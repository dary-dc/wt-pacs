#!/usr/bin/env bash
# W2: the three controller questions, through lab/scripts/link_impair.py.
#   S8  an early slow-start exit — Cubic, Cubic with the exit, BBR; shallow and deep buffer,
#       with and without jitter.
#   S9  the persistent-congestion threshold against 0.5 / 1 / 2 s blackouts. Where in the
#       transfer the blink lands, and the controller arms through it: blink_cells.sh.
#   S10 `initial_rtt` against the cold-connect tail at 1 % loss.
# Results: docs/transport/transport-conclusions.md §3.
#
#   lab/scripts/controller_cells.sh [rounds]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ROUNDS="${1:-3}"
RTT="${RTT:-80}"
RATE="${RATE:-20000}"
FILL=40          # frames the fill takes
KB=64            # frame size
T="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT

cargo build -q -p exact-server -p pack-study -p window-harness
BIN="${CARGO_TARGET_DIR:-target}/debug"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" \
  -out "$T/cert.pem" -days 2 -nodes -subj '/CN=localhost' \
  -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null
mkdir -p "$T/frames"
for i in $(seq 0 "$FILL"); do
  head -c $((KB * 1024)) /dev/urandom > "$T/frames/$(printf '%03d' "$i").htj2k"
done
echo "{\"frameCount\": $((FILL + 1))}" > "$T/metadata.json"
"$BIN/pack-study" --metadata "$T/metadata.json" --frames "$T/frames" --output "$T/study.sbnd" >/dev/null

SRV=$((36000 + RANDOM % 2000))
IN=$((34000 + RANDOM % 2000))
CTRL=$((38000 + RANDOM % 2000))

start_server() {  # extra server args...
  : > "$T/server.log"
  RUST_LOG=exact_server=info "$BIN/exact-server" --port "$SRV" --study "$T/study.sbnd" \
    --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" "$@" > "$T/server.log" 2>&1 &
  SERVER_PID=$!
  PIDS+=("$SERVER_PID")
  for _ in $(seq 100); do grep -q "wt_url=" "$T/server.log" && return; sleep 0.1; done
  echo "server did not start:"; cat "$T/server.log"; exit 1
}
stop_server() { kill "$SERVER_PID" 2>/dev/null || true; sleep 0.3; }

start_relay() {  # extra relay args...
  python3 lab/scripts/link_impair.py --udp "$IN:$SRV" --delay-ms "$((RTT / 2))" \
    --control-port "$CTRL" "$@" > "$T/relay.log" 2>&1 &
  RELAY_PID=$!
  PIDS+=("$RELAY_PID")
  for _ in $(seq 50); do grep -q READY "$T/relay.log" && return; sleep 0.1; done
  echo "relay did not start"; exit 1
}
stop_relay() { kill -TERM "$RELAY_PID" 2>/dev/null || true; sleep 0.3; }

# Per session: datagrams sent, lost, congestion events, and the smoothed RTT the session ended
# on — on a deep buffer that last one is the standing queue, which is what S8 is about.
link_cost() {
  python3 - "$T/server.log" <<'PY'
import re, sys
text = re.sub(r"\x1b\[[0-9;]*m", "", open(sys.argv[1], errors="replace").read())
rows = re.findall(r"session path .*?\brtt_us=(\d+) .*?\bsent=(\d+) lost=(\d+) congestion_events=(\d+)", text)
if not rows:
    print("- - - -")
else:
    n = len(rows)
    cols = [sum(int(r[i]) for r in rows) / n for i in range(4)]
    print("%.0f %.0f %.1f %.1f" % (cols[0] / 1000, cols[1], cols[2], cols[3]))
PY
}

SERVER_ARGS=()
RELAY_ARGS=()
run() {  # label state [probe args...]
  local label="$1" state="$2"
  shift 2
  start_server "${SERVER_ARGS[@]}"
  start_relay "${RELAY_ARGS[@]}"
  local line
  line=$(RUST_BACKTRACE=0 "$BIN/first_ask" --url "https://127.0.0.1:$IN/" --state "$state" \
    --warm "$FILL" --target "$FILL" --control-port "$CTRL" --rounds "$ROUNDS" \
    --timeout-ms 60000 "$@" 2>&1) || {
      printf '%-26s FAILED %s\n' "$label" "$(head -2 <<<"$line" | tr '\n' ' ')"
      stop_relay; stop_server; return; }
  # The last session's close is still in the relay's delay queue; the server's `session path`
  # line is written when it arrives, so let it.
  sleep 0.5
  stop_relay
  local fill
  fill=$(sed -n 's/.*fill_ms median=\([0-9.]*\).*/\1/p' <<<"$line")
  read -r rtt_ms sent lost ce < <(link_cost)
  stop_server
  printf '%-26s %9s %9s %8s %7s %8s\n' "$label" "$fill" "$sent" "$lost" "$ce" "$rtt_ms"
}

head_row() {
  printf '\n== %s\n%-26s %9s %9s %8s %7s %8s\n' "$1" \
    "arm" "fill ms" "sent" "lost" "cong" "end rtt"
}

echo "link: ${RTT} ms round trip, ${RATE} kbit, fill $((FILL * KB)) KB"

for buffer in "shallow:20" "deep:1500"; do
  for jitter in 0 2 10; do
    head_row "S8 · ${buffer%%:*} buffer (${buffer##*:} packets), jitter ${jitter} ms"
    RELAY_ARGS=(--rate-kbit "$RATE" --queue-pkts "${buffer##*:}" --jitter-ms "$jitter")
    for arm in cubic cubic-hystart bbr; do
      SERVER_ARGS=(--congestion "$arm")
      run "$arm" filled
    done
  done
done

RELAY_ARGS=(--rate-kbit "$RATE" --queue-pkts 1500)
for ms in 500 1000 2000; do
  head_row "S9 · a ${ms} ms blackout, deep buffer"
  for threshold in 3 6 12; do
    if [[ $threshold -eq 3 ]]; then SERVER_ARGS=(); else
      SERVER_ARGS=(--persistent-congestion-threshold "$threshold"); fi
    run "threshold $threshold" lossy --blackout-ms "$ms"
  done
done

printf '\n== S10 · the cold-connect tail at 1 %% loss\n%-26s %s\n' "arm" "cold open, $((ROUNDS * 8)) connects"
RELAY_ARGS=(--loss 1)
for rtt_ms in 333 100 50; do
  if [[ $rtt_ms -eq 333 ]]; then SERVER_ARGS=(); else
    SERVER_ARGS=(--initial-rtt-ms "$rtt_ms"); fi
  start_server "${SERVER_ARGS[@]}"
  start_relay "${RELAY_ARGS[@]}"
  line=$(RUST_BACKTRACE=0 "$BIN/cold_open" --url "https://127.0.0.1:$IN/" \
    --rounds $((ROUNDS * 8)) --rtt-ms "$RTT" 2>&1 | tail -1)
  stop_relay
  stop_server
  printf '%-26s %s\n' "initial_rtt ${rtt_ms} ms" \
    "$(grep -o 'session=[^ ]* .*session_p95=[^ ]* session_p99=[^ ]*' <<<"$line" || echo "$line")"
done
