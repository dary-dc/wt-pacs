#!/usr/bin/env bash
# E1 — does D_min saturate the link? docs/window-saturation-experiment.md §1
#
# Pass condition (fixed in advance): measured D_min — smallest depth reaching
# 95% of the D=64 ceiling util — is within ±1 of
#   pred = ceil(U × (1 + RTT/Tf)),  U=0.95, Tf = frame_bytes*8/read_bps
#
# RTT≈0 is a floor control only (pred collapses to 1). Real test is RTT>0.
# Default RTT path: harness --rtt-ms (userspace). USE_NETEM=1 for tc (needs CAP_NET_ADMIN).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$ROOT/.local/measurements/E1_SATURATION.tsv}"
SUMMARY="${SUMMARY:-$ROOT/.local/measurements/E1_SATURATION_SUMMARY.md}"
CERT="$ROOT/server/dev-cert/cert.pem"
KEY="$ROOT/server/dev-cert/key.pem"
PORT="${PORT:-4433}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

DEPTHS="${DEPTHS:-1,2,3,4,6,8,16,64}"
MBPS_LIST="${MBPS_LIST:-10}"
RTTS_MS="${RTTS_MS:-0,20,60,150}"
FILL_DWELL_MS="${FILL_DWELL_MS:-3000}"
U="${U:-0.95}"
USE_NETEM="${USE_NETEM:-0}"
IFACE="${IFACE:-lo}"
STUDIES="${STUDIES:-frames_32k:$ROOT/lab/fixtures/frames_32k/frames_32k.sbnd:32000:80,queue_large:$ROOT/lab/fixtures/queue_large/queue_large.sbnd:51000:20,frames_250k:$ROOT/lab/fixtures/frames_250k/frames_250k.sbnd:250000:80}"
FRAME_COUNT_DEFAULT="${FRAME_COUNT:-80}"

mkdir -p "$(dirname "$OUT")"
[[ -f "$CERT" ]] || "$ROOT/server/scripts/gen_dev_cert.sh"
[[ -f "$ROOT/lab/fixtures/frames_32k/frames_32k.sbnd" ]] || bash "$ROOT/lab/scripts/gen_tf_fixtures.sh"
cargo build -p exact-server -p window-harness --release >/dev/null

HARNESS="$CARGO_TARGET_DIR/release/window-harness"
SERVER="$CARGO_TARGET_DIR/release/exact-server"

{
  echo -e "study\tframe_bytes\tdepth\tmbps\trtt_ms\tlink_util\tfill_rate\tfill_bytes\tfill_frames\tpred_dmin\ttf_ms"
} > "$OUT"

CURRENT_RTT_MS=0
spid=""
cleanup() {
  kill "$spid" 2>/dev/null || true
  if [[ "$USE_NETEM" == "1" ]]; then
    tc qdisc del dev "$IFACE" root 2>/dev/null || true
  fi
}
trap cleanup EXIT

set_rtt() {
  local rtt_ms=$1
  CURRENT_RTT_MS=$rtt_ms
  if [[ "$USE_NETEM" == "1" ]]; then
    tc qdisc del dev "$IFACE" root 2>/dev/null || true
    if [[ "$rtt_ms" -gt 0 ]]; then
      local one_way
      one_way=$(python3 -c "print(max(0.001, float($rtt_ms) / 2.0))")
      if ! tc qdisc replace dev "$IFACE" root netem delay "${one_way}ms"; then
        echo "FATAL: tc netem failed — need CAP_NET_ADMIN (or unset USE_NETEM)." >&2
        exit 2
      fi
      echo "netem $IFACE delay ${one_way}ms (RTT≈${rtt_ms}ms)" >&2
    else
      echo "netem off (RTT≈0 floor)" >&2
    fi
  else
    echo "sim-rtt --rtt-ms=${rtt_ms}" >&2
  fi
}

pred_dmin() {
  local frame_bytes=$1 mbps=$2 rtt_ms=$3
  python3 -c "
import math
fb, mbps, rtt, U = $frame_bytes, $mbps, $rtt_ms, $U
bps = mbps * 1_000_000
tf_ms = fb * 8 / bps * 1000
pred = max(1, math.ceil(U * (1.0 + rtt / tf_ms)))
print(f'{pred} {tf_ms:.3f}')
"
}

