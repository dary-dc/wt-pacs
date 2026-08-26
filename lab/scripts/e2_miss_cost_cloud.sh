#!/usr/bin/env bash
# E2 miss cost on cloud — mild cell trace (reversal @ 60%). docs/window-saturation-experiment.md §2
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/lab/scripts/cloud_common.sh"

OUT="${OUT:-$ROOT/.local/measurements/cloud/E2_MISS_COST.tsv}"
SUMMARY="${SUMMARY:-$ROOT/.local/measurements/cloud/E2_MISS_COST_SUMMARY.md}"
REV="${REV:-$ROOT/lab/traces/mild_cell_scroll.json}"
FLY="${FLY:-$ROOT/lab/traces/fly_and_settle.json}"
DEPTHS="${DEPTHS:-1,2,4,8}"
RTTS_MS="${RTTS_MS:-30,50,90,180}"
MBPS="${LINK_MBPS:-10}"
FRAME_BYTES="${FRAME_BYTES:-250000}"
FRAME_COUNT="${FRAME_COUNT:-320}"
SKIP_BUILD="${SKIP_BUILD:-1}"

STEP_MS=185
cloud_precheck_ratio "$FRAME_BYTES" "$MBPS" "$STEP_MS" "mild (E2)"
ensure_harness_binary
cloud_sync_netem_script
cloud_ensure_server

BPS=$((MBPS * 1000000))
TF_MS=$(python3 -c "print($FRAME_BYTES * 8 / $BPS * 1000)")

mkdir -p "$(dirname "$OUT")"
echo -e "group\tdepth\trtt_ms\trecovered_ms\tpredicted_ms\twarm_cache\ttrace" > "$OUT"

run_one() {
  local group=$1 depth=$2 trace=$3 warm=$4 rtt=$5
  local pred
  pred=$(python3 -c "print(max(0, $depth - 1) * $FRAME_BYTES * 8 / $BPS * 1000)")
  cloud_set_netem "$rtt"
  local extra=()
  [[ "$warm" == "1" ]] && extra+=(--warm-cache)
  set +e
  local json
  json=$("$HARNESS" --url "$CLOUD_URL" --mode trace --trace "$trace" \
    --read-bps "$HARNESS_READ_BPS" --depth "$depth" --frame-count "$FRAME_COUNT" \
    --fill-dwell-ms 0 --arm "${group}_rtt${rtt}" "${extra[@]}" --rtt-ms 0 --json 2>/dev/null)
  local rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    echo -e "${group}\t${depth}\t${rtt}\tFAIL\t${pred}\t${warm}\t$(basename "$trace")" >> "$OUT"
    return
  fi
  printf '%s' "$json" | python3 -c "
import json,sys
g,d,rtt,pred,warm,tr=sys.argv[1:7]
o=json.load(sys.stdin)
print(f'{g}\t{d}\t{rtt}\t{o[\"recovered_ms\"]:.2f}\t{pred}\t{warm}\t{tr}', flush=True)
" "$group" "$depth" "$rtt" "$pred" "$warm" "$(basename "$trace")" >> "$OUT"
}

IFS=',' read -ra DEPTH_ARR <<< "$DEPTHS"
IFS=',' read -ra RTT_ARR <<< "$RTTS_MS"

cleanup() { cloud_set_netem off 2>/dev/null || true; }
trap cleanup EXIT

for rtt in "${RTT_ARR[@]}"; do
  for depth in "${DEPTH_ARR[@]}"; do
    echo "E2 cloud rtt=$rtt treatment D=$depth" >&2
    run_one treatment "$depth" "$REV" 0 "$rtt"
    run_one no_miss "$depth" "$FLY" 0 "$rtt"
    run_one warm_cache "$depth" "$REV" 1 "$rtt"
  done
done

cloud_set_netem off

python3 - "$OUT" "$SUMMARY" "$TF_MS" <<'PY'
import sys
from pathlib import Path
from statistics import mean

path, summary, tf = sys.argv[1], sys.argv[2], float(sys.argv[3])
rows = []
with open(path) as f:
    f.readline()
    for line in f:
        p = line.strip().split("\t")
        if len(p) < 7 or p[3] == "FAIL":
            continue
        rows.append(p)

lines = ["# E2 miss cost — cloud", "", f"**Tf ≈ {tf:.1f} ms** · metric: recovered_ms (reversal→wanted)", ""]
lines.append("| group | D | RTT | meas | pred | ratio |")
lines.append("| ----- | - | --- | ---- | ---- | ----- |")
warm = []
for r in rows:
    g, d, rtt, meas, pred = r[0], r[1], r[2], float(r[3]), float(r[4])
    ratio = meas / pred if pred > 1e-6 else 0
    lines.append(f"| {g} | {d} | {rtt} | {meas:.1f} | {pred:.1f} | {ratio:.2f} |")
    if g == "warm_cache":
        warm.append(meas)

lines += ["", "## Verdict", ""]
w = mean(warm) if warm else None
if w is not None and w > 50:
    lines.append(f"**Warm-cache control high ({w:.1f} ms)** — metric may be invalid.")
else:
    lines.append(f"Warm-cache mean ≈ {w:.1f} ms. Treatment should track (D−1)·Tf within 20%.")
Path(summary).write_text("\n".join(lines) + "\n")
print("\n".join(lines))
PY

echo "Wrote $SUMMARY" >&2
