#!/usr/bin/env bash
# L1 v3 — Isolation A/B for D=1 wait excess over RTT+Tf.
# A: delay-only netem (RATE=none) vs delay+rate (RATE=10mbit), same RTT labels.
# B: WT_SERVE_TIMING=1 on S; summarise ask_to_first / ask_to_last from server log.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_rig_agent}"
# shellcheck source=/dev/null
source "$ROOT/lab/scripts/cloud_common.sh"

SKIP_BUILD="${SKIP_BUILD:-0}"
FIX_FC="${FIX_FC:-80}"
TF_MS=25.6
READ_BPS=0
HARNESS_TIMEOUT_MS=120000
CELL_TIMEOUT_S=180
REPEATS="${REPEATS:-5}"

STUDY="$ROOT/lab/fixtures/frames_32k/frames_32k.sbnd"
TRACE="$ROOT/lab/traces/l1_one_way_80.json"
BIN_MAIN="${BIN_MAIN:-$ROOT/.local/r2/bin-main-exact-server}"
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
REMOTE_RAW=/tmp/l1v3-isolate
RAW_DIR="${RAW_DIR:-$ROOT/docs/measurements/r2/raw/l1v3/isolate}"
OUT_TSV="${OUT_TSV:-$ROOT/docs/measurements/r2/l1_s_vs_q_loss_v3.isolate.tsv}"
OUT_MD="${OUT_MD:-$ROOT/docs/measurements/r2/raw/l1v3/ISOLATION_RTT_EXCESS.md}"

mkdir -p "$RAW_DIR" "$(dirname "$OUT_TSV")"

echo "=== L1 v3 RTT-excess isolation $(date -Iseconds) ==="

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
echo "L1-v3-isolate $(date -Iseconds)" > "$H"
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
  local timing="${1:-0}"
  "${SSH[@]}" 'bash -s' "$study_r" "$timing" <<'REMOTE'
set -euo pipefail
STUDY=$1; TIMING=$2
sudo -n pkill -x exact-server 2>/dev/null || true
sudo -n pkill -f '/home/ubuntu/wt-pacs/bin/exact-server' 2>/dev/null || true
for p in 4435; do
  sudo -n fuser -k "${p}/udp" 2>/dev/null || true
done
sleep 1
ENV_EXTRA=()
if [[ "$TIMING" == "1" ]]; then
  ENV_EXTRA+=(WT_SERVE_TIMING=1)
fi
setsid env RUST_LOG=warn "${ENV_EXTRA[@]}" nohup /home/ubuntu/wt-pacs/bin/exact-server-main \
  --port 4435 --study "$STUDY" \
  --cert-pem /home/ubuntu/wt-pacs/cert/cert.pem \
  --key-pem /home/ubuntu/wt-pacs/cert/key.pem \
  --stream-mode shared \
  >/tmp/wt-pacs-exact-S.log 2>&1 < /dev/null &
disown
sleep 2
ss -lun | grep -q ':4435 ' || { cat /tmp/wt-pacs-exact-S.log; exit 1; }
echo "S up timing=$TIMING"
REMOTE
}

set_netem() {
  local rtt=$1 rate=$2
  "${SSH[@]}" "sudo -n env RATE=$rate $REMOTE_SCRIPTS/l1_veth_netem.sh $rtt 0 iid" >/dev/null
}

