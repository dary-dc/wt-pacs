"""The relay's delay as seen on loopback: every UDP datagram into and out of the relay's client port, paired by payload.

    python3 wire_delay.py RELAY_PORT SECONDS [--out pairs.tsv]

Needs CAP_NET_RAW (an AF_PACKET socket on lo). Prints, per direction, the transit's quantiles in ms and how many
datagrams left out of the order they arrived; with --out, one `direction arrival_s transit_ms` line per datagram.
"""
import argparse
import socket
import struct
import time

ETH_P_ALL = 3


def quantile(xs, q):
    return xs[min(len(xs) - 1, int(q * len(xs)))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("relay_port", type=int)
    ap.add_argument("seconds", type=float)
    ap.add_argument("--out")
    args = ap.parse_args()
    s = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.ntohs(ETH_P_ALL))
    s.bind(("lo", 0))
    s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 64 << 20)
    s.settimeout(0.5)
    first = {}
    pairs = {"to_client": [], "to_server": []}
    end = time.monotonic() + args.seconds
    while time.monotonic() < end:
        try:
            frame, meta = s.recvfrom(70000)
        except socket.timeout:
            continue
        now = time.monotonic()
        # lo delivers each datagram once as outgoing (pkttype 4); count only that copy.
        if meta[2] != 4 or len(frame) < 42 or frame[12:14] != b"\x08\x00" or frame[23] != 17:
            continue
        ihl = (frame[14] & 15) * 4
        sport, dport = struct.unpack("!HH", frame[14 + ihl:18 + ihl])
        payload = frame[22 + ihl:]
        key = hash(payload)
        if key in first:
            t0, direction = first.pop(key)
            pairs[direction].append((t0, (now - t0) * 1000))
        elif dport == args.relay_port:
            first[key] = (now, "to_server")
        elif sport != args.relay_port:
            first[key] = (now, "to_client")
    for direction, rows in pairs.items():
        transits = sorted(t for _, t in rows)
        if not transits:
            print(direction, "none")
            continue
        departures = [a + t / 1000 for a, t in sorted(rows)]
        overtaken = sum(1 for i in range(1, len(departures)) if departures[i] < departures[i - 1] - 1e-4)
        print("%s n %d transit ms min %.1f p10 %.1f p50 %.1f p90 %.1f max %.1f, out of order %d" % (
            direction, len(transits), transits[0], quantile(transits, 0.1), quantile(transits, 0.5),
            quantile(transits, 0.9), transits[-1], overtaken))
    if args.out:
        with open(args.out, "w") as f:
            for direction, rows in pairs.items():
                for a, t in rows:
                    f.write("%s %.6f %.3f\n" % (direction, a, t))


if __name__ == "__main__":
    main()
