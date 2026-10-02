#!/usr/bin/env python3
"""One impaired link for both planes, in a container without root: a userspace relay in front of
the UDP session and in front of the static host's TCP. Delay, rate, queue depth, jitter with or
without reordering, scattered and bursty loss, a blackout that drops or holds, a rebind — one model, both planes.
A delivery-opportunity trace can replace the to-client rate, the queue can be limited in bytes, and
CoDel can manage the UDP plane's queue. The UDP
plane can idle like a radio: after a quiet spell, the next packet waits for the promotion. A second
--udp is a neighbour: every UDP pair crosses one queue and one clock each way, as one phone's apps do.
Each client port on a pair gets its own upstream port, so two sessions open at once are two flows.
--tun moves the link down to IP packets, so kernel TCP and QUIC meet the same loss on one queue.

What it cannot do, and the limits it was calibrated against, are in `docs/rig-limits.md` §3.

usage: link_impair.py {--udp 5555:4433 [--udp 5557:4435 ...] [--tcp 8443:8000] | --tun} [--delay-ms 40]
                      [--rate-kbit 10000] [--rate-up-kbit 2000] [--trace FILE] [--queue-pkts 50 | --queue-bytes N |
                      --queue-ms N] [--codel 5:100] [--loss 0.5 | --loss-model ge] [--idle-promote 5:300]
                      [--self-timing]
                      [--control-port 5556]

--delay-ms is ONE WAY and applies to each direction, so a round trip reads twice it, matching
`cloud_netem.sh`'s profiles. Control datagrams on --control-port: `rebind`, `cut`, `blackout <ms>`,
`swallow <ms>` (drops server->client for <ms> from the next server datagram: its next flight), `stats`,
`quit`; `cut`, `rebind` and `swallow` act on the first --udp. Prints READY, then REBOUND <old> -> <new>,
then a tally at exit.
"""
import argparse
import bisect
import collections
import fcntl
import hashlib
import json
import heapq
import os
import random
import selectors
import signal
import socket
import struct
import subprocess
import sys
import time

MTU = 1500
TICK = 0.0005
IDLE = 0.05


class Trace:
    """A mahimahi trace: one millisecond timestamp per MTU-sized delivery opportunity, looped at
    its last timestamp, counted from `epoch`."""

    def __init__(self, path, epoch):
        with open(path, "rb") as f:
            raw = f.read()
        self.ms = [int(x) for x in raw.split()]
        if not self.ms or self.ms[-1] <= 0 or self.ms != sorted(self.ms):
            raise SystemExit("%s: want non-decreasing millisecond timestamps ending above 0" % path)
        self.period = self.ms[-1]
        self.epoch = epoch
        self.sha256 = hashlib.sha256(raw).hexdigest()
        self.mean_bps = len(self.ms) * MTU * 8 * 1000.0 / self.period

    def time(self, k):
        loop, i = divmod(k, len(self.ms))
        return self.epoch + (loop * self.period + self.ms[i]) / 1000.0

    def first_at_or_after(self, t):
        loop, rem = divmod((t - self.epoch) * 1000.0, self.period)
        if rem == 0 and loop > 0:  # a timestamp equal to the period belongs to the loop before
            loop, rem = loop - 1, self.period
        return int(loop) * len(self.ms) + bisect.bisect_left(self.ms, rem)


