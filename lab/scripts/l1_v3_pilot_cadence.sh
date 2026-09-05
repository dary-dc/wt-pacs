#!/usr/bin/env bash
# L1 v3 Phase 6 — A1 cadence pilots (S arm only).
# For each cell: 3 runs at --step-interval-ms 0 → f_cell → freeze
#   step_interval_ms = round(1000 / (0.9 × median_f_cell))
#
# Does NOT collect decision rows. Output:
#   docs/measurements/r2/l1_v3_cadence.json
#   docs/measurements/r2/l1_s_vs_q_loss_v3.pilot.tsv
#   docs/measurements/r2/raw/l1v3/pilot/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_rig_agent}"
# shellcheck source=/dev/null
source "$ROOT/lab/scripts/cloud_common.sh"

SKIP_BUILD="${SKIP_BUILD:-0}"
# A1: override with L1_FIX_FC=160 for Phase-B re-pilots / collect-aligned cadence.
FIX_FC="${L1_FIX_FC:-${FIX_FC:-80}}"
WINDOW_SHAPE=forward
READ_BPS=0
HARNESS_TIMEOUT_MS=180000
CELL_TIMEOUT_S=300
PILOT_REPEATS="${PILOT_REPEATS:-3}"

if [[ "$FIX_FC" == "160" ]]; then
  STUDY="$ROOT/lab/fixtures/frames_32k_160/frames_32k_160.sbnd"
  TRACE="$ROOT/lab/traces/l1_one_way_160.json"
else
  STUDY="$ROOT/lab/fixtures/frames_32k/frames_32k.sbnd"
  TRACE="$ROOT/lab/traces/l1_one_way_80.json"
fi
BIN_MAIN="${BIN_MAIN:-$ROOT/.local/r2/bin-main-exact-server}"
HARNESS_BIN="${HARNESS_BIN:-$ROOT/.local/r2/window-harness}"
CERT="${CERT:-$ROOT/server/dev-cert/cert.pem}"
KEY_PEM="${KEY_PEM:-$ROOT/server/dev-cert/key.pem}"
PATH_TSV="${PATH_TSV:-$ROOT/docs/measurements/r2/l1_s_vs_q_loss_v3.path.tsv}"

SRV_IP=10.77.0.1
REMOTE_BASE=/home/ubuntu/wt-pacs
REMOTE_BIN=$REMOTE_BASE/bin
REMOTE_CERT=$REMOTE_BASE/cert
REMOTE_FIX=$REMOTE_BASE/fixtures
REMOTE_SCRIPTS=$REMOTE_BASE/scripts
REMOTE_TRACES=$REMOTE_BASE/traces
REMOTE_RAW=/tmp/l1v3-pilot
RAW_DIR="${RAW_DIR:-$ROOT/docs/measurements/r2/raw/l1v3/pilot}"
OUT_TSV="${OUT_TSV:-$ROOT/docs/measurements/r2/l1_s_vs_q_loss_v3.pilot.tsv}"
CADENCE_JSON="${CADENCE_JSON:-$ROOT/docs/measurements/r2/l1_v3_cadence.json}"

# Small-collect cells (RTT 60) + optional RTT 150 for later scale-up.
# Format: rtt:loss:depth
CELLS="${CELLS:-60:0:4 60:0.5:4 60:2:4 150:0:7 150:0.5:7}"

mkdir -p "$RAW_DIR" "$(dirname "$OUT_TSV")"

echo "=== L1 v3 A1 cadence pilots $(date -Iseconds) ==="

[[ -f "$PATH_TSV" ]] || {
  echo "STOP: missing path validation TSV ($PATH_TSV)" >&2
  exit 4
}
[[ -f "$SSH_KEY" ]] || { echo "STOP: missing SSH_KEY=$SSH_KEY" >&2; exit 1; }
[[ -f "$STUDY" && -f "$TRACE" ]] || { echo "missing study/trace" >&2; exit 1; }
[[ -f "$CERT" && -f "$KEY_PEM" ]] || bash "$ROOT/server/scripts/gen_dev_cert.sh"

