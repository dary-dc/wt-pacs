#!/usr/bin/env bash
# L1 v3 Phase 4–5 — veth setup + path gates (S4a/S4b/S5).
# Orchestrates on the rig via SSH. Does not collect the campaign.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_rig_agent}"
# shellcheck source=/dev/null
source "$ROOT/lab/scripts/cloud_common.sh"

SKIP_BUILD="${SKIP_BUILD:-0}"
FIX_FC="${FIX_FC:-80}"
WINDOW_SHAPE=forward
TF_MS=25.6
READ_BPS=0
HARNESS_TIMEOUT_MS=120000
CELL_TIMEOUT_S=180

STUDY="$ROOT/lab/fixtures/frames_32k/frames_32k.sbnd"
TRACE="$ROOT/lab/traces/l1_one_way_80.json"
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
REMOTE_RAW=/tmp/l1v3-path
RAW_DIR="${RAW_DIR:-$ROOT/docs/measurements/r2/raw/l1v3/path}"
OUT_TSV="${OUT_TSV:-$ROOT/docs/measurements/r2/l1_s_vs_q_loss_v3.path.tsv}"

declare -A ARM_MODE=([S]=shared [Q]=per-frame)
declare -A ARM_PORT=([S]=4435 [Q]=4437)
declare -A D_FORMULA=([60]=4 [150]=7)

mkdir -p "$RAW_DIR" "$(dirname "$OUT_TSV")"

echo "=== L1 v3 path validation $(date -Iseconds) ==="

[[ -f "$SSH_KEY" ]] || { echo "STOP: missing SSH_KEY=$SSH_KEY" >&2; exit 1; }
[[ -f "$STUDY" && -f "$TRACE" ]] || { echo "missing study/trace" >&2; exit 1; }
[[ -f "$CERT" && -f "$KEY_PEM" ]] || bash "$ROOT/server/scripts/gen_dev_cert.sh"

if [[ "$SKIP_BUILD" != "1" ]]; then
  bash "$ROOT/lab/scripts/l1_build_bins.sh"
fi
[[ -x "$BIN_MAIN" && -x "$BIN_Q" && -x "$HARNESS_BIN" ]] || {
  echo "missing binaries" >&2
  exit 1
}

cleanup() {
  echo "RIG RELEASE" >&2
  "${SSH[@]}" "sudo -n $REMOTE_SCRIPTS/l1_veth_netem.sh off" 2>/dev/null || true
  "${SSH[@]}" 'rm -f /home/ubuntu/wt-pacs/locks/netem.holder' 2>/dev/null || true
}
trap cleanup EXIT

# Exclusive lock (refuse if held by another lane).
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
echo "L1-v3-path $(date -Iseconds)" > "$H"
REMOTE

"${SSH[@]}" "mkdir -p $REMOTE_BIN $REMOTE_CERT $REMOTE_FIX $REMOTE_SCRIPTS $REMOTE_TRACES $REMOTE_RAW"
# Stop any lingering servers before overwriting binaries (ETXTBSY otherwise).
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
"${SCP[@]}" "$BIN_Q" "$REMOTE:$REMOTE_BIN/exact-server-q"
"${SSH[@]}" "chmod +x $REMOTE_BIN/*"

echo "==> veth setup"
"${SSH[@]}" "sudo -n $REMOTE_SCRIPTS/l1_veth_setup.sh"

# Ensure QUIC campaign ports are allowed (OCI default rejects new UDP).
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

set_netem() {
  local rtt=$1 loss=${2:-0}
  "${SSH[@]}" "sudo -n $REMOTE_SCRIPTS/l1_veth_netem.sh $rtt $loss iid" >/dev/null
}

assert_netem() {
  local rtt=$1
  local delay_ms=$((rtt / 2))
  local q
  q=$("${SSH[@]}" "tc qdisc show dev veth-srv")
  echo "$q" | grep -q netem || { echo "STOP: no netem: $q" >&2; return 1; }
  echo "$q" | grep -Eq "delay ${delay_ms}ms" || {
    echo "STOP: delay want ${delay_ms}ms: $q" >&2
    return 1
  }
}

