#!/usr/bin/env bash
# Does `link_impair.py --tun` tell the truth about kernel TCP? Delay through the tun, a TCP
# bulk flow's goodput under a trace against the UDP plane's, Gilbert-Elliott loss counted per packet,
# retransmissions only when the relay drops; then the relay's CPU per packet and its ceiling.
# Reads every number out loud and exits non-zero on the first one outside tolerance.
# Results: docs/rig-limits.md §3.
#
#   lab/scripts/tun_check.sh     (re-runs itself inside `unshare -rn`)
set -euo pipefail
if [[ -z ${TUN_CHECK_INSIDE:-} ]]; then
  exec unshare -rn env TUN_CHECK_INSIDE=1 "$0" "$@"
fi
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
ip link set lo up

T="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT

RELAY=${RELAY:-lab/scripts/link_impair.py}
SERVER=10.77.0.2
fails=0

say() { printf '%-50s %s\n' "$1" "$2"; }
want() {  # label measured low high
  local verdict="ok"
  if ! python3 -c "import sys; sys.exit(0 if $3 <= $2 <= $4 else 1)"; then
    verdict="FAIL (want $3..$4)"
    fails=$((fails + 1))
  fi
  say "$1" "$2  $verdict"
}

cat > "$T/echo.py" <<'PY'
"""Echoes each datagram; with `sink`, counts them instead and prints the count after 1 s of quiet."""
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 32 << 20)
s.bind(("0.0.0.0", int(sys.argv[1])))
sink = sys.argv[2:] == ["sink"]
got = 0
while True:
    if got and sink:
        s.settimeout(1)
    try:
        d, a = s.recvfrom(65535)
    except socket.timeout:
        sys.exit(print(got))
    got += 1
    if not sink:
        s.sendto(d, a)
PY

cat > "$T/rtt.py" <<'PY'
"""Median round trip of `count` 100-byte datagrams to an echo, 10 ms apart, in ms."""
import socket, statistics, sys, time
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.settimeout(2)
rtt = []
for _ in range(int(sys.argv[3])):
    t = time.monotonic()
    s.sendto(b"x" * 100, (sys.argv[1], int(sys.argv[2])))
    s.recvfrom(65535)
    rtt.append((time.monotonic() - t) * 1000)
    time.sleep(0.01)
print("%.2f" % statistics.median(rtt))
PY

cat > "$T/blast.py" <<'PY'
"""Sends `count` datagrams of `size` bytes to host:port at `pps` a second, open loop."""
import socket, sys, time
host, port, count, size, pps = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5])
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
start = time.monotonic()
for i in range(count):
    wait = start + i / pps - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    s.sendto(b"x" * size, (host, port))
PY

cat > "$T/udp_goodput.py" <<'PY'
"""Sends 1500-byte datagrams at `kbit` to an echo for `seconds` and prints the kbit/s that came
back between `t0` and `t1` seconds after the relay's `epoch`."""
import socket, sys, threading, time
port, kbit, seconds, epoch, t0, t1 = int(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6])
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 32 << 20)
s.settimeout(0.5)
interval = 1500 * 8 / (kbit * 1000)


def send():
    start = time.monotonic()
    for i in range(int(seconds / interval)):
        wait = start + i * interval - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        s.sendto(b"x" * 1500, ("127.0.0.1", port))


sender = threading.Thread(target=send)
sender.start()
got = 0
while True:
    try:
        d, _ = s.recvfrom(65535)
    except socket.timeout:
        if not sender.is_alive():
            break
        continue
    if t0 <= time.monotonic() - epoch < t1:
        got += len(d)
print("%.0f" % (got * 8 / (t1 - t0) / 1000))
PY

cat > "$T/tcp_send.py" <<'PY'
"""A TCP server that sends to its first client for `seconds`, then closes."""
import socket, sys, time
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("0.0.0.0", int(sys.argv[1])))
s.listen()
c, _ = s.accept()
end, block = time.monotonic() + float(sys.argv[2]), b"x" * 65536
while time.monotonic() < end:
    c.sendall(block)