if [[ "$SKIP_BUILD" != "1" ]]; then
  bash "$ROOT/lab/scripts/l1_build_bins.sh"
fi
[[ -x "$BIN_MAIN" && -x "$HARNESS_BIN" ]] || { echo "missing binaries" >&2; exit 1; }

cleanup() {
  echo "RIG RELEASE" >&2
  "${SSH[@]}" "sudo -n $REMOTE_SCRIPTS/l1_veth_netem.sh off" 2>/dev/null || true
  "${SSH[@]}" 'rm -f /home/ubuntu/wt-pacs/locks/netem.holder' 2>/dev/null || true
}
trap cleanup EXIT

"${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
mkdir -p /home/ubuntu/wt-pacs/locks
H=/home/ubuntu/wt-pacs/locks/netem.holder
if [[ -f "$H" ]]; then
  if ! find "$H" -mmin +180 | grep -q .; then
    cur=$(cat "$H")
    case "$cur" in
      L1-v3*) ;;
      *) echo "STOP: rig held by $cur" >&2; exit 1 ;;
    esac
  fi
fi
echo "L1-v3-pilot $(date -Iseconds)" > "$H"
REMOTE

"${SSH[@]}" "mkdir -p $REMOTE_BIN $REMOTE_CERT $REMOTE_FIX $REMOTE_SCRIPTS $REMOTE_TRACES $REMOTE_RAW"
"${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
sudo -n pkill -x exact-server 2>/dev/null || true
sudo -n pkill -f '/home/ubuntu/wt-pacs/bin/exact-server' 2>/dev/null || true
sudo -n pkill -f '/home/ubuntu/wt-pacs/bin/window-harness' 2>/dev/null || true
for p in 4435 4436 4437; do
  sudo -n fuser -k "${p}/tcp" 2>/dev/null || true
  sudo -n fuser -k "${p}/udp" 2>/dev/null || true
done
sleep 1
REMOTE

"${SCP[@]}" "$ROOT/lab/scripts/l1_veth_setup.sh" "$ROOT/lab/scripts/l1_veth_netem.sh" \
  "$REMOTE:$REMOTE_SCRIPTS/"
"${SSH[@]}" "chmod +x $REMOTE_SCRIPTS/l1_veth_setup.sh $REMOTE_SCRIPTS/l1_veth_netem.sh"
"${SCP[@]}" "$CERT" "$KEY_PEM" "$REMOTE:$REMOTE_CERT/"
"${SCP[@]}" "$STUDY" "$REMOTE:$REMOTE_FIX/"
"${SCP[@]}" "$TRACE" "$REMOTE:$REMOTE_TRACES/"
"${SCP[@]}" "$HARNESS_BIN" "$REMOTE:$REMOTE_BIN/window-harness"
"${SCP[@]}" "$BIN_MAIN" "$REMOTE:$REMOTE_BIN/exact-server-main"
"${SSH[@]}" "chmod +x $REMOTE_BIN/*"

echo "==> veth setup"
"${SSH[@]}" "sudo -n $REMOTE_SCRIPTS/l1_veth_setup.sh"

"${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
for port in 4435 4436 4437; do
  if ! sudo -n iptables -C INPUT -p udp --dport "$port" -j ACCEPT 2>/dev/null; then
    reject_line=$(sudo -n iptables -L INPUT -n --line-numbers | awk '/REJECT/{print $1; exit}')
    if [[ -n "${reject_line:-}" ]]; then
      sudo -n iptables -I INPUT "$reject_line" -p udp --dport "$port" -j ACCEPT
    else
      sudo -n iptables -A INPUT -p udp --dport "$port" -j ACCEPT
    fi
  fi
done
REMOTE

