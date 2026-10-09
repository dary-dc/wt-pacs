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
"""Echoes each datagram, or only its first `reply` bytes (at least the probe's 12-byte header),
after `hold` seconds."""
import socket, sys, time
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 8 << 20)
s.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 8 << 20)
s.bind(("127.0.0.1", int(sys.argv[1])))
reply = max(12, int(sys.argv[2])) if len(sys.argv) > 2 else None
hold = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
while True:
    d, a = s.recvfrom(65535)
    time.sleep(hold)
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

cat > "$T/codel_sim.py" <<'PY'
"""Offers 1000 B datagrams open loop at 1.5x a 1 Mbit CoDel link for 12 s on a virtual clock,
through the relay's own Pipe. Prints the worst |gap - interval/sqrt(count)| over the first ten
drops in ms, the drops a second after 4 s against the excess, and the median sojourn after 4 s."""
import argparse, random, statistics, sys
sys.path.insert(0, sys.argv[1])
from link_impair import CoDel, Link, Pipe
args = argparse.Namespace(delay_ms=0, jitter_ms=0, jitter_mode="reorder", queue_pkts=10000,
                          queue_bytes=0, queue_ms=0, loss=0, loss_model="iid", ge_p=0, ge_r=0)
rate, size, interval = 1e6, 1000, 0.1
link = Link(rate, codel=CoDel(0.005, interval))
pipe = Pipe(args, random.Random(1), link)
drops, sojourns = [], []
law = link.codel.drop


def drop(now, sojourn, backlog):
    dropped = law(now, sojourn, backlog)
    (drops.append((now, link.codel.count)) if dropped else sojourns.append((now, sojourn)))
    return dropped


link.codel.drop = drop
gap = size * 8 / rate / 1.5
for i in range(int(12 / gap)):
    pipe.offer(i * gap, b"x" * size, False)
first = drops[:11]
worst = max((abs((b[0] - a[0]) - interval / a[1] ** 0.5) for a, b in zip(first, first[1:])),
            default=1)
late = [d for d, _ in drops if d >= 4]
print("%.2f %.1f %.1f %.1f" % (worst * 1000, len(late) / 8, rate / size / 8 * 0.5,
                               1000 * statistics.median(s for t, s in sojourns if t >= 4)))
PY

cat > "$T/fq_sim.py" <<'PY'
"""fq_codel on a 1 Mbit link, open loop on a virtual clock, through the relay's own Pipe and Link.
`split`: 1500 B at 1.2 Mbit against 300 B at 0.6 Mbit: the first one's share of the bytes, fq then
FIFO. `sparse`: 100 B every 200 ms beside four 1500 B flows at 0.5 Mbit, a 10-packet limit: the
sparse flow's sojourn p99 in ms and its packets lost, fq then FIFO. `codel`: two 500 B flows at
0.75 Mbit: the worst |gap - interval/sqrt(count)| over each flow's first ten drops in ms, and the
drops a second per flow after 4 s against each one's excess."""
import argparse, random, sys
sys.path.insert(0, sys.argv[1])
import link_impair as li

RATE, SECONDS = 1e6, 12.0


def run(flows, limit, fq):
    """flows: name -> (size, offered bps, start). Returns the link and a pipe per flow."""
    args = argparse.Namespace(delay_ms=0, jitter_ms=0, jitter_mode="reorder", queue_pkts=limit,
                              queue_bytes=0, queue_ms=0, loss=0, loss_model="iid", ge_p=0, ge_r=0)
    link = li.Link(RATE, fq=li.FqCodel(0.005, 0.1)) if fq else li.Link(RATE, codel=li.CoDel(0.005, 0.1))
    pipes = {name: li.Pipe(args, random.Random(1), link) for name in flows}
    offers = sorted((start + i * size * 8 / bps, name)
                    for name, (size, bps, start) in flows.items()
                    for i in range(int((SECONDS - start) * bps / size / 8)))
    for t, name in offers:
        pipes[name].offer(t, b"x" * flows[name][0], False, flow=name)
    link.serve(SECONDS)
    return link, pipes


def share(fq):
    link, _ = run({"a": (1500, 1.2e6, 0), "b": (300, 0.6e6, 0.0001)}, 1000, fq)
    return link.flows["a"][1] / (link.flows["a"][1] + link.flows["b"][1])


def sparse(fq):
    flows = {"bulk%d" % i: (1500, 0.5e6, i * 0.001) for i in range(4)}
    flows["sparse"] = (100, 100 * 8 / 0.2, 1.0123)
    link, pipes = run(flows, 10, fq)
    n, _, bins = link.flows["sparse"]
    p = pipes["sparse"]
    return li.quantile_ms(bins, n, 0.99), p.overflowed + p.managed


