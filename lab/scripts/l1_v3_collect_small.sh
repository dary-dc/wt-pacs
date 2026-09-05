#!/usr/bin/env bash
# L1 v3 Phase C — small directional collect (SSH body).
#
# Refuses unless ALL of:
#   APPROVE_SMALL_COLLECT=1
#   docs/lanes/L1-v3-phase-b-regime-reader.md exists
#   cadence JSON carries reader_model + frozen status
#
# TSV stamped DIRECTIONAL — NOT A DECISION. Not a ship decision.
# DRY_RUN=1 validates A-gates locally without SSH.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_rig_agent}"
# shellcheck source=/dev/null
source "$ROOT/lab/scripts/cloud_common.sh"
# shellcheck source=/dev/null
source "$ROOT/lab/scripts/l1_v3_common.sh"

COMPLETE_PLAN="$ROOT/docs/lanes/L1-v3-complete-plan.md"
PHASE_B_DOC="$ROOT/docs/lanes/L1-v3-phase-b-regime-reader.md"
CADENCE_JSON="${CADENCE_JSON:-$ROOT/docs/measurements/r2/l1_v3_cadence.json}"
PATH_TSV="${PATH_TSV:-$ROOT/docs/measurements/r2/l1_s_vs_q_loss_v3.path.tsv}"
OUT_TSV="${OUT_TSV:-$ROOT/docs/measurements/r2/l1_s_vs_q_loss_v3.small.tsv}"
RAW_DIR="${RAW_DIR:-$ROOT/docs/measurements/r2/raw/l1v3/small}"
SUMMARY_MD="${SUMMARY_MD:-$ROOT/docs/measurements/r2/raw/l1v3/small/DIRECTIONAL_SUMMARY.md}"

REPEATS_NULL="${REPEATS_NULL:-10}"
REPEATS_DOSE_LOW="${REPEATS_DOSE_LOW:-10}"
REPEATS_DOSE_HIGH="${REPEATS_DOSE_HIGH:-10}"
MAX_ASK_RATIO="${MAX_ASK_RATIO:-1.25}"
# Null "large unexplained gap" stop (pathology), not the 15% product bar.
NULL_REL_STOP="${NULL_REL_STOP:-0.40}"
NULL_ABS_STOP_MS="${NULL_ABS_STOP_MS:-200}"
SKIP_BUILD="${SKIP_BUILD:-0}"
WINDOW_SHAPE=forward
READ_BPS=0
HARNESS_TIMEOUT_MS="${HARNESS_TIMEOUT_MS:-240000}"
CELL_TIMEOUT_S="${CELL_TIMEOUT_S:-360}"
L1_INTERLEAVE_SEED="${L1_INTERLEAVE_SEED:-20260905}"

BIN_MAIN="${BIN_MAIN:-$ROOT/.local/r2/bin-main-exact-server}"
BIN_Q="${BIN_Q:-$ROOT/.local/r2/bin-q-exact-server}"
HARNESS_BIN="${HARNESS_BIN:-$ROOT/.local/r2/window-harness}"
CERT="${CERT:-$ROOT/server/dev-cert/cert.pem}"
KEY_PEM="${KEY_PEM:-$ROOT/server/dev-cert/key.pem}"

SRV_IP=10.77.0.1
REMOTE_BASE=/home/ubuntu/wt-pacs
REMOTE_BIN=$REMOTE_BASE/bin
REMOTE_CERT=$REMOTE_BASE/cert
REMOTE_FIX=$REMOTE_BASE/fixtures
REMOTE_SCRIPTS=$REMOTE_BASE/scripts
REMOTE_TRACES=$REMOTE_BASE/traces
REMOTE_RAW=/tmp/l1v3-small

declare -A ARM_MODE=([S]=shared [P]=per-frame [Q]=per-frame)
declare -A ARM_PORT=([S]=4435 [P]=4436 [Q]=4437)
declare -A ARM_ASK_PRI=([S]=0 [P]=0 [Q]=1)

if [[ "${APPROVE_SMALL_COLLECT:-0}" != "1" ]]; then
  echo "STOP: small collect not approved." >&2
  echo "  Set APPROVE_SMALL_COLLECT=1 only after Phases A–B sign-off." >&2
  echo "  See $COMPLETE_PLAN" >&2
  exit 3
