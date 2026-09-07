#!/usr/bin/env bash
# Competing-flow fairness on one real bottleneck — unmeasured everywhere in this project,
# and named in docs/transport-conclusions.md §1 as BBR's main deployment risk:
#
#   "quinn ships BBRv1, marked experimental, documented to take > 90 % of a shallow buffer
#    from competing Cubic flows"
#
# That is a claim about what happens to a NEIGHBOUR, so it needs two flows and one shared
# bottleneck. lab/netsim gives each flow its own pipe and cannot pose the question at all.
#
# WHAT THE RIG PERMITS, AND WHAT IT DOES NOT
# The Oracle VCN admits exactly two ports: UDP 4435 and TCP 22. UDP 4436/4437 are open in
# the host's iptables but blocked upstream at the VCN, verified by a QUIC handshake that
# times out against a server confirmed listening. Two consequences:
#
#   * Both QUIC flows must share ONE server on 4435, so both get that server's congestion
#     controller. `bbr vs cubic` between two QUIC flows is therefore NOT constructible here.
#   * The only other transport that can reach the rig is TCP on port 22 — which
#     cloud_netem_exact.sh deliberately files into an UNSHAPED band precisely so shaping
#     cannot lock the rig out. For the cross-protocol cells, and only those, that bypass is
#     removed so ssh shares the bottleneck, and a deadman timer on the rig restores the
#     qdisc unconditionally after DEADMAN_S seconds. Recovery does not depend on the
#     network still working.
#
# Cells:
#   qcubic_qcubic  QUIC Cubic vs QUIC Cubic   self-fairness control, expect ~50/50
#   qbbr_qbbr      QUIC BBR   vs QUIC BBR     does BBR share with itself?
#   qcubic_tcp     QUIC Cubic vs TCP Cubic    cross-protocol control
#   qbbr_tcp       QUIC BBR   vs TCP Cubic    THE deployment risk from §1
#
# Usage: REPS=3 DWELL_MS=30000 lab/scripts/r6_fairness_cloud.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/lab/scripts/cloud_r6_common.sh"

FIXTURE="${FIXTURE:-frames_500x64k}"
REPS="${REPS:-3}"
DWELL_MS="${DWELL_MS:-30000}"   # long enough that ~1 s of start-up skew is <4 %
DEPTH="${DEPTH:-8}"
RATE="${RATE:-20}"; DELAY="${DELAY:-25}"; LOSS="${LOSS:-0.0}"
# Queue depth matters more than any other knob here. quinn's BBRv1 warning is specifically
# about a SHALLOW buffer; a 500-packet queue at 5 Mbps is 1.2 s of buffering, which is the
# case BBR handles politely. QUEUE=20 (~48 ms at 5 Mbps) is the case it is warned about.
QUEUE="${QUEUE:-500}"
DEADMAN_S="${DEADMAN_S:-900}"
CELLS="${CELLS:-qcubic_qcubic qbbr_qbbr qcubic_tcp qbbr_tcp}"
OUT="${OUT:-$ROOT/.local/measurements/r6/fairness.tsv}"
mkdir -p "$(dirname "$OUT")"
# a_window_s / b_window_s are the denominators each flow's rate was actually divided by.
# They are NOT equal, and that is the point of recording them: the TCP flow is timed over a
# window that starts 1.5 s late and ends 3 s early so ssh connect time cannot inflate it,
# while the QUIC flow's bytes are divided by its *configured* dwell. QUIC therefore runs
# unopposed at both ends of the window and books those bytes against the full denominator,
# which overstates its share by a few points. Adversarial review, 2026-09-07 (S2).
# Making both windows identical needs the harness to emit its measured fill span — see
# docs/proposals/product-code-changes.md. Until then the asymmetry is at least visible.
[ -s "$OUT" ] || printf 'cell\trep\trate_mbps\tdelay_ms\tloss_pct\tqueue_pkts\tdwell_ms\tflow_a\tflow_b\ta_bytes\tb_bytes\ta_window_s\tb_window_s\ta_mbps\tb_mbps\ta_share\tjain\n' > "$OUT"

