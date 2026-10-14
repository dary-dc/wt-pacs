#!/usr/bin/env python3
"""Several streams against one across a wide range of links, for quic-compared.md §9.6 (row 193, STREAMSWIDE)."""
import math

from quic_grid import MSS, cubic_avg_window
from quic_streams import CREDIT_CONN, CREDIT_STREAM, M, bps

DBT = 13_600_000  # bytes: the 10-bit DBT volume row 180 filled (24 frames)
FRAMES = [32_000, 250_000, 1_000_000]  # bytes: a small CT or MR frame, a DBT projection, a mammogram
RATES = [1, 5, 18, 103, 309, 1000]  # Mbit/s
RTTS = [5, 26, 46, 92, 300]  # ms, idle
LOSSES = [1e-4, 1e-3, 1e-2, 1e-1]
BURSTS = [1, 3.5, 7]  # packets a loss event: iid, lte-good, the relay's default


def queue_ms(queue, rate):
    """A queue given as packets (int) or ms (float), in ms of delay when full."""
    return queue * MSS / bps(rate) * 1e3 if isinstance(queue, int) else queue


def link(rate, rtt, queue, p, burst, cc):
    """(rate the fill gets in bytes/s, loaded RTT in ms). Cubic: the loss-limited window unless the link binds first."""
    if cc == "cubic":
        loss_bound = cubic_avg_window(p / burst, rtt / 1e3) * MSS / (rtt / 1e3) if p > 0 else math.inf
        if loss_bound < bps(rate):
            return loss_bound, rtt
        return bps(rate), rtt + queue_ms(queue, rate)
    # A loss-blind model controller (BBRv1's shape): the link's rate, a queue of at most one idle RTT.
    return bps(rate) * (1 - p), rtt + min(queue_ms(queue, rate), rtt)


def repair_ms(x, loaded):
    """A gap's hold at the receiver: three later packets to declare it (RFC 9002 §6.1.1), then a loaded RTT."""
    return loaded + 3 * MSS / x * 1e3


def held_delay_ms(lam, t, span):
    """Mean wait of a frame for a repair, losses Poisson at `lam`/s, each holding the stream `t` s;
    only losses within `span` s before the frame's last byte can hold it."""
    if lam == 0:
        return 0.0
    if span >= t:
        return (t - (1 - math.exp(-lam * t)) / lam) * 1e3
    tail = t - span  # d in [0, tail]: the window is the whole span; d in [tail, t]: it is t - d
    first = tail * (1 - math.exp(-lam * span))
    second = span - (1 - math.exp(-lam * span)) / lam
    return (first + second) * 1e3


def hol(rate, rtt, queue, p, burst, cc, frame):
    """Per frame: (mean hold on one stream, on one stream a frame sent in order, frames held per loss event,
    the share of time one stream is held), ms and ratios."""
    x, loaded = link(rate, rtt, queue, p, burst, cc)
    t = repair_ms(x, loaded) / 1e3
    lam = p / burst * x / MSS
    return (held_delay_ms(lam, t, t), held_delay_ms(lam, t, frame / x), x * t / frame, 1 - math.exp(-lam * t))


def interleave_ms(k, frame, x):
    """Mean extra wait a frame pays when k equal-priority streams share the link instead of taking turns."""
    return (k - 1) * frame / (2 * x) * 1e3


def credit_stall_ms(rate, rtt, queue, p, burst, cc, credit, size=DBT):
    """Extra fill time from the credit: credit ÷ loaded RTT bounds the rate, and credit ÷ (hold + RTT) while held."""
    x, loaded = link(rate, rtt, queue, p, burst, cc)
    t = repair_ms(x, loaded) / 1e3
    held = 1 - math.exp(-p / burst * x / MSS * t)
    open_ = min(x, credit / (loaded / 1e3))
    capped = min(open_, credit / (t + loaded / 1e3))
    return size * ((1 - held) / open_ + held / capped - 1 / x) * 1e3


def fill_s(rate, rtt, queue, p, burst, cc, connections=1):
    x, _ = link(rate, rtt, queue, p, burst, cc)
    return size_s(min(bps(rate), connections * x))


def size_s(x, size=DBT):
    return size / x