fi

[[ -f "$COMPLETE_PLAN" ]] || { echo "STOP: missing $COMPLETE_PLAN" >&2; exit 4; }
[[ -f "$PHASE_B_DOC" ]] || { echo "STOP: Phase B note missing ($PHASE_B_DOC)." >&2; exit 4; }
[[ -f "$PATH_TSV" ]] || { echo "STOP: missing path validation $PATH_TSV" >&2; exit 4; }
[[ -f "$CADENCE_JSON" ]] || { echo "STOP: missing cadence $CADENCE_JSON" >&2; exit 4; }

python3 - "$CADENCE_JSON" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1]))
rm = doc.get("reader_model") or {}
if not rm.get("name"):
    raise SystemExit("STOP: cadence JSON missing reader_model.name (Phase B incomplete)")
st = doc.get("status") or ""
if st not in ("frozen_for_review", "frozen_phase_b", "frozen"):
    raise SystemExit(f"STOP: cadence status={st!r} not frozen")
print(f"cadence_ok reader_model={rm['name']} factor={rm.get('factor')}")
PY

l1_require_study_trace
PROTOCOL_SHA="$(l1_protocol_sha)"
CADENCE_SHA="$(l1_cadence_sha "$CADENCE_JSON")"
SERVER_SHA="$(sha256sum "$BIN_MAIN" | awk '{print $1}')"

mkdir -p "$RAW_DIR" "$(dirname "$OUT_TSV")"
l1_write_directional_header "$OUT_TSV"

echo "=== L1 v3 small collect (DIRECTIONAL) $(date -Iseconds) ==="
echo "fixture_fc=$L1_FIX_FC study=$(basename "$L1_STUDY") trace=$(basename "$L1_TRACE")"
echo "protocol_sha=$PROTOCOL_SHA cadence_sha=$CADENCE_SHA"
echo "server_sha=$SERVER_SHA"

cadence_step() {
  local rtt=$1 loss=$2
  python3 - "$CADENCE_JSON" "$rtt" "$loss" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1]))
rtt, loss = int(sys.argv[2]), float(sys.argv[3])
for c in doc["cells"]:
    if int(c["rtt_label_ms"]) == rtt and abs(float(c["loss_pct"]) - loss) < 1e-9:
        print(int(c["step_interval_ms"]))
        raise SystemExit(0)
raise SystemExit(f"STOP: no cadence cell rtt={rtt} loss={loss}")
PY
}

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "DRY_RUN=1 — validate A-gates locally; no SSH collect body."
  echo "-- interleaved schedule (first 12) --"
  L1_INTERLEAVE_SEED="$L1_INTERLEAVE_SEED" l1_interleave_arms "$REPEATS_NULL" S P Q | head -12
  step="$(cadence_step 60 0)"
  echo "precheck null cell step_ms=$step"
  l1_precheck_ratio "$step" "dry_null_60_0"
  sample="$(ls "$ROOT"/docs/measurements/r2/raw/l1v3/pilot/S_rtt60_loss0_d4_r*.json | head -1)"
  echo "sample=$sample"
  l1_assert_frame_bytes "$sample"
  echo -n "regime="; l1_stamp_regime "$sample" 0
  set +e
  tail_line="$(l1_tail_gate "$sample" 2>/dev/null)"
  trc=$?
  set -e
  echo "tail_gate_line=$tail_line exit=$trc (80-frame pilots may FAIL L1_TAIL_MIN=$L1_TAIL_MIN — expected)"
  echo "header:"; head -2 "$OUT_TSV"
  echo "DRY_RUN complete."
  exit 0
fi

# --- live SSH collect ---
[[ -f "$SSH_KEY" ]] || { echo "STOP: missing SSH_KEY=$SSH_KEY" >&2; exit 1; }
[[ -f "$CERT" && -f "$KEY_PEM" ]] || bash "$ROOT/server/scripts/gen_dev_cert.sh"
if [[ "$SKIP_BUILD" != "1" ]]; then
  bash "$ROOT/lab/scripts/l1_build_bins.sh"
