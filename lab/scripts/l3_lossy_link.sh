#!/usr/bin/env bash
# L3: send levers on a lossy, rate-limited link. The rig's one reachable port serves each arm in
# turn, server -> client shaped with netem; per round the arm order rotates and each arm runs a
# fill and an on-demand cell with the native driver. Results: docs/rig-limits.md §3.
#
#   SSH_KEY=~/.ssh/id_ed25519_rig lab/scripts/l3_lossy_link.sh [ROUNDS]
#   CELLS="off 20:50:0 20:50:1"   one-way delay ms : rate Mbit : loss %, or off
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ROUNDS=${1:-5}
HOST=${CLOUD_HOST:-168.138.130.163}
SSH_KEY=${SSH_KEY:?the human rig key, docs/cloud-rig-access.md}
CELLS=${CELLS:-"off 20:20:0 20:20:1 20:20:3 60:20:1"}
STUDY=${STUDY:-/home/ubuntu/wt-pacs/fixtures/frames_32k_160.sbnd}
FRAMES=${FRAMES:-160}
ASKS=${ASKS:-32}
SETTLE=${SETTLE:-2}
LIMIT=${LIMIT:-500}  # netem queue, packets
# 4436 and 4437 pass the host firewall but no session reaches them from outside (2026-09-18).
PORT=${CLOUD_PORT:-4435}
ARMS=("default:" "sw768k:--send-window-bytes 786432" "bbr:--congestion bbr")
# Every arm: with GSO on, netem here sees whole batches and drops them together.
SERVER_ARGS=${SERVER_ARGS:---segmentation-offload false}
BIN=${BIN:-$ROOT/target/release/exact-server}
DRIVER=${DRIVER:-$ROOT/target/release/server_ab}
OUT=${OUT:-$ROOT/.local/measurements/l3-$(date +%Y%m%d-%H%M%S).tsv}

mkdir -p "$(dirname "$OUT")"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes -o ControlMaster=auto -o ControlPersist=900
  -o ControlPath="/tmp/l3-ssh-%C" "ubuntu@$HOST")

shape() {
  "${SSH[@]}" bash -s "$1" "$LIMIT" <<'REMOTE'
set -eu
dev=$(ip route show default | awk '{print $5}' | head -1)
sudo -n tc qdisc del dev "$dev" root 2>/dev/null || true
if [ "$1" = off ]; then sudo -n tc qdisc add dev "$dev" root fq; exit 0; fi
IFS=: read -r delay rate loss <<<"$1"
sudo -n tc qdisc add dev "$dev" root handle 1: prio bands 3 priomap 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
sudo -n tc qdisc add dev "$dev" parent 1:1 handle 10: netem limit "$2" delay "${delay}ms" \
  rate "${rate}mbit" loss "${loss}%"
sudo -n tc qdisc add dev "$dev" parent 1:2 handle 20: pfifo
# The rig's own ssh stays unshaped, or a lossy cell locks us out.
sudo -n tc filter add dev "$dev" parent 1:0 protocol ip prio 1 u32 match ip sport 22 0xffff flowid 1:2
REMOTE
}

# netem's own count of what it sent and dropped, to check the configured loss is the real one.
netem_counts() {
  "${SSH[@]}" "tc -s qdisc show dev \$(ip route show default | awk '{print \$5}' | head -1) \
    | awk '/netem/{n=1} n&&/Sent/{print \$4, \$7; exit}' | tr -d ,"
}

# Server CPU in ns summed over its threads, and the host's steal ticks (a burstable VM).
server_cpu() {
  "${SSH[@]}" "pid=\$(pgrep -x exact-server-l3); \
    cat /proc/\$pid/task/*/schedstat | awk '{s+=\$1} END{printf \"%d \", s}'; \
    awk '/^cpu /{print \$9}' /proc/stat"
}

# The arm's server alone on the port, from a fresh process, ready before the driver dials.
serve() {
  "${SSH[@]}" "pkill -x exact-server-l3; while pgrep -x exact-server-l3 >/dev/null; do sleep 0.1; done; \
    setsid nohup wt-pacs/bin/exact-server-l3 --port $PORT --study $STUDY \
    --cert-pem wt-pacs/cert/cert.pem --key-pem wt-pacs/cert/key.pem $SERVER_ARGS $1 > /tmp/l3-server.log 2>&1 < /dev/null & \
    for i in \$(seq 50); do grep -q 'exact-server ready' /tmp/l3-server.log && exit 0; sleep 0.1; done; \
    cat /tmp/l3-server.log >&2; exit 1"
}

# The server's own account of the session: datagrams sent and lost, loss events, smoothed RTT.
session_stats() {
  "${SSH[@]}" "for i in \$(seq 30); do grep -q 'session path' /tmp/l3-server.log && break; sleep 0.1; done; \
    sed 's/\x1b\[[0-9;]*m//g' /tmp/l3-server.log | grep -o 'session path.*' | tail -1 \
    | sed -E 's/.*rtt_us=([0-9]+).*sent=([0-9]+) lost=([0-9]+) congestion_events=([0-9]+).*/\2 \3 \4 \1/'"
}

echo "==> deploy" >&2
"${SSH[@]}" 'pkill -x exact-server-l3 || true'
scp -i "$SSH_KEY" -o ControlPath="/tmp/l3-ssh-%C" "$BIN" "ubuntu@$HOST:wt-pacs/bin/exact-server-l3"

printf 'cell\tround\tarm\tmode\tcode\tp50_ns\tp90_ns\tp99_ns\twall_ns\tserver_cpu_ns\tsteal_ticks\tsent\tlost\tloss_events\tsrtt_us\n' > "$OUT"
for cell in $CELLS; do
  shape "$cell"
  before=$(netem_counts || true)
  for ((r = 0; r < ROUNDS; r++)); do
    for ((k = 0; k < ${#ARMS[@]}; k++)); do
      IFS=: read -r name args <<<"${ARMS[$(( (k + r) % ${#ARMS[@]} ))]}"
      for mode in fill on-demand; do
        serve "$args"
        read -r cpu0 steal0 < <(server_cpu)
        if [[ $mode == fill ]]; then n=(--asks "$FRAMES"); else n=(--depth 1 --asks "$ASKS" --step 7); fi
        code=0
        line=$(timeout 120 "$DRIVER" --url "https://$HOST:$PORT/" --mode "$mode" --frames "$FRAMES" "${n[@]}" \
          --arm "$name" --label "$cell" --no-header 2>/dev/null) || code=$?
        read -r cpu1 steal1 < <(server_cpu)
        read -r sent lost events srtt < <(session_stats)
        IFS=$'\t' read -r _ _ _ _ _ _ p50 p90 p99 wall _ <<<"${line:-}"
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$cell" "$r" "$name" "$mode" \
          "$code" "${p50:-NA}" "${p90:-NA}" "${p99:-NA}" "${wall:-NA}" "$((cpu1 - cpu0))" \
          "$((steal1 - steal0))" "${sent:-NA}" "${lost:-NA}" "${events:-NA}" "${srtt:-NA}" \
          | tee -a "$OUT"
        sleep "$SETTLE"
      done
    done
  done
  echo "netem $cell sent/dropped before: ${before:-none} after: $(netem_counts || true)" | tee -a "$OUT.qdisc"
done
shape off
"${SSH[@]}" 'pkill -x exact-server-l3 || true'
echo "wrote $OUT" >&2
