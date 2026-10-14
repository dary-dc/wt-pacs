#!/usr/bin/env python3
"""The fill's re-issue after an ask, for link-conditions.md §Re-measured, ASKTHENFILL (row 202)."""
import math

from quic_grid import MSS, cubic_avg_window
from quic_streams import CREDIT_STREAM, bps

DBT = 13_600_000  # bytes: dbt10_ea1141, the 24-frame volume row 171 filled
ASKED = 571_632  # bytes: the asked frame, the volume's largest (row 171's M ÷ 2)
FRAMES = [32_000, 250_000, 571_632, 1_000_000]  # bytes: CT or MR, a DBT projection, the asked one, a mammogram
RATES = [1, 5, 18, 103, 309, 1000]  # Mbit/s
RTTS = [5, 26, 46, 92, 300]  # ms, idle
DELIVERED = {18: 17.6, 103: 98.9}  # Mbit/s the rig's relay delivered asked these (row 181)

# Row 171's cells: (Mbit/s, idle RTT ms, queue) → (fill ms today, fill ms window, MB ahead under the window).
ROW171 = {
    (18, 46, "FIFO 20"): (6_486, 6_518, 1.71), (18, 46, "FIFO 360"): (6_337, 6_384, 1.71),
    (18, 46, "FIFO 800"): (6_338, 6_393, 3.43), (18, 46, "CoDel"): (6_813, 6_782, 1.71),
    (18, 92, "FIFO 20"): (6_841, 6_938, 1.71), (18, 92, "FIFO 360"): (6_593, 6_687, 2.29),
    (18, 92, "FIFO 800"): (6_593, 6_687, 4.56), (18, 92, "CoDel"): (7_372, 7_414, 1.71),
    (103, 46, "FIFO 20"): (1_388, 1_458, 2.29), (103, 46, "FIFO 360"): (1_383, 1_387, 6.26),
    (103, 46, "FIFO 800"): (1_384, 1_386, 6.26), (103, 46, "CoDel"): (1_390, 1_491, 2.86),
    (103, 92, "FIFO 20"): (1_871, 2_079, 2.29), (103, 92, "FIFO 360"): (1_786, 1_786, 6.26),
    (103, 92, "FIFO 800"): (1_782, 1_781, 6.26), (103, 92, "CoDel"): (1_910, 2_074, 3.71),
}


def rate(mbps, rtt, p=0.0):
    """Bytes/s a fill gets: the link, or Cubic's loss-limited window over the idle RTT if that binds first."""
    if p == 0:
        return bps(mbps)
    return min(bps(mbps), cubic_avg_window(p, rtt / 1e3) * MSS / (rtt / 1e3))


def gap_settled_ms(rtt):
    """Today: the remainder is asked once the asked frame's last byte lands, so the link idles a whole round trip."""
    return rtt


def gap_head_ms(rtt, asked, x):
    """Re-issued on the asked frame's head: its own bytes, asked ÷ x, still drain while the re-issue travels."""
    return max(0.0, rtt - asked / x * 1e3)


def duplicate_ms(ahead, x):
    """Re-issued with the ask itself: no gap, but everything already written ahead of the ask comes again."""
    return ahead / x * 1e3


def remainder(fill, at, ahead):
    """Bytes of the fill not yet written when the ask's frame is: what a re-issue must ask for."""
    return max(0.0, fill * (1 - at) - ahead - ASKED)


def check():
    x = bps(DELIVERED[18])
    assert gap_settled_ms(92) == 92
    assert gap_head_ms(92, ASKED, x) == 0  # 260 ms of the asked frame covers a 92 ms round trip
    assert 45 < ASKED / bps(DELIVERED[103]) * 1e3 < 47
    assert 45 < gap_head_ms(92, ASKED, bps(DELIVERED[103])) < 47
    assert gap_head_ms(46, 32_000, bps(103)) > 43  # a small frame covers almost none of it
    assert abs(duplicate_ms(1.71e6, x) - 777) < 1
    assert rate(103, 26, 0.01) * 8 < 5.4e6 and rate(103, 26) == bps(103)
    assert remainder(DBT, 0.5, CREDIT_STREAM) == 0  # row 171's today: nothing left to re-issue at 50 %
    assert remainder(DBT, 0.1, CREDIT_STREAM) > 4e6 and remainder(DBT, 0.5, 1.71e6) > 4e6


def table(head, rows):
    print("| " + " | ".join(head) + " |")
    print("| --- |" + " --: |" * (len(head) - 1))
    for r in rows:
        print("| " + " | ".join(r) + " |")


def main():
    check()
    print("### Row 171's cells: the window's fill cost against one idle round trip, and each re-issue's (ms)\n")
    rows = []
    for (r, rtt, q), (today, window, ahead) in ROW171.items():
        x = bps(DELIVERED[r])
        rows.append([f"{r}, {rtt}, {q}", f"{window - today:+,}", f"{gap_settled_ms(rtt)}",
                     f"{gap_head_ms(rtt, ASKED, x):.0f}", f"{duplicate_ms(ahead * 1e6, x):,.0f}"])
    table(["Mbit/s, RTT, queue", "measured window − today", "gap, settled", "gap, on the head", "with the ask"], rows)

    print("\n### Today at 10 % and 50 % of the fill: bytes left to re-issue (MB)\n")
    rows = [[f"{at:.0%}", f"{remainder(DBT, at, CREDIT_STREAM) / 1e6:.2f}", f"{remainder(DBT, at, 1.71e6) / 1e6:.2f}"]
            for at in [0.1, 0.5]]
    table(["ask at", "today (6 MiB ahead)", "window (1.71 MB ahead)"], rows)

    print("\n### What is left of a one-RTT gap on the head, ms (frame · Mbit/s; idle RTT)\n")
    rows = []
    for f in FRAMES:
        for r in RATES:
            rows.append([f"{f // 1000} kB · {r}"] + [f"{gap_head_ms(rtt, f, rate(r, rtt)):.0f}" for rtt in RTTS])
    table(["frame · Mbit/s"] + [f"{rtt}" for rtt in RTTS], rows)
    worst = max(gap_head_ms(rtt, f, rate(r, rtt, 0.01)) for f in FRAMES for r in RATES for rtt in RTTS)
    print(f"\nAt 1 % loss Cubic's own rate leaves at most {worst:.0f} ms of it anywhere above.")

if __name__ == "__main__":
    main()
