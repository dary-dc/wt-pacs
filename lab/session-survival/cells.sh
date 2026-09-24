#!/usr/bin/env bash
# LV1: how the client decides a session is dead, on a cut and on links that only look dead —
# a radio, a slow link, a standing queue, blinks, a burst of asks. Arms interleaved, order rotated
# each round. docs/proposal-session-survival.md §Detection by the bytes
#
#   lab/session-survival/cells.sh cut|radio|slow|deep|blinks|asks [rounds]   [ARMS=built,quick]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
CELL="${1:?cell}"
ROUNDS="${2:-7}"
T="$(mktemp -d)"
PIDS=()
CFG=client/dev-transport.json
[[ -f $CFG ]] && cp "$CFG" "$T/cfg.bak"
cleanup() {
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  if [[ -f $T/cfg.bak ]]; then cp "$T/cfg.bak" "$CFG"; else rm -f "$CFG"; fi
  rm -rf "$T"
}
trap cleanup EXIT
# `timeout` sends TERM, and without this the servers outlive the script — one spun for hours.
trap "exit 143" TERM INT

case "$CELL" in
  cut)    RELAY=(--rate-kbit 20000 --queue-pkts 200); RUN=(--fill 80 --cut-after 12) ;;
  radio)  RELAY=(--delay-ms 40 --rate-kbit 20000 --queue-pkts 200 --jitter-ms 10 --jitter-mode ordered
                 --loss-model ge); RUN=(--fill 80 --no-cut) ;;
  blinks) RELAY=(--delay-ms 40 --rate-kbit 20000 --queue-pkts 200)
          RUN=(--fill 80 --no-cut --blink-every 5000 --blink-ms 1000) ;;
  # 700 kbit: a 428 KB frame is 4.9 s on the wire. 50 packets queue 0.9 s, 240 queue 4.1 s.
  slow)   RELAY=(--delay-ms 40 --rate-kbit 700 --queue-pkts 50); RUN=(--fill 8 --no-cut) ;;
  deep)   RELAY=(--delay-ms 40 --rate-kbit 700 --queue-pkts 240); RUN=(--fill 8 --no-cut) ;;
  asks)   RELAY=(--delay-ms 40 --rate-kbit 700 --queue-pkts 50); RUN=(--asks 6 --no-cut) ;;
  *) echo "unknown cell $CELL" >&2; exit 2 ;;
esac

cargo build -q --release -p exact-server
cargo build -q -p pack-study
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" \
  -out "$T/cert.pem" -days 2 -nodes -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null
HASH=$(openssl x509 -in "$T/cert.pem" -outform DER | openssl dgst -sha256 | awk '{print $2}')
mkdir -p "$T/frames"
for i in $(seq 0 86); do head -c 438272 /dev/urandom > "$T/frames/$(printf '%03d' "$i").htj2k"; done
echo '{"frameCount": 87}' > "$T/m.json"
target/debug/pack-study --metadata "$T/m.json" --frames "$T/frames" --output "$T/study.sbnd" >/dev/null

SRV=$((30000 + RANDOM % 5000)) IN=$((35000 + RANDOM % 5000)) CTRL=$((40000 + RANDOM % 5000))
HTTP=$((45000 + RANDOM % 5000))
target/release/exact-server --port "$SRV" --bind 127.0.0.1 --study "$T/study.sbnd" \
  --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" \
  --max-idle-timeout-ms 60000 --keep-alive-interval-ms 20000 > "$T/server.log" 2>&1 &
PIDS+=("$!")
python3 lab/scripts/link_impair.py --udp "$IN:$SRV" --control-port "$CTRL" "${RELAY[@]}" > "$T/relay.log" 2>&1 &
PIDS+=("$!")
python3 server/dev-server.py --port "$HTTP" > /dev/null 2>&1 &
PIDS+=("$!")
echo "{\"wt_url\": \"https://127.0.0.1:$IN/\", \"cert_sha256\": \"$HASH\"}" > "$CFG"
sleep 2

echo "cell $CELL: relay ${RELAY[*]}"
NODE_PATH="${NODE_PATH:-$(npm root -g)}" node lab/session-survival/run.mjs --rounds "$ROUNDS" \
  --base "http://127.0.0.1:$HTTP" --control "$CTRL" --arms "${ARMS:-built}" "${RUN[@]}" ${RUN_ARGS:-}
[[ -n "${KEEP_SERVER_LOG:-}" ]] && cp "$T/server.log" "$KEEP_SERVER_LOG"
exit 0
