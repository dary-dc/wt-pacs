#!/usr/bin/env bash
# N1: does lab/scripts/link_impair.py tell the truth? Arithmetic first — delay, rate, queue,
# loss, and the floor the relay itself adds — then the two counts the lane owes: a cold open
# against docs/ARCHITECTURE.md, and a 250 KB ask against S7's slow start.
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
"""Echoes each datagram, or only its first `reply` bytes (at least the probe's 12-byte header)."""
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 8 << 20)
s.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 8 << 20)
s.bind(("127.0.0.1", int(sys.argv[1])))
reply = max(12, int(sys.argv[2])) if len(sys.argv) > 2 else None
while True:
    d, a = s.recvfrom(65535)
    s.sendto(d[:reply] if reply else d, a)
PY

cat > "$T/trace_probe.py" <<'PY'
"""Sends MTU-sized datagrams open loop at `factor` times the trace's mean for one period, so the
relay's queue never empties, and compares what comes back per 100 ms bin with the trace's own
opportunities in that bin, both counted from the relay's epoch.
Prints bins compared, the worst |delivered - trace| of any bin, delivered and the trace's total."""
import socket, sys, threading, time
port, trace, epoch, factor = int(sys.argv[1]), sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
ms = [int(x) for x in open(trace).read().split()]
period = ms[-1]
interval = period / 1000.0 / len(ms) / factor
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 32 << 20)
s.settimeout(0.5)
arrivals, sent = [], []


def send():
    start = time.monotonic()
    for i in range(int(period / 1000.0 / interval)):
        wait = start + i * interval - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        s.sendto(b"x" * 1500, ("127.0.0.1", port))
    sent.extend((start, time.monotonic()))


sender = threading.Thread(target=send)
sender.start()
while True:
    try:
        s.recvfrom(65535)
        arrivals.append(time.monotonic())
    except socket.timeout:
        if not sender.is_alive():
            break
# The first bin after the first send, to the last bin before the last send: the queue stands.
first = int((sent[0] - epoch) * 10) + 1
last = int((sent[1] - epoch) * 10) - 1
got = {b: 0 for b in range(first, last + 1)}
for t in arrivals:
    b = int((t - epoch) * 10)
    if b in got:
        got[b] += 1
want = {b: 0 for b in got}
for loop in range(last * 100 // period + 2):
    for t in ms:
        b = (loop * period + t) // 100
        if b in want:
            want[b] += 1
print("%d %d %d %d" % (len(got), max(abs(got[b] - want[b]) for b in got),
                       sum(got.values()), sum(want.values())))
PY

cat > "$T/probe.py" <<'PY'
"""Echoes `count` datagrams of `size` through the relay, paced `spacing` seconds apart (0 blasts
them, which is what fills a queue). Open loop: the sender never waits for a reply, so one lost
datagram costs one, not the whole stream. Each carries its send time and sequence, so the reply
reads the RTT and whether the path reordered it.
Prints median RTT, delivered, elapsed, p90-p10 of the RTT, how many arrived out of order, and the
worst RTT — the last of which is what a held outage shows up as."""
import socket, statistics, struct, sys, threading, time
port, count, size, spacing = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), float(sys.argv[4])
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 8 << 20)
s.settimeout(3)
pad = b"x" * max(0, size - 12)
done = threading.Event()


def send():
    for i in range(count):
        s.sendto(struct.pack("!dI", time.monotonic(), i) + pad, ("127.0.0.1", port))
        if spacing > 0:
            time.sleep(spacing)
    done.set()


start = time.monotonic()
threading.Thread(target=send, daemon=True).start()
rtt, got, highest, out_of_order = [], 0, -1, 0
while got < count:
    try:
        data, _ = s.recvfrom(65535)
    except socket.timeout:
        if done.is_set():
            break
        continue
    sent_at, seq = struct.unpack("!dI", data[:12])
    rtt.append((time.monotonic() - sent_at) * 1000)
    out_of_order += seq < highest
    highest = max(highest, seq)
    got += 1
spread = 0.0
if len(rtt) >= 10:
    q = statistics.quantiles(rtt, n=10)
    spread = q[8] - q[0]