deploy_s() {
  local study_r="$REMOTE_FIX/$(basename "$STUDY")"
  "${SSH[@]}" 'bash -s' "$study_r" <<'REMOTE'
set -euo pipefail
STUDY=$1
sudo -n pkill -x exact-server 2>/dev/null || true
sudo -n pkill -f '/home/ubuntu/wt-pacs/bin/exact-server' 2>/dev/null || true
for p in 4435; do
  sudo -n fuser -k "${p}/udp" 2>/dev/null || true
done
sleep 1
setsid env RUST_LOG=warn nohup /home/ubuntu/wt-pacs/bin/exact-server-main \
  --port 4435 --study "$STUDY" \
  --cert-pem /home/ubuntu/wt-pacs/cert/cert.pem \
  --key-pem /home/ubuntu/wt-pacs/cert/key.pem \
  --stream-mode shared \
  >/tmp/wt-pacs-exact-S.log 2>&1 < /dev/null &
disown
sleep 2
ss -lun | grep -q ':4435 ' || { cat /tmp/wt-pacs-exact-S.log; exit 1; }
echo "S up"
REMOTE
}

set_netem() {
  local rtt=$1 loss=$2
  "${SSH[@]}" "sudo -n env RATE=10mbit $REMOTE_SCRIPTS/l1_veth_netem.sh $rtt $loss iid" >/dev/null
}