deploy_sq() {
  local study_r="$REMOTE_FIX/$(basename "$STUDY")"
  "${SSH[@]}" 'bash -s' "$study_r" <<'REMOTE'
set -euo pipefail
STUDY=$1
# Free campaign ports — leftover exact-server (no -main/-q suffix) is common.
sudo -n pkill -x exact-server 2>/dev/null || true
sudo -n pkill -f '/home/ubuntu/wt-pacs/bin/exact-server' 2>/dev/null || true
for p in 4435 4436 4437; do
  sudo -n fuser -k "${p}/tcp" 2>/dev/null || true
  sudo -n fuser -k "${p}/udp" 2>/dev/null || true
done
sleep 1
start() {
  setsid env RUST_LOG=warn nohup "$1" \
    --port "$2" --study "$STUDY" \
    --cert-pem /home/ubuntu/wt-pacs/cert/cert.pem \
    --key-pem /home/ubuntu/wt-pacs/cert/key.pem \
    --stream-mode "$3" \
    >"$4" 2>&1 < /dev/null &
  disown
}
start /home/ubuntu/wt-pacs/bin/exact-server-main 4435 shared /tmp/wt-pacs-exact-S.log
start /home/ubuntu/wt-pacs/bin/exact-server-q 4437 per-frame /tmp/wt-pacs-exact-Q.log
sleep 2
# QUIC listens on UDP (not TCP).
ss -lun | grep -q ':4435 ' || { cat /tmp/wt-pacs-exact-S.log; exit 1; }
ss -lun | grep -q ':4437 ' || { cat /tmp/wt-pacs-exact-Q.log; exit 1; }
echo "S+Q up"
REMOTE
}

