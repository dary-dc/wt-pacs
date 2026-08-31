#!/usr/bin/env bash
# Memory-pressure cell for disk-access-bench (evidence review §7 / C1).
# Limits the *bench process* so the study does not fit in the page cache.
#
# Usage:
#   lab/scripts/run_disk_access_mempressure.sh [limit] -- <disk-access-bench args...>
# Example:
#   lab/scripts/run_disk_access_mempressure.sh 48M -- \
#     --study lab/fixtures/frames_250k_live/frames_250k_live.sbnd \
#     --decision --temp cold --trace forward --access full \
#     --chunk 16384 --repeats 5 \
#     --out docs/measurements/r2/disk_access_mempressure.tsv
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LIMIT="${1:?limit e.g. 48M}"
shift
if [[ "${1:-}" == "--" ]]; then shift; fi

BENCH="${BENCH:-$ROOT/target/release/disk-access-bench}"
if [[ ! -x "$BENCH" ]]; then
  echo "build first: cargo build -p disk-access-bench --release" >&2
  exit 1
fi

# Best-effort drop of the study's page cache before entering the limited cgroup
# (so study pages are charged to the limited cgroup, not the parent).
STUDY=""
prev=""
for a in "$@"; do
  if [[ -n "$prev" && "$prev" == "--study" ]]; then STUDY="$a"; break; fi
  prev="$a"
done
if [[ -n "$STUDY" && -f "$STUDY" ]]; then
  python3 - "$STUDY" <<'PY' || true
import os, sys, ctypes
path = sys.argv[1]
libc = ctypes.CDLL(None, use_errno=True)
fd = os.open(path, os.O_RDWR)
os.fsync(fd)
POSIX_FADV_DONTNEED = 4
libc.posix_fadvise(fd, ctypes.c_longlong(0), ctypes.c_longlong(0), POSIX_FADV_DONTNEED)
os.close(fd)
PY
fi

SUDO=()
if [[ "$(id -u)" -ne 0 ]] && sudo -n true 2>/dev/null; then
  SUDO=(sudo -n)
fi

run_in_cg() {
  local cg="$1"
  shift
  if [[ ${#SUDO[@]} -gt 0 ]] || [[ ! -w "$cg/cgroup.procs" ]]; then
    # Join cgroup then drop privileges back to the invoking user for the bench.
    local uid gid
    uid="$(id -u)"
    gid="$(id -g)"
    "${SUDO[@]}" bash -c "
      echo \$\$ > '$cg/cgroup.procs'
      exec setpriv --reuid=$uid --regid=$gid --clear-groups -- $(printf '%q ' "$@")
    "
  else
    echo $$ > "$cg/cgroup.procs"
    exec "$@"
  fi
}

if [[ -f /sys/fs/cgroup/cgroup.controllers ]]; then
  CG="/sys/fs/cgroup/l3-disk-$$"
  if ! mkdir -p "$CG" 2>/dev/null; then
    "${SUDO[@]}" mkdir -p "$CG"
  fi
  if ! echo "$LIMIT" > "$CG/memory.max" 2>/dev/null; then
    "${SUDO[@]}" bash -c "echo '$LIMIT' > '$CG/memory.max'"
  fi
  MAX="$(cat "$CG/memory.max" 2>/dev/null || "${SUDO[@]}" cat "$CG/memory.max")"
  echo "mempressure limit=$LIMIT cgroup=$CG memory.max=$MAX" >&2
  cleanup() { "${SUDO[@]}" rmdir "$CG" 2>/dev/null || rmdir "$CG" 2>/dev/null || true; }
  trap cleanup EXIT
  run_in_cg "$CG" "$BENCH" "$@"
elif [[ -d /sys/fs/cgroup/memory ]]; then
  CG="/sys/fs/cgroup/memory/l3-disk-$$"
  "${SUDO[@]}" mkdir -p "$CG"
  "${SUDO[@]}" bash -c "echo '$LIMIT' > '$CG/memory.limit_in_bytes'"
  echo "mempressure limit=$LIMIT cgroup=$CG (v1)" >&2
  cleanup() { "${SUDO[@]}" rmdir "$CG" 2>/dev/null || true; }
  trap cleanup EXIT
  run_in_cg "$CG" "$BENCH" "$@"
else
  echo "no usable cgroup memory controller; aborting (would NOT be a pressure cell)" >&2
  exit 1
fi
