#!/usr/bin/env python3
"""Does `link_shim.py` deliver the link it was asked for?

Stands a UDP echo server behind the shim and measures what a packet actually sees:
RTT for a lone small packet, and goodput for a one-way blast. Run this before trusting
any shaped cell — a shim that does not shape is worse than no shim at all.

    lab/scripts/link_shim_check.py --delay-ms 30 --rate-mbit 10
"""

from __future__ import annotations

import argparse
import json
import socket
import statistics
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def echo_server(port: int, stop: threading.Event) -> None:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 8 << 20)
    s.bind(("127.0.0.1", port))
    s.settimeout(0.2)
    while not stop.is_set():
        try:
            data, addr = s.recvfrom(65535)
        except socket.timeout:
            continue
        if data[:4] == b"PING":
            s.sendto(b"PONG" + data[4:], addr)
        elif data[:4] == b"DONE":
            s.sendto(b"DONE", addr)
    s.close()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--delay-ms", type=float, default=30.0)
    p.add_argument("--rate-mbit", type=float, default=10.0)
    p.add_argument("--queue-ms", type=float, default=100.0)
    p.add_argument("--echo-port", type=int, default=4599)
    p.add_argument("--shim-port", type=int, default=4598)
    p.add_argument("--pings", type=int, default=40)
    p.add_argument("--blast-packets", type=int, default=800)
    p.add_argument("--packet-bytes", type=int, default=1350)
    args = p.parse_args()

    stop = threading.Event()
    t = threading.Thread(target=echo_server, args=(args.echo_port, stop), daemon=True)
    t.start()

    shim = subprocess.Popen(
        [
            sys.executable,
            str(ROOT / "lab/scripts/link_shim.py"),
            "--listen-port", str(args.shim_port),
            "--server-port", str(args.echo_port),
            "--delay-ms", str(args.delay_ms),
            "--rate-mbit", str(args.rate_mbit),
            "--queue-ms", str(args.queue_ms),
        ],
        stdout=subprocess.PIPE,
        text=True,
    )
    assert shim.stdout is not None
    shim.stdout.readline()
    time.sleep(0.3)

    cli = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    cli.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 8 << 20)
    cli.settimeout(5.0)
    dst = ("127.0.0.1", args.shim_port)

    # RTT: one small packet at a time, so queueing is out of it.
    rtts = []
    for i in range(args.pings):
        payload = b"PING" + i.to_bytes(4, "big") + b"\0" * 56
        t0 = time.perf_counter()
        cli.sendto(payload, dst)
        cli.recv(65535)
        rtts.append((time.perf_counter() - t0) * 1000)
        time.sleep(0.005)

    # Goodput: fill the link one way, then time to drain.
    blast = b"PING" + b"\0" * (args.packet_bytes - 4)
    got = 0
    t0 = time.perf_counter()
    sender_done = threading.Event()

    def send_all() -> None:
        # Pace just above the nominal rate so the shim's queue, not the sender, is the limit.
        gap = (args.packet_bytes * 8) / (args.rate_mbit * 1_000_000 * 1.2) if args.rate_mbit else 0
        for _ in range(args.blast_packets):
            cli.sendto(blast, dst)
            if gap:
                time.sleep(gap)
        sender_done.set()

    threading.Thread(target=send_all, daemon=True).start()
    first = None
    last = None
    while True:
        try:
            cli.recv(65535)
        except socket.timeout:
            break
        got += 1
        now = time.perf_counter()
        if first is None:
            first = now
        last = now
        if got >= args.blast_packets and sender_done.is_set():
            break
    span = (last - first) if (first and last and last > first) else 0.0
    goodput_mbit = (got * args.packet_bytes * 8) / span / 1e6 if span > 0 else None

    shim.terminate()
    try:
        out = shim.stdout.read()
    except Exception:  # noqa: BLE001
        out = ""
    shim.wait(timeout=5)
    stop.set()

    result = {
        "asked": {
            "rtt_ms": 2 * args.delay_ms,
            "rate_mbit": args.rate_mbit,
            "queue_ms": args.queue_ms,
        },
        "rtt_ms": {
            "n": len(rtts),
            "min": round(min(rtts), 3),
            "median": round(statistics.median(rtts), 3),
            "mean": round(statistics.fmean(rtts), 3),
            "max": round(max(rtts), 3),
            "stdev": round(statistics.pstdev(rtts), 3),
        },
        "blast": {
            "sent": args.blast_packets,
            "received": got,
            "packet_bytes": args.packet_bytes,
            "span_s": round(span, 4) if span else None,
            # One direction only: the echo path is the same link, so the return leg shares it.
            "goodput_mbit_one_way": round(goodput_mbit, 3) if goodput_mbit else None,
        },
        "shim_stats_line": out.strip().splitlines()[-1] if out.strip() else None,
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
