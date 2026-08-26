#!/usr/bin/env bash
# E2 — cache miss cost on reversal. docs/window-saturation-experiment.md §2
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$ROOT/.local/measurements/E2_MISS_COST.tsv}"
STUDY="${STUDY:-$ROOT/lab/fixtures/queue_large/queue_large.sbnd}"
CERT="$ROOT/server/dev-cert/cert.pem"
KEY="$ROOT/server/dev-cert/key.pem"
PORT="${PORT:-4433}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

DEPTHS="${DEPTHS:-1,2,4,8}"
MBPS="${MBPS:-10}"
FRAME_BYTES="${FRAME_BYTES:-51000}"
FRAME_COUNT="${FRAME_COUNT:-20}"

mkdir -p "$(dirname "$OUT")"
[[ -f "$CERT" ]] || "$ROOT/server/scripts/gen_dev_cert.sh"
cargo build -p exact-server -p window-harness --release >/dev/null

HARNESS="$CARGO_TARGET_DIR/release/window-harness"
SERVER="$CARGO_TARGET_DIR/release/exact-server"
BPS=$((MBPS * 1000000))
# Tf ms ≈ frame_bytes*8/bps * 1000
TF_MS=$(python3 -c "print(f'{$FRAME_BYTES * 8 / $BPS * 1000:.2f}')")

{
  echo -e "group\tdepth\tmbps\trecovered_ms\tpredicted_ms\twarm_cache\ttrace"
} > "$OUT"

run_one() {
  local group=$1 depth=$2 trace=$3 warm=$4
  local pred
  pred=$(python3 -c "print(f'{max(0, $depth - 1) * $FRAME_BYTES * 8 / $BPS * 1000:.2f}')")
  "$SERVER" --port "$PORT" --study "$STUDY" \
    --cert-pem "$CERT" --key-pem "$KEY" >/dev/null 2>&1 &
  local sp=$!
  sleep 1.0
  local extra=()
  [[ "$warm" == "1" ]] && extra+=(--warm-cache)
  set +e
  local json
  json=$("$HARNESS" --url "https://127.0.0.1:${PORT}/" --mode trace \
    --trace "$trace" --read-bps "$BPS" --depth "$depth" \
    --frame-count "$FRAME_COUNT" --fill-dwell-ms 0 \
    --arm "$group" "${extra[@]}" --json 2>/dev/null)
  local rc=$?
  set -e
  kill "$sp" 2>/dev/null || true
  wait "$sp" 2>/dev/null || true
  if [[ $rc -ne 0 ]]; then
    echo -e "${group}\t${depth}\t${MBPS}\tFAIL\t${pred}\t${warm}\t$(basename "$trace")" >> "$OUT"
    return
  fi
  printf '%s' "$json" | python3 -c "
import json,sys
group, depth, mbps, pred, warm, trace = sys.argv[1:7]
d=json.load(sys.stdin)
print(f\"{group}\t{depth}\t{mbps}\t{d['recovered_ms']:.2f}\t{pred}\t{warm}\t{trace}\", flush=True)
" "$group" "$depth" "$MBPS" "$pred" "$warm" "$(basename "$trace")" >> "$OUT"
}

IFS=',' read -ra DEPTH_ARR <<< "$DEPTHS"
REV="$ROOT/lab/traces/reversal_storm.json"
FLY="$ROOT/lab/traces/fly_and_settle_window.json"
[[ -f "$FLY" ]] || FLY="$ROOT/lab/traces/fly_and_settle.json"

n=0
# treatment + floor + no-miss + warm
total=$(( ${#DEPTH_ARR[@]} * 3 + ${#DEPTH_ARR[@]} ))
for depth in "${DEPTH_ARR[@]}"; do
  n=$((n+1)); echo "[$n] treatment D=$depth" >&2
  run_one treatment "$depth" "$REV" 0
  n=$((n+1)); echo "[$n] no_miss D=$depth" >&2
  run_one no_miss "$depth" "$FLY" 0
  n=$((n+1)); echo "[$n] warm_cache D=$depth" >&2
  run_one warm_cache "$depth" "$REV" 1
done

echo "Tf_ms≈$TF_MS at ${MBPS} Mbps, frame_bytes=$FRAME_BYTES" >&2
echo "Wrote $OUT" >&2
python3 - "$OUT" "$TF_MS" <<'PY'
import sys
path, tf = sys.argv[1], float(sys.argv[2])
rows=[]
with open(path) as f:
    f.readline()
    for line in f:
        p=line.strip().split('\t')
        if len(p)<7 or p[3]=='FAIL': continue
        rows.append(p)
print("\n=== E2 summary ===")
print(f"{'group':<12} {'D':>3} {'meas_ms':>8} {'pred_ms':>8} {'ratio':>6}")
for r in rows:
    group, d, meas, pred = r[0], r[1], float(r[3]), float(r[4])
    ratio = (meas/pred) if pred>1e-6 else (0.0 if meas<1 else 999.0)
    print(f"{group:<12} {d:>3} {meas:8.1f} {pred:8.1f} {ratio:6.2f}")
warm=[float(r[3]) for r in rows if r[0]=='warm_cache']
print(f"\nwarm_cache mean recovered_ms={sum(warm)/len(warm) if warm else 'n/a'} (pass ≈ 0)")
PY
