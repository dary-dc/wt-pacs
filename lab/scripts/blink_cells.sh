#!/usr/bin/env bash
# W3: what a blink costs, where in the transfer it lands, and whether restarting slow start
# after the silence is worth it. Arms interleaved within every round.
# Results: docs/transport/transport-conclusions.md §3, after a blink.
#
#   lab/scripts/blink_cells.sh [rounds]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ROUNDS="${1:-5}"
RTT="${RTT:-80}"
RATE="${RATE:-20000}"
ARMS=(cubic cubic-restart bbr)
FILL=40          # frames the fill takes
KB=64            # frame size
ASK_KB=250       # the one-ask cell's frame size
ASK_WARM=8
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

study() {  # frames kb out
  local n="$1" kb="$2" out="$3" d="$T/f$3"
  mkdir -p "$d"
  for i in $(seq 0 "$n"); do
    head -c $((kb * 1024)) /dev/urandom > "$d/$(printf '%03d' "$i").htj2k"
  done
  echo "{\"frameCount\": $((n + 1))}" > "$T/m$3.json"
  "$BIN/pack-study" --metadata "$T/m$3.json" --frames "$d" --output "$T/$out.sbnd" >/dev/null
}
study "$FILL" "$KB" fill
study "$ASK_WARM" "$ASK_KB" ask

SRV=$((36000 + RANDOM % 2000))
IN=$((34000 + RANDOM % 2000))
CTRL=$((38000 + RANDOM % 2000))

start_server() {  # study extra args...
  local study="$1"; shift
  : > "$T/server.log"
  RUST_LOG=exact_server=info "$BIN/exact-server" --port "$SRV" --study "$T/$study.sbnd" \
    --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" "$@" > "$T/server.log" 2>&1 &
  SERVER_PID=$!
  PIDS+=("$SERVER_PID")
  for _ in $(seq 100); do grep -q "wt_url=" "$T/server.log" && return; sleep 0.1; done
  echo "server did not start:"; cat "$T/server.log"; exit 1
}
start_relay() {
  python3 lab/scripts/link_impair.py --udp "$IN:$SRV" --delay-ms "$((RTT / 2))" \
    --control-port "$CTRL" "${RELAY_ARGS[@]}" > "$T/relay.log" 2>&1 &
  RELAY_PID=$!
  PIDS+=("$RELAY_PID")
  for _ in $(seq 50); do grep -q READY "$T/relay.log" && return; sleep 0.1; done
  echo "relay did not start"; exit 1
}

# Datagrams sent and lost for the one session this round served, from the server's path line.
link_cost() {
  python3 - "$T/server.log" <<'PY'
import re, sys
text = re.sub(r"\x1b\[[0-9;]*m", "", open(sys.argv[1], errors="replace").read())
rows = re.findall(r"session path .*?\bsent=(\d+) lost=(\d+) congestion_events=(\d+)", text)
print("%s %s %s" % rows[-1] if rows else "- - -")
PY
}

# One round of one arm. Appends "<metric ms> <sent> <lost> <cong>" to the arm's file.
one() {  # cell arm study warm target [harness args...]
  local cell="$1" arm="$2" study="$3" warm="$4" target="$5"
  shift 5
  start_server "$study" --congestion "$arm"
  start_relay
  local line
  line=$(RUST_BACKTRACE=0 "$BIN/first_ask" --url "https://127.0.0.1:$IN/" --warm "$warm" \
    --target "$target" --control-port "$CTRL" --rounds 1 --timeout-ms 60000 "$@" 2>&1) || {
      echo "FAILED $cell $arm: $(head -2 <<<"$line" | tr '\n' ' ')" >&2
      kill "$RELAY_PID" "$SERVER_PID" 2>/dev/null || true; sleep 0.3; return; }
  # The close is still in the relay's delay queue and the server writes its `session path` line
  # when it arrives, so wait for it with the relay still up. A client that exited before
  # flushing the close never sends one, and that round keeps its time and loses its counters.
  for _ in $(seq 30); do grep -q "session path" "$T/server.log" && break; sleep 0.1; done
  kill -TERM "$RELAY_PID" 2>/dev/null || true; sleep 0.3
  local v
  v=$(sed -n "s/.*${METRIC} median=\([0-9.]*\).*/\1/p" <<<"$line")
  echo "$v $(link_cost)" >> "$T/$cell.$arm"
  kill "$SERVER_PID" 2>/dev/null || true; sleep 0.3
}