run_d1() {
  local arm=$1 rtt=$2 tag=$3
  local port=${ARM_PORT[$arm]}
  local mode=${ARM_MODE[$arm]}
  local url="https://${SRV_IP}:${port}/"
  local remote_raw="$REMOTE_RAW/${tag}.json"
  local remote_err="$REMOTE_RAW/${tag}.err"
  local remote_trace="$REMOTE_TRACES/$(basename "$TRACE")"

  set_netem "$rtt" 0
  assert_netem "$rtt"

  set +e
  "${SSH[@]}" "sudo -n ip netns exec wt-cli timeout $CELL_TIMEOUT_S \
    $REMOTE_BIN/window-harness \
      --url '$url' \
      --trace '$remote_trace' \
      --read-bps $READ_BPS \
      --timeout-ms $HARNESS_TIMEOUT_MS \
      --depth 1 \
      --frame-count $FIX_FC \
      --fill-dwell-ms 0 \
      --mode trace \
      --rtt-ms 0 \
      --arm '$arm' \
      --stream-mode '$mode' \
      --window-shape $WINDOW_SHAPE \
      --step-interval-ms 50 \
      --json \
      >'$remote_raw' 2>'$remote_err'"
  local rc=$?
  set -e
  "${SCP[@]}" "$REMOTE:$remote_raw" "$RAW_DIR/${tag}.json" 2>/dev/null || true
  "${SCP[@]}" "$REMOTE:$remote_err" "$RAW_DIR/${tag}.err" 2>/dev/null || true
  if [[ $rc -ne 0 ]]; then
    echo "FAIL harness_rc=$rc" >&2
    cat "$RAW_DIR/${tag}.err" 2>/dev/null || true
    return $rc
  fi
  assert_netem "$rtt"
  python3 -c "
import json
m=json.load(open('$RAW_DIR/${tag}.json'))
print(f\"{m['miss_p95_wait_ms']}\t{m['asks_sent']}\t{m['step_loop_ms']}\")
"
}

cat >"$OUT_TSV" <<'HDR'
arm	rtt_label_ms	rtt_measured_ms	depth	run	miss_p95_wait_ms	asks_sent	step_loop_ms
HDR

deploy_sq

declare -A MEAS=()
for rtt in 60 150; do
  echo "==> S4a rtt=$rtt"
  set_netem "$rtt" 0
  assert_netem "$rtt"
  measured=$("${SSH[@]}" "sudo -n ip netns exec wt-cli ping -c 30 -q $SRV_IP" | python3 -c '
import re,sys
t=sys.stdin.read()
m=re.search(r"rtt min/avg/max/[^=]*=\s*([\d.]+)/([\d.]+)/([\d.]+)", t)
assert m, t
print(m.group(2))
')
  python3 -c "
label=float('$rtt'); m=float('$measured')
# ±5% plus 2 ms absolute slack for netem rate-limiter / timer granularity.
slack=2.0
lo,hi=label*0.95-slack, label*1.05+slack
print(f'S4a ping_avg={m:.2f} band=[{lo:.1f},{hi:.1f}] (label={label} ±5% +{slack}ms)')
assert lo<=m<=hi, 'S4a FAIL'
"
  MEAS[$rtt]=$measured
  d_meas=$(python3 -c "import math; print(math.ceil(0.95*(1+float('$measured')/float('$TF_MS'))))")
  d_label=${D_FORMULA[$rtt]}
  echo "S5: D(measured)=$d_meas D(label)=$d_label"
  [[ "$d_meas" == "$d_label" ]] || { echo "STOP S5" >&2; exit 5; }
done

echo "==> S4b D=1 controls"
for rtt in 60 150; do
  for run in 1 2 3 4 5; do
    for arm in S Q; do
      tag="${arm}_rtt${rtt}_d1_r${run}"
      echo "--- $tag ---" >&2
      # Metrics line only on stdout; harness/netem chatter on stderr.
      line=$(run_d1 "$arm" "$rtt" "$tag" | tail -n1)
      miss=$(echo "$line" | cut -f1)
      asks=$(echo "$line" | cut -f2)
      step=$(echo "$line" | cut -f3)
      python3 -c "float('$miss'); float('$asks'); float('$step')" >/dev/null
      echo -e "${arm}\t${rtt}\t${MEAS[$rtt]}\t1\t${run}\t${miss}\t${asks}\t${step}" >>"$OUT_TSV"
      echo "  miss_p95=$miss asks=$asks step_loop=$step" >&2
    done
  done
done

python3 - "$OUT_TSV" <<'PY'
import csv, statistics, sys
path = sys.argv[1]
# Gate S4b: at D=1 the ask crosses the return path (RTT/2) and the body crosses
# the forward path (RTT/2 + Tf). Expected ≈ 1.5·RTT + Tf (Tf=25.6 ms @ 32 KiB / 10 Mbit).
# Accept ±15% around that (tighter than v2's uncontrolled path, looser than ideal RTT+Tf).
tf = 25.6
bands = {
    "60": (0.85 * (1.5 * 60 + tf), 1.15 * (1.5 * 60 + tf)),   # ≈ 98–133
    "150": (0.85 * (1.5 * 150 + tf), 1.15 * (1.5 * 150 + tf)), # ≈ 213–288
}
by = {"60": [], "150": []}
with open(path) as f:
    for r in csv.DictReader(f, delimiter="\t"):
        by[r["rtt_label_ms"]].append(float(r["miss_p95_wait_ms"]))
for rtt, vals in by.items():
    lo, hi = bands[rtt]
    med = statistics.median(vals)
    print(f"S4b rtt={rtt}: median miss_p95={med:.1f} band=[{lo:.1f},{hi:.1f}] n={len(vals)}")
    if not (lo <= med <= hi):
        raise SystemExit(f"STOP S4b rtt={rtt}")
print("S4b ok")
PY

echo "=== path validation PASSED ==="
echo "TSV=$OUT_TSV"
echo "RAW=$RAW_DIR"
