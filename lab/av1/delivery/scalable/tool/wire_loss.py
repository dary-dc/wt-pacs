"""The loss a visit met, counted on the loopback wire rather than by the relay: every UDP datagram sent on `lo`
is counted by port pair until SIGTERM, then each direction's relayed count is set against what entered the relay.

    sudo python3 wire_loss.py out.json &   # around one visit of run.mjs; needs CAP_NET_RAW
"""
import json
import signal
import socket
import struct
import sys
from collections import Counter

ETH_P_ALL, PACKET_OUTGOING = 0x0003, 4


def legs(flows):
    """The relay's two socket pairs, and each direction's datagrams in → out: (server→client, client→server)."""
    pairs = {}
    for (a, b), n in flows.items():
        if (b, a) in flows:
            pairs.setdefault(frozenset((a, b)), {})[(a, b)] = n
    if len(pairs) != 2:
        raise SystemExit(f"expected the relay's two socket pairs, found {len(pairs)}: {sorted(flows.items())}")
    p, q = (sorted(d.values()) for d in pairs.values())
    down = sorted((p[1], q[1]), reverse=True)
    up = sorted((p[0], q[0]), reverse=True)
    return down, up


def main():
    out = sys.argv[1]
    s = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(ETH_P_ALL))
    s.bind(("lo", 0))
    flows = Counter()
    stop = []
    signal.signal(signal.SIGTERM, lambda *_: stop.append(1))
    s.settimeout(0.2)
    while not stop:
        try:
            frame, addr = s.recvfrom(65535)
        except (socket.timeout, InterruptedError):
            continue
        # Loopback frames carry a 14-byte Ethernet header; each datagram is seen once going out.
        if addr[2] != PACKET_OUTGOING or frame[12:14] not in (b"\x08\x00", b"\x86\xdd"):
            continue
        ip = frame[14:]
        if ip[0] >> 4 == 4:
            proto, udp = ip[9], ip[(ip[0] & 15) * 4:]
        else:
            proto, udp = ip[6], ip[40:]
        if proto == 17:
            flows[struct.unpack("!HH", udp[:4])] += 1
    down, up = legs(flows)
    res = {"s2c": {"in": down[0], "out": down[1], "lost": 1 - down[1] / down[0]},
           "c2s": {"in": up[0], "out": up[1], "lost": 1 - up[1] / up[0]},
           "flows": {f"{a}->{b}": n for (a, b), n in flows.items()}}
    with open(out, "w") as f:
        json.dump(res, f)


if __name__ == "__main__":
    main()