class Link:
    """A bottleneck's clock and queue: a pipe's own, or one every TCP connection crosses. The clock
    is a rate, or a trace whose unused opportunities are gone once passed."""

    def __init__(self, rate_bps=0.0, trace=None, codel=None):
        self.rate = rate_bps
        self.trace = trace
        self.codel = codel
        self.next_free = 0.0
        self.opportunity, self.left = -1, 0
        self.tx = collections.deque()  # (departure, bytes) of each packet not yet off the link
        self.queued = 0

    def mean_bps(self):
        return self.trace.mean_bps if self.trace else self.rate

    def depart(self, now, size):
        start = max(now, self.next_free)
        if not self.trace:
            self.next_free = start + (size * 8 / self.rate if self.rate else 0.0)
            return self.next_free
        if self.left == 0:
            self.opportunity, self.left = self.opportunity + 1, MTU
        if self.trace.time(self.opportunity) < start:
            self.opportunity, self.left = self.trace.first_at_or_after(start), MTU
        while size > self.left:
            size -= self.left
            self.opportunity, self.left = self.opportunity + 1, MTU
        self.left -= size
        self.next_free = self.trace.time(self.opportunity)
        return self.next_free


class CoDel:
    """RFC 8289's dequeue, run when a packet is offered: in one FIFO its dequeue time is known
    then, and packets reach it in order. The bytes behind it at dequeue are not, so the
    one-packet guard reads the bytes ahead of it instead."""

    def __init__(self, target, interval):
        self.target, self.interval = target, interval
        self.first_above = 0.0
        self.dropping = False
        self.count = self.last_count = 0
        self.drop_next = 0.0

    def _ok_to_drop(self, now, sojourn, backlog):
        if sojourn < self.target or backlog <= MTU:
            self.first_above = 0.0
            return False
        if self.first_above == 0.0:
            self.first_above = now + self.interval
            return False
        return now >= self.first_above

    def _control_law(self, t):
        return t + self.interval / self.count ** 0.5

    def drop(self, now, sojourn, backlog):
        """`now` is the packet's dequeue time, `sojourn` its wait to reach it."""
        ok = self._ok_to_drop(now, sojourn, backlog)
        if self.dropping:
            if not ok:
                self.dropping = False
            elif now >= self.drop_next:
                self.count += 1
                self.drop_next = self._control_law(self.drop_next)
                return True
            return False
        if not ok:
            return False
        self.dropping = True
        delta = self.count - self.last_count
        self.count = delta if delta > 1 and now - self.drop_next < 16 * self.interval else 1
        self.drop_next = self._control_law(now)
        self.last_count = self.count
        return True


class Lateness:
    """How late each packet left against its due time: a preempted relay reads as link jitter."""

    VOID_MS = 1.0

    def __init__(self, on):
        self.on = on
        self.bins = collections.Counter()  # 10 µs each
        self.n = 0
        self.worst = 0.0

    def sent(self, due):
        if self.on:
            late = time.monotonic() - due
            self.bins[int(late * 1e5)] += 1
            self.n += 1
            self.worst = max(self.worst, late)

    def quantile_ms(self, q):
        seen = 0
        for b in sorted(self.bins):
            seen += self.bins[b]
            if seen >= q * self.n:
                return (b + 1) / 100.0
        return 0.0

    def tally(self):
        p99 = self.quantile_ms(0.99)
        return "self-timing packets %d late p50 %.2f p99 %.2f max %.2f ms%s" % (
            self.n, self.quantile_ms(0.5), p99, self.worst * 1000,
            " VOID: p99 over %g ms" % self.VOID_MS if p99 > self.VOID_MS else "")


