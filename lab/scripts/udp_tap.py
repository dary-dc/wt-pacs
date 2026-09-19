#!/usr/bin/env python3
"""UDP relay that histograms datagram sizes in both directions.

usage: udp_tap.py LISTEN_PORT UPSTREAM_PORT OUT.json
Relays 127.0.0.1:LISTEN_PORT <-> 127.0.0.1:UPSTREAM_PORT, one upstream socket per client
address, and writes the histogram on SIGTERM / SIGINT. It drops under load, so its numbers
answer "how large" and never "how fast" — docs/improvements/2026-09-10.md.
"""
import collections
import json
import select
import signal
import socket
import sys

listen_port, up_port, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
front = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
front.bind(("127.0.0.1", listen_port))
front.setblocking(False)
clients = {}
by_sock = {}
hist = {"c2s": collections.Counter(), "s2c": collections.Counter()}
total = {"c2s": 0, "s2c": 0}


def dump(*_):
    res = {}
    for d in ("c2s", "s2c"):
        h = hist[d]
        n = sum(h.values())
        res[d] = {
            "datagrams": n,
            "bytes": total[d],
            "max": max(h) if h else 0,
            "mean": round(total[d] / n, 1) if n else 0,
            "top_sizes": sorted(h.items(), key=lambda kv: -kv[1])[:8],
        }
    json.dump(res, open(out, "w"), indent=1)
    sys.exit(0)


signal.signal(signal.SIGTERM, dump)
signal.signal(signal.SIGINT, dump)

while True:
    ready, _, _ = select.select([front] + list(by_sock), [], [])
    for s in ready:
        if s is front:
            data, addr = front.recvfrom(65535)
            up = clients.get(addr)
            if up is None:
                up = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                up.connect(("127.0.0.1", up_port))
                up.setblocking(False)
                clients[addr] = up
                by_sock[up] = addr
            hist["c2s"][len(data)] += 1
            total["c2s"] += len(data)
            up.send(data)
        else:
            data = s.recv(65535)
            hist["s2c"][len(data)] += 1
            total["s2c"] += len(data)
            front.sendto(data, by_sock[s])