r6_sync_scripts
r6_upload_server
STUDY=$(r6_upload_fixture "$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd")

# A dedicated, NON-multiplexed ssh for the TCP competitor: the control channel is a
# ControlMaster session and a bulk transfer down it would share one TCP flow with the
# orchestration, which is not the flow we mean to measure.
SSH_BULK=(ssh -i "$SSH_KEY" -o BatchMode=yes -o IdentitiesOnly=yes
  -o UserKnownHostsFile="$SSH_KNOWN_HOSTS" -o StrictHostKeyChecking=yes
  -o ControlPath=none "$REMOTE")

# The deadman is addressed by PID FILE, never by `pkill -f <name>`. ssh hands the remote
# sshd a command line that CONTAINS the pattern, so a pattern-matching pkill matches its
# own shell, kills it, and ssh returns 255 — which is exactly how the first version of this
# script both failed to arm the timer and then died claiming success.
DEADMAN_PID=/tmp/wt-pacs-netem-deadman.pid

arm_deadman() {
  "${SSH[@]}" "bash -s $(printf '%q %q' "$DEADMAN_S" "$DEADMAN_PID")" <<'REMOTE'
DEAD=$1; PIDF=$2
[ -f "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null
IF=$(ip route show default | awk '{print $5}' | head -1)
setsid nohup bash -c "sleep $DEAD
  sudo -n tc qdisc del dev $IF root 2>/dev/null
  sudo -n tc qdisc add dev $IF root fq 2>/dev/null" >/dev/null 2>&1 < /dev/null &
echo $! > "$PIDF"
disown
sleep 0.2
kill -0 "$(cat "$PIDF")" 2>/dev/null && echo "deadman armed (pid $(cat "$PIDF"), ${DEAD}s)" \
  || { echo "DEADMAN FAILED TO ARM" >&2; exit 1; }
REMOTE
}
disarm_deadman() {
  "${SSH[@]}" "bash -s $(printf '%q' "$DEADMAN_PID")" <<'REMOTE'
PIDF=$1
[ -f "$PIDF" ] && { kill "$(cat "$PIDF")" 2>/dev/null; rm -f "$PIDF"; }
exit 0
REMOTE
}

# Same shaping as cloud_netem_exact.sh but with NO port-22 exemption, so a TCP flow on 22
# contends for the same 20 Mbit band and the same 500-packet queue as QUIC on 4435.
netem_no_bypass() {
  "${SSH[@]}" "bash -s $(printf '%q %q %q %q' "$DELAY" "$RATE" "$LOSS" "$QUEUE")" <<'REMOTE'
set -euo pipefail
D=$1; R=$2; L=$3; Q=$4
IF=$(ip route show default | awk '{print $5}' | head -1)
sudo -n tc qdisc del dev "$IF" root 2>/dev/null || true
ARGS=(netem limit "$Q" delay "${D}ms" rate "${R}mbit")
case "$L" in 0|0.0|0.00) ;; *) ARGS+=(loss "${L}%") ;; esac
sudo -n tc qdisc add dev "$IF" root handle 1: "${ARGS[@]}"
tc qdisc show dev "$IF" | head -2
REMOTE
}

stop_all() { "${SSH[@]}" 'pkill -x exact-server 2>/dev/null; true'; }
cleanup() {
  stop_all >/dev/null 2>&1 || true
  r6_netem "$DELAY" "$RATE" "$LOSS" "$QUEUE" >/dev/null 2>&1 || true   # restores the ssh bypass
  disarm_deadman >/dev/null 2>&1 || true
}
trap cleanup EXIT

start_quic_server() {   # start_quic_server <congestion>
  r6_start_server "$STUDY" --stream-mode shared --congestion "$1" >/dev/null
}

quic_flow() { # quic_flow <outfile>
  trap - EXIT                     # never let a flow subshell run the campaign's cleanup
  timeout 180 "$HARNESS" --url "$CLOUD_URL" --mode saturate \
    --fill-dwell-ms "$DWELL_MS" --frame-count 500 --depth "$DEPTH" \
    --stream-mode shared --read-bps 0 --rtt-ms 0 --arm fair --json > "$1" 2>/dev/null || true
}