def ask_ms(rate, rtt, queue, p, burst, cc, ahead_kind, frame=M // 2):
    """An ask during a fill at its half: what is ahead of it per design, all crossing at the fill's rate."""
    x, loaded = link(rate, rtt, queue, p, burst, cc)
    cwnd = x * loaded / 1e3
    ahead = {"shared": min(CREDIT_STREAM, DBT / 2), "window": min(CREDIT_STREAM, cwnd + M), "asks first": cwnd}
    return rtt + (ahead[ahead_kind] + frame) / x * 1e3


def check():
    assert queue_ms(10, 8) == 10 * MSS / 1e3 and queue_ms(20.0, 8) == 20.0
    x, loaded = link(103, 46, 20.0, 0.01, 1, "cubic")  # row 180's loss cells: ~3 Mbit/s whatever the rate
    assert 2.9e6 < x * 8 < 3.2e6 and loaded == 46
    assert link(103, 46, 360.0, 0, 1, "cubic") == (bps(103), 406)
    assert link(103, 46, 360.0, 0.01, 1, "bbr") == (bps(103) * 0.99, 92)
    lam, t = 10.0, 0.1  # one loss a 100 ms, each holding 100 ms
    assert abs(held_delay_ms(lam, t, t) - (100 - 1e3 * (1 - math.exp(-1)) / 10)) < 1e-9
    assert held_delay_ms(lam, t, 0) == 0 and held_delay_ms(0, t, t) == 0
    assert abs(held_delay_ms(lam, t, 0.05) - 1e3 * (0.05 * (1 - math.exp(-0.5)) + 0.05 - (1 - math.exp(-0.5)) / 10)) < 1e-9
    assert repair_ms(MSS * 1000, 50) == 53  # 1 000 packets a second: three of them, 3 ms
    assert link(103, 46, 20.0, 0.01, 7, "cubic")[0] > 2.5 * link(103, 46, 20.0, 0.01, 1, "cubic")[0]
    assert held_delay_ms(lam, t, 0.05) < held_delay_ms(lam, t, 0.1) == held_delay_ms(lam, t, 1.0)
    assert interleave_ms(1, 250_000, 1e6) == 0 and interleave_ms(3, 250_000, 1e6) == 250
    assert credit_stall_ms(103, 46, 20.0, 0.01, 1, "bbr", CREDIT_STREAM) == 0
    assert credit_stall_ms(309, 92, 360.0, 0.001, 1, "bbr", CREDIT_STREAM) > 0
    assert credit_stall_ms(309, 92, 360.0, 0.001, 1, "bbr", CREDIT_CONN) == 0
    assert credit_stall_ms(309, 92, 360.0, 0, 1, "bbr", CREDIT_STREAM) > 0  # 6 MiB ÷ 184 ms is under 309 Mbit/s
    assert hol(103, 46, 20.0, 0.01, 7, "bbr", 250_000)[3] < hol(103, 46, 20.0, 0.01, 1, "bbr", 250_000)[3]
    assert fill_s(8, 46, 20.0, 0, 1, "cubic") == DBT / 1e6
    assert abs(fill_s(103, 46, 20.0, 0.01, 1, "cubic", 4) * 4 - fill_s(103, 46, 20.0, 0.01, 1, "cubic")) < 1e-9


def table(head, rows):
    print("| " + " | ".join(head) + " |")
    print("| --- |" + " --: |" * (len(head) - 1))
    for r in rows:
        print("| " + " | ".join(r) + " |")


def main():
    check()
    print("\n### The rate a Cubic fill gets, Mbit/s (iid loss; 'link' where the link binds first)\n")
    for rtt in [26, 92, 300]:
        print(f"Idle RTT {rtt} ms:\n")
        rows = []
        for p in LOSSES:
            cells = []
            for r in RATES:
                x, _ = link(r, rtt, 20.0, p, 1, "cubic")
                cells.append("link" if x == bps(r) else f"{x * 8 / 1e6:.3g}")
            rows.append([f"{p:g}"] + cells)
        table(["loss"] + [f"{r} Mbit/s" for r in RATES], rows)
        print()

    print("\n### One stream's hold under loss, 250 kB frames, FIFO 20 ms: frames held per loss event · "
          "share of time held · mean hold a frame on one stream → on one stream a frame, ms\n")
    for cc in ["cubic", "bbr"]:
        print(f"{'Cubic' if cc == 'cubic' else 'A loss-blind controller'}, idle RTT 46 ms, iid:\n")
        rows = []
        for p in LOSSES:
            cells = []
            for r in RATES:
                s, pf, held, share = hol(r, 46, 20.0, p, 1, cc, 250_000)
                cells.append(f"{held:.2g} · {share:.0%} · {s:.0f} → {pf:.0f}")
            rows.append([f"{p:g}"] + cells)
        table(["loss"] + [f"{r} Mbit/s" for r in RATES], rows)
        print()

    print("\n### One stream a frame's gain in mean time to a frame, ms (loss 0.1 %, FIFO 20 ms; "
          "rate · idle RTT)\n")
    rows = []
    for cc in ["cubic", "bbr"]:
        for frame in FRAMES:
            for burst in [1, 7]:
                cells = []
                for rtt in [26, 92, 300]:
                    for r in [18, 103, 1000]:
                        s, pf, _, _ = hol(r, rtt, 20.0, 1e-3, burst, cc, frame)
                        cells.append(f"{s - pf:.0f}")
                rows.append([cc, f"{frame // 1000} kB", f"{burst:g}"] + cells)
    table(["controller", "frame", "burst"] + [f"{r} · {t}" for t in [26, 92, 300] for r in [18, 103, 1000]], rows)

    print("\n### What k equal-priority streams cost a frame by interleaving, ms (Cubic, idle RTT 46 ms, "
          "250 kB frames)\n")
    rows = []
    for p in [0, 1e-3, 1e-2]:
        x18, _ = link(18, 46, 20.0, p, 1, "cubic")
        x103, _ = link(103, 46, 20.0, p, 1, "cubic")
        rows.append([f"{p:g}"] + [f"{interleave_ms(k, 250_000, x):.0f}" for x in [x18, x103] for k in [2, 4, 8]])
    table(["loss"] + [f"{r} Mbit/s, k = {k}" for r in [18, 103] for k in [2, 4, 8]], rows)

    print("\n### A fill's end: extra time from the credit, one stream's 6 MiB → a stream a frame's 15 MiB, s "
          "(the 13.6 MB volume, FIFO 360 ms)\n")
    rows = []
    for cc in ["cubic", "bbr"]:
        for rtt in [46, 92, 300]:
            cells = []
            for r in [103, 309, 1000]:
                for p in [1e-3, 1e-2]:
                    one = credit_stall_ms(r, rtt, 360.0, p, 1, cc, CREDIT_STREAM) / 1e3
                    per = credit_stall_ms(r, rtt, 360.0, p, 1, cc, CREDIT_CONN) / 1e3
                    cells.append(f"{round(max(0, one), 3):.2g} → {round(max(0, per), 3):.2g} of {fill_s(r, rtt, 360.0, p, 1, cc):.2g}")
            rows.append([cc, f"{rtt} ms"] + cells)
    table(["controller", "idle RTT"] + [f"{r} Mbit/s, {p:g}" for r in [103, 309, 1000] for p in [1e-3, 1e-2]], rows)

    print("\n### A fill under random loss, s: one Cubic connection, k Cubic connections, a loss-blind controller "
          "(13.6 MB, idle RTT 46 ms)\n")
    rows = []
    for p in LOSSES:
        for r in [18, 103, 309]:
            cells = [f"{fill_s(r, 46, 20.0, p, 1, 'cubic', k):.3g}" for k in [1, 2, 4, 8]]
            rows.append([f"{p:g}", f"{r}"] + cells + [f"{fill_s(r, 46, 20.0, p, 1, 'bbr'):.3g}"])
    table(["loss", "Mbit/s", "1", "2", "4", "8", "loss-blind"], rows)

    print("\n### Row 180's loss cells: the ask during a fill, ms, this model against the measured median\n")
    measured = {(18, 46): (20_954, 5_315, 1_792), (103, 46): (20_099, 5_246, 1_707), (309, 46): (20_258, 5_233, 1_728),
                (309, 92): (39_587, 11_006, 3_060)}
    rows = []
    for (r, rtt), got in measured.items():
        model = [ask_ms(r, rtt, 20.0, 0.01, 1, "cubic", k) for k in ["shared", "window", "asks first"]]
        rows.append([f"{r} Mbit/s, {rtt} ms"] + [f"{m:,.0f} / {g:,} (×{g / m:.2f})" for m, g in zip(model, got)])
    table(["cell, 1 % loss", "shared", "window", "asks first"], rows)


if __name__ == "__main__":
    main()