class Pipe:
    """One direction: loss, then a finite queue drained by the link's clock, then the one-way delay."""

    def __init__(self, args, rng, link, lossy=True):
        self.delay = args.delay_ms / 1000.0
        self.jitter = args.jitter_ms / 1000.0
        self.ordered = args.jitter_mode == "ordered"
        self.last_due = 0.0
        self.limit = args.queue_pkts
        self.limit_bytes = args.queue_bytes or args.queue_ms / 1000.0 * link.mean_bps() / 8
        self.loss = args.loss / 100.0
        self.ge = (args.ge_p / 100.0, args.ge_r / 100.0) if args.loss_model == "ge" else None
        self.lossy = lossy
        self.rng = rng
        self.bad = False
        self.link = link
        # Data may not leave before this: a new connection's setup round trip on a shared link.
        self.hold = 0.0
        self.pending = []
        self.seq = 0
        self.sent = self.lost = self.overflowed = self.managed = 0

    def _drop(self):
        if self.ge:
            p, r = self.ge
            self.bad = self.rng.random() >= r if self.bad else self.rng.random() < p
            return self.bad
        return self.loss > 0 and self.rng.random() < self.loss

    def offer(self, now, payload, blacked_out, to=None):
        if self.lossy and (blacked_out or self._drop()):
            self.lost += 1
            return
        link = self.link
        while link.tx and link.tx[0][0] <= now:
            link.queued -= link.tx.popleft()[1]
        size = len(payload)
        if (self.limit and len(link.tx) >= self.limit
                or self.limit_bytes and link.queued + size > self.limit_bytes):
            self.overflowed += 1
            return
        dequeue = max(now, link.next_free)
        if self.lossy and link.codel and link.codel.drop(dequeue, dequeue - now, link.queued):
            self.managed += 1
            return
        departure = link.depart(now, size)
        link.tx.append((departure, size))
        link.queued += size
        # --jitter-mode picks which path the wobble models. docs/rig-limits.md §3.
        wobble = self.rng.uniform(-self.jitter, self.jitter) if self.jitter else 0.0
        due = max(departure, self.hold) + max(0.0, self.delay + wobble)
        if self.ordered:
            due = max(due, self.last_due)
            self.last_due = due
        heapq.heappush(self.pending, (due, self.seq, payload, to))
        self.seq += 1

    def due(self):
        return self.pending[0][0] if self.pending else None

    def ready(self, now):
        out = []
        while self.pending and self.pending[0][0] <= now:
            due, _, payload, to = heapq.heappop(self.pending)
            out.append((due, payload, to))
        self.sent += len(out)
        return out


def udp_socket(port, host="127.0.0.1"):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    for opt in (socket.SO_RCVBUF, socket.SO_SNDBUF):
        s.setsockopt(socket.SOL_SOCKET, opt, 8 << 20)
    s.bind((host, port))
    s.setblocking(False)
    return s


def stall(pipes, now, seconds):
    for pipe in pipes:
        pipe.link.next_free = max(pipe.link.next_free, now) + seconds