fi
[[ -x "$BIN_MAIN" && -x "$BIN_Q" && -x "$HARNESS_BIN" ]] || {
  echo "STOP: missing binaries" >&2
  exit 1
}
SERVER_SHA="$(sha256sum "$BIN_MAIN" | awk '{print $1}')"

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
echo "L1-v3-small $(date -Iseconds)" > "$H"
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
"${SCP[@]}" "$L1_STUDY" "$REMOTE:$REMOTE_FIX/"
"${SCP[@]}" "$L1_TRACE" "$REMOTE:$REMOTE_TRACES/"
"${SCP[@]}" "$HARNESS_BIN" "$REMOTE:$REMOTE_BIN/window-harness"
"${SCP[@]}" "$BIN_MAIN" "$REMOTE:$REMOTE_BIN/exact-server-main"
"${SCP[@]}" "$BIN_Q" "$REMOTE:$REMOTE_BIN/exact-server-q"
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

deploy_spq() {
  local study_r="$REMOTE_FIX/$(basename "$L1_STUDY")"
  "${SSH[@]}" 'bash -s' "$study_r" <<'REMOTE'
set -euo pipefail
STUDY=$1
sudo -n pkill -x exact-server 2>/dev/null || true
sudo -n pkill -f '/home/ubuntu/wt-pacs/bin/exact-server' 2>/dev/null || true
for p in 4435 4436 4437; do
  sudo -n fuser -k "${p}/tcp" 2>/dev/null || true
  sudo -n fuser -k "${p}/udp" 2>/dev/null || true
done
sleep 1
# S shared · P per-frame · Q per-frame + ask-priority (same binary)
setsid env RUST_LOG=warn nohup /home/ubuntu/wt-pacs/bin/exact-server-main \
  --port 4435 --study "$STUDY" \
  --cert-pem /home/ubuntu/wt-pacs/cert/cert.pem \
  --key-pem /home/ubuntu/wt-pacs/cert/key.pem \
  --stream-mode shared \
  >/tmp/wt-pacs-exact-S.log 2>&1 < /dev/null &
disown
setsid env RUST_LOG=warn nohup /home/ubuntu/wt-pacs/bin/exact-server-main \
  --port 4436 --study "$STUDY" \
  --cert-pem /home/ubuntu/wt-pacs/cert/cert.pem \
  --key-pem /home/ubuntu/wt-pacs/cert/key.pem \
  --stream-mode per-frame \
  >/tmp/wt-pacs-exact-P.log 2>&1 < /dev/null &
disown
setsid env RUST_LOG=warn nohup /home/ubuntu/wt-pacs/bin/exact-server-q \
  --port 4437 --study "$STUDY" \
  --cert-pem /home/ubuntu/wt-pacs/cert/cert.pem \
  --key-pem /home/ubuntu/wt-pacs/cert/key.pem \
  --stream-mode per-frame --ask-priority \
  >/tmp/wt-pacs-exact-Q.log 2>&1 < /dev/null &
disown
sleep 2
ss -lun | grep -q ':4435 ' || { cat /tmp/wt-pacs-exact-S.log; exit 1; }
ss -lun | grep -q ':4436 ' || { cat /tmp/wt-pacs-exact-P.log; exit 1; }
ss -lun | grep -q ':4437 ' || { cat /tmp/wt-pacs-exact-Q.log; exit 1; }
echo "S+P+Q up"
REMOTE
}

set_netem() {
  local rtt=$1 loss=$2
  "${SSH[@]}" "sudo -n env RATE=10mbit $REMOTE_SCRIPTS/l1_veth_netem.sh $rtt $loss iid" >/dev/null
}

assert_asks() {
  local json=$1
  python3 - "$json" "$L1_FIX_FC" "$MAX_ASK_RATIO" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
fc, ratio = float(sys.argv[2]), float(sys.argv[3])
asks = float(m["asks_sent"])
lim = fc * ratio
if asks > lim:
    raise SystemExit(f"STOP: asks_sent={asks} > {lim:.0f} (ratio {asks/fc:.2f} > {ratio})")
print(f"asks_ok asks={asks:.0f} lim={lim:.0f}")
PY
}

