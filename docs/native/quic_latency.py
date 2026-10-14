#!/usr/bin/env python3
"""Latency terms for quic-compared.md §Latency: first frame, an ask, loss repair (RFC 9002 §6), over rate × RTT × loss."""
from quic_grid import MSS, RATES, RTTS, cubic_mbps, fmt

FRAME = 512 * 512 * 2  # bytes: one 512² 16-bit slice, uncompressed
LOSSES = [1e-4, 1e-3, 1e-2]
TIME_THRESHOLD = 9 / 8  # RFC 9002 §6.1.2
GRANULARITY_MS = 1  # RFC 9002 §6.1.2


def pto_ms(srtt, rttvar, max_ack_delay):
    """RFC 9002 §6.2.1."""
    return srtt + max(4 * rttvar, GRANULARITY_MS) + max_ack_delay


def handshake_pto_ms(initial_rtt):
    """Before any RTT sample: srtt = initial, rttvar = initial ÷ 2, no ack delay (RFC 9002 §5.3, §6.2.1)."""
    return pto_ms(initial_rtt, initial_rtt / 2, 0)


def serialize_ms(nbytes, rate_mbps):
    return nbytes * 8 / (rate_mbps * 1e3)


def transfer_ms(nbytes, rate_mbps, rtt, initial_window):
    """Slow start from the initial window: a round trip per window until the window covers the rest or the BDP."""
    bdp = rate_mbps * 1e3 / 8 * rtt
    cwnd, left, t = initial_window, nbytes, 0.0
    while left > cwnd and cwnd < bdp:
        left -= cwnd
        cwnd *= 2
        t += rtt
    return t + serialize_ms(left, rate_mbps)


def first_frame_ms(rate_mbps, rtt, initial_window, handshake_rtts):
    """handshake_rtts round trips, then the ask's round trip, then the transfer."""
    return handshake_rtts * rtt + rtt + transfer_ms(FRAME, rate_mbps, rtt, initial_window)


def ask_ms(rate_mbps, rtt):
    """A warm connection whose window covers the frame: a round trip and the frame's serialization."""
    return rtt + serialize_ms(FRAME, rate_mbps)


def loss_penalty_ms(rate_mbps, rtt, p, max_ack_delay):
    """Expected delay a loss adds to an ask: the last packet lost waits a PTO; a loss among the other packets of the
    frame's last round trip waits the time threshold; earlier losses are repaired before the frame ends."""
    packets = -(-FRAME // MSS)
    last_round = min(packets - 1, int(rate_mbps * 1e3 / 8 * rtt // MSS))
    any_in_last_round = 1 - (1 - p) ** last_round
    return p * pto_ms(rtt, 0, max_ack_delay) + (1 - p) * any_in_last_round * TIME_THRESHOLD * rtt


def check():
    assert round(handshake_pto_ms(333)) == 999  # RFC 9002 §6.2.2: "a PTO of 1 second"
    assert pto_ms(100, 0, 25) == 126
    assert FRAME == 524_288
    assert transfer_ms(10, 10, 100, 12_000) == serialize_ms(10, 10)
    assert transfer_ms(36_000, 1000, 100, 12_000) == 100 + serialize_ms(24_000, 1000)  # 12 000 B, then 24 000 B
    assert transfer_ms(84_000, 1000, 100, 12_000) == 200 + serialize_ms(48_000, 1000)
    assert loss_penalty_ms(10, 10, 0, 25) == 0
    assert loss_penalty_ms(1000, 300, 1, 25) == pto_ms(300, 0, 25)
    small_p = 1e-6 * (326 + 361 * 9 / 8 * 300)  # 362 packets, 361 in the last round trip
    assert abs(loss_penalty_ms(1000, 300, 1e-6, 25) - small_p) / small_p < 1e-3
    assert abs(loss_penalty_ms(1000, 300, 0.5, 25) - (0.5 * 326 + 0.5 * 9 / 8 * 300)) < 0.01  # at most one repair wait


def grid(title, f):
    print(f"\n### {title}\n")
    print("| link \\ RTT | " + " | ".join(f"{t} ms" for t in RTTS) + " |")
    print("| --- |" + " --: |" * len(RTTS))
    for r in RATES:
        print(f"| {r} Mbit/s | " + " | ".join(fmt(f(r, t)) for t in RTTS) + " |")


def main():
    check()
    print("### Handshake PTO, ms, by initial RTT\n")
    for rtt0 in [50, 100, 250, 333]:
        print(f"* {rtt0} ms → {fmt(handshake_pto_ms(rtt0))} ms")
    print("\n### PTO after the handshake, ms (srtt = RTT, rttvar → 0), by the peer's max_ack_delay\n")
    print("| max_ack_delay \\ RTT | " + " | ".join(f"{t} ms" for t in RTTS) + " |")
    print("| --- |" + " --: |" * len(RTTS))
    for mad in [26, 25, 20, 10, 1]:
        print(f"| {mad} ms | " + " | ".join(fmt(pto_ms(t, 0, mad)) for t in RTTS) + " |")
    grid("A frame on a fresh connection, ms: 1-RTT handshake, initial window 12 000 B",
         lambda r, t: first_frame_ms(r, t, 12_000, 1))
    grid("An ask on a warm connection, clean link, ms", ask_ms)
    for p in LOSSES:
        grid(f"Expected delay a loss adds to an ask at p = {p:g}, ms, max_ack_delay 25 ms",
             lambda r, t, p=p: loss_penalty_ms(r, t, p, 25))
    grid("An ask at p = 1e-2 behind a CUBIC sender (its rate capped by quic_grid.py's loss bound), ms",
         lambda r, t: t + serialize_ms(FRAME, min(r, cubic_mbps(1e-2, t))) + loss_penalty_ms(r, t, 1e-2, 25))


if __name__ == "__main__":
    main()
