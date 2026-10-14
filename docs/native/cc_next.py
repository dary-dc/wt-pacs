#!/usr/bin/env python3
"""Congestion control beyond Cubic and BBR on the target's links, for transport-conclusions.md §1 (row 200, CCNEXT)."""
import math
import random

from quic_grid import MSS, cubic_avg_window
from quic_streams import CREDIT_STREAM, M, bps

BETA, C = 0.7, 0.4  # RFC 9438 §4.6 and §5.1
ASK = M // 2  # bytes: one large DBT frame, the ask row 193 times
# (name, Mbit/s, idle RTT ms, bottleneck buffer ms): link-conditions.md §Link profiles; the buffer is the loaded
# RTT less the idle one (Ookla's down-phase medians), a shallow AQM-like 20 ms for the far server
LINKS = [
    ("cellular p50", 103, 26, 725.0),
    ("cellular p10", 18, 52, 725.0),
    ("Wi-Fi p50", 218, 10, 240.0),
    ("far server, shallow", 46, 92, 20.0),
]
LOSSES = [0, 1e-4, 1e-3, 1e-2, 5e-2]


def rfc9406_q_ms(rtt):
    """RFC 9406 §4.2's RttThresh: max(4 ms, min(min RTT ÷ 8, 16 ms))."""
    return max(4.0, min(rtt / 8, 16.0))


def sawtooth(rate, rtt, buffer, p, burst=1.0, q_star=0.0, delay_cut=False, credit=CREDIT_STREAM, seconds=120.0, seed=1):
    """A fluid Cubic fill (RFC 9438: cubic and Reno-friendly growth, a 0.7 cut, one cut a round trip).
    A random loss cuts only if the queue is at least q_star ms (0: plain Cubic; inf: only overflow cuts);
    delay_cut also cuts on a queue of q_star without a loss. Returns (goodput Mbit/s, time-mean queue ms)."""
    rng = random.Random(seed)
    pps = bps(rate) / MSS
    bdp = pps * rtt / 1e3
    full = bdp + pps * buffer / 1e3  # packets in flight when the buffer is full
    cap = min(full, credit / MSS)  # the receiver's credit bounds what is in flight
    w = w_max = bdp
    epoch, w_est, recover_until = 0.0, w, -1.0
    t, dt, sent, queue_sum = 0.0, rtt / 8e3, 0.0, 0.0
    while t < seconds:
        flight = min(w, cap)
        queue_s = max(0.0, flight - bdp) / pps
        loaded = rtt / 1e3 + queue_s
        x = min(flight / loaded, pps)
        sent += x * dt * (1 - p)
        queue_sum += queue_s * dt
        congestive = w > full
        random_loss = rng.random() < -math.expm1(-p / burst * x * dt)
        if random_loss and queue_s * 1e3 >= q_star:
            congestive = True
        if delay_cut and queue_s * 1e3 >= q_star:
            congestive = True
        if congestive and t >= recover_until:
            w_max, w = w, max(2.0, w * BETA)
            epoch, w_est, recover_until = t, w, t + loaded
        else:
            k = (w_max * (1 - BETA) / C) ** (1 / 3)
            w_est += 3 * (1 - BETA) / (1 + BETA) * dt / loaded
            w = max(C * (t + dt - epoch - k) ** 3 + w_max, w_est)
            w = min(w, max(cap, full) + 1)  # past the cap nothing more is sent; past full the next step cuts
        t += dt
    return sent * MSS * 8 / seconds / 1e6, queue_sum / seconds * 1e3


def bbr_v1_quinn(rate, rtt, buffer, p, credit=CREDIT_STREAM):
    """quinn's BBRv1, window-limited at 2 × BDP on its 1.25 × window ÷ srtt pacer: the link, one idle RTT of queue."""
    x = bps(rate) * (1 - p)
    return x * 8 / 1e6, min(buffer, rtt, max(0.0, credit / bps(rate) * 1e3 - rtt))


def v3_probe_overshoot(rate, rtt, p, thresh=0.02):
    """The chance a v3 probe round (one BDP of packets, iid loss p) loses more than BBR.LossThresh (draft-06 §5.5.10),
    which cuts inflight_longterm."""
    n = max(1, round(bps(rate) / MSS * rtt / 1e3))
    allowed = math.floor(thresh * n)
    below = sum(math.comb(n, i) * p**i * (1 - p) ** (n - i) for i in range(allowed + 1))
    return max(0.0, 1 - below)


def reno_mbps(p, rtt):
    """A Reno-like loss response (LEDBAT halves on loss, RFC 6817 §2.4.2; Vegas uses Reno's): 1.2 ÷ √p a round trip."""
    return 1.2 / math.sqrt(p) * MSS * 8 / (rtt / 1e3) / 1e6 if p > 0 else math.inf


def ask_ms(rate, rtt, queue):
    """An ask asked first during a fill: a request, the bytes already in flight, then its own (row 193's form)."""
    return rtt + (rtt + queue) + ASK / bps(rate) * 1e3


def tail_ms(p, srtt, rttvar, max_ack_delay=25.0):
    """Mean cost a lone ask pays when its last packet is lost: a probe timeout (RFC 9002 §6.2.1) in place of the
    9/8 RTT a later packet would have allowed (§6.1.2)."""
    pto = srtt + max(4 * rttvar, 1.0) + max_ack_delay
    return p * (pto - 9 / 8 * srtt)