run_one() {
  local study_name=$1 study_path=$2 frame_bytes=$3 frame_count=$4 depth=$5 mbps=$6 rtt_ms=$7
  local bps=$((mbps * 1000000))
  read -r pred tf_ms < <(pred_dmin "$frame_bytes" "$mbps" "$rtt_ms")

  kill "$spid" 2>/dev/null || true
  wait "$spid" 2>/dev/null || true
  "$SERVER" --port "$PORT" --study "$study_path" \
    --cert-pem "$CERT" --key-pem "$KEY" >/dev/null 2>&1 &
  spid=$!
  sleep 1.0

  local rtt_args=()
  if [[ "$USE_NETEM" != "1" ]]; then
    rtt_args+=(--rtt-ms "$rtt_ms")
  fi

  set +e
  local json
  json=$(timeout 60 "$HARNESS" --url "https://127.0.0.1:${PORT}/" --mode saturate \
    --read-bps "$bps" --depth "$depth" --frame-count "$frame_count" \
    --fill-dwell-ms "$FILL_DWELL_MS" --arm "D${depth}_rtt${rtt_ms}" \
    "${rtt_args[@]}" --json 2>/dev/null)
  local rc=$?
  set -e
  kill "$spid" 2>/dev/null || true
  wait "$spid" 2>/dev/null || true
  spid=""

  if [[ $rc -ne 0 ]]; then
    echo -e "${study_name}\t${frame_bytes}\t${depth}\t${mbps}\t${rtt_ms}\tFAIL\t-\t-\t-\t${pred}\t${tf_ms}" >> "$OUT"
    return
  fi
  printf '%s' "$json" | python3 -c "
import json,sys
name, fb, depth, mbps, rtt, pred, tf = sys.argv[1:8]
d=json.load(sys.stdin)
print(f\"{name}\t{fb}\t{depth}\t{mbps}\t{rtt}\t{d['link_util']:.4f}\t{d['fill_rate']:.2f}\t{d['fill_bytes']}\t{d['fill_frames']}\t{pred}\t{tf}\", flush=True)
" "$study_name" "$frame_bytes" "$depth" "$mbps" "$rtt_ms" "$pred" "$tf_ms" >> "$OUT"
}

IFS=',' read -ra DEPTH_ARR <<< "$DEPTHS"
IFS=',' read -ra MBPS_ARR <<< "$MBPS_LIST"
IFS=',' read -ra RTT_ARR <<< "$RTTS_MS"
IFS=',' read -ra STUDY_ARR <<< "$STUDIES"

n=0
total=$(( ${#DEPTH_ARR[@]} * ${#MBPS_ARR[@]} * ${#STUDY_ARR[@]} * ${#RTT_ARR[@]} ))
for rtt in "${RTT_ARR[@]}"; do
  set_rtt "$rtt"
  for spec in "${STUDY_ARR[@]}"; do
    IFS=':' read -r sname spath sbytes scount <<< "$spec"
    scount="${scount:-$FRAME_COUNT_DEFAULT}"
    [[ -f "$spath" ]] || { echo "missing $spath" >&2; continue; }
    for mbps in "${MBPS_ARR[@]}"; do
      for depth in "${DEPTH_ARR[@]}"; do
        n=$((n + 1))
        echo "[$n/$total] $sname depth=$depth mbps=$mbps rtt=$rtt" >&2
        run_one "$sname" "$spath" "$sbytes" "$scount" "$depth" "$mbps" "$rtt"
      done
    done
  done
done

if [[ "$USE_NETEM" == "1" ]]; then
  tc qdisc del dev "$IFACE" root 2>/dev/null || true
fi

echo "Wrote $OUT" >&2
python3 - "$OUT" "$SUMMARY" "$U" <<'PY'
import math, sys
from collections import defaultdict
from pathlib import Path

path, summary, U = sys.argv[1], sys.argv[2], float(sys.argv[3])
rows = []
with open(path) as f:
    hdr = f.readline()
    for line in f:
        p = line.strip().split("\t")
        if len(p) < 11 or p[5] == "FAIL":
            continue
        rows.append(p)

# key = (study, mbps, rtt) -> depth -> util
by = defaultdict(dict)
meta = {}
for r in rows:
    study, fb, d, mbps, rtt, util = r[0], int(r[1]), int(r[2]), r[3], int(r[4]), float(r[5])
    pred, tf = int(float(r[9])), float(r[10])
    by[(study, mbps, rtt)][d] = util
    meta[(study, mbps, rtt)] = (fb, pred, tf)

lines = []
lines.append("# E1 saturation sweep")
lines.append("")
lines.append(f"**U:** {U} · **ceiling control:** D=64 · **pass:** |meas_dmin − pred| ≤ 1")
lines.append("**RTT path:** harness `--rtt-ms` unless USE_NETEM=1")
lines.append("")
lines.append("RTT=0 is a **floor control** (pred→1). Gate answers are at RTT>0.")
lines.append("")
lines.append("| study | mbps | RTT ms | Tf ms | pred D | meas D_min | ceil util | D64 util | role | pass? |")
lines.append("| ----- | ---- | ------ | ----- | ------ | ---------- | --------- | -------- | ---- | ----- |")

gate_pass = []
gate_fail = []
for key in sorted(by, key=lambda k: (k[0], float(k[1]), k[2])):
    study, mbps, rtt = key
    util = by[key]
    fb, pred, tf = meta[key]
    role = "floor" if rtt == 0 else "gate"
    if 64 not in util:
        lines.append(f"| {study} | {mbps} | {rtt} | {tf:.1f} | {pred} | MISSING D=64 | — | — | {role} | invalid |")
        if rtt > 0:
            gate_fail.append(key)
        continue
    ceil = max(util.values())
    u64 = util[64]
    thresh = 0.95 * ceil
    meas = None
    for d in sorted(util):
        if util[d] >= thresh:
            meas = d
            break
    ok = meas is not None and abs(meas - pred) <= 1
    cell = "PASS" if ok else "FAIL"
    if role == "floor":
        cell = "n/a (floor)" if ok else f"FAIL floor ({meas} vs {pred})"
    else:
        (gate_pass if ok else gate_fail).append((study, mbps, rtt, pred, meas))
    lines.append(
        f"| {study} | {mbps} | {rtt} | {tf:.1f} | {pred} | {meas} | {ceil:.3f} | {u64:.3f} | {role} | {cell} |"
    )

lines.append("")
lines.append("## Verdict")
lines.append("")
if not any(k[2] > 0 for k in by):
    lines.append("**E1 not answered** — no RTT>0 points run.")
elif gate_fail:
    lines.append(
        f"**E1 fails** at {len(gate_fail)} gate point(s) under ±1 of predicted D_min. "
        "Do not treat the window formula as validated by saturation alone."
    )
else:
    lines.append(
        f"**E1 passes** at all {len(gate_pass)} gate point(s): measured D_min within ±1 of "
        "`ceil(U×(1+RTT/Tf))`."
    )

lines.append("")
lines.append(f"Raw TSV: `{Path(path).name}`.")
Path(summary).write_text("\n".join(lines) + "\n")
print("\n".join(lines))
PY