report() {  # cell
  python3 - "$T" "$1" "${ARMS[@]}" <<'PY'
import sys
t, cell, arms = sys.argv[1], sys.argv[2], sys.argv[3:]
def rows(arm):
    try:
        return [l.split() for l in open(f"{t}/{cell}.{arm}") if l.strip()]
    except FileNotFoundError:
        return []
base = [float(r[0]) for r in rows(arms[0])]
for arm in arms:
    r = rows(arm)
    if not r:
        print("%-14s %s" % (arm, "no rounds")); continue
    mine = [float(x[0]) for x in r]
    ms = sorted(mine)
    wins = sum(1 for a, b in zip(mine, base) if a < b)
    counted = [x for x in r if x[1] != "-"]
    mean = lambda i: sum(int(x[i]) for x in counted) / len(counted)
    print("%-14s %9.1f %9.1f %9.1f %8s %9.0f %7.1f %6.1f %6s" % (
        arm, ms[len(ms) // 2], ms[0], ms[-1], f"{wins}/{len(r)}",
        mean(1), mean(2), mean(3), f"{len(counted)}/{len(r)}"))
PY
}

head_row() {
  printf '\n== %s\n%-14s %9s %9s %9s %8s %9s %7s %6s %6s\n' "$1" \
    "arm" "median" "min" "max" "wins" "sent" "lost" "cong" "rows"
}

cell() {  # label study warm target [harness args...]
  local label="$1"; shift
  local study="$1" warm="$2" target="$3"; shift 3
  local key="${label// /_}"
  rm -f "$T/$key".*
  for _ in $(seq "$ROUNDS"); do
    for arm in "${ARMS[@]}"; do
      one "$key" "$arm" "$study" "$warm" "$target" "$@"
    done
  done
  head_row "$label"
  report "$key"
}

echo "link: ${RTT} ms round trip, ${RATE} kbit, fill $((FILL * KB)) KB, $ROUNDS rounds, arms interleaved"

RELAY_ARGS=(--rate-kbit "$RATE" --queue-pkts 1500)
METRIC=fill_ms
cell "no blackout" fill "$FILL" "$FILL" --state filled
for ms in 500 1000 2000; do
  cell "blink ${ms} ms at the fill's start" fill "$FILL" "$FILL" \
    --state lossy --blackout-ms "$ms" --blackout-after 0
done
cell "blink 1000 ms mid-fill" fill "$FILL" "$FILL" \
  --state lossy --blackout-ms 1000 --blackout-after 20
cell "blink 1000 ms near the fill's end" fill "$FILL" "$FILL" \
  --state lossy --blackout-ms 1000 --blackout-after 36

METRIC=ask_to_last_byte_ms
cell "one ${KB} KB ask, warmed, blinked" fill "$FILL" "$FILL" \
  --state lossy --blackout-ms 1000 --blackout-after "$FILL"
cell "one ${ASK_KB} KB ask, warmed, clean" ask "$ASK_WARM" "$ASK_WARM" --state filled
cell "one ${ASK_KB} KB ask, warmed, blinked" ask "$ASK_WARM" "$ASK_WARM" \
  --state lossy --blackout-ms 1000 --blackout-after "$ASK_WARM"

METRIC=fill_ms
for loss in 1 3; do
  RELAY_ARGS=(--rate-kbit "$RATE" --queue-pkts 1500 --loss "$loss")
  cell "no blackout, ${loss} % loss" fill "$FILL" "$FILL" --state filled
done
