#!/usr/bin/env python3
"""Stream designs for quic-compared.md §Streams: what an ask waits behind during a fill, and the window ceilings."""
from quic_grid import MIB

CREDIT_STREAM = 6 * MIB  # Chromium's window per incoming uni stream, net/quic/quic_context.cc:22
CREDIT_CONN = 15 * MIB  # Chromium's connection window, net/quic/quic_context.cc:21
SEND_WINDOW = 10_000_000  # quinn's default send_window, quinn-proto/src/config/transport.rs:379
M = 1_100_000  # bytes: two of the 10-bit DBT volume's largest frames (link-conditions.md, ASKAHEAD)
F = M // 2  # bytes: the asked frame
RATES = [18, 103, 309]  # Mbit/s: cellular p10 · p50 · p90 (link-conditions.md §Link profiles)
RTTS = [46, 92]  # ms, idle: the ASKAHEAD cells
QUEUES = [20, 360, 800]  # ms of FIFO at the bottleneck
LOADED = [200, 400, 800]  # ms of RTT when another flow holds the queue


def bps(mbps):
    return mbps * 1e6 / 8


def cwnd(rate, rtt_ms, queue_ms, cap):
    """A loss-based controller fills the path and the queue, up to what the sender may have unacknowledged."""
    return min(cap, bps(rate) * (rtt_ms + queue_ms) / 1e3)


def ask_ms(ahead, rate, rtt_ms):
    """The asked frame leaves behind `ahead` bytes, all of which cross the bottleneck first."""
    return rtt_ms + (ahead + F) / bps(rate) * 1e3


def designs(rate, rtt, queue):
    """Bytes ahead of the ask, per design. Shared: the stream credit binds; per-frame: quinn's send window."""
    shared_cap = min(CREDIT_STREAM, SEND_WINDOW)
    per_frame_cap = min(CREDIT_CONN, SEND_WINDOW)
    return {
        "shared, today": shared_cap,
        "shared, send window = cwnd + M": min(shared_cap, cwnd(rate, rtt, queue, shared_cap) + M),
        "per-frame, ask-order priority (today's flag)": per_frame_cap,
        "per-frame, an ask above the fill": cwnd(rate, rtt, queue, per_frame_cap),
    }


def held_frames(rate, rtt_ms, queue_ms, frame):
    """Frames of the shared stream that arrive while a lost packet is repaired, about one loaded RTT."""
    return bps(rate) * (rtt_ms + queue_ms) / 1e3 / frame


def credit_covers_repair(rate, rtt_ms, queue_ms, credit):
    """The sender keeps sending through a repair while the credit holds the window and one more RTT of data."""
    return credit >= 2 * bps(rate) * (rtt_ms + queue_ms) / 1e3


def window_mbps(window, rtt_ms):
    return window * 8 / rtt_ms / 1e3


def check():
    assert CREDIT_STREAM == 6_291_456 and CREDIT_CONN == 15_728_640
    assert abs(ask_ms(0, 8, 0) - F / 1e3) < 1e-9  # 8 Mbit/s is 1 000 bytes a ms
    assert cwnd(100, 50, 0, 1e12) == 625_000
    assert cwnd(100, 50, 1e6, 7) == 7
    d = designs(103, 46, 800)
    assert d["shared, send window = cwnd + M"] == d["shared, today"]  # a deep FIFO: the credit binds either way
    assert d["per-frame, an ask above the fill"] == SEND_WINDOW
    assert held_frames(8, 500, 500, 1000) == 1000
    assert credit_covers_repair(8, 50, 0, 100_000) and not credit_covers_repair(8, 50, 1, 100_000)


def main():
    check()
    for rtt in RTTS:
        print(f"\n### An ask during a fill, ms: idle RTT {rtt} ms, F = {F} B, M = {M} B\n")
        names = list(designs(18, rtt, 20))
        print("| design | " + " | ".join(f"{r} Mbit/s, {q} ms queue" for q in QUEUES for r in RATES) + " |")
        print("| --- |" + " --: |" * (len(QUEUES) * len(RATES)))
        for n in names:
            cells = [ask_ms(designs(r, rtt, q)[n], r, rtt) for q in QUEUES for r in RATES]
            print(f"| {n} | " + " | ".join(f"{c:,.0f}" for c in cells) + " |")
    print("\n### Under loss on the shared stream, short queue (20 ms): frames of 250 kB held per loss, "
          "and whether 6 MiB of credit covers a repair\n")
    print("| idle RTT | " + " | ".join(f"{r} Mbit/s" for r in RATES) + " |")
    print("| --- |" + " --- |" * len(RATES))
    for rtt in RTTS:
        print(f"| {rtt} ms | " + " | ".join(
            f"{held_frames(r, rtt, 20, 250_000):.1f}; {'yes' if credit_covers_repair(r, rtt, 20, CREDIT_STREAM) else 'no'}"
            for r in RATES) + " |")
    print("\n### Window ÷ RTT, Mbit/s, when another flow holds the queue\n")
    print("| window | " + " | ".join(f"{t} ms" for t in RTTS + LOADED) + " |")
    print("| --- |" + " --: |" * (len(RTTS) + len(LOADED)))
    for name, w in [("one stream, 6 MiB", CREDIT_STREAM), ("the connection, 15 MiB", CREDIT_CONN),
                    ("quinn's send window, 10 MB", SEND_WINDOW)]:
        print(f"| {name} | " + " | ".join(f"{window_mbps(w, t):,.0f}" for t in RTTS + LOADED) + " |")


if __name__ == "__main__":
    main()
