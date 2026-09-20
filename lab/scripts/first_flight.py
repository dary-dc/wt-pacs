#!/usr/bin/env python3
"""The server's first flight in bytes on the wire: a pass-through UDP tap that groups each
connection's datagrams into flights, a flight being a run of datagrams in one direction.

Before it has validated the client's address a QUIC server may send only three times what it has
received (`quinn-proto` `connection/paths.rs`), so whether a certificate chain fits the first
flight is what decides a round trip. docs/proposal-session-open.md §What production adds.

It relays and does not shape: put it in front of link_impair.py so each flight arrives whole.

usage: first_flight.py LISTEN_PORT UPSTREAM_PORT [MAX_FLIGHTS]
Prints one line per connection on SIGTERM / SIGINT: `conn=N c2s:bytes/datagrams s2c:... `
"""
import select
import signal
import socket
import sys

listen_port, up_port = int(sys.argv[1]), int(sys.argv[2])
keep = int(sys.argv[3]) if len(sys.argv) > 3 else 6

front = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
front.bind(("127.0.0.1", listen_port))
front.setblocking(False)
clients = {}
by_sock = {}
flights = {}


def note(addr, direction, size):
    runs = flights.setdefault(addr, [])
    if not runs or runs[-1][0] != direction:
        runs.append([direction, 0, 0])
    runs[-1][1] += size
    runs[-1][2] += 1


def dump(*_):
    for n, runs in enumerate(flights.values()):
        print("conn=%d %s" % (n, " ".join("%s:%d/%d" % tuple(r) for r in runs[:keep])), flush=True)
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
            note(addr, "c2s", len(data))
            up.send(data)
        else:
            data = s.recv(65535)
            note(by_sock[s], "s2c", len(data))
            front.sendto(data, by_sock[s])