def codel():
    drops = {}
    law = li.CoDel.drop

    def drop(self, now, sojourn, backlog):
        dropped = law(self, now, sojourn, backlog)
        if dropped:
            drops.setdefault(id(self), []).append((now, self.count))
        return dropped

    li.CoDel.drop = drop
    link, _ = run({"a": (500, 0.75e6, 0), "b": (500, 0.75e6, 0.002)}, 10000, True)
    li.CoDel.drop = law
    worst, rates = 0.0, []
    for f in link.fq.flows.values():
        d = drops.get(id(f.codel), [])
        first = d[:11]
        worst = max([worst] + [abs((b[0] - a[0]) - 0.1 / a[1] ** 0.5) for a, b in zip(first, first[1:])]
                    if len(first) == 11 else [1.0])
        rates.append(sum(1 for t, _ in d if t >= 4) / (SECONDS - 4))
    return worst * 1000, min(rates), max(rates), (0.75e6 - RATE / 2) / 500 / 8


what = sys.argv[2]
if what == "split":
    print("%.3f %.3f" % (share(True), share(False)))
elif what == "sparse":
    print("%.2f %d %.2f %d" % (*sparse(True), *sparse(False)))
else:
    print("%.2f %.1f %.1f %.1f" % codel())
PY

cat > "$T/held.py" <<'PY'
"""Holds the link `ms` through the control port and sends five datagrams into the hold at once.
Prints the worst RTT: the hold, the round trip, and however late the relay woke for the queue."""
import socket, sys, time
port, ctrl, ms = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.settimeout(3)
s.sendto(b"blackout " + ms.encode(), ("127.0.0.1", ctrl))
time.sleep(0.01)
start = time.monotonic()
for _ in range(5):
    s.sendto(b"x" * 100, ("127.0.0.1", port))
for _ in range(5):
    s.recvfrom(65535)
print("%.1f" % ((time.monotonic() - start) * 1000))
PY

cat > "$T/ge_sim.py" <<'PY'
"""Draws a million packets through the relay's own Gilbert-Elliott pipe at p and r (percent).
Prints the loss rate and the mean burst length, each over what p / (p + r) and 1 / r predict."""
import argparse, random, sys
sys.path.insert(0, sys.argv[1])
from link_impair import Link, Pipe
p, r = float(sys.argv[2]), float(sys.argv[3])
args = argparse.Namespace(delay_ms=0, jitter_ms=0, jitter_mode="reorder", queue_pkts=0,
                          queue_bytes=0, queue_ms=0, loss=0, loss_model="ge", ge_p=p, ge_r=r)
pipe = Pipe(args, random.Random(1), Link())
draws = [pipe._drop() for _ in range(1000000)]
bursts = sum(1 for a, b in zip([False] + draws, draws) if b and not a)
print("%.3f %.3f" % (sum(draws) / len(draws) / (p / (p + r)), sum(draws) / bursts * r / 100))
PY

cat > "$T/two_ports.py" <<'PY'
"""Two client ports through one pair, sends interleaved, each datagram tagged with its port's
letter. Prints the replies each port got that were its own, and those that were the other's."""
import socket, sys, time
port, count = int(sys.argv[1]), int(sys.argv[2])
socks = {}
for tag in (b"a", b"b"):
    socks[tag] = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    socks[tag].settimeout(0.05)
for i in range(count):
    for tag, s in socks.items():
        s.sendto(tag + b"x" * 99, ("127.0.0.1", port))
    time.sleep(0.005)
own, foreign = {b"a": 0, b"b": 0}, 0
deadline = time.monotonic() + 2
while time.monotonic() < deadline:
    for tag, s in socks.items():
        try:
            d, _ = s.recvfrom(65535)
        except socket.timeout:
            continue
        if d[:1] == tag:
            own[tag] += 1
        else:
            foreign += 1
print(own[b"a"], own[b"b"], foreign)
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

# The model itself, off the wire: a blast through the echo below also counts the host's drops.
for pr in 0.07:14 0.0286:28.57 0.2886:28.57; do
  read -r rate burst < <(python3 "$T/ge_sim.py" lab/scripts "${pr%%:*}" "${pr##*:}")
  want "gilbert-elliott $pr: loss over p/(p+r)" "$rate" 0.85 1.15
  want "gilbert-elliott $pr: burst over 1/r" "$burst" 0.85 1.15
done
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