run_pilot() {
  local rtt=$1 loss=$2 depth=$3 run=$4
  local loss_tag=${loss//./p}
  local tag="S_rtt${rtt}_loss${loss_tag}_d${depth}_r${run}"
  local url="https://${SRV_IP}:4435/"
  local remote_raw="$REMOTE_RAW/${tag}.json"
  local remote_err="$REMOTE_RAW/${tag}.err"
  local remote_trace="$REMOTE_TRACES/$(basename "$TRACE")"

  set +e
  "${SSH[@]}" "sudo -n ip netns exec wt-cli timeout $CELL_TIMEOUT_S \
    $REMOTE_BIN/window-harness \
      --url '$url' \
      --trace '$remote_trace' \
      --read-bps $READ_BPS \
      --timeout-ms $HARNESS_TIMEOUT_MS \
      --depth $depth \
      --frame-count $FIX_FC \
      --fill-dwell-ms 0 \
      --mode trace \
      --rtt-ms 0 \
      --arm S \
      --stream-mode shared \
      --window-shape $WINDOW_SHAPE \
      --step-interval-ms 0 \
      --json \
      >'$remote_raw' 2>'$remote_err'"
  local rc=$?
  set -e
  "${SCP[@]}" "$REMOTE:$remote_raw" "$RAW_DIR/${tag}.json" 2>/dev/null || true
  "${SCP[@]}" "$REMOTE:$remote_err" "$RAW_DIR/${tag}.err" 2>/dev/null || true
  if [[ $rc -ne 0 ]]; then
    echo "FAIL harness_rc=$rc tag=$tag" >&2
    cat "$RAW_DIR/${tag}.err" 2>/dev/null || true
    return $rc
  fi
  python3 -c "
import json
m=json.load(open('$RAW_DIR/${tag}.json'))
fw=float(m['frames_on_wire']); sl=float(m['step_loop_ms'])
assert sl>0 and fw>0, m
f_cell=fw/(sl/1000.0)
print(f\"{f_cell:.6f}\t{m['frames_on_wire']}\t{m['step_loop_ms']:.3f}\t{m['asks_sent']}\t{m['cache_misses']}\t{m['miss_p95_wait_ms']:.3f}\")
"
}

cat >"$OUT_TSV" <<'HDR'
arm	rtt_label_ms	loss_pct	depth	run	f_cell_fps	frames_on_wire	step_loop_ms	asks_sent	cache_misses	miss_p95_wait_ms	role
HDR

deploy_s

declare -a CELL_KEYS=()
declare -A CELL_F=()

for cell in $CELLS; do
  IFS=: read -r rtt loss depth <<<"$cell"
  echo "==> pilot cell rtt=$rtt loss=$loss D=$depth (step-interval-ms=0, n=$PILOT_REPEATS)"
  set_netem "$rtt" "$loss"
  rates=()
  for run in $(seq 1 "$PILOT_REPEATS"); do
    echo -n "  run=$run → "
    line=$(run_pilot "$rtt" "$loss" "$depth" "$run")
    echo "$line"
    f_cell=$(echo "$line" | cut -f1)
    fw=$(echo "$line" | cut -f2)
    sl=$(echo "$line" | cut -f3)
    asks=$(echo "$line" | cut -f4)
    misses=$(echo "$line" | cut -f5)
    miss_p95=$(echo "$line" | cut -f6)
    rates+=("$f_cell")
    printf 'S\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\tpilot\n' \
      "$rtt" "$loss" "$depth" "$run" "$f_cell" "$fw" "$sl" "$asks" "$misses" "$miss_p95" >>"$OUT_TSV"
  done
  key="${rtt}_${loss}_${depth}"
  CELL_KEYS+=("$key")
  CELL_F[$key]="${rates[*]}"
done

python3 - "$CADENCE_JSON" "$OUT_TSV" "$FIX_FC" "${CELL_KEYS[@]}" <<'PY'
import json, math, statistics, sys
from pathlib import Path

out_path = Path(sys.argv[1])
pilot_tsv = Path(sys.argv[2])
fix_fc = int(sys.argv[3])
keys = sys.argv[4:]

# Re-read rates from TSV for stability.
from collections import defaultdict
by = defaultdict(list)
with open(pilot_tsv) as f:
    hdr = f.readline().strip().split("\t")
    for line in f:
        r = dict(zip(hdr, line.strip().split("\t")))
        k = f"{r['rtt_label_ms']}_{r['loss_pct']}_{r['depth']}"
        by[k].append(float(r["f_cell_fps"]))

cells = []
for k in keys:
    rtt, loss, depth = k.split("_", 2)
    vals = by[k]
    assert len(vals) >= 1, k
    f_med = statistics.median(vals)
    assert f_med > 0.5, (k, f_med)
    step = int(round(1000.0 / (0.9 * f_med)))
    step = max(1, step)
    # Sanity: reader should not be slower than ~2s/step or faster than 1ms.
    assert 1 <= step <= 2000, (k, step, f_med)
    cell = {
        "rtt_label_ms": int(rtt),
        "loss_pct": float(loss),
        "depth": int(depth),
        "loss_model": "iid",
        "f_cell_pilot_fps": round(f_med, 4),
        "f_cell_pilot_runs": [round(v, 4) for v in vals],
        "step_interval_ms": step,
        "rule": "step_interval_ms = round(1000 / (0.9 * median_f_cell)); S-arm pilots at step-interval-ms=0",
        "arms_use_same_cadence": ["S", "P", "Q"],
    }
    cells.append(cell)
    print(
        f"FREEZE rtt={rtt} loss={loss} D={depth}: "
        f"f_cell_med={f_med:.3f} fps → step_interval_ms={step}"
    )

trace_rel = "lab/traces/l1_one_way_160.json" if fix_fc == 160 else "lab/traces/l1_one_way_80.json"
fix_rel = (
    "lab/fixtures/frames_32k_160/frames_32k_160.sbnd"
    if fix_fc == 160
    else "lab/fixtures/frames_32k/frames_32k.sbnd"
)
doc = {
    "status": "frozen_for_review",
    "note": "Pilots excluded from decision analysis. Do not retune mid-collect (S11).",
    "trace": trace_rel,
    "fixture": fix_rel,
    "window_shape": "forward",
    "fixture_frame_count": fix_fc,
    "reader_model": {
        "name": "clinical_under_delivery",
        "factor": 0.9,
        "doc": "docs/lanes/L1-v3-phase-b-regime-reader.md",
    },
    "regime_doc": "docs/lanes/L1-v3-phase-b-regime-reader.md",
    "review_doc": "docs/lanes/L1-v3-complete-plan.md",
    "cells": cells,
}
out_path.write_text(json.dumps(doc, indent=2) + "\n")
print(f"Wrote {out_path}")
PY

echo "Pilots complete. Cadence frozen at $CADENCE_JSON"
echo "REVIEW before PHASE=collect / small collect."
