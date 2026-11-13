#!/usr/bin/env python3
"""Each link class emulated between two network namespaces, every package sent raw and compressed over both stacks.

usage: link.py OUT [--rounds N] [--geo-rounds N] [--classes a,b] [--bin PATH]   as root; one JSON line per transfer
The kernel has no netem, so a forwarder between two TUN devices delays, rate-limits and drops each packet.
"""
import argparse
import fcntl
import heapq
import json
import multiprocessing
import os
import random
import select
import struct
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import wire  # noqa: E402

TUNSETIFF, IFF_TUN, IFF_NO_PI = 0x400454CA, 0x0001, 0x1000
PCS, PACS = ("pcs", "10.77.0.1", "tpcs"), ("pacs", "10.77.0.2", "tpacs")
PORT = 4433
QUEUE_PACKETS = 100
DOWN_MBIT = {"fiber": 100, "4g5g": 100, "geo": 10, "adsl": 8, "floor": None}
KINDS = [("ct", k) for k in ("exam-diff", "exam-group", "series-group", "instance-group", "fanout-diff",
                             "series-resend")] + [("mr", "series-resend")]


def sh(*cmd: str) -> None:
    subprocess.run(cmd, check=True)


def tun(name: str) -> int:
    fd = os.open("/dev/net/tun", os.O_RDWR)
    fcntl.ioctl(fd, TUNSETIFF, struct.pack("16sH", name.encode(), IFF_TUN | IFF_NO_PI))
    return fd


def namespaces() -> tuple:
    """Two namespaces, a TUN each, Cubic and no cached path metrics in both; the TUN fds stay with this process."""
    sh("sysctl", "-q", "-w", "net.ipv4.tcp_allowed_congestion_control=reno bbr cubic")
    fds = []
    for (ns, addr, dev), (_, peer, _) in ((PCS, PACS), (PACS, PCS)):
        subprocess.run(["ip", "netns", "del", ns], stderr=subprocess.DEVNULL)
        sh("ip", "netns", "add", ns)
        fds.append(tun(dev))
        sh("ip", "link", "set", dev, "netns", ns)
        sh("ip", "-n", ns, "link", "set", "lo", "up")
        sh("ip", "-n", ns, "addr", "add", addr, "peer", peer, "dev", dev)
        sh("ip", "-n", ns, "link", "set", dev, "mtu", "1500", "up")
        sh("ip", "netns", "exec", ns, "sysctl", "-q", "-w", "net.ipv4.tcp_congestion_control=cubic",
           "net.ipv4.tcp_no_metrics_save=1")
    return fds[0], fds[1]


class Direction:
    """One way of the link: a FIFO drained at `mbit` (None: no limit), then `delay` seconds, each packet lost at `loss`."""

    def __init__(self, mbit, delay: float, loss: float, rng: random.Random):
        self.rate = mbit * 1e6 / 8 if mbit else None
        self.delay, self.loss, self.rng = delay, loss, rng
        self.free = 0.0
        self.departures = []

    def admit(self, now: float, size: int):
        """The packet's arrival time at the far end, or None when dropped by loss or a full queue."""
        while self.departures and self.departures[0] <= now:
            heapq.heappop(self.departures)
        if len(self.departures) >= QUEUE_PACKETS or self.rng.random() < self.loss:
            return None
        start = max(now, self.free)
        self.free = start + (size / self.rate if self.rate else 0.0)
        heapq.heappush(self.departures, self.free)
        return self.free + self.delay


def forward(up_fd: int, down_fd: int, link: dict, down_mbit, seed: int) -> None:
    rng = random.Random(seed)
    ways = {up_fd: (Direction(link["up_mbit"], link["rtt"] / 2, link["loss"], rng), down_fd),
            down_fd: (Direction(down_mbit, link["rtt"] / 2, link["loss"], rng), up_fd)}
    pending, seq = [], 0
    poll = select.epoll()
    for fd in ways:
        poll.register(fd, select.EPOLLIN)
    while True:
        timeout = max(0.0, pending[0][0] - time.monotonic()) if pending else 1.0
        for fd, _ in poll.poll(timeout):
            packet = os.read(fd, 65536)
            direction, out = ways[fd]
            at = direction.admit(time.monotonic(), len(packet))
            if at is not None:
                heapq.heappush(pending, (at, seq, out, packet))
                seq += 1
        now = time.monotonic()
        while pending and pending[0][0] <= now:
            _, _, out, packet = heapq.heappop(pending)
            os.write(out, packet)


def plan(rounds: int) -> list:
    """Every (series, kind, variant, protocol), the order rotated round by round."""
    cells = [(s, k, v, p) for s, k in KINDS for v in ("raw", "zstd_1") for p in ("tcp", "quic")]
    return [(r, cells[(r * 5) % len(cells):] + cells[:(r * 5) % len(cells)]) for r in range(rounds)]


def run_class(name: str, link: dict, rounds: int, out: str, binary: str, fds: tuple) -> None:
    proc = multiprocessing.Process(target=forward, args=(fds[0], fds[1], link, DOWN_MBIT[name], rounds), daemon=True)
    proc.start()
    order = plan(rounds)
    with tempfile.NamedTemporaryFile("w", suffix=".plan", delete=False) as fh:
        for _, cells in order:
            for s, k, v, p in cells:
                fh.write(f"{p} {os.path.join(out, s, f'{k}.{v}.tar')}\n")
    try:
        result = subprocess.run(["ip", "netns", "exec", PCS[0], binary, "send", f"{PACS[1]}:{PORT}", fh.name],
                                check=True, capture_output=True, text=True)
    finally:
        proc.terminate()
        os.unlink(fh.name)
    lines = iter(result.stdout.splitlines())
    for r, cells in order:
        for s, k, v, p in cells:
            got = json.loads(next(lines))
            print(json.dumps({"class": name, "round": r, "series": s, "kind": k, "variant": v, "protocol": p,
                              "bytes": got["bytes"], "ms": got["ms"], "status": got["status"]}), flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--rounds", type=int, default=12)
    ap.add_argument("--geo-rounds", type=int, default=8)
    ap.add_argument("--classes", default="floor,fiber,4g5g,geo,adsl")
    ap.add_argument("--bin", default=os.path.join(HERE, "target", "release", "update-link"))
    args = ap.parse_args()
    fds = namespaces()
    server = subprocess.Popen(["ip", "netns", "exec", PACS[0], args.bin, "serve", f"0.0.0.0:{PORT}"])
    time.sleep(0.5)
    classes = dict(wire.CLASSES, floor={"rtt": 0.0, "up_mbit": None, "loss": 0.0})
    try:
        for name in args.classes.split(","):
            rounds = args.geo_rounds if name == "geo" else args.rounds
            run_class(name, classes[name], rounds, args.out, args.bin, fds)
    finally:
        server.terminate()


if __name__ == "__main__":
    main()
