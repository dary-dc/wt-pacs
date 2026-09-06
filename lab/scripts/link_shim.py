#!/usr/bin/env python3
"""A UDP link shim: one bottleneck link between a QUIC client and a QUIC server.

Why this exists: the plan in `docs/client-runtime-experiment-plan.md` §4 asks for a shaped
link (netem in a netns). This kernel has no netem (`CONFIG_NET_SCH_NETEM` is not set), so the
shaping happens in user space instead, in front of the server's UDP port.

Model — a work-conserving FIFO link, per direction:

    serialize = bytes * 8 / rate
    depart    = max(now, link_free) + serialize      # queueing + serialization
    arrive    = depart + delay                       # propagation
    link_free = depart

A packet whose queueing delay would exceed `--queue-ms` is dropped (tail drop), which is what
gives the link a finite buffer instead of unbounded latency.

RTT added end to end is 2 x `--delay-ms` (one propagation delay in each direction).

This sits identically in front of both client arms, so its own cost and jitter are a common
term in an A/B, not a differential one. `--stats-json` writes what the link actually did, so
the run can be checked against what was asked for.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import signal
import socket
import sys


class Link:
    """One direction of the bottleneck."""

    def __init__(self, loop, rate_bps: float, delay_s: float, queue_s: float):
        self.loop = loop
        self.rate_bps = rate_bps
        self.delay_s = delay_s
        self.queue_s = queue_s
        self.free_at = 0.0
        self.packets = 0
        self.bytes = 0
        self.drops = 0
        self.queue_s_max = 0.0

    def send(self, data: bytes, deliver) -> None:
        now = self.loop.time()
        serialize = (len(data) * 8) / self.rate_bps if self.rate_bps > 0 else 0.0
        depart = max(now, self.free_at) + serialize
        queued = depart - now
        if self.queue_s > 0 and queued > self.queue_s:
            self.drops += 1
            return
        self.free_at = depart
        self.packets += 1
        self.bytes += len(data)
        if queued > self.queue_s_max:
            self.queue_s_max = queued
        arrive = depart + self.delay_s
        if arrive <= now:
            deliver(data)
        else:
            self.loop.call_at(arrive, deliver, data)


class Upstream(asyncio.DatagramProtocol):
    """Server-facing socket for one client address."""

    def __init__(self, shim, client_addr):
        self.shim = shim
        self.client_addr = client_addr
        self.transport = None

    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        self.shim.down.send(data, self._deliver)

    def _deliver(self, data: bytes) -> None:
        if self.shim.transport is not None:
            self.shim.transport.sendto(data, self.client_addr)


class Shim(asyncio.DatagramProtocol):
    """Client-facing socket. One upstream socket per client address."""

    def __init__(self, loop, server_addr, up: Link, down: Link):
        self.loop = loop
        self.server_addr = server_addr
        self.up = up
        self.down = down
        self.transport = None
        self.upstreams: dict[tuple[str, int], Upstream] = {}
        self.pending: set = set()

    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        peer = self.upstreams.get(addr)
        if peer is None:
            self.upstreams[addr] = None  # reserve; creation is async
            task = self.loop.create_task(self._open(addr, data))
            self.pending.add(task)
            task.add_done_callback(self.pending.discard)
            return
        self.up.send(data, lambda d, p=peer: self._to_server(p, d))

    def _to_server(self, peer: Upstream, data: bytes) -> None:
        if peer.transport is not None:
            peer.transport.sendto(data)

    async def _open(self, addr, first: bytes):
        transport, peer = await self.loop.create_datagram_endpoint(
            lambda: Upstream(self, addr),
            local_addr=("127.0.0.1", 0),
            remote_addr=self.server_addr,
        )
        self.upstreams[addr] = peer
        self.up.send(first, lambda d, p=peer: self._to_server(p, d))


async def run(args) -> int:
    loop = asyncio.get_running_loop()
    rate_bps = args.rate_mbit * 1_000_000.0
    delay_s = args.delay_ms / 1000.0
    queue_s = args.queue_ms / 1000.0
    up = Link(loop, rate_bps, delay_s, queue_s)
    down = Link(loop, rate_bps, delay_s, queue_s)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 8 << 20)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 8 << 20)
    sock.bind(("127.0.0.1", args.listen_port))

    transport, shim = await loop.create_datagram_endpoint(
        lambda: Shim(loop, ("127.0.0.1", args.server_port), up, down),
        sock=sock,
    )
    print(
        f"link-shim 127.0.0.1:{args.listen_port} -> 127.0.0.1:{args.server_port} "
        f"rtt={2 * args.delay_ms}ms rate={args.rate_mbit}mbit queue={args.queue_ms}ms",
        flush=True,
    )

    stop = loop.create_future()
    for s in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(s, lambda: stop.done() or stop.set_result(None))
    await stop
    transport.close()

    stats = {
        "listen_port": args.listen_port,
        "server_port": args.server_port,
        "rtt_ms": 2 * args.delay_ms,
        "rate_mbit": args.rate_mbit,
        "queue_ms": args.queue_ms,
        "up": {
            "packets": up.packets,
            "bytes": up.bytes,
            "drops": up.drops,
            "max_queue_ms": round(up.queue_s_max * 1000, 3),
        },
        "down": {
            "packets": down.packets,
            "bytes": down.bytes,
            "drops": down.drops,
            "max_queue_ms": round(down.queue_s_max * 1000, 3),
        },
    }
    if args.stats_json:
        with open(args.stats_json, "w") as f:
            json.dump(stats, f, indent=2)
            f.write("\n")
    print(json.dumps(stats), flush=True)
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--listen-port", type=int, default=4444)
    p.add_argument("--server-port", type=int, default=4433)
    p.add_argument("--delay-ms", type=float, default=0.0, help="one-way propagation; RTT is 2x this")
    p.add_argument("--rate-mbit", type=float, default=0.0, help="bottleneck rate per direction; 0 = unlimited")
    p.add_argument("--queue-ms", type=float, default=100.0, help="bottleneck buffer; 0 = unbounded")
    p.add_argument("--stats-json", default=None)
    return asyncio.run(run(p.parse_args()))


if __name__ == "__main__":
    sys.exit(main())