print("%.3f %d %.4f %.3f %d %.3f" % (statistics.median(rtt) if rtt else 0.0, got,
                                     time.monotonic() - start, spread, out_of_order,
                                     max(rtt) if rtt else 0.0))
PY

relay() {  # extra args...; TARGET= picks another echo
  python3 "$RELAY" --udp "$UDP_IN:${TARGET:-$UDP_OUT}" "$@" > "$T/relay.log" 2>&1 &
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
read -r _ got el _ _ < <(python3 "$T/probe.py" "$UDP_IN" 1000 1000 0)
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

relay --delay-ms 20
read -r rtt _ _ spread reord worst < <(python3 "$T/probe.py" "$UDP_IN" 200 200 0.005)
want "no jitter: rtt p90-p10 (ms)" "$spread" 0 2
want "no jitter: arrived out of order" "$reord" 0 0
stop_relay

relay --delay-ms 20 --jitter-ms 5
read -r rtt _ _ spread reord worst < <(python3 "$T/probe.py" "$UDP_IN" 200 200 0.005)
want "jitter 5 ms: rtt median (ms)" "$rtt" 37 43
want "jitter 5 ms: rtt p90-p10 (ms)" "$spread" 8 17
want "jitter 5 ms: arrived out of order" "$reord" 5 120
stop_relay

# Ordered jitter only ever delays a packet to its predecessor's slot, so the wobble is still
# there, no packet passes another, and one way stays inside delay + jitter: 50 ms plus the floor.
relay --delay-ms 20 --jitter-ms 5 --jitter-mode ordered
read -r rtt _ _ spread reord worst < <(python3 "$T/probe.py" "$UDP_IN" 200 200 0.005)
want "ordered jitter 5 ms: rtt median (ms)" "$rtt" 39 47
want "ordered jitter 5 ms: rtt p90-p10 (ms)" "$spread" 5 14
want "ordered jitter 5 ms: arrived out of order" "$reord" 0 0
want "ordered jitter 5 ms: worst rtt (ms)" "$worst" 44 52
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

# Held, the same outage loses nothing the queue can hold: the 60 packets of a 10 ms-paced stream
# that fall inside it burst out at its end, the first of them a whole outage late.
relay --control-port "$CTRL" --blackout-mode hold --queue-pkts 200
poke 0.7 "blackout 600"
read -r _ got _ spread reord worst < <(python3 "$T/probe.py" "$UDP_IN" 200 200 0.01)
want "held 600 ms: delivered of a 2 s stream" "$got" 200 200
want "held 600 ms: worst rtt (ms)" "$worst" 585 610
want "held 600 ms: arrived out of order" "$reord" 0 0
stop_relay

relay --control-port "$CTRL" --blackout-mode hold --queue-pkts 20
poke 0.7 "blackout 600"
read -r _ got _ < <(python3 "$T/probe.py" "$UDP_IN" 200 200 0.01)
want "held 600 ms, queue 20: delivered of 200" "$got" 152 168
stop_relay

# Armed a second before any traffic, the window still opens on the first echo and eats ~30 of a
# 10 ms-paced stream: a blackout armed then would have expired unused.
relay --control-port "$CTRL"
poke 0 "swallow 300"
sleep 1
read -r _ got _ < <(python3 "$T/probe.py" "$UDP_IN" 200 200 0.01)
want "swallow 300 ms armed idle: delivered of 200" "$got" 167 173
stop_relay
swallowed=$(grep -o "swallowed [0-9]*" "$T/relay.log" | awk '{print $2}')
want "swallow 300 ms: server->client datagrams it took" "${swallowed:-0}" 27 33
lost_up=$(grep -o "client->server sent [0-9]* lost [0-9]*" "$T/relay.log" | awk '{print $5}')
want "swallow 300 ms: client->server datagrams it took" "${lost_up:-0}" 0 0

relay --control-port "$CTRL"
poke 0.7 "rebind"
read -r _ got _ < <(python3 "$T/probe.py" "$UDP_IN" 200 200 0.01)
want "rebind mid-stream: delivered of 200" "$got" 199 200
grep -q "^REBOUND " "$T/relay.log" || { say "the relay reported its rebind" "FAIL"; fails=$((fails + 1)); }
stop_relay

echo
echo "== a phone's link: the relay's own timing, an uplink of its own, a trace, a queue in bytes"
late() { grep -o "late p50 [0-9.]* p99 [0-9.]* max [0-9.]*" "$T/relay.log" | awk "{print \$$1}"; }

# Every packet echoed is two sends, each timed. On a quiet host the p99 is ~0.2 ms; a loop that
# waits in whole milliseconds (epoll) read 0.7–1.0.
relay --self-timing --delay-ms 20 --rate-kbit 20000 --queue-pkts 4000
python3 "$T/probe.py" "$UDP_IN" 2000 1200 0.0004 > /dev/null
stop_relay
want "self-timing, 20 Mbit: p99 late (ms)" "$(late 5)" 0 0.5
grep -q "self-timing packets 4000 " "$T/relay.log" && verdict=ok || { verdict=FAIL; fails=$((fails + 1)); }
say "self-timing, 20 Mbit: every send timed" "$verdict"

# Stopped for 100 ms with ~20 packets due inside it at a 50 ms delay: a cell the guard voids.
relay --self-timing --delay-ms 50
(sleep 0.5; kill -STOP "$RELAY_PID"; sleep 0.1; kill -CONT "$RELAY_PID") & PIDS+=("$!")
python3 "$T/probe.py" "$UDP_IN" 200 200 0.005 > /dev/null
stop_relay
want "relay stopped 100 ms: worst late (ms)" "$(late 7)" 90 140
grep -q "VOID" "$T/relay.log" && verdict=ok || { verdict=FAIL; fails=$((fails + 1)); }
say "relay stopped 100 ms: the cell is void" "$verdict"

# 200 × 1000 bytes up and 64 back: the uplink alone sets the time, 0.8 s at 2 Mbit, 0.16 at 10.
SHORT=$((UDP_OUT + 1))
python3 "$T/echo.py" "$SHORT" 64 & PIDS+=("$!")
sleep 0.3
TARGET=$SHORT relay --rate-kbit 10000 --rate-up-kbit 2000 --queue-pkts 4000
read -r _ got el _ < <(python3 "$T/probe.py" "$UDP_IN" 200 1000 0)
want "up 2 Mbit, down 10: 200 kB up (s)" "$el" 0.78 0.9
stop_relay
TARGET=$SHORT relay --rate-kbit 2000 --rate-up-kbit 10000 --queue-pkts 4000
read -r _ got el _ < <(python3 "$T/probe.py" "$UDP_IN" 200 1000 0)
want "up 10 Mbit, down 2: 200 kB up (s)" "$el" 0.15 0.25
stop_relay

relay --rate-kbit 1000 --queue-bytes 15000
read -r _ got _ < <(python3 "$T/probe.py" "$UDP_IN" 500 1000 0)
want "queue 15000 B: 1000 B survivors of 500" "$got" 15 17
stop_relay
relay --rate-kbit 1000 --queue-bytes 15000
read -r _ got _ < <(python3 "$T/probe.py" "$UDP_IN" 500 500 0)
want "queue 15000 B: 500 B survivors of 500" "$got" 30 33
stop_relay
relay --rate-kbit 1200 --queue-ms 100
read -r _ got _ < <(python3 "$T/probe.py" "$UDP_IN" 500 1000 0)
want "queue 100 ms at 1200 kbit: 1000 B survivors" "$got" 15 17
stop_relay
relay --rate-kbit 10000 --queue-bytes 15000
read -r _ got _ < <(python3 "$T/probe.py" "$UDP_IN" 200 1000 0.002)
want "queue 15000 B, a stream under the rate" "$got" 200 200
stop_relay

# 12 Mbit for 1 s, 3 for 1 s, an outage of 300 ms, 12 for 0.7 s: a mean of 7.8 Mbit.
python3 lab/scripts/gen_step_trace.py 12000:1000 3000:1000 0:300 12000:700 > "$T/steps.trace"
relay --trace "$T/steps.trace" --queue-pkts 5000
epoch=$(grep -o "epoch=[0-9.]*" "$T/relay.log" | cut -d= -f2)
read -r bins worst got total < <(python3 "$T/trace_probe.py" "$UDP_IN" "$T/steps.trace" "$epoch" 2)
want "trace at 2x its mean: worst 100 ms bin (pkts)" "$worst" 0 1
want "trace at 2x its mean: delivered over $bins bins" "$got" "$((total - bins))" "$((total + bins))"
stop_relay
python3 lab/scripts/gen_step_trace.py 1200:1000 > "$T/slow.trace"
relay --trace "$T/slow.trace" --queue-ms 100
read -r _ got _ < <(python3 "$T/probe.py" "$UDP_IN" 500 1500 0)
want "queue 100 ms at a 1200 kbit trace: survivors" "$got" 10 12
stop_relay

# Opportunities nobody used are gone: after a second idle, 100 packets still take 100 ms.
python3 lab/scripts/gen_step_trace.py 12000:1000 > "$T/flat.trace"
relay --trace "$T/flat.trace" --queue-pkts 4000
sleep 1
read -r _ got el _ < <(python3 "$T/probe.py" "$UDP_IN" 100 1500 0)
want "trace 1 per ms, idle 1 s: 100 MTU (s)" "$el" 0.098 0.115
stop_relay
relay --trace "$T/flat.trace" --queue-pkts 4000
read -r _ got el _ < <(python3 "$T/probe.py" "$UDP_IN" 300 500 0)
want "trace 1 per ms: 300 x 500 B, three a chance (s)" "$el" 0.098 0.115
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

# Two 1 MB fetches at once at 8 000 kbit/s: ~1 s each when every connection has its own rate,
# ~2 s when they cross one bottleneck — which is what an HTTP/1.1 page's six sockets share.
mkdir -p "$T/www" && head -c 1000000 /dev/urandom > "$T/www/mb.bin"
python3 -m http.server --bind 127.0.0.1 --directory "$T/www" "$((TCP_OUT + 1))" > "$T/www.log" 2>&1 & WWW_PID=$!; PIDS+=("$WWW_PID")
sleep 0.5
for mode in per-connection shared; do
  python3 "$RELAY" --tcp "$((TCP_IN + 1)):$((TCP_OUT + 1))" --delay-ms 5 --rate-kbit 8000 --tcp-rate "$mode" > "$T/tcp-$mode.log" 2>&1 &
  TCP_PID=$!; PIDS+=("$TCP_PID")
  for _ in $(seq 50); do grep -q READY "$T/tcp-$mode.log" && break; sleep 0.1; done
  start=$(date +%s.%N)
  curl -s -o "$T/a.bin" "http://127.0.0.1:$((TCP_IN + 1))/mb.bin" & A=$!
  curl -s -o "$T/b.bin" "http://127.0.0.1:$((TCP_IN + 1))/mb.bin" & B=$!
  wait "$A" "$B" || true  # a truncated stream is the byte-exact check's to report
  took=$(python3 -c "print(round($(date +%s.%N) - $start, 2))")
  if [[ $mode == shared ]]; then want "two 1 MB at 8 Mbit/s, shared (s)" "$took" 1.9 2.4
  else want "two 1 MB at 8 Mbit/s, a rate each (s)" "$took" 0.95 1.35; fi
  if cmp -s "$T/a.bin" "$T/www/mb.bin" && cmp -s "$T/b.bin" "$T/www/mb.bin"; then
    say "  both byte-exact under the rate" "ok"
  else
    say "  both byte-exact under the rate" "FAIL"
    fails=$((fails + 1))
  fi
  kill -TERM "$TCP_PID" 2>/dev/null || true
  sleep 0.3
done
kill "$WWW_PID" 2>/dev/null || true

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
# R1 counted 4; lever 2's SETTINGS in the first flight took one. docs/ARCHITECTURE.md §Lever 2
want "first byte: round trips (lever 2 counts 3)" "$rt" 2.6 3.4
read -r rt fixed < <(python3 "$T/fit.py" "$T/fit.tsv" ask_to_last_byte)
say "250 KB ask: fixed cost (ms)" "$fixed"
want "250 KB ask: flights (S7 predicts ~5)" "$rt" 4.5 6.0

echo
[[ $fails -eq 0 ]] || { echo "$fails check(s) failed"; exit 1; }
echo "link impair check OK"
