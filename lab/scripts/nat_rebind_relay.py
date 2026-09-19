#!/usr/bin/env python3
"""A UDP relay that changes its own source port mid-session: a NAT rebind, as the field has it.
usage: nat_relay.py <listen_port> <server_port> <rebind_after_s> [control_port]
With a control port the rebind waits for b"rebind" there instead of the clock, so a driver can
place it exactly; the relay then runs until killed.
Prints REBOUND <old> -> <new> when it happens, and a packet tally at exit.
"""
import selectors, socket, sys, time

listen_port, server_port, rebind_after = int(sys.argv[1]), int(sys.argv[2]), float(sys.argv[3])
control_port = int(sys.argv[4]) if len(sys.argv) > 4 else None
SRV = ("127.0.0.1", server_port)

down = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
down.bind(("127.0.0.1", listen_port))
up = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
up.bind(("127.0.0.1", 0))

sel = selectors.DefaultSelector()
sel.register(down, selectors.EVENT_READ, "down")
sel.register(up, selectors.EVENT_READ, "up")

ctrl = None
if control_port is not None:
    ctrl = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    ctrl.bind(("127.0.0.1", control_port))
    sel.register(ctrl, selectors.EVENT_READ, "ctrl")
    print(f"READY listen={listen_port} ctrl={control_port}", flush=True)

client = None
rebound = False
start = time.time()
n_up = n_down = n_after = 0

try:
    while ctrl is not None or time.time() - start < rebind_after + 25:
        asked = False
        for key, _ in sel.select(timeout=0.05):
            try:
                if key.data == "down":
                    data, addr = down.recvfrom(65535)
                    client = addr
                    up.sendto(data, SRV)
                    n_up += 1
                elif key.data == "ctrl":
                    asked = ctrl.recvfrom(65535)[0].strip() == b"rebind"
                else:
                    data, _ = up.recvfrom(65535)
                    if client:
                        down.sendto(data, client)
                    n_down += 1
                    if rebound:
                        n_after += 1
            except OSError:
                pass
        due = asked if ctrl is not None else time.time() - start > rebind_after
        if not rebound and due:
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
