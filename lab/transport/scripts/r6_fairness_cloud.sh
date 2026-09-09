#!/usr/bin/env bash
# Competing-flow fairness: two flows, ONE bottleneck. What the rig can and cannot pose,
# and the four traps that each cost a run: docs/transport/measurements/r6/fairness-instrument.md.
# Usage: REPS=3 DWELL_MS=30000 lab/transport/scripts/r6_fairness_cloud.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/lab/transport/scripts/cloud_r6_common.sh"

FIXTURE="${FIXTURE:-frames_500x64k}"
REPS="${REPS:-3}"
DWELL_MS="${DWELL_MS:-30000}"   # long enough that ~1 s of start-up skew is <4 %
DEPTH="${DEPTH:-8}"
RATE="${RATE:-20}"; DELAY="${DELAY:-25}"; LOSS="${LOSS:-0.0}"
# SHALLOW on purpose: ~48 ms at 5 Mbps is the case quinn's BBRv1 is warned about.
QUEUE="${QUEUE:-500}"
DEADMAN_S="${DEADMAN_S:-900}"
CELLS="${CELLS:-qcubic_qcubic qbbr_qbbr qcubic_tcp qbbr_tcp}"
OUT="${OUT:-$ROOT/.local/measurements/r6/fairness.tsv}"
mkdir -p "$(dirname "$OUT")"
# The two denominators are NOT equal, which is why both are recorded — the bias and its
# fix are in docs/transport/measurements/r6/fairness-instrument.md.
[ -s "$OUT" ] || printf 'cell\trep\trate_mbps\tdelay_ms\tloss_pct\tqueue_pkts\tdwell_ms\tflow_a\tflow_b\ta_bytes\tb_bytes\ta_window_s\tb_window_s\ta_mbps\tb_mbps\ta_share\tjain\n' > "$OUT"

r6_sync_scripts
r6_upload_server
STUDY=$(r6_upload_fixture "$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd")

# NON-multiplexed on purpose: down the ControlMaster it would share the orchestration's flow.
SSH_BULK=(ssh -i "$SSH_KEY" -o BatchMode=yes -o IdentitiesOnly=yes
  -o UserKnownHostsFile="$SSH_KNOWN_HOSTS" -o StrictHostKeyChecking=yes
  -o ControlPath=none "$REMOTE")

# By PID FILE, never `pkill -f`: the pattern appears in ssh's own remote command line.
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
  # Start late, stop early, so this window sits strictly inside the QUIC dwell.
  trap - EXIT
  local secs bytes t0 t1
  secs=$(python3 -c "print(max(1,$DWELL_MS/1000 - 3))")
  sleep 1.5
  t0=$(date +%s.%N)
  # `timeout` ALWAYS exits 124 here by design; swallow it or pipefail kills the subshell
  # after the byte count is captured but before it is written.
  bytes=$( { timeout "$secs" "${SSH_BULK[@]}" 'dd if=/home/ubuntu/wt-pacs/www/blob.bin bs=1M status=none' 2>/dev/null || true; } | wc -c )
  t1=$(date +%s.%N)
  echo "$bytes $(python3 -c "print($t1-$t0)")" > "$1"
}

"${SSH[@]}" 'mkdir -p /home/ubuntu/wt-pacs/www; [ -f /home/ubuntu/wt-pacs/www/blob.bin ] || fallocate -l 400M /home/ubuntu/wt-pacs/www/blob.bin' >/dev/null

echo "bottleneck: rig egress netem +${DELAY} ms, ${RATE} Mbps, ${LOSS}% loss, ${QUEUE}p queue — SHARED"
echo "dwell ${DWELL_MS} ms, ${REPS} repeats, cells: $CELLS"

# THE GUARD: prove one flow reaches the cap before putting two through it. Below the cap they
# share an uncontrolled bottleneck and the split is measurable and meaningless.
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