# One radio: quiet for longer than S, the next packet either way waits P for both directions.
relay --delay-ms 20 --idle-promote 5:300
sleep 6
read -r rtt _ < <(python3 "$T/probe.py" "$UDP_IN" 1 100 0)
want "idle 6 s, promotion 5:300: rtt (ms)" "$rtt" 340 346
sleep 4
read -r rtt _ < <(python3 "$T/probe.py" "$UDP_IN" 1 100 0)
want "then idle 4 s: rtt (ms)" "$rtt" 40 46
stop_relay
grep -q "promoted 1$" "$T/relay.log" && verdict=ok || { verdict=FAIL; fails=$((fails + 1)); }
say "idle 6 s then 4 s: promotions" "$verdict"

# An echo that answers 1.5 s late, so its reply is the packet that ends the quiet, at 1.52 s: the
# first rtt is 1840 ms. The second probe leaves at 1.6, inside that promotion, and waits it out to
# 1.82 before its own 1.5 s and a promotion again: 2060 ms, where a radio that held only the
# server's direction reads 1840.
SLOW=$((UDP_OUT + 2))
python3 "$T/echo.py" "$SLOW" 0 1.5 & PIDS+=("$!")
sleep 0.3
TARGET=$SLOW relay --delay-ms 20 --idle-promote 1:300
read -r _ got _ _ _ worst < <(python3 "$T/probe.py" "$UDP_IN" 2 100 1.6)
want "server ends the quiet: delivered of 2" "$got" 2 2
want "a client packet inside it waits: worst rtt (ms)" "$worst" 2055 2075
stop_relay

# Two client ports through one pair are two flows, as a session and its replacement are: each
# gets its own replies, none of the other's.
relay --delay-ms 10
read -r own_a own_b foreign < <(python3 "$T/two_ports.py" "$UDP_IN" 100)
want "two client ports, one pair: own replies, first" "$own_a" 100 100
want "  own replies, second" "$own_b" 100 100
want "  the other's replies" "$foreign" 0 0
stop_relay

# A neighbour: two pairs, one link. 250 kB each way through each at 4 Mbit takes 1 s, not 0.5.
NEIGHBOUR=$((UDP_OUT + 3))
python3 "$T/echo.py" "$NEIGHBOUR" & PIDS+=("$!")
sleep 0.3
relay --udp "$((UDP_IN + 1)):$NEIGHBOUR" --rate-kbit 4000 --queue-pkts 4000
python3 "$T/probe.py" "$((UDP_IN + 1))" 250 1000 0 > "$T/neighbour.out" & NPROBE=$!
read -r _ got el _ < <(python3 "$T/probe.py" "$UDP_IN" 250 1000 0)
wait "$NPROBE"
read -r _ ngot nel _ < "$T/neighbour.out"
want "two pairs at 4 Mbit: 250 kB through the first (s)" "$el" 0.95 1.15
want "  and through the neighbour (s)" "$nel" 0.95 1.15
want "  delivered of 500" "$((got + ngot))" 500 500
stop_relay
# One queue too: two bursts of 100 into a 10-packet queue leave about 10 between them, not 20.
relay --udp "$((UDP_IN + 1)):$NEIGHBOUR" --rate-kbit 1000 --queue-pkts 10
python3 "$T/probe.py" "$((UDP_IN + 1))" 100 1000 0 > "$T/neighbour.out" & NPROBE=$!
read -r _ got _ < <(python3 "$T/probe.py" "$UDP_IN" 100 1000 0)
wait "$NPROBE"
read -r _ ngot _ < "$T/neighbour.out"
want "two bursts of 100, one queue of 10: survivors" "$((got + ngot))" 10 13
stop_relay

# CoDel against 1.5x overload that never backs off: while dequeues are back to back (8 ms at
# 1 Mbit), the drops follow interval/sqrt(count) and settle at the excess, the sojourn well above
# target: RFC 8289's 5 ms is reached against a flow that answers a drop, below.
read -r worst rate excess sojourn < <(python3 "$T/codel_sim.py" lab/scripts)
want "codel: first ten drop gaps vs law (ms off)" "$worst" 0 8
want "codel: drops a second, 4-12 s (excess $excess)" "$rate" 56 69
want "codel: sojourn held against no back-off (ms)" "$sojourn" 25 60

