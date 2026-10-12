#!/usr/bin/env python3
"""Throughput ceilings for quic-compared.md: window ÷ RTT per stack, and CUBIC's loss bound (RFC 9438 §5)."""
import math
import sys

MIB = 1 << 20
MSS = 1452  # bytes of a QUIC packet's payload budget on a 1 500-byte path, as quic.md §7.1 uses
RATES = [1, 5, 10, 50, 100, 500, 1000]  # Mbit/s
RTTS = [10, 30, 80, 150, 300]  # ms

# (stack, a fresh stream's first window, the steady one-stream window, both bytes at defaults; quic.md §7.2)
DEFAULTS = [
    ("quinn", 1_250_000, 1_250_000, "1.25 MB stream, fixed"),
    ("msquic", 64 * 1024, 16 * MIB, "64 KiB stream doubling to the 16 MiB connection window"),
    ("Cloudflare quiche", 1_000_000, 16 * MIB, "app-set start (tokio-quiche 1 MB), auto-tuned to 16 MiB"),
    ("ngtcp2", 16 * MIB, 16 * MIB, "app's; the example client's 16 MiB"),
    ("picoquic", 1 * MIB, None, "2 MiB stream, 1 MiB connection, auto-tuned without a cap"),
    ("Google QUICHE", 16_000, 16_000, "16 KB bare library"),
    ("Google QUICHE in Chromium", 6_000_000, 16_000_000, "6 MB stream auto-tuned to 16 MB"),
    ("neqo", 1 * MIB, 10 * MIB, "1 MiB stream auto-tuned to 10 MiB"),
    ("s2n-quic", 3_750_000, 3_750_000, "3.75 MB, fixed"),
    ("quic-go", 512 * 1024, 6 * MIB, "512 KiB stream auto-tuned to 6 MiB"),
    ("lsquic", 6 * MIB, 6 * MIB, "client 6 MiB stream, fixed"),
    ("mvfst", 65_535, 65_535, "65 KiB stream, auto-tune off"),
]


def fmt(x):
    return f"{x:,.0f}".replace(",", " ") if x >= 100 else f"{x:.3g}"


def window_mbps(window, rtt_ms):
    return window * 8 / (rtt_ms / 1000) / 1e6


def cubic_avg_window(p, rtt_s):
    """Segments: the larger of CUBIC's own (Figure 8, C = 0.4) and Reno's 1.2 ÷ √p, the RFC's Reno column."""
    return max(1.054 * rtt_s ** 0.75 / p ** 0.75, 1.2 / math.sqrt(p))


def cubic_mbps(p, rtt_ms):
    return cubic_avg_window(p, rtt_ms / 1000) * MSS * 8 / (rtt_ms / 1000) / 1e6


def cell(rate, window, rtt):
    if window is None:
        return "link"
    cap = window_mbps(window, rtt)
    return "link" if cap >= rate else f"**{fmt(cap)}**"


def check():
    assert round(window_mbps(1_250_000, 100)) == 100
    # RFC 9438 §5.1 Table 1 (RTT 0.1 s, C = 0.4) and Table 2 (RTT 0.01 s), average window in segments.
    for p, rtt, want in [(1e-2, 0.1, 12), (1e-4, 0.1, 187), (1e-6, 0.1, 5926), (1e-6, 0.01, 1200)]:
        got = cubic_avg_window(p, rtt)
        assert abs(got - want) / want < 0.01, (p, rtt, got, want)


def main():
    check()
    head = "| window | " + " | ".join(f"{r} ms" for r in RTTS) + " |"
    print("### window ÷ RTT, Mbit/s: a fresh stream's first window · the steady window\n")
    print(head)
    print("| --- |" + " --: |" * len(RTTS))
    for stack, first, w, _ in DEFAULTS:
        steady = ["none" if w is None else fmt(window_mbps(w, t)) for t in RTTS]
        caps = [s if first == w else f"{fmt(window_mbps(first, t))} · {s}" for t, s in zip(RTTS, steady)]
        print(f"| {stack} | " + " | ".join(caps) + " |")
    for stack, _, w, why in DEFAULTS:
        print(f"\n#### {stack}: {why}\n")
        print("| link \\ RTT | " + " | ".join(f"{t} ms" for t in RTTS) + " |")
        print("| --- |" + " --- |" * len(RTTS))
        for r in RATES:
            print(f"| {r} Mbit/s | " + " | ".join(cell(r, w, t) for t in RTTS) + " |")
    print("\n### CUBIC's loss bound, Mbit/s (one flow, random loss p)\n")
    print("| p \\ RTT | " + " | ".join(f"{t} ms" for t in RTTS) + " |")
    print("| --- |" + " --: |" * len(RTTS))
    for p in [1e-2, 1e-3, 1e-4, 1e-5, 1e-6]:
        print(f"| {p:g} | " + " | ".join(fmt(cubic_mbps(p, t)) for t in RTTS) + " |")


if __name__ == "__main__":
    sys.exit(main())
