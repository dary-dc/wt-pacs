#!/usr/bin/env bash
# Memory-pressure cell for disk-access-bench (evidence review §7 / C1).
# Limits the *bench process* so the study does not fit in the page cache.
#
# Aborts unless the limit is a *real* cgroup controller (not a plain file on tmpfs)
# and the bench process confirms it via `--require-cgroup-mem-bytes`.
#
# Usage:
#   lab/scripts/run_disk_access_mempressure.sh [limit] -- <disk-access-bench args...>
# Example (produces docs/disk-access/c1_mempressure_multi.tsv):
#   lab/scripts/run_disk_access_mempressure.sh 48M -- \
#     --study lab/fixtures/frames_250k_live/frames_250k_live.sbnd \
#     --arm mmap-naive --arm mmap-hybrid-mincore --arm mmap-blocking-touch \
#     --arm pread-blocking-pooled --arm pread-nowait --arm pread-nowait-chunked \
#     --temp cold --trace forward --chunk 16384 --repeats 5 --read-chunk 65536 \
#     --runtime multi --out docs/disk-access/c1_mempressure_multi.tsv
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

# Parse 48M / 48m / 50331648 → bytes for the in-process assert.
limit_to_bytes() {
  local s="$1"
  if [[ "$s" =~ ^([0-9]+)[Kk]$ ]]; then echo $(( ${BASH_REMATCH[1]} * 1024 ))
  elif [[ "$s" =~ ^([0-9]+)[Mm]$ ]]; then echo $(( ${BASH_REMATCH[1]} * 1024 * 1024 ))
  elif [[ "$s" =~ ^([0-9]+)[Gg]$ ]]; then echo $(( ${BASH_REMATCH[1]} * 1024 * 1024 * 1024 ))
  elif [[ "$s" =~ ^[0-9]+$ ]]; then echo "$s"
  else
    echo "cannot parse limit='$s' (want e.g. 48M or byte count)" >&2
    exit 1
  fi
}
LIMIT_BYTES="$(limit_to_bytes "$LIMIT")"

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

# Reject a plain file posing as memory.max (tmpfs mkdir + echo).
assert_real_cgroup_dir() {
  local cg="$1"
  local kind="$2" # v2 | v1
  local fstype
  fstype="$(stat -f -c %T "$cg" 2>/dev/null || stat -c %T "$cg" 2>/dev/null || echo unknown)"
  # `stat -f -c %T` names cgroup v1 "cgroupfs" and v2 "cgroup2fs"; keep both spellings
  # plus the raw mount names so a v1 host is a real pressure cell, not a refused one.
  case "$fstype" in
    cgroup2fs|cgroupfs|cgroup|cgroup2) ;;
    *)
      echo "FATAL: $cg is not a cgroup filesystem (stat type='$fstype'). Refusing fake pressure cell." >&2
      exit 1
      ;;
  esac
  if [[ "$kind" == v2 ]]; then
    if [[ ! -e "$cg/memory.current" ]]; then
      echo "FATAL: $cg/memory.current missing — not a real memory cgroup." >&2
      exit 1
    fi
    local max
    max="$(cat "$cg/memory.max")"
    if [[ "$max" == "max" ]]; then
      echo "FATAL: $cg/memory.max is unlimited." >&2
      exit 1
    fi
    if [[ "$max" -gt $LIMIT_BYTES ]]; then
      echo "FATAL: memory.max=$max > requested $LIMIT_BYTES." >&2
      exit 1
    fi
    echo "mempressure limit=$LIMIT ($LIMIT_BYTES B) cgroup=$cg memory.max=$max fstype=$fstype" >&2
  else
    if [[ ! -e "$cg/memory.usage_in_bytes" ]]; then
      echo "FATAL: $cg is a v1 cgroup but not the memory controller." >&2
      exit 1
    fi
    local lim
    lim="$(cat "$cg/memory.limit_in_bytes")"
    if [[ "$lim" -gt $LIMIT_BYTES ]]; then
      echo "FATAL: memory.limit_in_bytes=$lim > requested $LIMIT_BYTES." >&2
      exit 1
    fi
    echo "mempressure limit=$LIMIT ($LIMIT_BYTES B) cgroup=$cg memory.limit_in_bytes=$lim fstype=$fstype (v1)" >&2
  fi
}

run_in_cg() {
  local cg="$1"
  shift
  # Always pass in-process assert so a wrapper bug cannot silently clear the gate.
  local -a bench_args=(--require-cgroup-mem-bytes "$LIMIT_BYTES" "$@")
  if [[ ${#SUDO[@]} -gt 0 ]] || [[ ! -w "$cg/cgroup.procs" ]]; then
    local uid gid
    uid="$(id -u)"
    gid="$(id -g)"
    "${SUDO[@]}" bash -c "
      echo \$\$ > '$cg/cgroup.procs'
      exec setpriv --reuid=$uid --regid=$gid --clear-groups -- $(printf '%q ' "$BENCH" "${bench_args[@]}")
    "
  else
    echo $$ > "$cg/cgroup.procs"
    exec "$BENCH" "${bench_args[@]}"
  fi
}

if [[ -f /sys/fs/cgroup/cgroup.controllers ]]; then
  CG="/sys/fs/cgroup/l3-disk-$$"
  if [[ ${#SUDO[@]} -gt 0 ]]; then
    "${SUDO[@]}" mkdir -p "$CG"
    "${SUDO[@]}" bash -c "echo '$LIMIT' > '$CG/memory.max'"
  else
    mkdir -p "$CG"
    echo "$LIMIT" > "$CG/memory.max"
  fi
  assert_real_cgroup_dir "$CG" v2
  cleanup() { "${SUDO[@]}" rmdir "$CG" 2>/dev/null || rmdir "$CG" 2>/dev/null || true; }
  trap cleanup EXIT
  run_in_cg "$CG" "$@"
elif [[ -d /sys/fs/cgroup/memory ]]; then
  CG="/sys/fs/cgroup/memory/l3-disk-$$"
  # Root needs no sudo; a non-root user with no sudo cannot create the cgroup at all.
  if [[ ${#SUDO[@]} -eq 0 && "$(id -u)" -ne 0 ]]; then
    echo "cgroup v1 path needs root (or passwordless sudo) to create $CG" >&2
    exit 1
  fi
  "${SUDO[@]}" mkdir -p "$CG"
  "${SUDO[@]}" bash -c "echo '$LIMIT' > '$CG/memory.limit_in_bytes'"
  assert_real_cgroup_dir "$CG" v1
  cleanup() { "${SUDO[@]}" rmdir "$CG" 2>/dev/null || true; }
  trap cleanup EXIT
  run_in_cg "$CG" "$@"
else
  echo "no usable cgroup memory controller; aborting (would NOT be a pressure cell)" >&2
  exit 1
fi
