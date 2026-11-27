#!/usr/bin/env python3
"""The wire, by arithmetic: packets, round trips and time of each package, raw and compressed, per link class.

usage: wire.py packages.jsonl     one JSON line per (series, kind, variant, protocol, class) on stdout
Every constant is an assumption the lab README labels; nothing here is measured.
"""
import json
import math
import sys

REQUEST_HEAD = 260
CLIENT_FLIGHT = 1500
TLS_RECORD, TLS_RECORD_OVERHEAD = 16384, 22
TCP_MSS, TCP_HEADERS, TCP_IW_SEGMENTS = 1448, 52, 10
QUIC_DATAGRAM, QUIC_PACKET_OVERHEAD, QUIC_IP_UDP = 1200, 36, 28
H3_HEAD = 120
LOSS_COST_RTT = 1.5

CLASSES = {
    "fiber": {"rtt": 0.010, "up_mbit": 100, "loss": 0.0},
    "4g5g": {"rtt": 0.060, "up_mbit": 19, "loss": 0.01},
    "geo": {"rtt": 0.600, "up_mbit": 2, "loss": 0.001},
    "adsl": {"rtt": 0.050, "up_mbit": 1, "loss": 0.001},
}


def quic_initial_window() -> int:
    """RFC 9002 §7.2."""
    return min(10 * QUIC_DATAGRAM, max(14720, 2 * QUIC_DATAGRAM))


def tcp_flight(body: int) -> tuple:
    """(packets, wire bytes) of the client's flight: its certificate and Finished, then the request."""
    plain = REQUEST_HEAD + body
    tls = CLIENT_FLIGHT + plain + math.ceil(plain / TLS_RECORD) * TLS_RECORD_OVERHEAD
    packets = math.ceil(tls / TCP_MSS)
    return packets, tls + packets * TCP_HEADERS


def quic_flight(body: int) -> tuple:
    payload = QUIC_DATAGRAM - QUIC_PACKET_OVERHEAD
    plain = CLIENT_FLIGHT + H3_HEAD + body
    packets = math.ceil(plain / payload)
    return packets, plain + packets * (QUIC_PACKET_OVERHEAD + QUIC_IP_UDP)


def rounds(packets: int, initial: int) -> list:
    """Packets per round trip under slow start from `initial` packets, doubling, no loss (RFC 5681 §3.1)."""
    out, cwnd = [], initial
    while packets > 0:
        out.append(min(cwnd, packets))
        packets -= out[-1]
        cwnd *= 2
    return out


def transfer(body: int, protocol: str, link: dict) -> dict:
    """Seconds from the first packet to the response: the handshakes, each round max(RTT, its serialisation)."""
    if protocol == "tcp":
        packets, wire = tcp_flight(body)
        handshake, initial = 2, TCP_IW_SEGMENTS
    else:
        packets, wire = quic_flight(body)
        handshake, initial = 1, quic_initial_window() // QUIC_DATAGRAM
    per_packet = wire / packets
    flights = rounds(packets, initial)
    rtt, rate = link["rtt"], link["up_mbit"] * 1e6 / 8
    seconds = handshake * rtt
    for n in flights[:-1]:
        seconds += max(rtt, n * per_packet / rate)
    seconds += flights[-1] * per_packet / rate + rtt
    loss = (1 - (1 - link["loss"]) ** packets) * LOSS_COST_RTT * rtt
    return {"packets": packets, "wire_bytes": wire, "round_trips": handshake + len(flights), "data_rounds": len(flights),
            "seconds": seconds + loss, "seconds_lossless": seconds}


def main() -> None:
    for line in open(sys.argv[1]):
        row = json.loads(line)
        for variant in ("raw", "zstd_1"):
            for protocol in ("tcp", "quic"):
                for name, link in CLASSES.items():
                    print(json.dumps({"series": row["series"], "kind": row["kind"], "variant": variant,
                                      "protocol": protocol, "class": name, "bytes": row["bytes"][variant],
                                      **transfer(row["bytes"][variant], protocol, link)}))


if __name__ == "__main__":
    main()
