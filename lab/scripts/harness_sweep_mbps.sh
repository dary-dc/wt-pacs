#!/usr/bin/env bash
# Layer-2 harness sweep: read_bps vs recovered_ms on fly_and_settle (E1 prep).
# Against product exact-server (serial loop).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$ROOT/.local/measurements/HARNESS_SWEEP.tsv}"
STUDY="${STUDY:-$ROOT/lab/fixtures/queue_large/queue_large.sbnd}"
TRACE="${TRACE:-$ROOT/lab/traces/fly_and_settle.json}"
DEPTH="${DEPTH:-4}"
CERT="$ROOT/server/dev-cert/cert.pem"
KEY="$ROOT/server/dev-cert/key.pem"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

# Default: dense where it matters, sparse where sim is flat.
MBPS_MIN="${MBPS_MIN:-1}"
MBPS_MID="${MBPS_MID:-50}"
MBPS_MAX="${MBPS_MAX:-300}"
STEP_LOW="${STEP_LOW:-1}"
STEP_HIGH="${STEP_HIGH:-5}"

mkdir -p "$(dirname "$OUT")"
[[ -f "$CERT" ]] || "$ROOT/server/scripts/gen_dev_cert.sh"
cargo build -p exact-server -p window-harness --release >/dev/null

HARNESS="$CARGO_TARGET_DIR/release/window-harness"
SERVER="$CARGO_TARGET_DIR/release/exact-server"

mbps_list() {
  local v=$MBPS_MIN
  while [[ $v -le $MBPS_MID ]]; do
    echo "$v"
    v=$((v + STEP_LOW))
  done
  v=$((MBPS_MID + STEP_HIGH))
  while [[ $v -le $MBPS_MAX ]]; do
    echo "$v"
    v=$((v + STEP_HIGH))
  done
}

{
  echo -e "mbps\tdepth\trecovered_ms\tframes_on_wire\tbytes_on_wire\tframes_after_settle\tbytes_after_settle\twasted_bytes\tcommitment_depth"
} > "$OUT"

run_one() {
  local mbps=$1
  local bps=$((mbps * 1000000))
  "$SERVER" --port 4433 --study "$STUDY" \
    --cert-pem "$CERT" --key-pem "$KEY" >/dev/null 2>&1 &
  local sp=$!
  sleep 1.0
  set +e
  local json
  json=$("$HARNESS" --url "https://127.0.0.1:4433/" --trace "$TRACE" \
    --read-bps "$bps" --depth "$DEPTH" --json 2>/dev/null)
  local rc=$?
  set -e
  kill "$sp" 2>/dev/null || true
  wait "$sp" 2>/dev/null || true
  if [[ $rc -ne 0 ]]; then
    echo -e "${mbps}\t${DEPTH}\tFAIL\t-\t-\t-\t-\t-\t-" >> "$OUT"
    return
  fi
  printf '%s' "$json" | python3 -c "
import json, sys
mbps, depth = sys.argv[1], sys.argv[2]
d = json.load(sys.stdin)
print(
    f\"{mbps}\t{depth}\t{d['recovered_ms']:.2f}\t{d['frames_on_wire']}\t{d['bytes_on_wire']}\t\"
    f\"{d['frames_after_settle']}\t{d['bytes_after_settle']}\t{d['wasted_bytes']}\t{d['commitment_depth']}\",
    flush=True,
)
" "$mbps" "$DEPTH"
}

n=0
total=$(mbps_list | wc -l)
for mbps in $(mbps_list); do
  n=$((n + 1))
  echo "[$n/$total] ${mbps} Mbps depth=$DEPTH..." >&2
  run_one "$mbps" >> "$OUT"
done

echo "Wrote $OUT" >&2
