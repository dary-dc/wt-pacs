#!/usr/bin/env bash
# E1 — does D_min saturate the link? docs/window-saturation-experiment.md §1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$ROOT/.local/measurements/E1_SATURATION.tsv}"
CERT="$ROOT/server/dev-cert/cert.pem"
KEY="$ROOT/server/dev-cert/key.pem"
PORT="${PORT:-4433}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

DEPTHS="${DEPTHS:-1,2,3,4,6,8,16,64}"
MBPS_LIST="${MBPS_LIST:-10,25}"
FILL_DWELL_MS="${FILL_DWELL_MS:-3000}"
STUDIES="${STUDIES:-frames_32k:$ROOT/lab/fixtures/frames_32k/frames_32k.sbnd:32000:80,queue_large:$ROOT/lab/fixtures/queue_large/queue_large.sbnd:51000:20,frames_250k:$ROOT/lab/fixtures/frames_250k/frames_250k.sbnd:250000:80}"
FRAME_COUNT_DEFAULT="${FRAME_COUNT:-80}"

mkdir -p "$(dirname "$OUT")"
[[ -f "$CERT" ]] || "$ROOT/server/scripts/gen_dev_cert.sh"
[[ -f "$ROOT/lab/fixtures/frames_32k/frames_32k.sbnd" ]] || bash "$ROOT/lab/scripts/gen_tf_fixtures.sh"
cargo build -p exact-server -p window-harness --release >/dev/null

HARNESS="$CARGO_TARGET_DIR/release/window-harness"
SERVER="$CARGO_TARGET_DIR/release/exact-server"

{
  echo -e "study\tframe_bytes\tdepth\tmbps\tlink_util\tfill_rate\tfill_bytes\tfill_frames\tpredicted_dmin_rtt0"
} > "$OUT"

run_one() {
  local study_name=$1 study_path=$2 frame_bytes=$3 frame_count=$4 depth=$5 mbps=$6
  local bps=$((mbps * 1000000))
  # RTT≈0 on localhost pacing → predicted D_min = 1
  local pred=1
  "$SERVER" --port "$PORT" --study "$study_path" \
    --cert-pem "$CERT" --key-pem "$KEY" >/dev/null 2>&1 &
  local sp=$!
  sleep 1.0
  set +e
  local json
  json=$("$HARNESS" --url "https://127.0.0.1:${PORT}/" --mode saturate \
    --read-bps "$bps" --depth "$depth" --frame-count "$frame_count" \
    --fill-dwell-ms "$FILL_DWELL_MS" --arm "D${depth}" --json 2>/dev/null)
  local rc=$?
  set -e
  kill "$sp" 2>/dev/null || true
  wait "$sp" 2>/dev/null || true
  if [[ $rc -ne 0 ]]; then
    echo -e "${study_name}\t${frame_bytes}\t${depth}\t${mbps}\tFAIL\t-\t-\t-\t${pred}" >> "$OUT"
    return
  fi
  printf '%s' "$json" | python3 -c "
import json,sys
name, fb, depth, mbps, pred = sys.argv[1:6]
d=json.load(sys.stdin)
print(f\"{name}\t{fb}\t{depth}\t{mbps}\t{d['link_util']:.4f}\t{d['fill_rate']:.2f}\t{d['fill_bytes']}\t{d['fill_frames']}\t{pred}\", flush=True)
" "$study_name" "$frame_bytes" "$depth" "$mbps" "$pred" >> "$OUT"
}

IFS=',' read -ra DEPTH_ARR <<< "$DEPTHS"
IFS=',' read -ra MBPS_ARR <<< "$MBPS_LIST"
IFS=',' read -ra STUDY_ARR <<< "$STUDIES"

n=0
total=$(( ${#DEPTH_ARR[@]} * ${#MBPS_ARR[@]} * ${#STUDY_ARR[@]} ))
for spec in "${STUDY_ARR[@]}"; do
  IFS=':' read -r sname spath sbytes scount <<< "$spec"
  scount="${scount:-$FRAME_COUNT_DEFAULT}"
  [[ -f "$spath" ]] || { echo "missing $spath" >&2; continue; }
  for mbps in "${MBPS_ARR[@]}"; do
    for depth in "${DEPTH_ARR[@]}"; do
      n=$((n + 1))
      echo "[$n/$total] $sname depth=$depth mbps=$mbps" >&2
      run_one "$sname" "$spath" "$sbytes" "$scount" "$depth" "$mbps"
    done
  done
done

echo "Wrote $OUT" >&2
python3 - "$OUT" <<'PY'
import sys
from collections import defaultdict
path=sys.argv[1]
rows=[]
with open(path) as f:
    hdr=f.readline()
    for line in f:
        p=line.strip().split('\t')
        if len(p)<9 or p[4]=='FAIL': continue
        rows.append(p)
# per study,mbps: find measured D_min = smallest D with util >= 0.95 * util(D=64)
by=defaultdict(dict)
for r in rows:
    study, fb, d, mbps, util = r[0], r[1], int(r[2]), r[3], float(r[4])
    by[(study, mbps)][d]=util
print("\n=== E1 summary (RTT≈0, predicted D_min=1) ===")
print(f"{'study':<14} {'mbps':>4} {'max_util':>8} {'d_at_max':>8} {'u64':>7} {'meas_dmin':>9} {'pred':>4} {'pass':>5}")
for key in sorted(by):
    util=by[key]
    if 64 not in util:
        print(f"{key[0]:<14} {key[1]:>4}  MISSING D=64 ceiling control")
        continue
    d_max=max(util, key=util.get)
    ceil=util[d_max]
    u64=util[64]
    thresh=0.95*ceil
    meas=None
    for d in sorted(util):
        if util[d] >= thresh:
            meas=d
            break
    pred=1
    ok = meas is not None and abs(meas-pred)<=1
    print(f"{key[0]:<14} {key[1]:>4} {ceil:8.3f} {d_max:8d} {u64:7.3f} {str(meas):>9} {pred:>4} {str(ok):>5}")
PY