class UdpPlane:
    """Each client port gets its own upstream port, as a NAT gives it, so two sessions open at once
    are two flows to the server; both cross the one queue and rate clock each way."""

    def __init__(self, sel, listen_port, server_port, args, rng, links, lateness):
        self.sel = sel
        self.server = ("127.0.0.1", server_port)
        self.down = udp_socket(listen_port)
        self.ups = {}
        self.rebind_ip = args.rebind_ip
        self.client = None
        self.dead = None
        self.to_server = Pipe(args, rng, links("upstream"))
        self.to_client = Pipe(args, rng, links("client"))
        self.lateness = lateness
        self.swallow = None
        self.swallow_until = 0.0
        self.swallowed = 0
        self.idle_after, self.promotion = args.idle_promote or (0.0, 0.0)
        self.last_packet = time.monotonic()
        self.promoted = 0
        sel.register(self.down, selectors.EVENT_READ, ("udp", self, "down"))

    def _upstream(self, client, host="127.0.0.1"):
        if client not in self.ups:
            self.ups[client] = udp_socket(0, host)
            self.sel.register(self.ups[client], selectors.EVENT_READ, ("udp", self, client))
        return self.ups[client]

    def read(self, which, now, blacked_out):
        """`which` is "down", or the client whose upstream socket is readable."""
        # Drain the socket, not one datagram: a burst that outruns the loop is the kernel's
        # drop, not the model's.
        up = which != "down"
        sock, pipe = (self.ups[which], self.to_client) if up else (self.down, self.to_server)
        while True:
            try:
                data, addr = sock.recvfrom(65535)
            except (BlockingIOError, InterruptedError):
                return
            if not up:
                if addr == self.dead:
                    continue
                self.client = addr
                self._upstream(addr)
            if up and self.swallow is not None:
                self.swallow_until, self.swallow = now + self.swallow, None
            swallowed = up and now < self.swallow_until
            self.swallowed += swallowed
            self._wake(now)
            pipe.offer(now, data, blacked_out or swallowed, which if up else addr)

    def _wake(self, now):
        if self.promotion and now - self.last_packet > self.idle_after:
            stall((self.to_server, self.to_client), now, self.promotion)
            self.promoted += 1
        self.last_packet = now

    def pump(self, now):
        for due, payload, client in self.to_server.ready(now):
            if client in self.ups:
                self.ups[client].sendto(payload, self.server)
            self.lateness.sent(due)
        for due, payload, client in self.to_client.ready(now):
            if client != self.dead:
                self.down.sendto(payload, client)
            self.lateness.sent(due)

    def cut(self):
        """The path this session is on is gone for good, and a session from a new port is not —
        what a handover does, on one host. docs/ARCHITECTURE.md"""
        self.dead, self.client = self.client, None
        return self.dead[1] if self.dead else 0

    def rebind(self, client=None):
        """The latest client's upstream port changes, as a NAT rebinding does; to `--rebind-ip`'s
        address when one is given."""
        client = client or self.client or self.dead
        if client not in self.ups:
            return "-", "-"
        old = self.ups.pop(client)
        was = "%s:%d" % old.getsockname()
        self.sel.unregister(old)
        old.close()
        return was, "%s:%d" % self._upstream(client, self.rebind_ip).getsockname()

    def due(self):
        return [d for d in (self.to_server.due(), self.to_client.due()) if d is not None]

    def tally(self):
        a, b = self.to_server, self.to_client
        return ("udp :%d client->server sent %d lost %d overflowed %d codel %d | server->client "
                "sent %d lost %d overflowed %d codel %d swallowed %d promoted %d"
                % (self.down.getsockname()[1], a.sent, a.lost, a.overflowed, a.managed, b.sent,
                   b.lost, b.overflowed, b.managed, self.swallowed, self.promoted))


class TcpConn:
    """A byte stream relayed above TCP. A chunk dropped here is data gone, not a segment the
    peer retransmits, so this plane shapes only: no loss, no blackout. docs/rig-limits.md §3."""

    SIDES = ("client", "upstream")

    def __init__(self, sel, client, upstream, args, rng, links, lateness):
        self.sel = sel
        self.socks = {"client": client, "upstream": upstream}
        self.pipes = {s: Pipe(args, rng, links(s), lossy=False) for s in self.SIDES}
        for pipe in self.pipes.values():
            pipe.limit = pipe.limit_bytes = 0  # a chunk dropped here is data gone: the queue only delays
        self.lateness = lateness
        # The kernel completed the handshake locally, so charge the round trip it would have
        # waited for — from the accept, not the first request, or a socket the browser opened
        # ahead of time would pay it serially.
        if not args.tcp_no_handshake:
            self.pipes["upstream"].hold = time.monotonic() + 2 * args.delay_ms / 1000.0
        self.out = {s: b"" for s in self.SIDES}
        self.eof = {s: False for s in self.SIDES}
        self.shut = {s: False for s in self.SIDES}
        self.closed = False
        for side, s in self.socks.items():
            s.setblocking(False)
            sel.register(s, selectors.EVENT_READ, ("tcp", self, side))

    @staticmethod
    def peer(side):
        return "upstream" if side == "client" else "client"

    def read(self, side, now, _blacked_out):
        try:
            data = self.socks[side].recv(65535)
        except BlockingIOError:
            return
        except OSError:
            self.close()
            return
        if not data:
            self.eof[side] = True
            self._unwatch(side)
            return
        pipe = self.pipes[self.peer(side)]
        for i in range(0, len(data), MTU):
            pipe.offer(now, data[i:i + MTU], False)

    def pump(self, now):
        if self.closed:
            return
        for side in self.SIDES:
            for due, payload, _ in self.pipes[side].ready(now):
                self.out[side] += payload
                self.lateness.sent(due)
            if self.out[side]:
                try:
                    self.out[side] = self.out[side][self.socks[side].send(self.out[side]):]
                except BlockingIOError:
                    pass
                except OSError:
                    self.close()
                    return
            drained = not self.out[side] and self.pipes[side].due() is None
            if self.eof[self.peer(side)] and drained and not self.shut[side]:
                self.shut[side] = True
                try:
                    self.socks[side].shutdown(socket.SHUT_WR)
                except OSError:
                    pass
        if all(self.shut.values()):
            self.close()

    def _unwatch(self, side):
        try:
            self.sel.unregister(self.socks[side])
        except KeyError:
            pass

    def close(self):
        if self.closed:
            return
        self.closed = True
        for side in self.SIDES:
            self._unwatch(side)
            self.socks[side].close()

    def due(self):
        return [d for p in self.pipes.values() if (d := p.due()) is not None]