tcp_flow() {  # tcp_flow <outfile>
  # The QUIC flow does not start filling until its handshake completes, so a competitor
  # started at the same instant owns the link for that first second and its rate is
  # inflated. Start late, stop early: this window sits strictly inside the QUIC dwell.
  trap - EXIT
  local secs bytes t0 t1
  secs=$(python3 -c "print(max(1,$DWELL_MS/1000 - 3))")
  sleep 1.5
  t0=$(date +%s.%N)
  # `timeout` ALWAYS exits 124 here — the blob is 400 MB and the window is seconds, so
  # being cut off is the design, not a failure. Under `set -o pipefail` that 124 becomes
  # the pipeline's status and `set -e` then kills this subshell after the byte count has
  # been captured but before it is written, which is precisely how six runs came back
  # reporting a competitor that moved 0.00 Mbps. Swallow it inside the pipeline.
  bytes=$( { timeout "$secs" "${SSH_BULK[@]}" 'dd if=/home/ubuntu/wt-pacs/www/blob.bin bs=1M status=none' 2>/dev/null || true; } | wc -c )
  t1=$(date +%s.%N)
  echo "$bytes $(python3 -c "print($t1-$t0)")" > "$1"
}

"${SSH[@]}" 'mkdir -p /home/ubuntu/wt-pacs/www; [ -f /home/ubuntu/wt-pacs/www/blob.bin ] || fallocate -l 400M /home/ubuntu/wt-pacs/www/blob.bin' >/dev/null

echo "bottleneck: rig egress netem +${DELAY} ms, ${RATE} Mbps, ${LOSS}% loss, ${QUEUE}p queue — SHARED"
echo "dwell ${DWELL_MS} ms, ${REPS} repeats, cells: $CELLS"

# THE GUARD THIS EXPERIMENT CANNOT RUN WITHOUT.
# "Two flows, one bottleneck" is only a measurement if the bottleneck is the one we
# installed. A residential path is not a constant: this link delivered 51 Mbps at the start
# of the session and 9 Mbps three hours later, at which point a 20 Mbit netem cap was no
# longer binding and both flows were sharing an UNCONTROLLED bottleneck of unknown queue
# depth. The split was still measurable and still meaningless. So: prove a single flow can
# reach the cap before putting two flows through it.
r6_netem "$DELAY" "$RATE" "$LOSS" "$QUEUE" >/dev/null
start_quic_server cubic
SOLO=$(timeout 120 "$HARNESS" --url "$CLOUD_URL" --mode saturate --fill-dwell-ms 10000 \
  --frame-count 500 --depth "$DEPTH" --stream-mode shared --read-bps 0 --rtt-ms 0 \
  --arm solo --json 2>/dev/null | python3 -c "
import json,sys
try: m=json.load(sys.stdin); print(f\"{m['fill_bytes']*8/(m['fill_dwell_ms']/1000)/1e6:.2f}\")
except Exception: print('0')
")
python3 - "$SOLO" "$RATE" <<'PY'
import sys
solo=float(sys.argv[1]); cap=float(sys.argv[2])
frac=solo/cap if cap else 0
print(f"  instrument check: one flow alone reaches {solo:.2f} Mbps against a {cap:.0f} Mbps cap ({frac*100:.0f} %)")
if frac < 0.85:
    print("  ABORT: the netem cap is NOT the bottleneck — the path is. Any split measured")
    print("         here would be a split across someone else's queue. Lower RATE below the")
    print("         path's current capacity and re-run.")
    raise SystemExit(2)
PY

for REP in $(seq 1 "$REPS"); do
  for CELL in $CELLS; do
    A=/tmp/fair_a.json; B=/tmp/fair_b.json; T=/tmp/fair_t.txt
    rm -f "$A" "$B" "$T"
    case "$CELL" in
      qcubic_qcubic) FA=quic_cubic; FB=quic_cubic; CC=cubic; KIND=qq ;;
      qbbr_qbbr)     FA=quic_bbr;   FB=quic_bbr;   CC=bbr;   KIND=qq ;;
      qcubic_tcp)    FA=quic_cubic; FB=tcp_cubic;  CC=cubic; KIND=qt ;;
      qbbr_tcp)      FA=quic_bbr;   FB=tcp_cubic;  CC=bbr;   KIND=qt ;;
      *) echo "unknown cell $CELL" >&2; exit 1 ;;
    esac

    if [[ "$KIND" == "qt" ]]; then
      arm_deadman >/dev/null
      netem_no_bypass >/dev/null
    else
      r6_netem "$DELAY" "$RATE" "$LOSS" "$QUEUE" >/dev/null
    fi
    start_quic_server "$CC"

    if [[ "$KIND" == "qt" ]]; then
      quic_flow "$A" & PA=$!
      tcp_flow  "$T" & PB=$!
    else
      quic_flow "$A" & PA=$!
      quic_flow "$B" & PB=$!
    fi
    wait "$PA" "$PB" 2>/dev/null || true
    [[ "$KIND" == "qt" ]] && { r6_netem "$DELAY" "$RATE" "$LOSS" "$QUEUE" >/dev/null; disarm_deadman >/dev/null; }

    python3 - "$CELL" "$REP" "$RATE" "$DELAY" "$LOSS" "$QUEUE" "$DWELL_MS" "$FA" "$FB" "$OUT" <<'PY'
