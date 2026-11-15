#!/usr/bin/env bash
# Row 258 EXECGAP: does a warm co-tenant wait on the fill's inline WILLNEED (G1) or on the tile drain on
# drop (G2)? Four servers up for the whole run, G0 G0′ G1 G2, in order.py's order each round; each cell
# reads frames no earlier run read. Protocol and verdict: docs/adr/disk-access.md §9, finding 6.
#   lab/scripts/exec_gap.sh <series.sbnd> <out-dir> [--quick]
# The series must be larger than the host's page cache, on the device under test. BIN_DIR holds
# series-server-G0, -G1, -G2 and server_ab; unset, they are built from G0_REF, G0_REF + G1_PICK or G2_PICK, and
# AB_REF, the row's server_ab with --cotenant, --spread, --cycles and --close-after.
# ROUNDS (12), CODED (the series' NNN.htj2k, for XXH3), SERVER_CPUS / CLIENT_CPUS (taskset lists).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SERIES=$(realpath "${1:?usage: exec_gap.sh <series.sbnd> <out-dir> [--quick]}")
OUT=$(mkdir -p "${2:?usage: exec_gap.sh <series.sbnd> <out-dir> [--quick]}" && realpath "$2")
QUICK=$([[ "${3:-}" == --quick ]] && echo 1 || echo 0)
ROUNDS=${ROUNDS:-$( ((QUICK)) && echo 1 || echo 12)}
G0_REF=${G0_REF:-a1333bce}
G1_PICK=${G1_PICK:-0c0ba29e}
G2_PICK=${G2_PICK:-31805718}
AB_REF=${AB_REF:-c5eca138}
COT=${COT:-64}                                    # the co-tenant's warm frames, from frame 0
FILL_FRAMES=${FILL_FRAMES:-$( ((QUICK)) && echo 4 || echo 16)}
FILLS=$( ((QUICK)) && echo "2 4" || echo "16 64")
B_SESSIONS=$( ((QUICK)) && echo 2 || echo 16)
B_DEPTH=4 B_CLOSE=2                               # each closes with B_CLOSE frames in, the rest still asked
B_CYCLES=${B_CYCLES:-$( ((QUICK)) && echo 1 || echo 2)}
B_STEP=${B_STEP:-2}                               # tiles past read-ahead: §12, Make the miss real
ARMS=(G0 G0p G1 G2)

