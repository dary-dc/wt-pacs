#!/usr/bin/env bash
# S3 — the regime our deployment actually runs in: misses caused by eviction, not by fadvise.
#
# Every cell in the campaign so far force-evicts the study and then reads it once, so a miss
# is always a *first* touch of a study that would have fitted in RAM anyway. A tens-of-GB
# study on a cloud box never gets that luxury: pages are evicted under pressure while the
# session is still using them, and the steady-state hit rate is set by
# `working set / available cache`, not by read-ahead.
#
# This caps the page cache available to the bench with a cgroup memory limit and sweeps that
# ratio. `warm` cells are the point: the warm phase reads the whole working set, the cap
# throws most of it away, and the timed phase then measures what a session actually finds
# resident in steady state.
#
#   sudo lab/scripts/run_mempressure_campaign.sh <study.sbnd> <trace.tsv> <outdir> [label]
#
# Requires root and cgroup v1 memory (or v2 with the memory controller delegated).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STUDY="${1:?usage: run_mempressure_campaign.sh <study.sbnd> <trace.tsv> <outdir> [label]}"
TRACE="${2:?trace tsv}"
OUT="${3:?outdir}"
LABEL="${4:-v19}"
BIN="$ROOT/target/release/read_campaign"
REPEATS="${REPEATS:-6}"
DEPTHS="${DEPTHS:-1,8}"
ARMS="${ARMS:-pool,uring,hybrid}"
CAPS="${CAPS:-2048M 256M 96M}"
CG_ROOT=/sys/fs/cgroup/memory
CG="$CG_ROOT/readpath_mp"

[[ -x "$BIN" ]] || { echo "build first: cargo build -p disk-access-bench --release" >&2; exit 1; }
[[ -d "$CG_ROOT" ]] || { echo "no cgroup v1 memory controller at $CG_ROOT" >&2; exit 1; }
mkdir -p "$OUT"

to_bytes() {
  case "$1" in
    *M|*m) echo $(( ${1%[Mm]} * 1024 * 1024 )) ;;
    *G|*g) echo $(( ${1%[Gg]} * 1024 * 1024 * 1024 )) ;;
    *) echo "$1" ;;
  esac
}

cleanup() { rmdir "$CG" 2>/dev/null || true; }
trap cleanup EXIT

TSV="$OUT/${LABEL}_mempressure.tsv"
: > "$TSV"
first=1
for cap in $CAPS; do
  bytes=$(to_bytes "$cap")
  cleanup
  mkdir -p "$CG"
  echo "$bytes" > "$CG/memory.limit_in_bytes"
  # A limit that did not take would silently turn this into an ordinary warm run, so read it
  # back and refuse rather than publish a cell that measured nothing.
  got=$(cat "$CG/memory.limit_in_bytes")
  if [[ "$got" -gt $(( bytes + 4096 )) || "$got" -lt $(( bytes - 4096 )) ]]; then
    echo "cgroup limit did not take: asked $bytes, got $got" >&2
    exit 1
  fi
  echo "==> cap $cap ($got bytes)" >&2

  # Drop the study from the page cache first. In cgroup v1 a page is charged to whichever
  # group first faults it in, so pages left over from a previous run stay charged to root and
  # the cap never binds — which is exactly how the first attempt at this cell reported a
  # 2.6 MB peak and a 0.0% miss rate against a 238 MB working set.
  python3 - "$STUDY" <<'EVICT'
import os, sys
fd = os.open(sys.argv[1], os.O_RDONLY)
try:
    os.posix_fadvise(fd, 0, os.fstat(fd).st_size, os.POSIX_FADV_DONTNEED)
finally:
    os.close(fd)
EVICT

  hdr=(); [[ $first -eq 1 ]] || hdr=(--no-header); first=0
  # `sh -c 'echo $$ > tasks; exec ...'` joins the cgroup before exec, so every page the
  # bench faults in — anon and page cache alike — is charged to the capped group.
  sh -c "echo \$\$ > $CG/tasks; exec $BIN --study '$STUDY' --trace '$TRACE' \
      --arms $ARMS --depths $DEPTHS --readers 1 --temps warm --monitors 0 \
      --repeats $REPEATS --label ${LABEL}_cap${cap} ${hdr[*]}" >> "$TSV"
  echo "    peak usage $(cat "$CG/memory.max_usage_in_bytes" 2>/dev/null) bytes, \
failcnt $(cat "$CG/memory.failcnt" 2>/dev/null)" >&2
done

echo "results: $TSV" >&2
