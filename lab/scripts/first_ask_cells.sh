#!/usr/bin/env bash
# W1: one frame asked on an idle session, in four session states and under two levers, through
# lab/scripts/link_impair.py at 40 and 80 ms round trip and at two frame sizes. The server's own
# `session path` line gives loss and congestion events per arm.
# Results and the verdict they correct: docs/transport/transport-conclusions.md §Initial window.
#
#   lab/scripts/first_ask_cells.sh [rounds]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ROUNDS="${1:-5}"
WARM="${WARM:-8}"
TARGET=$((WARM + 1))
FRAMES=$((TARGET + 2))
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

for kb in 50 250; do
  mkdir -p "$T/f$kb"
  for i in $(seq 0 $((FRAMES - 1))); do
    head -c $((kb * 1000)) /dev/urandom > "$T/f$kb/$(printf '%03d' "$i").htj2k"
  done
  echo "{\"frameCount\": $FRAMES}" > "$T/m$kb.json"
  "$BIN/pack-study" --metadata "$T/m$kb.json" --frames "$T/f$kb" --output "$T/s$kb.sbnd" >/dev/null
done

SRV=$((36000 + RANDOM % 2000))
IN=$((34000 + RANDOM % 2000))
CTRL=$((38000 + RANDOM % 2000))

start_server() {  # study extra...
  : > "$T/server.log"
  RUST_LOG=exact_server=info "$BIN/exact-server" --port "$SRV" --study "$1" \
    --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" "${@:2}" > "$T/server.log" 2>&1 &
  SERVER_PID=$!
  PIDS+=("$SERVER_PID")
  for _ in $(seq 100); do grep -q "wt_url=" "$T/server.log" && return; sleep 0.1; done
  echo "server did not start:"; cat "$T/server.log"; exit 1
}
stop_server() { kill "$SERVER_PID" 2>/dev/null || true; sleep 0.3; }

RELAY_EXTRA=()
start_relay() {  # rtt_ms; RELAY_EXTRA carries rate and queue when a cell wants them
  python3 lab/scripts/link_impair.py --udp "$IN:$SRV" --delay-ms "$(($1 / 2))" \
    --control-port "$CTRL" "${RELAY_EXTRA[@]}" > "$T/relay.log" 2>&1 &
  RELAY_PID=$!
  PIDS+=("$RELAY_PID")
  for _ in $(seq 50); do grep -q READY "$T/relay.log" && return; sleep 0.1; done
  echo "relay did not start"; exit 1
}
stop_relay() { kill -TERM "$RELAY_PID" 2>/dev/null || true; sleep 0.3; }

# The server prints one `session path` line per session it ends; the probe opens one per round,
# so these cover the same sessions the median does. All three are per session, and they count the
# whole of it — a warm-up's loss is in there too, not only the ask's.
link_cost() {
  python3 - "$T/server.log" <<'PY'
import re, sys
text = re.sub(r"\x1b\[[0-9;]*m", "", open(sys.argv[1], errors="replace").read())
rows = [(int(s), int(l), int(c)) for s, l, c in
        re.findall(r"session path .*?\bsent=(\d+) lost=(\d+) congestion_events=(\d+)", text)]
if not rows:
    print("-  -  -")
else:
    n = len(rows)
    print("%d %.1f %.1f" % (sum(r[0] for r in rows) // n, sum(r[1] for r in rows) / n,
                            sum(r[2] for r in rows) / n))
PY
}

cell() {  # label state study rtt warm extra_server_args...
  local label="$1" state="$2" study="$3" rtt="$4" warm="$5"
  shift 5
  start_server "$study" "$@"
  start_relay "$rtt"
  local line
  line=$(RUST_BACKTRACE=0 "$BIN/first_ask" --url "https://127.0.0.1:$IN/" --state "$state" --warm "$warm" \
    --target "$TARGET" --control-port "$CTRL" --rounds "$ROUNDS" 2>&1) || {
      printf '%-22s %-9s FAILED %s\n' "$label" "${rtt} ms" "$(head -3 <<<"$line" | tr "\n" " ")"; stop_relay
      stop_server; return; }
  stop_relay
  local ms bytes
  ms=$(sed -n 's/.*ask_to_last_byte_ms median=\([0-9.]*\).*/\1/p' <<<"$line")
  bytes=$(sed -n 's/.*bytes=\([0-9]*\).*/\1/p' <<<"$line")
  read -r sent lost ce < <(link_cost)
  stop_server
  printf '%-22s %-9s %9.1f %8.2f %9s %6s %6s\n' \
    "$label" "${rtt} ms" "$ms" "$(python3 -c "print($ms/$rtt)")" "$sent" "$lost" "$ce"
}

header() {
  printf '\n== %s\n%-22s %-9s %9s %8s %9s %6s %6s\n' "$1" \
    "arm" "rtt" "ask ms" "trips" "sent/sess" "lost" "cong"
}

for kb in 50 250; do
  header "${kb} KB frames"
  for rtt in 40 80; do
    for state in fresh filled lossy rebound; do
      cell "$state" "$state" "$T/s$kb.sbnd" "$rtt" "$WARM"
    done
    # Lever 1: the warm-up rides in the session URL, swept by how many frames it carries.
    for w in 1 2 4 8; do
      cell "open-push $((w * kb)) KB" open-push "$T/s$kb.sbnd" "$rtt" "$w" --open-ask
    done
    # Lever 2: 32 packets before the first ACK, against quinn's 12 000 bytes.
    cell "fresh, iw 32 pkt" fresh "$T/s$kb.sbnd" "$rtt" "$WARM" --initial-window-bytes 38400
    cell "filled, iw 32 pkt" filled "$T/s$kb.sbnd" "$rtt" "$WARM" --initial-window-bytes 38400
  done
done

# A 32-packet initial window is only free where nothing can punish the burst. These cells can:
# the link is rate-limited and its queue is shallower than the window.
RELAY_EXTRA=(--rate-kbit 10000 --queue-pkts 20)
header "250 KB frames, 10 Mbit link with a 20-packet queue"
for rtt in 40 80; do
  cell "fresh" fresh "$T/s250.sbnd" "$rtt" "$WARM"
  cell "fresh, iw 32 pkt" fresh "$T/s250.sbnd" "$rtt" "$WARM" --initial-window-bytes 38400
  cell "open-push 1000 KB" open-push "$T/s250.sbnd" "$rtt" 4 --open-ask
done