c.close()
PY

cat > "$T/tcp_recv.py" <<'PY'
"""Reads a TCP stream from host:port to its end and prints the goodput in kbit/s between `t0` and
`t1` seconds after `epoch` (0: after the connect), and the bytes received."""
import socket, sys, time
host, port, epoch, t0, t1 = sys.argv[1], int(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
c = socket.create_connection((host, port))
epoch = epoch or time.monotonic()
got = total = 0
while True:
    d = c.recv(1 << 16)
    if not d:
        break
    total += len(d)
    if t0 <= time.monotonic() - epoch < t1:
        got += len(d)
print("%.0f %d" % (got * 8 / (t1 - t0) / 1000, total))
PY

relay() {  # extra args...
  python3 "$RELAY" "$@" > "$T/relay.log" 2>&1 &
  RELAY_PID=$!
  PIDS+=("$RELAY_PID")
  for _ in $(seq 50); do grep -q READY "$T/relay.log" && break; sleep 0.1; done
  grep -q READY "$T/relay.log" || { echo "relay did not start: $(cat "$T/relay.log")" >&2; exit 1; }
  NS=$(grep -o 'server_netns=[^ ]*' "$T/relay.log" | cut -d= -f2 || true)
  EPOCH=$(grep -o 'epoch=[0-9.]*' "$T/relay.log" | cut -d= -f2 || true)
}
stop_relay() { kill -TERM "$RELAY_PID" 2>/dev/null || true; wait "$RELAY_PID" 2>/dev/null || true; }
inside() { nsenter --net="$NS" "$@"; }
retrans() { inside awk '/^Tcp:/ && ++n == 2 {print $13}' /proc/net/snmp; }
tally() {  # direction field: the relay's count, e.g. `tally server->client 5` is what it lost that way
  grep -o "$1 sent [0-9]* lost [0-9]* overflowed [0-9]*" "$T/relay.log" | awk "{print \$$2}"
}
unread() { grep -o "unread [0-9-]* [0-9-]*" "$T/relay.log" | awk '{print $2 + $3}'; }
cpu_ticks() { awk '{print $14 + $15}' "/proc/$1/stat"; }

# A TCP bulk flow from the server's namespace, `seconds` long; prints goodput kbit/s and bytes.
bulk() {  # seconds t0 t1 [epoch]
  nsenter --net="$NS" python3 "$T/tcp_send.py" 9000 "$1" & PIDS+=("$!")
  sleep 0.3
  python3 "$T/tcp_recv.py" "$SERVER" 9000 "${4:-0}" "$2" "$3"
}

echo "== the tun plane's arithmetic"

relay --tun
nsenter --net="$NS" python3 "$T/echo.py" 9100 & PIDS+=("$!")
sleep 0.3
want "floor: rtt at delay 0 (ms)" "$(python3 "$T/rtt.py" "$SERVER" 9100 40)" 0 2
stop_relay

relay --tun --delay-ms 20
nsenter --net="$NS" python3 "$T/echo.py" 9100 & PIDS+=("$!")
sleep 0.3
want "one-way 20 ms: rtt (ms)" "$(python3 "$T/rtt.py" "$SERVER" 9100 30)" 40 43
stop_relay

# 12 Mbit for 1 s, 3 for 1 s: a 7.5 Mbit mean. Goodput over 4 whole periods from 2 s after the
# relay's start, so slow start is out of it. A UDP datagram's 1 500 B is payload and a TCP segment's
# IP packet, so TCP carries 1 448 / 1 500 of the bytes the UDP plane does.
python3 lab/scripts/gen_step_trace.py 12000:1000 3000:1000 > "$T/steps.trace"
python3 "$T/echo.py" 9200 & PIDS+=("$!")
sleep 0.3
relay --udp 9201:9200 --trace "$T/steps.trace" --delay-ms 20 --queue-pkts 100
udp_kbit=$(python3 "$T/udp_goodput.py" 9201 16000 10.5 "$EPOCH" 2 10)
stop_relay
relay --tun --trace "$T/steps.trace" --delay-ms 20 --queue-pkts 100
read -r tcp_kbit _ < <(bulk 10.5 2 10 "$EPOCH")
stop_relay
say "step trace, udp plane: goodput (kbit/s)" "$udp_kbit"
want "step trace, tcp through the tun: over udp" "$(python3 -c "print('%.3f' % ($tcp_kbit / $udp_kbit))")" 0.95 1.05

# Mean 2 %, bursts of 3.5: a sink in the server's namespace counts what arrived, the relay what it
# dropped, and the two must add to what was sent.
relay --tun --loss-model ge --ge-p 0.5831 --ge-r 28.57 --queue-pkts 0
nsenter --net="$NS" python3 "$T/echo.py" 9300 sink > "$T/sink.out" & SINK=$!; PIDS+=("$SINK")
sleep 0.3
python3 "$T/blast.py" "$SERVER" 9300 150000 200 20000
wait "$SINK"
stop_relay
arrived=$(cat "$T/sink.out")
lost=$(tally client-\>server 5)
want "ge 2 %: lost of 150 000, over the mean" "$(python3 -c "print('%.3f' % ($lost / 150000 / 0.02))")" 0.85 1.15
want "ge 2 %: arrived + the relay's count" "$((arrived + lost))" 150000 150000

# Nothing dropped, nothing retransmitted; then iid 1 %, and the kernel retransmits.
relay --tun --delay-ms 10 --rate-kbit 20000 --queue-pkts 1000
before=$(retrans)
read -r kbit _ < <(bulk 4 0 4)
after=$(retrans)
stop_relay
dropped=$(( $(tally server-\>client 5) + $(tally server-\>client 7) + $(tally client-\>server 5) + $(tally client-\>server 7) ))
want "no loss: segments the relay dropped" "$dropped" 0 0
want "no loss: segments the tun's queue dropped" "$(unread)" 0 0
want "no loss: segments the kernel retransmitted" "$((after - before))" 0 0

# No rate: the sender outruns the loop, the tun's own queue drops, and the tally must say so.
relay --tun --delay-ms 10 --queue-pkts 0
before=$(retrans)
read -r kbit _ < <(bulk 4 0 4)
after=$(retrans)
stop_relay
say "no rate: goodput (kbit/s), retransmitted" "$kbit, $((after - before))"
want "no rate: the tun's queue dropped, if any retransmitted" \
  "$(python3 -c "print(int($((after - before)) == 0 or $(unread) > 0))")" 1 1

relay --tun --delay-ms 10 --rate-kbit 20000 --queue-pkts 1000 --loss 1
before=$(retrans)
bulk 4 0 4 > /dev/null
after=$(retrans)
stop_relay
data_lost=$(tally server-\>client 5)
say "iid 1 %: data segments the relay dropped" "$data_lost"
want "iid 1 %: retransmitted over dropped" "$(python3 -c "print('%.2f' % (($after - $before) / max(1, $data_lost)))")" 0.9 2

echo
echo "== the relay's own cost"
# One TCP flow at each rate, 40 ms of round trip, a queue that never drops: CPU per packet relayed
# and the guard's p99. Where it reads VOID is this host's ceiling.
for rate in 20000 50000 100000 200000; do
  relay --tun --delay-ms 20 --rate-kbit "$rate" --queue-pkts 4000 --self-timing
  t0=$(cpu_ticks "$RELAY_PID")
  read -r kbit _ < <(bulk 5 1 5)
  t1=$(cpu_ticks "$RELAY_PID")
  stop_relay
  pkts=$(( $(tally client-\>server 3) + $(tally server-\>client 3) ))
  us=$(python3 -c "print('%.1f' % (($t1 - $t0) * 1e6 / $(getconf CLK_TCK) / max(1, $pkts)))")
  say "$((rate / 1000)) Mbit: goodput, µs a packet, guard" \
    "$kbit kbit/s, $us µs, $(grep -o 'late p50.*' "$T/relay.log")"
done

echo
[[ $fails -eq 0 ]] || { echo "$fails check(s) failed"; exit 1; }
echo "tun check OK"
