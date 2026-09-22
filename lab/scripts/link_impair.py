#!/usr/bin/env python3
"""One impaired link for both planes, in a container without root: a userspace relay in front of
the UDP session and in front of the static host's TCP. Delay, rate, queue depth, jitter with or
without reordering, scattered and bursty loss, a blackout that drops or holds, a rebind — one model, both planes.

What it cannot do, and the limits it was calibrated against, are in `docs/rig-limits.md` §3.

usage: link_impair.py --udp 5555:4433 [--tcp 8443:8000] [--delay-ms 40] [--rate-kbit 10000]
                      [--queue-pkts 50] [--loss 0.5 | --loss-model ge] [--control-port 5556]

--delay-ms is ONE WAY and applies to each direction, so a round trip reads twice it, matching
`cloud_netem.sh`'s profiles. Control datagrams on --control-port: `rebind`, `cut`, `blackout <ms>`,
`stats`, `quit`. Prints READY, then REBOUND <old> -> <new>, then a tally at exit.
"""
import argparse
import collections
import heapq
import random
import selectors
import signal
import socket
import sys
import time

MTU = 1500
TICK = 0.0005
IDLE = 0.05


class Pipe:
    """One direction: loss, then a finite queue drained at the rate, then the one-way delay."""

    def __init__(self, args, rng, lossy=True):
        self.delay = args.delay_ms / 1000.0
        self.jitter = args.jitter_ms / 1000.0
        self.ordered = args.jitter_mode == "ordered"
        self.last_due = 0.0
        self.rate = args.rate_kbit * 1000.0
        self.limit = args.queue_pkts
        self.loss = args.loss / 100.0
        self.ge = (args.ge_p / 100.0, args.ge_r / 100.0) if args.loss_model == "ge" else None
        self.lossy = lossy
        self.rng = rng
        self.bad = False
        self.next_free = 0.0
        self.pending = []
        self.tx = collections.deque()
        self.seq = 0
        self.sent = self.lost = self.overflowed = 0

    def _drop(self):
        if self.ge:
            p, r = self.ge
            self.bad = self.rng.random() >= r if self.bad else self.rng.random() < p
            return self.bad
        return self.loss > 0 and self.rng.random() < self.loss

    def offer(self, now, payload, blacked_out):
        if self.lossy and (blacked_out or self._drop()):
            self.lost += 1
            return
        while self.tx and self.tx[0] <= now:
            self.tx.popleft()
        if self.limit and len(self.tx) >= self.limit:
            self.overflowed += 1
            return
        start = max(now, self.next_free)
        self.next_free = start + (len(payload) * 8 / self.rate if self.rate else 0.0)
        self.tx.append(self.next_free)
        # --jitter-mode picks which path the wobble models. docs/rig-limits.md §3.
        wobble = self.rng.uniform(-self.jitter, self.jitter) if self.jitter else 0.0
        due = self.next_free + max(0.0, self.delay + wobble)
        if self.ordered:
            due = max(due, self.last_due)
            self.last_due = due
        heapq.heappush(self.pending, (due, self.seq, payload))
        self.seq += 1

    def due(self):
        return self.pending[0][0] if self.pending else None

    def ready(self, now):
        out = []
        while self.pending and self.pending[0][0] <= now:
            out.append(heapq.heappop(self.pending)[2])
        self.sent += len(out)
        return out