run_cell() {
  local rate_label=$1 rtt=$2 run=$3
  local tag="S_rtt${rtt}_${rate_label}_r${run}"
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
      --depth 1 \
      --frame-count $FIX_FC \
      --fill-dwell-ms 0 \
      --mode trace \
      --rtt-ms 0 \
      --arm S \
      --stream-mode shared \
      --window-shape forward \
      --step-interval-ms 50 \
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
print(f\"{m['miss_p95_wait_ms']:.3f}\t{m['miss_mean_wait_ms']:.3f}\t{m['asks_sent']}\t{m['step_loop_ms']:.1f}\")
"
}

cat >"$OUT_TSV" <<'HDR'
arm	rtt_label_ms	rate	run	miss_p95_wait_ms	miss_mean_wait_ms	asks_sent	step_loop_ms	ideal_rtt_plus_tf
HDR

deploy_s 0

for rate in 10mbit none; do
  rate_tag=$rate
  [[ "$rate" == "none" ]] && rate_tag=delayonly
  for rtt in 60 150; do
    echo "==> Isolation A rate=$rate rtt=$rtt"
    set_netem "$rtt" "$rate"
    for run in $(seq 1 "$REPEATS"); do
      echo -n "  $rate_tag rtt=$rtt run=$run → "
      line=$(run_cell "$rate_tag" "$rtt" "$run")
      echo "$line"
      miss_p95=$(echo "$line" | cut -f1)
      miss_mean=$(echo "$line" | cut -f2)
      asks=$(echo "$line" | cut -f3)
      step=$(echo "$line" | cut -f4)
      ideal=$(python3 -c "print(f'{float('$rtt')+float('$TF_MS'):.1f}')")
      printf 'S\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$rtt" "$rate_tag" "$run" "$miss_p95" "$miss_mean" "$asks" "$step" "$ideal" >>"$OUT_TSV"
    done
  done
done

echo "==> Isolation B (WT_SERVE_TIMING=1, rate=10mbit, rtt=60, 1 run)"
deploy_s 1
set_netem 60 10mbit
"${SSH[@]}" 'truncate -s 0 /tmp/wt-pacs-exact-S.log'
run_cell timing60 60 1 >/tmp/isolate_b_line.txt || true
"${SCP[@]}" "$REMOTE:/tmp/wt-pacs-exact-S.log" "$RAW_DIR/S_serve_timing_rtt60.log" 2>/dev/null || true
B_LINE=$(cat /tmp/isolate_b_line.txt 2>/dev/null || echo "FAIL")
echo "  harness: $B_LINE"

python3 - "$OUT_TSV" "$OUT_MD" "$RAW_DIR/S_serve_timing_rtt60.log" "$TF_MS" "$B_LINE" <<'PY'
import statistics, sys, re
from pathlib import Path

tsv, md_path, timing_log, tf, b_line = sys.argv[1:6]
tf = float(tf)
rows = []
with open(tsv) as f:
    hdr = f.readline().strip().split("\t")
    for line in f:
        parts = line.strip().split("\t")
        if len(parts) < len(hdr):
            continue
        r = dict(zip(hdr, parts))
        r["miss_p95_wait_ms"] = float(r["miss_p95_wait_ms"])
        r["miss_mean_wait_ms"] = float(r["miss_mean_wait_ms"])
        r["rtt_label_ms"] = int(r["rtt_label_ms"])
        rows.append(r)

def med(vals):
    return statistics.median(vals) if vals else float("nan")

lines = []
lines.append("# L1 v3 Isolation — D=1 wait vs RTT+Tf")
lines.append("")
lines.append(f"**Date:** isolation run · **Tf:** {tf} ms (32 KiB @ 10 Mbit ideal)")
lines.append("")
lines.append("## Isolation A — delay+rate vs delay-only")
lines.append("")
lines.append("| rate | RTT | median miss_p95 | median miss_mean | ideal RTT+Tf | excess p95 |")
lines.append("| --- | --- | --- | --- | --- | --- |")
for rate in ("10mbit", "delayonly"):
    for rtt in (60, 150):
        subset = [r for r in rows if r["rate"] == rate and r["rtt_label_ms"] == rtt]
        p95 = med([r["miss_p95_wait_ms"] for r in subset])
        mean = med([r["miss_mean_wait_ms"] for r in subset])
        ideal = rtt + tf
        lines.append(
            f"| {rate} | {rtt} | {p95:.1f} | {mean:.1f} | {ideal:.1f} | {p95 - ideal:.1f} |"
        )

# Verdict
p95_rate_60 = med([r["miss_p95_wait_ms"] for r in rows if r["rate"] == "10mbit" and r["rtt_label_ms"] == 60])
p95_delay_60 = med([r["miss_p95_wait_ms"] for r in rows if r["rate"] == "delayonly" and r["rtt_label_ms"] == 60])
p95_rate_150 = med([r["miss_p95_wait_ms"] for r in rows if r["rate"] == "10mbit" and r["rtt_label_ms"] == 150])
p95_delay_150 = med([r["miss_p95_wait_ms"] for r in rows if r["rate"] == "delayonly" and r["rtt_label_ms"] == 150])
ideal_60, ideal_150 = 60 + tf, 150 + tf

def near_ideal(p95, ideal, tol=0.15):
    return abs(p95 - ideal) / ideal <= tol

lines.append("")
lines.append("### Read")
if near_ideal(p95_delay_60, ideal_60) and near_ideal(p95_delay_150, ideal_150):
    verdict = (
        "**Delay-only lands near RTT+Tf** while delay+rate keeps the excess → "
        "the ~1.5×RTT band is largely a **netem rate / ACK-path artifact**, not FoD app logic."
    )
elif (p95_delay_60 < p95_rate_60 * 0.85) or (p95_delay_150 < p95_rate_150 * 0.85):
    verdict = (
        "**Delay-only reduces excess but does not fully remove it** → rate shaping contributes; "
        "remaining gap is still on the wire/stack (CC / multi-flight)."
    )
else:
    verdict = (
        "**Delay-only does not remove the excess** → not explained by netem `rate`; "
        "look at Isolation B / QUIC CC."
    )
lines.append(verdict)
lines.append("")
lines.append("## Isolation B — server ask → write_all")
lines.append("")
lines.append(f"Harness (timing run, rtt=60 rate=10mbit): `{b_line}`")
lines.append("")

path = Path(timing_log)
firsts, lasts = [], []
if path.is_file():
    for line in path.read_text(errors="replace").splitlines():
        m = re.search(r"ask_to_first_ms=([0-9.]+).*ask_to_last_ms=([0-9.]+)", line)
        if m:
            firsts.append(float(m.group(1)))
            lasts.append(float(m.group(2)))

if firsts:
    lines.append(f"serve_timing samples: n={len(firsts)}")
    lines.append(
        f"- ask_to_first_ms: median={statistics.median(firsts):.3f} "
        f"p95={sorted(firsts)[max(0, int(0.95*(len(firsts)-1)) )]:.3f}"
    )
    lines.append(
        f"- ask_to_last_ms: median={statistics.median(lasts):.3f} "
        f"p95={sorted(lasts)[max(0, int(0.95*(len(lasts)-1)) )]:.3f}"
    )
    med_last = statistics.median(lasts)
    if med_last < 5.0:
        lines.append("")
        lines.append(
            f"**Server enqueue is fast** (median ask_to_last={med_last:.2f} ms ≪ Tf). "
            "Client wait excess is **after** data enters quinn (path / CC / netem), not FoD locate/write."
        )
    else:
        lines.append("")
        lines.append(
            f"**Server ask→last write is large** (median {med_last:.2f} ms). "
            "Investigate flow-control blocking `write_all`, disk, or serial-loop stalls."
        )
else:
    lines.append("No `serve_timing` lines found in server log (check WT_SERVE_TIMING deploy).")

lines.append("")
lines.append("Artifacts: `l1_s_vs_q_loss_v3.isolate.tsv`, `raw/l1v3/isolate/`")
Path(md_path).write_text("\n".join(lines) + "\n")
print("\n".join(lines))
PY

echo "Wrote $OUT_TSV and $OUT_MD"