class TcpPlane:
    def __init__(self, sel, listen_port, server_port, args, rng, links, lateness):
        self.sel, self.args, self.rng, self.lateness = sel, args, rng, lateness
        self.server = ("127.0.0.1", server_port)
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", listen_port))
        self.listener.listen(64)
        self.listener.setblocking(False)
        self.conns = []
        # One bottleneck for every connection, or a link each (the model earlier runs were taken on).
        shared = {s: links(s) for s in TcpConn.SIDES}
        self.links = shared.get if args.tcp_rate == "shared" else links
        self.accepted = self.chunks = 0
        sel.register(self.listener, selectors.EVENT_READ, ("tcp-accept", None, None))

    def accept(self):
        client, _ = self.listener.accept()
        upstream = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            upstream.connect(self.server)
        except OSError:
            client.close()
            upstream.close()
            return
        for s in (client, upstream):
            s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.conns.append(TcpConn(self.sel, client, upstream, self.args, self.rng, self.links,
                                  self.lateness))
        self.accepted += 1

    def pump(self, now):
        for c in self.conns:
            c.pump(now)
        done = [c for c in self.conns if c.closed]
        self.chunks += sum(p.sent for c in done for p in c.pipes.values())
        self.conns = [c for c in self.conns if not c.closed]

    def due(self):
        return [d for c in self.conns for d in c.due()]

    def tally(self):
        live = sum(p.sent for c in self.conns for p in c.pipes.values())
        return "tcp connections %d, chunks relayed %d" % (self.accepted, self.chunks + live)


TUNSETIFF, IFF_TUN, IFF_NO_PI = 0x400454CA, 0x0001, 0x1000
TUN_CLIENT, TUN_SERVER = "10.77.0.1", "10.77.0.2"


def tun_open(name):
    fd = os.open("/dev/net/tun", os.O_RDWR | os.O_NONBLOCK)
    fcntl.ioctl(fd, TUNSETIFF, struct.pack("16sH", name.encode(), IFF_TUN | IFF_NO_PI))
    return fd


