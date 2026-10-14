#!/usr/bin/env python3
"""Throughput ceilings for quic-compared.md: window ÷ RTT per stack, and CUBIC's loss bound (RFC 9438 §5.1)."""
import math

MIB = 1 << 20
MSS = 1452  # bytes of a QUIC packet's payload budget on a 1 500-byte path, as quic.md §7.1 uses
RATES = [1, 5, 10, 50, 100, 500, 1000]  # Mbit/s
RTTS = [10, 30, 80, 150, 300]  # ms

# The client's receive window for a server-opened unidirectional stream, bytes at the pins (quic-compared.md §6):
# (stack, the first window, the window auto-tuning reaches or None for no cap).
DEFAULTS = [
    ("quinn", 1_250_000, 1_250_000),
    ("msquic", 64 * 1024, 16 * MIB),
    ("Cloudflare quiche (tokio-quiche)", 1_000_000, 16 * MIB),
    ("ngtcp2 (example client)", 16 * MIB, 16 * MIB),
    ("picoquic", 65_535, None),
    ("Google QUICHE, client", 16 * 1024, 16 * 1024),
    ("neqo", 1 * MIB, 10 * MIB),
    ("s2n-quic", 3_750_000, 3_750_000),
    ("quic-go", 512 * 1024, 6 * MIB),
    ("lsquic, client", 32 * 1024, 32 * 1024),
    ("mvfst", 66_560, 66_560),
]

# Stream windows no setting raises cleanly (quic-compared.md §3.1): neqo's constant cap, and Google QUICHE's
# kStreamReceiveWindowLimit, above which a debug build's check fails.
BEST_BY_SETTING = [("neqo", 10 * MIB), ("Google QUICHE", 16 * MIB)]


def fmt(x):
    return f"{x:,.0f}".replace(",", " ") if x >= 100 else f"{x:.3g}"


def window_mbps(window, rtt_ms):
    return window * 8 / (rtt_ms / 1000) / 1e6


def bdp_bytes(rate_mbps, rtt_ms):
    return rate_mbps * 1e6 / 8 * rtt_ms / 1000


def cubic_avg_window(p, rtt_s):
    """Segments: the larger of CUBIC's Figure 8 (C = 0.4) and Reno's 1.2 ÷ √p, which reproduces Table 1's Reno column."""
    return max(1.054 * rtt_s ** 0.75 / p ** 0.75, 1.2 / math.sqrt(p))


def cubic_mbps(p, rtt_ms):
    return cubic_avg_window(p, rtt_ms / 1000) * MSS * 8 / (rtt_ms / 1000) / 1e6


def cell(rate, window, rtt):
    cap = window_mbps(window, rtt)
    return "link" if cap >= rate else f"**{fmt(cap)}**"


def check():
    assert round(window_mbps(1_250_000, 100)) == 100
    assert bdp_bytes(max(RATES), max(RTTS)) == 37_500_000
    # RFC 9438 §5.1 Table 1 (RTT 0.1 s) and Table 2 (RTT 0.01 s), C = 0.4, average window in segments.
    for p, rtt, want in [(1e-2, 0.1, 12), (1e-4, 0.1, 187), (1e-6, 0.1, 5926), (1e-6, 0.01, 1200)]:
        got = cubic_avg_window(p, rtt)
        assert abs(got - want) / want < 0.01, (p, rtt, got, want)


def main():
    check()
    print(f"grid's largest BDP: {bdp_bytes(max(RATES), max(RTTS)) / 1e6:g} MB\n")
    print("### Defaults: window ÷ RTT, Mbit/s, first window · the window auto-tuning reaches\n")
    print("| stack | " + " | ".join(f"{t} ms" for t in RTTS) + " |")
    print("| --- |" + " --: |" * len(RTTS))
    for stack, first, top in DEFAULTS:
        caps = []
        for t in RTTS:
            steady = "no cap" if top is None else fmt(window_mbps(top, t))
            caps.append(steady if first == top else f"{fmt(window_mbps(first, t))} · {steady}")
        print(f"| {stack} | " + " | ".join(caps) + " |")
    for stack, w in BEST_BY_SETTING:
        print(f"\n### {stack} at its best by setting, {w} B\n")
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
    main()