def udp_socket(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    for opt in (socket.SO_RCVBUF, socket.SO_SNDBUF):
        s.setsockopt(socket.SOL_SOCKET, opt, 8 << 20)
    s.bind(("127.0.0.1", port))
    s.setblocking(False)
    return s


class UdpPlane:
    def __init__(self, sel, listen_port, server_port, args, rng):
        self.sel = sel
        self.server = ("127.0.0.1", server_port)
        self.down = udp_socket(listen_port)
        self.up = udp_socket(0)
        self.client = None
        self.dead = None
        self.to_server = Pipe(args, rng)
        self.to_client = Pipe(args, rng)
        sel.register(self.down, selectors.EVENT_READ, ("udp", None, "down"))
        sel.register(self.up, selectors.EVENT_READ, ("udp", None, "up"))

    def read(self, which, now, blacked_out):
        # Drain the socket, not one datagram: a burst that outruns the loop is the kernel's
        # drop, not the model's.
        sock, pipe = (self.down, self.to_server) if which == "down" else (self.up, self.to_client)
        while True:
            try:
                data, addr = sock.recvfrom(65535)
            except (BlockingIOError, InterruptedError):
                return
            if which == "down":
                if addr == self.dead:
                    continue
                self.client = addr
            pipe.offer(now, data, blacked_out)

    def pump(self, now):
        for payload in self.to_server.ready(now):
            self.up.sendto(payload, self.server)
        for payload in self.to_client.ready(now):
            if self.client:
                self.down.sendto(payload, self.client)

    def cut(self):
        """The path this session is on is gone for good, and a session from a new port is not —
        what a handover does, on one host. docs/proposal-session-survival.md"""
        self.dead, self.client = self.client, None
        return self.dead[1] if self.dead else 0

    def rebind(self):
        old = self.up.getsockname()[1]
        self.sel.unregister(self.up)
        self.up.close()
        self.up = udp_socket(0)
        self.sel.register(self.up, selectors.EVENT_READ, ("udp", None, "up"))
        return old, self.up.getsockname()[1]

    def due(self):
        return [d for d in (self.to_server.due(), self.to_client.due()) if d is not None]

    def tally(self):
        a, b = self.to_server, self.to_client
        return ("udp client->server sent %d lost %d overflowed %d | server->client sent %d "
                "lost %d overflowed %d" % (a.sent, a.lost, a.overflowed, b.sent, b.lost,
                                           b.overflowed))


class TcpConn:
    """A byte stream relayed above TCP. A chunk dropped here is data gone, not a segment the
    peer retransmits, so this plane shapes only: no loss, no blackout. docs/rig-limits.md §3."""

    SIDES = ("client", "upstream")

    def __init__(self, sel, client, upstream, args, rng):
        self.sel = sel
        self.socks = {"client": client, "upstream": upstream}
        self.pipes = {s: Pipe(args, rng, lossy=False) for s in self.SIDES}
        # The kernel completed the handshake locally, so charge the round trip it would have
        # waited for — from the accept, not the first request, or a socket the browser opened
        # ahead of time would pay it serially.
        if not args.tcp_no_handshake:
            self.pipes["upstream"].next_free = time.monotonic() + 2 * args.delay_ms / 1000.0
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
            self.out[side] += b"".join(self.pipes[side].ready(now))
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
    def __init__(self, sel, listen_port, server_port, args, rng):
        self.sel, self.args, self.rng = sel, args, rng
        self.server = ("127.0.0.1", server_port)
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", listen_port))
        self.listener.listen(64)
        self.listener.setblocking(False)
        self.conns = []
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
        self.conns.append(TcpConn(self.sel, client, upstream, self.args, self.rng))
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


def parse_pair(s):
    listen, target = s.split(":")
    return int(listen), int(target)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--udp", type=parse_pair, help="LISTEN:SERVER, the QUIC session's plane")
    ap.add_argument("--tcp", type=parse_pair, help="LISTEN:SERVER, the static host's plane")
    ap.add_argument("--delay-ms", type=float, default=0.0, help="one way, each direction")
    ap.add_argument("--rate-kbit", type=float, default=0.0, help="0 = unlimited")
    ap.add_argument("--jitter-ms", type=float, default=0.0, help="uniform, each direction")
    ap.add_argument("--jitter-mode", choices=("reorder", "ordered"), default="reorder",
                    help="reorder: deliver by time, across packets. ordered: one leg, in sequence")
    ap.add_argument("--queue-pkts", type=int, default=50, help="tail drop, like netem's limit")
    ap.add_argument("--loss", type=float, default=0.0, help="percent, iid, udp only")
    ap.add_argument("--loss-model", choices=("iid", "ge"), default="iid")
    ap.add_argument("--ge-p", type=float, default=0.07, help="percent, good->bad")
    ap.add_argument("--ge-r", type=float, default=14.0, help="percent, bad->good")
    ap.add_argument("--tcp-no-handshake", action="store_true",
                    help="do not charge a new tcp connection its setup round trip")
    ap.add_argument("--blackout-mode", choices=("drop", "hold"), default="drop",
                    help="drop: the outage discards. hold: it queues and bursts on return")
    ap.add_argument("--control-port", type=int)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()
    if not args.udp and not args.tcp:
        ap.error("nothing to relay: pass --udp and/or --tcp")

    rng = random.Random(args.seed)
    sel = selectors.DefaultSelector()
    udp = UdpPlane(sel, *args.udp, args, rng) if args.udp else None
    tcp = TcpPlane(sel, *args.tcp, args, rng) if args.tcp else None
    planes = [p for p in (udp, tcp) if p]

    ctrl = None
    if args.control_port is not None:
        ctrl = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        ctrl.bind(("127.0.0.1", args.control_port))
        sel.register(ctrl, selectors.EVENT_READ, ("ctrl", None, None))

    print("READY udp=%s tcp=%s ctrl=%s delay_ms=%g jitter_ms=%g rate_kbit=%g queue=%d loss=%g%s"
          % (args.udp[0] if args.udp else "-", args.tcp[0] if args.tcp else "-",
             args.control_port, args.delay_ms, args.jitter_ms, args.rate_kbit,
             args.queue_pkts, args.loss,
             " ge" if args.loss_model == "ge" else ""), flush=True)

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
                    if kind == "udp":
                        udp.read(side, now, args.blackout_mode == "drop" and now < blackout_until)
                    elif kind == "tcp":
                        owner.read(side, now, False)
                    elif kind == "tcp-accept":
                        tcp.accept()
                    else:
                        cmd = ctrl.recvfrom(65535)[0].split()
                        head = cmd[0] if cmd else b""
                        if head == b"cut" and udp:
                            print("CUT client port %d, upstream %d -> %d"
                                  % (udp.cut(), *udp.rebind()), flush=True)
                        elif head == b"rebind" and udp:
                            print("REBOUND %d -> %d" % udp.rebind(), flush=True)
                        elif head == b"blackout":
                            outage = float(cmd[1]) / 1000.0
                            blackout_until = now + outage
                            if args.blackout_mode == "hold" and udp:
                                # The link stops draining, so a queue already standing is
                                # pushed by the outage, not absorbed into it.
                                for pipe in (udp.to_server, udp.to_client):
                                    pipe.next_free = max(pipe.next_free, now) + outage
                            print("BLACKOUT %s ms %s" % (cmd[1].decode(), args.blackout_mode),
                                  flush=True)
                        elif head == b"stats":
                            for p in planes:
                                print(p.tally(), flush=True)
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


if __name__ == "__main__":
    sys.exit(main())