class TunPlane:
    """Every IPv4 packet between this namespace and a server namespace of its own, kernel TCP and
    UDP alike, so a dropped TCP segment is one the sender retransmits. docs/rig-limits.md §3."""

    def __init__(self, sel, args, rng, links, lateness):
        self.ns = subprocess.Popen(["unshare", "-n", "sleep", "infinity"])
        own = os.readlink("/proc/self/ns/net")
        self.netns = "/proc/%d/ns/net" % self.ns.pid
        while os.readlink(self.netns) == own:
            time.sleep(0.01)
        self.fds = {"client": tun_open("wtc"), "upstream": tun_open("wts")}
        inside = ["nsenter", "--net=" + self.netns]
        subprocess.run(["ip", "link", "set", "wts", "netns", str(self.ns.pid)], check=True)
        for pre, dev, me, peer in (([], "wtc", TUN_CLIENT, TUN_SERVER),
                                   (inside, "wts", TUN_SERVER, TUN_CLIENT)):
            for cmd in (["addr", "add", me, "peer", peer, "dev", dev],
                        ["link", "set", dev, "up"], ["link", "set", "lo", "up"]):
                subprocess.run(pre + ["ip"] + cmd, check=True)
        self.to_server = Pipe(args, rng, links("upstream"))
        self.to_client = Pipe(args, rng, links("client"))
        self.pipes = {"client": self.to_server, "upstream": self.to_client}
        self.lateness = lateness
        self.idle_after, self.promotion = args.idle_promote or (0.0, 0.0)
        self.last_packet = time.monotonic()
        self.promoted = self.not_ipv4 = 0
        for side, fd in self.fds.items():
            sel.register(fd, selectors.EVENT_READ, ("tun", self, side))

    def read(self, side, now, blacked_out):
        while True:
            try:
                packet = os.read(self.fds[side], 65535)
            except (BlockingIOError, InterruptedError):
                return
            if packet[0] >> 4 != 4:
                self.not_ipv4 += 1
                continue
            self._wake(now)
            self.pipes[side].offer(now, packet, blacked_out)

    _wake = UdpPlane._wake

    def pump(self, now):
        for fd, pipe in ((self.fds["upstream"], self.to_server),
                         (self.fds["client"], self.to_client)):
            for due, packet, _ in pipe.ready(now):
                os.write(fd, packet)
                self.lateness.sent(due)

    def due(self):
        return [d for d in (self.to_server.due(), self.to_client.due()) if d is not None]

    def close(self):
        self.ns.kill()

    def _unread(self, pre, dev):
        """Packets the kernel dropped from the tun's own queue because this loop read too late:
        not the model's loss, and a kernel TCP retransmits them all the same."""
        out = subprocess.run(pre + ["ip", "-j", "-s", "link", "show", dev], capture_output=True)
        return json.loads(out.stdout)[0]["stats64"]["tx"]["dropped"] if out.returncode == 0 else -1

    def tally(self):
        a, b = self.to_server, self.to_client
        return ("tun client->server sent %d lost %d overflowed %d codel %d | server->client "
                "sent %d lost %d overflowed %d codel %d promoted %d not-ipv4 %d | unread %d %d"
                % (a.sent, a.lost, a.overflowed, a.managed, b.sent, b.lost, b.overflowed,
                   b.managed, self.promoted, self.not_ipv4, self._unread([], "wtc"),
                   self._unread(["nsenter", "--net=" + self.netns], "wts")))


def parse_pair(s):
    listen, target = s.split(":")
    return int(listen), int(target)