import json,sys
cell,rep,rate,delay,loss,queue,dwell,fa,fb,out = sys.argv[1:11]
d=int(dwell)/1000
def quic(p):
    try:
        m=json.load(open(p)); return m["fill_bytes"], m["fill_dwell_ms"]/1000
    except Exception: return 0, d
def tcp(p):
    try:
        s=open(p).read().split(); return int(s[0]), float(s[1])
    except Exception: return 0, d
a,ad = quic("/tmp/fair_a.json")
b,bd = (tcp("/tmp/fair_t.txt") if fb=="tcp_cubic" else quic("/tmp/fair_b.json"))
# ad and bd are different windows by construction — see the header comment in the runner.
am = a*8/ad/1e6 if ad else 0
bm = b*8/bd/1e6 if bd else 0
tot = am+bm
share = am/tot if tot else 0
jain = (am+bm)**2/(2*(am**2+bm**2)) if (am or bm) else 0
print(f"  {cell:<14} rep{rep}  {fa:<10} {am:6.2f} Mbps | {fb:<10} {bm:6.2f} Mbps  "
      f"A-share {share*100:5.1f}%  Jain {jain:.3f}")
open(out,"a").write("\t".join([cell,rep,rate,delay,loss,queue,dwell,fa,fb,str(a),str(b),
   f"{ad:.2f}",f"{bd:.2f}",
   f"{am:.3f}",f"{bm:.3f}",f"{share:.4f}",f"{jain:.4f}"])+"\n")
PY
  done
done
echo "--- $OUT"
python3 - "$OUT" <<'PY'
import sys,statistics as st
from collections import defaultdict
rows=[l.rstrip("\n").split("\t") for l in open(sys.argv[1]) if l.strip()]
h,b=rows[0],rows[1:]; d=[dict(zip(h,r)) for r in b]
by=defaultdict(list)
for r in d: by[r["cell"]].append(r)
print(f"\n{'cell':<15} {'n':>2} {'flow A':<11} {'A Mbps':>8} {'flow B':<11} {'B Mbps':>8} {'A share':>8} {'Jain':>6}")
for c,rs in by.items():
    am=st.median(float(r["a_mbps"]) for r in rs); bm=st.median(float(r["b_mbps"]) for r in rs)
    sh=st.median(float(r["a_share"]) for r in rs); j=st.median(float(r["jain"]) for r in rs)
    print(f"{c:<15} {len(rs):>2} {rs[0]['flow_a']:<11} {am:8.2f} {rs[0]['flow_b']:<11} {bm:8.2f} {sh*100:7.1f}% {j:6.3f}")
PY