read -r FRAMES FRAME_BYTES < <(python3 - "$SERIES" <<'PY'
import os, struct, sys
with open(sys.argv[1], "rb") as f:
    head = f.read(16)
assert head[:4] == b"SBND", "not an SBND series"
n = struct.unpack("<I", head[12:16])[0]
print(n, os.path.getsize(sys.argv[1]) // n)
PY
)
GAP=$(( (4 << 20) / FRAME_BYTES + 2 ))            # past FILL_WINDOW's reach, so no range warms the next
FILL_SPREAD=$((FILL_FRAMES + GAP)) B_SPREAD=$(((B_CLOSE + B_DEPTH) * B_STEP + GAP))
PER_RUN=$(( (${FILLS/ /+}) * FILL_SPREAD + B_SESSIONS * B_CYCLES * B_SPREAD ))
NEED=$((COT + GAP + ROUNDS * ${#ARMS[@]} * PER_RUN))
((NEED <= FRAMES)) || { echo "exec_gap: needs $NEED unread frames, the series has $FRAMES" >&2; exit 1; }

if [[ -z "${BIN_DIR:-}" ]]; then
  BIN_DIR="$OUT/bin" T="$OUT/build"
  mkdir -p "$BIN_DIR"
  build() { # arm ref [pick]
    git -C "$ROOT" worktree add -q --detach "$T/$1" "$2"
    [[ -z "${3:-}" ]] || git -C "$T/$1" cherry-pick --no-commit "$3"
    (cd "$T/$1" && cargo build -q --release -p series-server --bin series-server --target-dir "$T/target")
    cp "$T/target/release/series-server" "$BIN_DIR/series-server-$1"
    git -C "$ROOT" worktree remove --force "$T/$1"
  }
  build G0 "$G0_REF"; build G1 "$G0_REF" "$G1_PICK"; build G2 "$G0_REF" "$G2_PICK"
  git -C "$ROOT" worktree add -q --detach "$T/ab" "$AB_REF"
  (cd "$T/ab" && cargo build -q --release -p disk-access-bench --bin server_ab --target-dir "$T/target")
  cp "$T/target/release/server_ab" "$BIN_DIR/"
  git -C "$ROOT" worktree remove --force "$T/ab"
  rm -rf "$T"
fi
[[ -f "$ROOT/server/dev-cert/cert.pem" ]] || bash "$ROOT/server/scripts/gen_dev_cert.sh"

dev=$(lsblk -no PKNAME "$(findmnt -no SOURCE -T "$SERIES")" 2>/dev/null | head -1 || true)
{
  echo "host $(hostname) $(date -u +%FT%TZ)"
  echo "kernel $(uname -r)"
  echo "fs $(findmnt -no FSTYPE,SOURCE -T "$SERIES")"
  echo "read_ahead_kb $(cat "/sys/class/bdi/$(mountpoint -d "$(findmnt -no TARGET -T "$SERIES")")/read_ahead_kb")"
  echo "nr_requests $(cat "/sys/block/$dev/queue/nr_requests" 2>/dev/null || echo "?") ($dev)"
  echo "thp $(cat /sys/kernel/mm/transparent_hugepage/enabled)"
  echo "glibc $(ldd --version | head -1)"
  echo "mem $(awk '/MemTotal/ {print $2, $3}' /proc/meminfo) · cpus $(nproc) · server ${SERVER_CPUS:-all} · client ${CLIENT_CPUS:-all}"
  echo "series $SERIES: $FRAMES frames of ~$FRAME_BYTES B, $(du -h "$SERIES" | cut -f1); needs $NEED"
  echo "arms G0=$G0_REF G1=+$G1_PICK G2=+$G2_PICK server_ab=$AB_REF bins $BIN_DIR · rounds $ROUNDS quick $QUICK"
} | tee "$OUT/host.txt"

pids=() ports=() logs=()
for arm in "${ARMS[@]}"; do
  port=$(python3 -c 'import socket;s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
  log="$OUT/server-$arm.log"
  NO_COLOR=1 RUST_LOG=series_server=warn,series_server::transport::pipeline=info \
    ${SERVER_CPUS:+taskset -c "$SERVER_CPUS"} "$BIN_DIR/series-server-${arm%p}" --port "$port" --series "$SERIES" \
    --bind 127.0.0.1 --cert-pem "$ROOT/server/dev-cert/cert.pem" --key-pem "$ROOT/server/dev-cert/key.pem" \
    >"$log" 2>&1 &
  pids+=($!) ports+=("$port") logs+=("$log")
done
trap 'kill "${pids[@]}" 2>/dev/null; wait 2>/dev/null' EXIT
for log in "${logs[@]}"; do
  for _ in $(seq 1 200); do grep -q '^telemetry=' "$log" && break; sleep 0.05; done
done

coded=()
[[ -z "${CODED:-}" ]] || coded=(--coded "$CODED")
sessions() { grep -c 'session reads' "$1" || true; }
# Hits, misses and ring-built sessions over the `session reads` lines after line $2 of log $1.
reads() {
  sed 's/\x1b\[[0-9;]*m//g' "$1" | grep 'session reads' | tail -n +"$(($2 + 1))" \
    | awk '{for (i = 1; i <= NF; i++) { split($i, kv, "="); if (kv[1] == "hits") h += kv[2]
             if (kv[1] == "misses") m += kv[2]; if ($i == "ring=true") r++ } }
           END {printf "%d\t%d\t%d", h, m, r}'
}
run() { # arm-index round cell start sessions-in-all driver-args...
  local i=$1 r=$2 cell=$3 start=$4 want=$(($5 + 1)) s0 row; shift 5
  s0=$(sessions "${logs[$i]}")
  row=$(${CLIENT_CPUS:+taskset -c "$CLIENT_CPUS"} "$BIN_DIR/server_ab" --url "https://127.0.0.1:${ports[$i]}/" \
    --server-pid "${pids[$i]}" --frames "$FRAMES" --start "$start" --cotenant "0:$COT" "${coded[@]}" \
    --label "$cell" --variant "${ARMS[$i]}" --temp "r$r" --no-header "$@")
  for _ in $(seq 1 100); do (( $(sessions "${logs[$i]}") - s0 >= want )) && break; sleep 0.05; done
  printf '%s\t%s\n' "$row" "$(reads "${logs[$i]}" "$s0")"
}

TSV="$OUT/exec_gap.tsv"
printf 'cell\tarm\tround\tmode\tdepth\tasks\tp50_ns\tp90_ns\tp99_ns\twall_ns\tasks_per_s\tcpu_ns_per_ask\trss_kib\tmiss_pct\tnamed\tcot_asks\tcot_p50_ns\tcot_p99_ns\tcot_max_ns\thits\tmisses\trings\n' >"$TSV"
for i in "${!ARMS[@]}"; do # the co-tenant's frames read once into the cache, by each server
  "$BIN_DIR/server_ab" --url "https://127.0.0.1:${ports[$i]}/" --frames "$FRAMES" --mode on-demand \
    --asks "$COT" --no-header >/dev/null
done
next=$((COT + GAP))
take() { start=$next; next=$((next + $1)); }
for r in $(seq 1 "$ROUNDS"); do
  for i in $(python3 "$ROOT/lab/scripts/order.py" row "${#ARMS[@]}" "$r"); do
    for fills in $FILLS; do
      take $((fills * FILL_SPREAD))
      run "$i" "$r" "a$fills" "$start" "$fills" \
        --mode fill --sessions "$fills" --asks "$FILL_FRAMES" --spread "$FILL_SPREAD" >>"$TSV"
    done
    take $((B_SESSIONS * B_CYCLES * B_SPREAD))
    run "$i" "$r" b "$start" $((B_SESSIONS * B_CYCLES)) --mode on-demand --sessions "$B_SESSIONS" --cycles "$B_CYCLES" --depth "$B_DEPTH" \
      --asks $((B_CLOSE + B_DEPTH)) --close-after "$B_CLOSE" --step "$B_STEP" --spread "$B_SPREAD" >>"$TSV"
  done
  echo "round $r done $(date -u +%T)" >&2
done
CORES=$(python3 -c "import sys; print(len(__import__('os').sched_getaffinity(${pids[0]})))")
python3 "$ROOT/lab/scripts/exec_gap_summary.py" "$TSV" "$CORES" | tee "$OUT/summary.txt"
