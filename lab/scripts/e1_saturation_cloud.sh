#!/usr/bin/env bash
# E1 saturation on cloud — server tc netem + 10 Mbps. docs/window-saturation-experiment.md §1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/lab/scripts/cloud_common.sh"

OUT="${OUT:-$ROOT/.local/measurements/cloud/E1_SATURATION.tsv}"
SUMMARY="${SUMMARY:-$ROOT/.local/measurements/cloud/E1_SATURATION_SUMMARY.md}"
DEPTHS="${DEPTHS:-1,2,3,4,6,8,16,64}"
RTTS_MS="${RTTS_MS:-30,50,90,180}"
MBPS="${MBPS:-10}"
FRAME_BYTES="${FRAME_BYTES:-250000}"
FRAME_COUNT="${FRAME_COUNT:-80}"
FILL_DWELL_MS="${FILL_DWELL_MS:-3000}"
U="${U:-0.95}"
SKIP_BUILD="${SKIP_BUILD:-1}"

cloud_precheck_ratio "$FRAME_BYTES" "$MBPS" 185 "E1 reference (250 KB @ 10 Mbps)" || true
ensure_harness_binary
cloud_sync_netem_script
cloud_ensure_server

mkdir -p "$(dirname "$OUT")"
echo -e "depth\tmbps\trtt_ms\tlink_util\tfill_rate\tfill_bytes\tfill_frames\tpred_dmin\ttf_ms" > "$OUT"

pred_dmin() {
  python3 -c "
import math
fb, mbps, rtt, U = $FRAME_BYTES, $MBPS, $1, $U
bps = mbps * 1_000_000
tf_ms = fb * 8 / bps * 1000
pred = max(1, math.ceil(U * (1.0 + rtt / tf_ms)))
print(f'{pred} {tf_ms:.3f}')
"
}

IFS=',' read -ra DEPTH_ARR <<< "$DEPTHS"
IFS=',' read -ra RTT_ARR <<< "$RTTS_MS"

cleanup() { cloud_set_netem off 2>/dev/null || true; }
trap cleanup EXIT

n=0
total=$((${#DEPTH_ARR[@]} * ${#RTT_ARR[@]}))
for rtt in "${RTT_ARR[@]}"; do
  cloud_set_netem "$rtt"
  for depth in "${DEPTH_ARR[@]}"; do
    n=$((n + 1))
    echo "[$n/$total] E1 cloud depth=$depth rtt~=$rtt" >&2
    read -r pred tf_ms < <(pred_dmin "$rtt")
    set +e
    json=$("$HARNESS" --url "$CLOUD_URL" --mode saturate \
      --read-bps "$HARNESS_READ_BPS" --depth "$depth" --frame-count "$FRAME_COUNT" \
      --fill-dwell-ms "$FILL_DWELL_MS" --arm "e1_D${depth}_rtt${rtt}" --rtt-ms 0 --json 2>/dev/null)
    rc=$?
    set -e
    if [[ $rc -ne 0 ]]; then
      echo -e "${depth}\t${MBPS}\t${rtt}\tFAIL\t-\t-\t-\t${pred}\t${tf_ms}" >> "$OUT"
      continue
    fi
    printf '%s' "$json" | python3 -c "
import json,sys
depth, mbps, rtt, pred, tf = sys.argv[1:6]
d=json.load(sys.stdin)
print(f\"{depth}\t{mbps}\t{rtt}\t{d['link_util']:.4f}\t{d['fill_rate']:.2f}\t{d['fill_bytes']}\t{d['fill_frames']}\t{pred}\t{tf}\", flush=True)
" "$depth" "$MBPS" "$rtt" "$pred" "$tf_ms" >> "$OUT"
  done
done

cloud_set_netem off

python3 - "$OUT" "$SUMMARY" "$U" "$MBPS" <<'PY'
import sys
from collections import defaultdict
from pathlib import Path

path, summary, U, mbps = sys.argv[1:5]
U = float(U)
rows = []
with open(path) as f:
    f.readline()
    for line in f:
        p = line.strip().split("\t")
        if len(p) < 9 or p[3] == "FAIL":
            continue
        rows.append(p)

by = defaultdict(dict)
meta = {}
for r in rows:
    d, rtt, util, pred, tf = int(r[0]), int(r[2]), float(r[3]), int(float(r[7])), float(r[8])
    by[rtt][d] = util
    meta[rtt] = (pred, tf)

lines = ["# E1 saturation — cloud", "", f"**Path:** server tc {mbps} Mbps · **U:** {U}", ""]
lines.append("| RTT ms | pred D | meas D_min | ceil | D64 | pass? |")
lines.append("| ------ | ------ | ---------- | ---- | --- | ----- |")
gate_ok = True
for rtt in sorted(by):
    util = by[rtt]
    pred, tf = meta[rtt]
    if 64 not in util:
        lines.append(f"| {rtt} | {pred} | — | — | — | invalid |")
        gate_ok = False
        continue
    ceil = max(util.values())
    meas = next((d for d in sorted(util) if util[d] >= 0.95 * ceil), None)
    ok = meas is not None and abs(meas - pred) <= 1
    if not ok:
        gate_ok = False
    lines.append(f"| {rtt} | {pred} | {meas} | {ceil:.3f} | {util[64]:.3f} | {'PASS' if ok else 'FAIL'} |")

lines += ["", "## Verdict", ""]
lines.append("**E1 PASS**" if gate_ok else "**E1 FAIL** — D_min off by >1 at some RTT.")
Path(summary).write_text("\n".join(lines) + "\n")
print("\n".join(lines))
PY

echo "Wrote $SUMMARY" >&2