# fq_codel: bytes split evenly whatever the packet size, a sparse flow passes a bulk queue and
# loses nothing to an overflow, and each queue's CoDel keeps its own law. A DRR turn of the other
# flow (four 500 B packets, 16 ms) is how late a queue's drop can fall against it.
read -r share fifo < <(python3 "$T/fq_sim.py" lab/scripts split)
want "fq_codel: 1500 B at 1.2 Mbit vs 300 B at 0.6: share" "$share" 0.475 0.525
say "  the same through one FIFO" "$fifo"
read -r p99 lost fifo_p99 fifo_lost < <(python3 "$T/fq_sim.py" lab/scripts sparse)
want "fq_codel: sparse beside four bulk, p99 (ms)" "$p99" 0 12
want "fq_codel: sparse lost at a 10-packet limit" "$lost" 0 0
say "  the same through one FIFO: p99 ms, lost" "$fifo_p99 $fifo_lost"
read -r worst lo hi excess < <(python3 "$T/fq_sim.py" lab/scripts codel)
want "fq_codel: each queue's first ten gaps vs law (ms off)" "$worst" 0 16
want "fq_codel: drops a second, fewest queue (excess $excess)" "$lo" 56 69
want "fq_codel: drops a second, most queue" "$hi" 56 69

# Live: a sparse probe beside a 2x open-loop blast on its own pair, and a hold with nothing else
# due, which only the queue's own next dequeue wakes the relay for.
relay --udp "$((UDP_IN + 1)):$UDP_OUT" --rate-kbit 1000 --rate-up-kbit 0 --delay-ms 20   --queue-pkts 200 --fq-codel
python3 "$T/probe.py" "$UDP_IN" 1500 1000 0.004 > /dev/null & BULK=$!
sleep 1
read -r rtt got _ < <(python3 "$T/probe.py" "$((UDP_IN + 1))" 100 100 0.03)
wait "$BULK"
want "fq_codel: sparse probe beside the blast, rtt (ms)" "$rtt" 40 50
want "fq_codel: sparse probe delivered of 100" "$got" 100 100
stop_relay
relay --rate-kbit 1000 --rate-up-kbit 0 --delay-ms 20 --blackout-mode hold --control-port "$CTRL" --fq-codel
want "fq_codel: five into a 275 ms hold, worst rtt (ms)" "$(python3 "$T/held.py" "$UDP_IN" "$CTRL" 275)" 308 313
stop_relay

echo
echo "== the static host's plane"
python3 server/dev-server.py --port "$TCP_OUT" > "$T/static.log" 2>&1 & PIDS+=("$!")
for _ in $(seq 50); do curl -sf "http://127.0.0.1:$TCP_OUT/client/README.md" >/dev/null && break; sleep 0.1; done
python3 "$RELAY" --tcp "$TCP_IN:$TCP_OUT" --delay-ms 40 > "$T/tcp.log" 2>&1 & TCP_PID=$!; PIDS+=("$TCP_PID")
for _ in $(seq 50); do grep -q READY "$T/tcp.log" && break; sleep 0.1; done
curl -s "http://127.0.0.1:$TCP_IN/client/README.md" > "$T/got.md"
if cmp -s "$T/got.md" client/README.md; then
  say "a relayed fetch is byte-exact" "ok"
else
  say "a relayed fetch is byte-exact" "FAIL"
  fails=$((fails + 1))
fi
tot=$(curl -s -o /dev/null -w '%{time_total}' "http://127.0.0.1:$TCP_IN/client/README.md")
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

# A Cubic fill and a probe on one 5 Mbit link: the probe's extra round trip is the standing queue.
standing() {  # extra relay args...: prints the probe's median rtt over 56 ms
  TARGET=$UDP_OUT relay --udp "$((UDP_IN + 1)):$NEIGHBOUR" --delay-ms 28 --rate-kbit 5000 \
    --rate-up-kbit 0 --queue-pkts 200 "$@"
  timeout 60 "$BIN/window-harness" --url "https://127.0.0.1:$UDP_IN/" --mode saturate \
    --fill-dwell-ms 10000 --frame-count 10 --depth 8 --read-bps 0 --stream-mode shared \
    > /dev/null 2>&1 & FILL=$!
  sleep 3
  read -r rtt _ < <(python3 "$T/probe.py" "$((UDP_IN + 1))" 300 100 0.02)
  wait "$FILL" || true
  stop_relay
  python3 -c "print('%.1f' % ($rtt - 56))"
}
want "cubic fill, 200-packet tail drop: queue (ms)" "$(standing)" 100 600
want "cubic fill, codel 5:100: queue (ms)" "$(standing --codel 5:100)" 2 10

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
# R1 counted 4; the early SETTINGS took one. docs/ARCHITECTURE.md §Early SETTINGS
want "first byte: round trips (early SETTINGS count 3)" "$rt" 2.6 3.4
read -r rt fixed < <(python3 "$T/fit.py" "$T/fit.tsv" ask_to_last_byte)
say "250 KB ask: fixed cost (ms)" "$fixed"
want "250 KB ask: flights (S7 predicts ~5)" "$rt" 4.5 6.0

echo
[[ $fails -eq 0 ]] || { echo "$fails check(s) failed"; exit 1; }
echo "link impair check OK"