def parse_promotion(s):
    idle_s, promotion_ms = s.split(":")
    return float(idle_s), float(promotion_ms) / 1000.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--udp", type=parse_pair, action="append",
                    help="LISTEN:SERVER, the QUIC session's plane; again for a neighbour on one link")
    ap.add_argument("--tcp", type=parse_pair, help="LISTEN:SERVER, the static host's plane")
    ap.add_argument("--tun", action="store_true",
                    help="relay every IP packet to a server namespace of its own (%s -> %s); "
                         "needs CAP_NET_ADMIN, so run it inside `unshare -rn`" % (TUN_CLIENT, TUN_SERVER))
    ap.add_argument("--delay-ms", type=float, default=0.0, help="one way, each direction")
    ap.add_argument("--rate-kbit", type=float, default=0.0, help="0 = unlimited")
    ap.add_argument("--rate-up-kbit", type=float,
                    help="client->server only, default --rate-kbit; 0 = unlimited")
    ap.add_argument("--trace", help="a mahimahi trace that replaces the server->client rate")
    ap.add_argument("--jitter-ms", type=float, default=0.0, help="uniform, each direction")
    ap.add_argument("--jitter-mode", choices=("reorder", "ordered"), default="reorder",
                    help="reorder: deliver by time, across packets. ordered: one leg, in sequence")
    ap.add_argument("--queue-pkts", type=int, default=50, help="tail drop, like netem's limit")
    ap.add_argument("--queue-bytes", type=int, default=0, help="tail drop in bytes, not packets")
    ap.add_argument("--queue-ms", type=float, default=0.0,
                    help="--queue-bytes as milliseconds at each direction's mean rate")
    ap.add_argument("--codel", type=parse_pair, metavar="TARGET:INTERVAL",
                    help="udp and tun: CoDel on each direction's queue, in ms (RFC 8289's are 5:100)")
    ap.add_argument("--loss", type=float, default=0.0, help="percent, iid, udp and tun")
    ap.add_argument("--loss-model", choices=("iid", "ge"), default="iid")
    ap.add_argument("--ge-p", type=float, default=0.07, help="percent, good->bad")
    ap.add_argument("--ge-r", type=float, default=14.0, help="percent, bad->good")
    ap.add_argument("--tcp-rate", choices=("per-connection", "shared"), default="per-connection",
                    help="shared: every tcp connection crosses one bottleneck, as on a real link")
    ap.add_argument("--tcp-no-handshake", action="store_true",
                    help="do not charge a new tcp connection its setup round trip")
    ap.add_argument("--blackout-mode", choices=("drop", "hold"), default="drop",
                    help="drop: the outage discards. hold: it queues and bursts on return")
    ap.add_argument("--idle-promote", type=parse_promotion, metavar="S:P",
                    help="udp and tun: after S seconds with no packet either way, the next one holds "
                         "both directions P ms, as one radio's promotion does")
    ap.add_argument("--self-timing", action="store_true",
                    help="tally how late each packet left; VOID when p99 is over 1 ms")
    ap.add_argument("--rebind-ip", default="127.0.0.1",
                    help="the address a rebind moves the server's side to; another one is a new path")
    ap.add_argument("--control-port", type=int)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()
    if not args.udp and not args.tcp and not args.tun:
        ap.error("nothing to relay: pass --udp and/or --tcp, or --tun")
    if args.tun and (args.udp or args.tcp):
        ap.error("--tun carries every packet: no --udp or --tcp beside it")
    if args.idle_promote and len(args.udp or ()) > 1:
        ap.error("--idle-promote times one session's quiet: one --udp only")
    if args.queue_bytes and args.queue_ms:
        ap.error("--queue-bytes or --queue-ms, not both")
    if args.queue_bytes or args.queue_ms:
        args.queue_pkts = 0
    up_bps = (args.rate_kbit if args.rate_up_kbit is None else args.rate_up_kbit) * 1000.0
    trace = Trace(args.trace, time.monotonic()) if args.trace else None

    def links(side):
        codel = CoDel(args.codel[0] / 1000.0, args.codel[1] / 1000.0) if args.codel else None
        return (Link(up_bps, codel=codel) if side == "upstream"
                else Link(args.rate_kbit * 1000.0, trace, codel))

    rng = random.Random(args.seed)
    # Not epoll: it waits in whole milliseconds, so every due packet left up to 1 ms late.
    sel = selectors.SelectSelector()
    lateness = Lateness(args.self_timing)
    radio = {s: links(s) for s in ("upstream", "client")}
    udps = [UdpPlane(sel, *pair, args, rng, radio.get, lateness) for pair in args.udp or ()]
    udp = udps[0] if udps else None
    tcp = TcpPlane(sel, *args.tcp, args, rng, links, lateness) if args.tcp else None
    tun = TunPlane(sel, args, rng, radio.get, lateness) if args.tun else None
    planes = udps + ([tcp] if tcp else []) + ([tun] if tun else [])

    ctrl = None
    if args.control_port is not None:
        ctrl = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        ctrl.bind(("127.0.0.1", args.control_port))
        sel.register(ctrl, selectors.EVENT_READ, ("ctrl", None, None))

    queue = ("%dB" % args.queue_bytes if args.queue_bytes else
             "%gms" % args.queue_ms if args.queue_ms else "%d" % args.queue_pkts)
    print("READY udp=%s tcp=%s%s ctrl=%s delay_ms=%g jitter_ms=%g rate_kbit=%g rate_up_kbit=%g "
          "queue=%s%s loss=%g%s%s%s"
          % (",".join(str(pair[0]) for pair in args.udp) if args.udp else "-",
             args.tcp[0] if args.tcp else "-",
             " tun=%s->%s server_netns=%s" % (TUN_CLIENT, TUN_SERVER, tun.netns) if tun else "",
             args.control_port, args.delay_ms, args.jitter_ms, args.rate_kbit, up_bps / 1000.0,
             queue, " codel=%d:%d" % args.codel if args.codel else "", args.loss, " ge" if args.loss_model == "ge" else "",
             " idle_promote=%g:%g" % (args.idle_promote[0], args.idle_promote[1] * 1000)
             if args.idle_promote else "",
             " trace=%s sha256=%s mean_kbit=%.0f epoch=%.6f"
             % (args.trace, trace.sha256, trace.mean_bps / 1000.0, trace.epoch) if trace else ""),
          flush=True)

    blackout_until = 0.0
    running = True
    # A driver stops the relay with SIGTERM and wants the tally, so it is a graceful stop.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        while running:
            now = time.monotonic()
            due = [d for p in planes for d in p.due()]
            timeout = min(TICK, max(0.0, min(due) - now)) if due else IDLE
            for key, _ in sel.select(timeout=timeout):
                kind, owner, side = key.data
                now = time.monotonic()
                try:
                    if kind in ("udp", "tun"):
                        owner.read(side, now, args.blackout_mode == "drop" and now < blackout_until)
                    elif kind == "tcp":
                        owner.read(side, now, False)
                    elif kind == "tcp-accept":
                        tcp.accept()
                    else:
                        cmd = ctrl.recvfrom(65535)[0].split()
                        head = cmd[0] if cmd else b""
                        if head == b"cut" and udp:
                            print("CUT client port %d, upstream %s -> %s"
                                  % (udp.cut(), *udp.rebind()), flush=True)
                        elif head == b"rebind" and udp:
                            print("REBOUND %s -> %s" % udp.rebind(), flush=True)
                        elif head == b"blackout":
                            outage = float(cmd[1]) / 1000.0
                            blackout_until = now + outage
                            radio_plane = udp or tun
                            if args.blackout_mode == "hold" and radio_plane:
                                # The link stops draining, so a queue already standing is
                                # pushed by the outage, not absorbed into it.
                                stall((radio_plane.to_server, radio_plane.to_client), now, outage)
                            print("BLACKOUT %s ms %s" % (cmd[1].decode(), args.blackout_mode),
                                  flush=True)
                        elif head == b"swallow" and udp:
                            udp.swallow = float(cmd[1]) / 1000.0
                            print("SWALLOW %s ms armed" % cmd[1].decode(), flush=True)
                        elif head == b"stats":
                            for p in planes:
                                print(p.tally(), flush=True)
                            if lateness.on:
                                print(lateness.tally(), flush=True)
                        elif head == b"quit":
                            running = False
                except OSError:
                    pass
            now = time.monotonic()
            for p in planes:
                p.pump(now)
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        for p in planes:
            print(p.tally(), flush=True)
        if lateness.on:
            print(lateness.tally(), flush=True)
        if tun:
            tun.close()


if __name__ == "__main__":
    sys.exit(main())