backlog_mark() {
  local json=$1
  python3 - "$json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
h1 = float(m.get("wait_h1_median_ms") or 0)
h2 = float(m.get("wait_h2_median_ms") or 0)
if h1 > 0 and h2 > 1.5 * h1:
    print("BACKLOG")
else:
    print("ok")
PY
}

ORDER_INDEX=0

run_one() {
  local arm=$1 rtt=$2 loss=$3 depth=$4 run=$5 step_ms=$6 cell_label=$7
  local loss_tag=${loss//./p}
  local tag="${arm}_rtt${rtt}_loss${loss_tag}_d${depth}_r${run}"
  local port=${ARM_PORT[$arm]}
  local mode=${ARM_MODE[$arm]}
  local url="https://${SRV_IP}:${port}/"
  local remote_raw="$REMOTE_RAW/${tag}.json"
  local remote_err="$REMOTE_RAW/${tag}.err"
  local remote_trace="$REMOTE_TRACES/$(basename "$L1_TRACE")"
  local local_json="$RAW_DIR/${tag}.json"
  local ts_iso

  ts_iso="$(date -Iseconds)"
  ORDER_INDEX=$((ORDER_INDEX + 1))

  set +e
  "${SSH[@]}" "sudo -n ip netns exec wt-cli timeout $CELL_TIMEOUT_S \
    $REMOTE_BIN/window-harness \
      --url '$url' \
      --trace '$remote_trace' \
      --read-bps $READ_BPS \
      --timeout-ms $HARNESS_TIMEOUT_MS \
      --depth $depth \
      --frame-count $L1_FIX_FC \
      --fill-dwell-ms 0 \
      --mode trace \
      --rtt-ms 0 \
      --arm '$arm' \
      --stream-mode '$mode' \
      --window-shape $WINDOW_SHAPE \
      --step-interval-ms $step_ms \
      --json \
      >'$remote_raw' 2>'$remote_err'"
  local rc=$?
  set -e
  "${SCP[@]}" "$REMOTE:$remote_raw" "$local_json" 2>/dev/null || true
  "${SCP[@]}" "$REMOTE:$remote_err" "$RAW_DIR/${tag}.err" 2>/dev/null || true
  if [[ $rc -ne 0 || ! -f "$local_json" ]]; then
    echo "FAIL harness_rc=$rc tag=$tag" >&2
    cat "$RAW_DIR/${tag}.err" 2>/dev/null || true
    return "$rc"
  fi

  l1_assert_frame_bytes "$local_json"
  assert_asks "$local_json"

  local regime bl mark cell_out tail_line trc
  regime="$(l1_stamp_regime "$local_json" "$loss")"
  bl="$(backlog_mark "$local_json")"
  mark="$cell_label"
  if [[ "$bl" == "BACKLOG" ]]; then
    mark="${cell_label}+BACKLOG"
  fi

  set +e
  tail_line="$(l1_tail_gate "$local_json")"
  trc=$?
  set -e
  if [[ $trc -ne 0 ]]; then
    echo "STOP: tail gate FAIL tag=$tag line=$tail_line" >&2
    exit 2
  fi
  local tail_n
  tail_n="$(echo "$tail_line" | cut -f2)"

  python3 - "$local_json" "$ORDER_INDEX" "$ts_iso" "$arm" "$rtt" "$loss" "$depth" "$run" \
    "$regime" "$step_ms" "$tail_n" "$mark" "$PROTOCOL_SHA" "$CADENCE_SHA" "$SERVER_SHA" \
    "$OUT_TSV" <<'PY'
import json, sys
path = sys.argv[1]
order, ts, arm, rtt, loss, depth, run = sys.argv[2:9]
regime, step, tail_n, mark = sys.argv[9:13]
psha, csha, ssha, out = sys.argv[13:17]
m = json.load(open(path))
cols = [
    order, ts, arm, rtt, loss, depth, run, regime, step,
    f"{float(m['miss_p95_wait_ms']):.6f}",
    f"{float(m['miss_mean_wait_ms']):.6f}",
    str(int(m["cache_misses"])),
    tail_n,
    str(int(m["asks_sent"])),
    str(int(m["peak_outstanding"])),
    f"{float(m['step_loop_ms']):.6f}",
    str(int(m["bytes_on_wire"])),
    str(int(m["frames_on_wire"])),
    f"{float(m.get('wait_h1_median_ms') or 0):.6f}",
    f"{float(m.get('wait_h2_median_ms') or 0):.6f}",
    mark, psha, csha, ssha,
]
with open(out, "a") as f:
    f.write("\t".join(cols) + "\n")
print(
    f"  ok arm={arm} run={run} regime={regime} "
    f"miss_p95={m['miss_p95_wait_ms']:.1f} misses={m['cache_misses']} "
    f"tail={tail_n} asks={m['asks_sent']} mark={mark}"
)
PY
}

run_cell() {
  local label=$1 rtt=$2 loss=$3 depth=$4 repeats=$5
  shift 5
  local arms=("$@")
  local step
  step="$(cadence_step "$rtt" "$loss")"
  echo "==> cell=$label rtt=$rtt loss=$loss D=$depth step_ms=$step arms=${arms[*]} n=$repeats"
  l1_precheck_ratio "$step" "${label}_${rtt}_${loss}"
  set_netem "$rtt" "$loss"

  mapfile -t schedule < <(L1_INTERLEAVE_SEED="$L1_INTERLEAVE_SEED" l1_interleave_arms "$repeats" "${arms[@]}")
  declare -A run_n=()
  for a in "${arms[@]}"; do run_n[$a]=0; done

  local arm
  for arm in "${schedule[@]}"; do
    run_n[$arm]=$((run_n[$arm] + 1))
    echo "--- $label $arm r${run_n[$arm]} (order=$ORDER_INDEX) ---"
    run_one "$arm" "$rtt" "$loss" "$depth" "${run_n[$arm]}" "$step" "$label"
  done
}

null_gap_check() {
  python3 - "$OUT_TSV" "$NULL_REL_STOP" "$NULL_ABS_STOP_MS" <<'PY'
import csv, statistics, sys
from collections import defaultdict
path, rel_stop, abs_stop = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
by = defaultdict(list)
with open(path) as f:
    # skip banner
    line = f.readline()
    if not line.startswith("#"):
        f.seek(0)
    rdr = csv.DictReader(f, delimiter="\t")
    for r in rdr:
        if r.get("cell_label", "").startswith("null") and float(r["loss_pct"]) == 0.0:
            by[r["arm"]].append(float(r["miss_p95_wait_ms"]))
if len(by) < 2:
    print("null_gap_check: insufficient arms — skip")
    raise SystemExit(0)
med = {a: statistics.median(v) for a, v in by.items()}
print("null medians:", {a: round(m, 2) for a, m in med.items()})
arms = sorted(med)
worst = 0.0
for i, a in enumerate(arms):
    for b in arms[i + 1 :]:
        lo, hi = min(med[a], med[b]), max(med[a], med[b])
        abs_g = hi - lo
        rel = abs_g / lo if lo > 0 else float("inf")
        print(f"  {a} vs {b}: abs={abs_g:.1f}ms rel={rel:.3f}")
        worst = max(worst, rel)
        if abs_g > abs_stop and rel > rel_stop:
            raise SystemExit(
                f"STOP: null large unexplained gap {a} vs {b} "
                f"abs={abs_g:.1f}>{abs_stop} and rel={rel:.3f}>{rel_stop}"
            )
print(f"null_gap_ok worst_rel={worst:.3f}")
PY
}

write_summary() {
  python3 - "$OUT_TSV" "$SUMMARY_MD" <<'PY'
import csv, statistics, sys
from collections import defaultdict
from pathlib import Path

tsv, out = Path(sys.argv[1]), Path(sys.argv[2])
rows = []
with open(tsv) as f:
    line = f.readline()
    if not line.startswith("#"):
        f.seek(0)
    rows = list(csv.DictReader(f, delimiter="\t"))

def med(vals):
    return statistics.median(vals) if vals else float("nan")

def mad_ci(vals):
    if len(vals) < 2:
        return med(vals), float("nan"), float("nan")
    m = statistics.median(vals)
    # simple percentile CI via sorted order stats (directional only)
    s = sorted(vals)
    lo = s[max(0, int(0.1 * (len(s) - 1)))]
    hi = s[min(len(s) - 1, int(0.9 * (len(s) - 1)))]
    return m, lo, hi

by = defaultdict(list)
regime_counts = defaultdict(lambda: defaultdict(int))
for r in rows:
    key = (r["cell_label"].split("+")[0], r["rtt_label_ms"], r["loss_pct"], r["arm"])
    by[key].append(float(r["miss_p95_wait_ms"]))
    regime_counts[(r["cell_label"].split("+")[0], r["loss_pct"], r["arm"])][r["regime"]] += 1

lines = [
    "# L1 v3 Phase C — directional summary",
    "",
    "**NOT A DECISION.** Shape-only readout from small collect.",
    "",
    "## Miss p95 by cell × arm (median [p10, p90])",
    "",
    "| cell | loss | arm | n | median_ms | p10 | p90 |",
    "| --- | ---: | --- | ---: | ---: | ---: | ---: |",
]
for key in sorted(by.keys(), key=lambda k: (k[0], float(k[2]), k[3])):
    cell, rtt, loss, arm = key
    m, lo, hi = mad_ci(by[key])
    lines.append(
        f"| {cell} | {loss} | {arm} | {len(by[key])} | {m:.1f} | {lo:.1f} | {hi:.1f} |"
    )

lines += ["", "## Regime rates", "", "| cell | loss | arm | regimes |", "| --- | ---: | --- | --- |"]
for key in sorted(regime_counts.keys()):
    cell, loss, arm = key
    parts = ", ".join(f"{k}={v}" for k, v in sorted(regime_counts[key].items()))
    lines.append(f"| {cell} | {loss} | {arm} | {parts} |")

def loss_eq(a, b):
    return abs(float(a) - float(b)) < 1e-9

# Directional shape: Q vs S at each loss (all regimes pooled — label mixed)
lines += ["", "## Directional shape (Q vs S, all regimes pooled)", ""]
for loss in (0.0, 0.5, 2.0):
    for cell_pref in ("null", "dose-low", "dose-high"):
        sk = next((k for k in by if k[0].startswith(cell_pref) and loss_eq(k[2], loss) and k[3] == "S"), None)
        qk = next((k for k in by if k[0].startswith(cell_pref) and loss_eq(k[2], loss) and k[3] == "Q"), None)
        if not sk or not qk:
            continue
        sm, qm = med(by[sk]), med(by[qk])
        if sm <= 0:
            continue
        gain = (sm - qm) / sm
        lines.append(
            f"- {cell_pref} loss={loss}%: S_med={sm:.1f} Q_med={qm:.1f} "
            f"rel_gain_Q={(gain*100):+.1f}% (pooled; check regime split)"
        )

pk = next((k for k in by if loss_eq(k[2], 0.5) and k[3] == "P"), None)
qk = next((k for k in by if loss_eq(k[2], 0.5) and k[3] == "Q"), None)
if pk and qk:
    pm, qm = med(by[pk]), med(by[qk])
    lines += [
        "",
        "## P vs Q at 0.5% (attribution smoke)",
        f"- P_med={pm:.1f} Q_med={qm:.1f} (if similar → priority not the lever)",
    ]

lines += [
    "",
    "## Explicit non-claims",
    "- Not a ship decision for Q.",
    "- Not a 15% product-bar result.",
    "- RTT-150 not in this collect.",
    "",
]
out.write_text("\n".join(lines))
print(f"Wrote {out}")
PY
}

deploy_spq

# Phase C grid (complete plan)
run_cell null 60 0 4 "$REPEATS_NULL" S P Q
null_gap_check

run_cell dose-low 60 0.5 4 "$REPEATS_DOSE_LOW" S P Q
run_cell dose-high 60 2 4 "$REPEATS_DOSE_HIGH" S Q

write_summary

echo "=== Phase C small collect COMPLETE (DIRECTIONAL ONLY) ==="
echo "TSV=$OUT_TSV"
echo "RAW=$RAW_DIR"
echo "SUMMARY=$SUMMARY_MD"
echo "Do NOT treat as ship decision. Proceed to Phase E only after review."
