#!/usr/bin/env bash
# Window-depth × priority 2×2 against lab/window-server (not product exact-server).
# See docs/window-depth-and-priority-experiment.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$ROOT/.local/measurements/WINDOW_DEPTH.tsv}"
STUDY="${STUDY:-$ROOT/lab/fixtures/queue_large/queue_large.sbnd}"
TRACE="${TRACE:-$ROOT/lab/traces/fly_and_settle_window.json}"
CERT="$ROOT/server/dev-cert/cert.pem"
KEY="$ROOT/server/dev-cert/key.pem"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

DEPTHS="${DEPTHS:-1,2,4,8}"
MBPS_LIST="${MBPS_LIST:-10,25}"
FILL_DWELL_MS="${FILL_DWELL_MS:-2000}"
FRAME_COUNT="${FRAME_COUNT:-20}"

mkdir -p "$(dirname "$OUT")"
[[ -f "$CERT" ]] || "$ROOT/server/scripts/gen_dev_cert.sh"
cargo build -p window-server -p queue-harness --release >/dev/null

HARNESS="$CARGO_TARGET_DIR/release/queue-harness"
SERVER="$CARGO_TARGET_DIR/release/window-server"

{
  echo -e "arm\torder\tstream_cap\tdepth\tmbps\trecovered_ms\tfill_rate\tframes_on_wire\twasted_bytes\tcommitment_depth"
} > "$OUT"

run_one() {
  local arm=$1 order=$2 cap=$3 depth=$4 mbps=$5
  local bps=$((mbps * 1000000))
  "$SERVER" --port 4433 --study "$STUDY" \
    --cert-pem "$CERT" --key-pem "$KEY" \
    --order "$order" --stream-cap "$cap" >/dev/null 2>&1 &
  local sp=$!
  sleep 1.0
  set +e
  local json
  json=$("$HARNESS" --url "https://127.0.0.1:4433/" --trace "$TRACE" \
    --read-bps "$bps" --depth "$depth" --frame-count "$FRAME_COUNT" \
    --fill-dwell-ms "$FILL_DWELL_MS" --arm "$arm" --json 2>/dev/null)
  local rc=$?
  set -e
  kill "$sp" 2>/dev/null || true
  wait "$sp" 2>/dev/null || true
  if [[ $rc -ne 0 ]]; then
    echo -e "${arm}\t${order}\t${cap}\t${depth}\t${mbps}\tFAIL\t-\t-\t-\t-" >> "$OUT"
    return
  fi
  printf '%s' "$json" | python3 -c "
import json, sys
arm, order, cap, depth, mbps = sys.argv[1:6]
d = json.load(sys.stdin)
print(
    f\"{arm}\t{order}\t{cap}\t{depth}\t{mbps}\t{d['recovered_ms']:.2f}\t{d['fill_rate']:.2f}\t\"
    f\"{d['frames_on_wire']}\t{d['wasted_bytes']}\t{d['commitment_depth']}\",
    flush=True,
)
" "$arm" "$order" "$cap" "$depth" "$mbps" >> "$OUT"
}

IFS=',' read -ra DEPTH_ARR <<< "$DEPTHS"
IFS=',' read -ra MBPS_ARR <<< "$MBPS_LIST"

declare -a ARMS=(
  "A fifo 0"
  "B generation 0"
  "C generation 1"
  "D fifo 1"
)

n=0
total=$(( ${#DEPTH_ARR[@]} * ${#MBPS_ARR[@]} * ${#ARMS[@]} ))
for depth in "${DEPTH_ARR[@]}"; do
  for mbps in "${MBPS_ARR[@]}"; do
    for spec in "${ARMS[@]}"; do
      n=$((n + 1))
      set -- $spec
      arm=$1 order=$2 cap=$3
      echo "[$n/$total] arm=$arm depth=$depth mbps=$mbps" >&2
      run_one "$arm" "$order" "$cap" "$depth" "$mbps"
    done
  done
done

echo "Wrote $OUT" >&2
