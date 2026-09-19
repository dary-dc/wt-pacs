#!/usr/bin/env bash
# N1: does lab/scripts/link_impair.py tell the truth? Arithmetic first — delay, rate, queue,
# loss, and the floor the relay itself adds — then the two counts the lane owes: a cold open
# against docs/proposal-session-open.md, and a 250 KB ask against S7's slow start.
# Reads every number out loud and exits non-zero on the first one outside tolerance.
# Results and what this harness cannot do: docs/rig-limits.md §3.
#
#   lab/scripts/link_impair_check.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

T="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT

RELAY=lab/scripts/link_impair.py
UDP_IN=$((34000 + RANDOM % 2000))
UDP_OUT=$((36000 + RANDOM % 2000))
TCP_IN=$((38000 + RANDOM % 2000))
TCP_OUT=$((40000 + RANDOM % 2000))
fails=0

say() { printf '%-42s %s\n' "$1" "$2"; }
want() {  # label measured low high
  local verdict="ok"
  if ! python3 -c "import sys; sys.exit(0 if $3 <= $2 <= $4 else 1)"; then
    verdict="FAIL (want $3..$4)"
    fails=$((fails + 1))
  fi
  say "$1" "$2  $verdict"
}

cat > "$T/echo.py" <<'PY'
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 8 << 20)
s.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 8 << 20)
s.bind(("127.0.0.1", int(sys.argv[1])))
while True:
    d, a = s.recvfrom(65535)
    s.sendto(d, a)
PY

cat > "$T/probe.py" <<'PY'
"""Echoes `count` datagrams of `size` through the relay, paced `spacing` seconds apart (0 blasts
them, which is what fills a queue). Open loop: the sender never waits for a reply, so one lost
datagram costs one, not the whole stream. Each carries its send time, so the reply reads the RTT.
Prints median RTT, delivered, elapsed."""
import socket, statistics, struct, sys, threading, time
port, count, size, spacing = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), float(sys.argv[4])
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 8 << 20)
s.settimeout(3)
pad = b"x" * max(0, size - 8)
done = threading.Event()


def send():
    for _ in range(count):
        s.sendto(struct.pack("!d", time.monotonic()) + pad, ("127.0.0.1", port))
        if spacing > 0:
            time.sleep(spacing)
    done.set()


start = time.monotonic()
threading.Thread(target=send, daemon=True).start()
rtt, got = [], 0
while got < count:
    try:
        data, _ = s.recvfrom(65535)
    except socket.timeout:
        if done.is_set():
            break
        continue
    rtt.append((time.monotonic() - struct.unpack("!d", data[:8])[0]) * 1000)
    got += 1
print("%.3f %d %.4f" % (statistics.median(rtt) if rtt else 0.0, got, time.monotonic() - start))
PY

relay() {  # extra args...
  python3 "$RELAY" --udp "$UDP_IN:$UDP_OUT" "$@" > "$T/relay.log" 2>&1 &
  RELAY_PID=$!
  PIDS+=("$RELAY_PID")
  for _ in $(seq 50); do grep -q READY "$T/relay.log" && return; sleep 0.1; done
  echo "relay did not start: $(cat "$T/relay.log")" >&2
  exit 1
}
stop_relay() { kill -TERM "$RELAY_PID" 2>/dev/null || true; sleep 0.4; }

python3 "$T/echo.py" "$UDP_OUT" & ECHO_PID=$!; PIDS+=("$ECHO_PID")
sleep 0.3

echo "== the relay's own arithmetic"

relay
read -r rtt _ _ < <(python3 "$T/probe.py" "$UDP_IN" 40 100 0.01)
want "floor: rtt at delay 0 (ms)" "$rtt" 0 2
stop_relay

for d in 20 40; do
  relay --delay-ms "$d"
  read -r rtt _ _ < <(python3 "$T/probe.py" "$UDP_IN" 30 100 0.01)
  want "one-way ${d} ms: rtt (ms)" "$rtt" "$((2 * d))" "$((2 * d + 3))"
  stop_relay
done

relay --rate-kbit 10000 --queue-pkts 4000
read -r _ got el < <(python3 "$T/probe.py" "$UDP_IN" 1000 1000 0)
kbit=$(python3 -c "print(f'{$got*1000*8/$el/1000:.0f}')")
want "rate 10000 kbit: goodput (kbit/s)" "$kbit" 9000 10100
want "rate 10000 kbit: delivered of 1000" "$got" 1000 1000
stop_relay

relay --rate-kbit 1000 --queue-pkts 10
read -r _ got _ < <(python3 "$T/probe.py" "$UDP_IN" 500 1000 0)
want "queue 10: delivered of a 500 burst" "$got" 10 12
stop_relay

relay --loss 5 --queue-pkts 4000
read -r _ got _ < <(python3 "$T/probe.py" "$UDP_IN" 4000 200 0)
# Lossy in both directions, so 1 - 0.95^2 go missing; over 4000 samples 3σ is ~1.4 %.
want "loss 5% each way: delivered of 4000" "$got" 3554 3668
stop_relay

relay --loss-model ge --queue-pkts 4000
read -r _ got _ < <(python3 "$T/probe.py" "$UDP_IN" 8000 200 0)
want "gilbert-elliott 0.07/14: delivered of 8000" "$got" 7800 7980
stop_relay

