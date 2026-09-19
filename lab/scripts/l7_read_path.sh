#!/usr/bin/env bash
# L7: the read path where it misses. On the cloud rig, server and native driver on the rig's own
# loopback, a 4 GB study on a 954 MB host, so reads reach the throttled block device without any
# eviction; every run starts at a frame no earlier run read. Arms: read_ahead_kb 2048 (the rig's)
# against 128 (the workstation's), interleaved. The server's own hit/miss line says how cold each
# run was. A warm 80 MB study is the hit reference. Results: docs/disk-access/EVIDENCE.md.
#
#   SSH_KEY=~/.ssh/id_ed25519_rig lab/scripts/l7_read_path.sh [ROUNDS]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ROUNDS=${1:-6}
HOST=${CLOUD_HOST:-168.138.130.163}
SSH_KEY=${SSH_KEY:?the human rig key, docs/cloud-rig-access.md}
OUT=${OUT:-$ROOT/.local/measurements/l7-$(date +%Y%m%d-%H%M%S).tsv}
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes "ubuntu@$HOST")
SCP=(scp -q -i "$SSH_KEY")

mkdir -p "$(dirname "$OUT")"
"${SCP[@]}" "$ROOT/target/release/exact-server" "ubuntu@$HOST:wt-pacs/bin/exact-server-l7"
"${SCP[@]}" "$ROOT/target/release/server_ab" "ubuntu@$HOST:wt-pacs/bin/server_ab-l7"

"${SSH[@]}" bash -s "$ROUNDS" <<'REMOTE' > "$OUT"
set -u
cd ~/wt-pacs
BIG=fixtures/frames_4g/frames_4g.sbnd BIG_FRAMES=16000
SMALL=fixtures/frames_250k_live.sbnd SMALL_FRAMES=320
dev=$(lsblk -no PKNAME "$(findmnt -no SOURCE /)")

serve() {
  pkill -x exact-server-l7; while pgrep -x exact-server-l7 > /dev/null; do sleep 0.05; done
  setsid nohup bin/exact-server-l7 --port 4480 --bind 127.0.0.1 --study "$1" \
    --cert-pem cert/cert.pem --key-pem cert/key.pem > /tmp/l7-server.log 2>&1 < /dev/null &
  for _ in $(seq 100); do grep -q 'exact-server ready' /tmp/l7-server.log && break; sleep 0.05; done
}

# arm cell study frames start driver-args...
run() {
  local arm=$1 cell=$2 study=$3 frames=$4 start=$5; shift 5
  serve "$study"
  local pid; pid=$(pgrep -x exact-server-l7)
  local line steal0
  steal0=$(awk '/^cpu /{print $9}' /proc/stat)
  line=$(bin/server_ab-l7 --url https://127.0.0.1:4480/ --server-pid "$pid" --frames "$frames" \
    --start "$start" --arm "$arm" --label "$cell" --temp "ra$(cat /sys/block/$dev/queue/read_ahead_kb)" \
    --no-header "$@" 2> /dev/null) || line="$arm	$cell	FAILED"
  pkill -x exact-server-l7; sleep 0.3
  local hm
  hm=$(sed 's/\x1b\[[0-9;]*m//g' /tmp/l7-server.log | grep -o 'session reads hits=[0-9]* misses=[0-9]*' \
    | awk -F'[= ]' '{h+=$4; m+=$6} END{printf "%d\t%d", h, m}')
  printf '%s\t%s\t%s\n' "$line" "$hm" "$(( $(awk '/^cpu /{print $9}' /proc/stat) - steal0 ))"
}

printf 'label\tarm\ttemp\tmode\tdepth\tasks\tp50_ns\tp90_ns\tp99_ns\twall_ns\tasks_per_s\tcpu_ns_per_ask\trss_kib\tmiss_pct\tnamed\thits\tmisses\tsteal_ticks\n'
k=0
for ((r = 0; r < $1; r++)); do
  for ra in $( ((r % 2)) && echo "128 2048" || echo "2048 128" ); do
    echo "$ra" | sudo -n tee /sys/block/$dev/queue/read_ahead_kb > /dev/null
    arm=ra$ra
    for cell in od1 od4 od4s fill; do
      k=$((k + 1)); od=$(( (k * 1601) % BIG_FRAMES )); fs=$(( (k * 2003) % (BIG_FRAMES - 400) ))
      case $cell in
        od1)  run "$arm" od1  "$BIG" $BIG_FRAMES "$od" --mode on-demand --depth 1 --asks 128 --step 997 ;;
        od4)  run "$arm" od4  "$BIG" $BIG_FRAMES "$od" --mode on-demand --depth 4 --asks 128 --step 997 ;;
        od4s) run "$arm" od4s "$BIG" $BIG_FRAMES "$od" --mode on-demand --depth 1 --sessions 4 --asks 64 --step 997 ;;
        fill) run "$arm" fill "$BIG" $BIG_FRAMES "$fs" --mode fill --asks 400 ;;
      esac
    done
  done
  echo 2048 | sudo -n tee /sys/block/$dev/queue/read_ahead_kb > /dev/null
  # The fill reads the small study through, so the asks after it find it resident.
  run warm fill "$SMALL" $SMALL_FRAMES 0 --mode fill --asks 320
  run warm od1  "$SMALL" $SMALL_FRAMES 0 --mode on-demand --depth 1 --asks 128 --step 7
done
echo 2048 | sudo -n tee /sys/block/$dev/queue/read_ahead_kb > /dev/null
REMOTE
echo "wrote $OUT" >&2
