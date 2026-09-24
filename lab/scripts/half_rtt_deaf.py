#!/usr/bin/env python3
"""A client that ignores 0.5-RTT data, made of any client: a pass-through UDP relay that removes
every 1-RTT (short-header) packet the server sends a client until that client sends its own first
1-RTT packet, alone or coalesced — which it can only do once its handshake is complete. Long-header
packets coalesced ahead of a 1-RTT packet in one datagram are kept.
docs/proposal-session-open.md §Other clients

usage: half_rtt_deaf.py LISTEN_PORT UPSTREAM_PORT
Prints one line per client on SIGTERM / SIGINT: `client=N stripped_packets=... stripped_bytes=...`
"""
import select
import signal
import socket
import sys

listen_port, up_port = int(sys.argv[1]), int(sys.argv[2])
front = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
front.bind(("127.0.0.1", listen_port))
clients, by_sock, deaf, stripped = {}, {}, {}, {}


def varint(b, i):
    n = 1 << (b[i] >> 6)
    v = b[i] & 0x3F
    for k in range(1, n):
        v = (v << 8) | b[i + k]
    return v, i + n


def long_header_prefix(d):
    """How many leading bytes of the datagram are long-header packets."""
    i = 0
    while i < len(d) and d[i] & 0x80:
        j = i + 5
        j += 1 + d[j]
        j += 1 + d[j]
        if (d[i] >> 4) & 3 == 0:  # Initial: a token
            n, j = varint(d, j)
            j += n
        length, j = varint(d, j)
        i = j + length
    return i


def one_rtt_at(d):
    """Where a 1-RTT packet starts in the datagram, or None. What follows the long-header packets
    may be zero padding instead, and the fixed bit cannot tell them apart (RFC 9287 greases it)."""
    i = long_header_prefix(d)
    return i if any(d[i:]) else None


def dump(*_):
    for n, addr in enumerate(clients):
        print("client=%d stripped_packets=%d stripped_bytes=%d" % (n, *stripped[addr]), flush=True)
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
                clients[addr], by_sock[up] = up, addr
                deaf[addr], stripped[addr] = True, [0, 0]
            if one_rtt_at(data) is not None:
                deaf[addr] = False
            up.send(data)
        else:
            data, addr = s.recv(65535), by_sock[s]
            cut = one_rtt_at(data) if deaf[addr] else None
            if cut is not None:
                stripped[addr][0] += 1
                stripped[addr][1] += len(data) - cut
                data = data[:cut]
            if data:
                front.sendto(data, addr)