CTRL=$((42000 + RANDOM % 2000))
poke() { (sleep "$1"; python3 -c "
import socket, sys
socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(sys.argv[1].encode(), ('127.0.0.1', $CTRL))
" "$2") & PIDS+=("$!"); }

relay --control-port "$CTRL"
poke 0.7 "blackout 600"
read -r _ got _ < <(python3 "$T/probe.py" "$UDP_IN" 200 200 0.01)
want "blackout 600 ms: delivered of a 2 s stream" "$got" 128 152
stop_relay

relay --control-port "$CTRL"
poke 0.7 "rebind"
read -r _ got _ < <(python3 "$T/probe.py" "$UDP_IN" 200 200 0.01)
want "rebind mid-stream: delivered of 200" "$got" 199 200
grep -q "^REBOUND " "$T/relay.log" || { say "the relay reported its rebind" "FAIL"; fails=$((fails + 1)); }
stop_relay

echo
echo "== the static host's plane"
python3 server/dev-server.py --port "$TCP_OUT" > "$T/static.log" 2>&1 & PIDS+=("$!")
for _ in $(seq 50); do curl -sf "http://127.0.0.1:$TCP_OUT/README.md" >/dev/null && break; sleep 0.1; done
python3 "$RELAY" --tcp "$TCP_IN:$TCP_OUT" --delay-ms 40 > "$T/tcp.log" 2>&1 & TCP_PID=$!; PIDS+=("$TCP_PID")
for _ in $(seq 50); do grep -q READY "$T/tcp.log" && break; sleep 0.1; done
curl -s "http://127.0.0.1:$TCP_IN/README.md" > "$T/got.md"
if cmp -s "$T/got.md" README.md; then
  say "a relayed fetch is byte-exact" "ok"
else
  say "a relayed fetch is byte-exact" "FAIL"
  fails=$((fails + 1))
fi
tot=$(curl -s -o /dev/null -w '%{time_total}' "http://127.0.0.1:$TCP_IN/README.md")
want "fetch at one-way 40 ms (s): setup + exchange" "$tot" 0.155 0.185
kill -TERM "$TCP_PID" 2>/dev/null || true

echo
echo "== the counts this lane owes"
kill "$ECHO_PID" 2>/dev/null || true   # the real server takes the echo's port
sleep 0.3
cargo build -q -p exact-server -p pack-study -p window-harness
BIN="${CARGO_TARGET_DIR:-target}/debug"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" \
  -out "$T/cert.pem" -days 2 -nodes -subj '/CN=localhost' \
  -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null
mkdir -p "$T/frames"
for i in $(seq 0 9); do head -c 256000 /dev/urandom > "$T/frames/$(printf '%03d' "$i").htj2k"; done
echo '{"frameCount": 10}' > "$T/metadata.json"
"$BIN/pack-study" --metadata "$T/metadata.json" --frames "$T/frames" --output "$T/study.sbnd" >/dev/null
RUST_LOG=exact_server=warn "$BIN/exact-server" --port "$UDP_OUT" --study "$T/study.sbnd" \
  --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" > "$T/server.log" 2>&1 & PIDS+=("$!")
for _ in $(seq 100); do grep -q "wt_url=" "$T/server.log" && break; sleep 0.1; done
grep -q "wt_url=" "$T/server.log" || { echo "server did not start:"; cat "$T/server.log"; exit 1; }

# A ratio at one delay carries the relay's own floor and the crypto with it. Three delays and a
# least-squares fit separate them: the slope is the round trips, the intercept everything else.
: > "$T/fit.tsv"
for d in 20 40 80; do
  relay --delay-ms "$d"
  line=$("$BIN/cold_open" --url "https://127.0.0.1:$UDP_IN/" --rounds 5 --rtt-ms "$((2 * d))")
  say "cold open at rtt $((2 * d)) ms" "$line"
  printf '%s\t%s\n' "$((2 * d))" "$line" >> "$T/fit.tsv"
  stop_relay
done

cat > "$T/fit.py" <<'FIT'
import re, sys
rows = [l.split("\t", 1) for l in open(sys.argv[1]).read().splitlines() if l]
xs, ys = [], []
for rtt, line in rows:
    m = re.search(sys.argv[2] + r"=([0-9.]+)ms", line)
    if m:
        xs.append(float(rtt))
        ys.append(float(m.group(1)))
mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
print("%.2f %.1f" % (slope, my - slope * mx))
FIT

read -r rt fixed < <(python3 "$T/fit.py" "$T/fit.tsv" session)
say "session ready: round trips + fixed ms" "$rt + $fixed"
read -r rt fixed < <(python3 "$T/fit.py" "$T/fit.tsv" first_byte)
say "first byte: fixed cost (ms)" "$fixed"
want "first byte: round trips (R1 counts 4)" "$rt" 3.6 4.4
read -r rt fixed < <(python3 "$T/fit.py" "$T/fit.tsv" ask_to_last_byte)
say "250 KB ask: fixed cost (ms)" "$fixed"
want "250 KB ask: flights (S7 predicts ~5)" "$rt" 4.5 6.0

echo
[[ $fails -eq 0 ]] || { echo "$fails check(s) failed"; exit 1; }
echo "link impair check OK"