def check():
    assert rfc9406_q_ms(26) == 4.0 and rfc9406_q_ms(92) == 11.5 and rfc9406_q_ms(300) == 16.0
    # plain Cubic under random loss lands near RFC 9438's response function at row 193's cell
    x, q = sawtooth(103, 46, 20.0, 0.01, seconds=60)
    model = cubic_avg_window(0.01, 0.046) * MSS * 8 / 0.046 / 1e6
    assert 0.7 * model < x < 1.3 * model and q < 1
    # lossless, deep buffer, wide credit: Cubic fills the link and stands most of the buffer
    x, q = sawtooth(18, 52, 725.0, 0, credit=10**9, seconds=60)
    assert x > 17 and 400 < q < 725
    # the browser's credit, not the buffer, bounds the queue where it binds first
    x, q = sawtooth(103, 26, 725.0, 0, seconds=60)
    assert q < CREDIT_STREAM / bps(103) * 1e3 - 26 + 1 and q < sawtooth(103, 26, 725.0, 0, credit=10**9, seconds=60)[1]
    # a delay cut costs a clean link the part of each 0.7 cut that falls below one BDP; goodput excludes the losses
    assert 0.95 * 103 < sawtooth(103, 26, 725.0, 0, q_star=4.0, delay_cut=True, seconds=60)[0] < 0.99 * 103
    assert 0.94 * 103 < sawtooth(103, 26, 725.0, 0.05, q_star=math.inf, seconds=60)[0] < 0.96 * 103
    # the classifier ignores a loss that met no queue, so at 1 % it fills; a delay cut bounds its queue
    plain = sawtooth(103, 26, 725.0, 0.01, seconds=60)[0]
    classed, q_classed = sawtooth(103, 26, 725.0, 0.01, q_star=4.0, seconds=60)
    capped, q_capped = sawtooth(103, 26, 725.0, 0.01, q_star=4.0, delay_cut=True, seconds=60)
    assert classed > 10 * plain and capped > 10 * plain and q_capped < 8
    # with next to no loss the classifier alone stands Cubic's queue; the delay cut does not
    assert sawtooth(103, 26, 725.0, 1e-6, q_star=4.0, seconds=60)[1] > 100
    assert sawtooth(103, 26, 725.0, 1e-6, q_star=4.0, delay_cut=True, seconds=60)[1] < 8
    assert v3_probe_overshoot(103, 26, 1e-3) < 1e-3 < v3_probe_overshoot(103, 26, 1e-2) < 0.5 < v3_probe_overshoot(103, 26, 5e-2)
    assert bbr_v1_quinn(103, 26, 725.0, 0)[1] == 26 and bbr_v1_quinn(46, 92, 20.0, 0)[1] == 20
    assert abs(reno_mbps(0.01, 46) - 12 * MSS * 8 / 0.046 / 1e6) < 1e-9
    assert ask_ms(8, 50, 100) == 50 + 150 + ASK / 1e6 * 1e3
    assert tail_ms(0.01, 100, 25) == 0.01 * (100 + 100 + 25 - 112.5) and tail_ms(0, 100, 25) == 0


def table(head, rows):
    print("| " + " | ".join(head) + " |")
    print("| --- |" + " --: |" * (len(head) - 1))
    for r in rows:
        print("| " + " | ".join(r) + " |")


def pct(p):
    return f"{p * 100:g} %"


def main():
    check()
    print("\n### Fill Mbit/s · standing queue ms, Cubic-shaped controllers (simulated, 120 s, iid loss)\n")
    rows = []
    for name, rate, rtt, buf in LINKS:
        q = rfc9406_q_ms(rtt)
        for p in LOSSES:
            cells = [f"{name}, {pct(p)}"]
            for kw in ({}, {"q_star": q}, {"q_star": q, "delay_cut": True}):
                x, qu = sawtooth(rate, rtt, buf, p, **kw)
                cells.append(f"{x:.1f} · {qu:.0f}")
            x, qu = bbr_v1_quinn(rate, rtt, buf, p)
            cells.append(f"{x:.1f} · {qu:.0f}")
            rows.append(cells)
    table(["link, loss", "Cubic", "Cubic + classifier", "Cubic + classifier + delay cut", "quinn's BBRv1"], rows)

    print("\n### An ask asked first during a fill, ms (row 180's asks-first; queue from the table above)\n")
    rows = []
    for name, rate, rtt, buf in LINKS:
        q = rfc9406_q_ms(rtt)
        for p in [0, 1e-3, 1e-2]:
            cells = [f"{name}, {pct(p)}"]
            for kw in ({}, {"q_star": q}, {"q_star": q, "delay_cut": True}):
                x, qu = sawtooth(rate, rtt, buf, p, **kw)
                cells.append(f"{ask_ms(min(rate, x), rtt, qu):.0f}")
            x, qu = bbr_v1_quinn(rate, rtt, buf, p)
            cells.append(f"{ask_ms(x, rtt, qu):.0f}")
            rows.append(cells)
    table(["link, loss", "Cubic", "Cubic + classifier", "+ delay cut", "quinn's BBRv1"], rows)

    print("\n### BBRv3: the chance a probe round loses over 2 % (iid), and Reno-like delay controllers' loss bound\n")
    rows = []
    for name, rate, rtt, _ in LINKS:
        rows.append([name] + [f"{v3_probe_overshoot(rate, rtt, p):.3f} · {min(rate, reno_mbps(p, rtt)):.1f}" for p in LOSSES])
    table(["link"] + [pct(p) for p in LOSSES], rows)

    print("\n### A lone ask's mean tail-loss cost, ms (its last packet lost; rttvar a quarter of srtt)\n")
    rows = [[pct(p)] + [f"{tail_ms(p, s, s / 4):.2f}" for s in (36, 260, 751)] for p in LOSSES[1:]]
    table(["loss", "srtt 36 ms", "260 ms", "751 ms"], rows)


if __name__ == "__main__":
    main()
