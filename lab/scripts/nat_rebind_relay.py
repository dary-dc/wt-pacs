#!/usr/bin/env python3
"""A UDP relay that changes its own source port mid-session: a NAT rebind, as the field has it.
usage: nat_relay.py <listen_port> <server_port> <rebind_after_s>
Prints REBOUND <old> -> <new> when it happens, and a packet tally at exit.
"""
import selectors, socket, sys, time

listen_port, server_port, rebind_after = int(sys.argv[1]), int(sys.argv[2]), float(sys.argv[3])
SRV = ("127.0.0.1", server_port)

down = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
down.bind(("127.0.0.1", listen_port))
up = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
up.bind(("127.0.0.1", 0))

sel = selectors.DefaultSelector()
sel.register(down, selectors.EVENT_READ, "down")
sel.register(up, selectors.EVENT_READ, "up")

client = None
rebound = False
start = time.time()
n_up = n_down = n_after = 0

try:
    while time.time() - start < rebind_after + 25:
        for key, _ in sel.select(timeout=0.05):
            try:
                if key.data == "down":
                    data, addr = down.recvfrom(65535)
                    client = addr
                    up.sendto(data, SRV)
                    n_up += 1
                else:
                    data, _ = up.recvfrom(65535)
                    if client:
                        down.sendto(data, client)
                    n_down += 1
                    if rebound:
                        n_after += 1
            except OSError:
                pass
        if not rebound and time.time() - start > rebind_after:
            old = up.getsockname()
            sel.unregister(up)
            up.close()
            up = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            up.bind(("127.0.0.1", 0))
            sel.register(up, selectors.EVENT_READ, "up")
            rebound = True
            print(f"REBOUND {old[1]} -> {up.getsockname()[1]}", flush=True)
finally:
    print(f"packets client->server {n_up}, server->client {n_down}, "
          f"server->client after rebind {n_after}", flush=True)
