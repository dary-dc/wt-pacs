#!/usr/bin/env python3
"""A resolver for `*.test` that answers after a delay: A 127.0.0.1 for every name, and an HTTPS
record with alpn=h3 for the names given to --h3. Everything else is NXDOMAIN. One line per
query on stdout. lab/page-open/README.md §The static plane

usage: stub_dns.py --port 53 --delay-ms 40 [--h3 static.test ...]
"""
import argparse
import socket
import struct
import sys
import threading
import time

A, AAAA, HTTPS = 1, 28, 65


def parse(q):
    i, labels = 12, []
    while q[i]:
        labels.append(q[i + 1:i + 1 + q[i]].decode())
        i += 1 + q[i]
    qtype, = struct.unpack(">H", q[i + 1:i + 3])
    return ".".join(labels).lower(), qtype, i + 5


def answer(q, h3):
    name, qtype, end = parse(q)
    records = []
    if name.endswith(".test") and qtype == A:
        records.append((A, socket.inet_aton("127.0.0.1")))
    if name in h3 and qtype == HTTPS:
        # SvcPriority 1, TargetName "." (the owner), SvcParam alpn (key 1) = ["h3"].
        records.append((HTTPS, struct.pack(">H", 1) + b"\x00" + struct.pack(">HH", 1, 3) + b"\x02h3"))
    rcode = 0 if name.endswith(".test") else 3
    head = struct.pack(">HHHHHH", struct.unpack(">H", q[:2])[0], 0x8180 | rcode, 1, len(records), 0, 0)
    # 0xc00c points back at the question's name.
    body = b"".join(b"\xc0\x0c" + struct.pack(">HHIH", t, 1, 60, len(rd)) + rd for t, rd in records)
    return name, qtype, head + q[12:end] + body


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=53)
    ap.add_argument("--delay-ms", type=float, default=0.0)
    ap.add_argument("--h3", nargs="*", default=[])
    a = ap.parse_args()
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", a.port))
    h3 = {n.lower() for n in a.h3}
    while True:
        q, peer = s.recvfrom(4096)
        name, qtype, reply = answer(q, h3)
        print(f"{time.time():.3f} {name} {qtype}", flush=True)
        threading.Timer(a.delay_ms / 1000, s.sendto, (reply, peer)).start()


if __name__ == "__main__":
    sys.exit(main())
