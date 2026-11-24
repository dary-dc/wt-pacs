"""EXACT-UNASKED: the exact frame without a request, sized from the delivery run's rows.

Inputs, all from claude/delivery b8cd8c71 unless named: lab/delivery/predictions.json (frame bytes, K2's lone
HTJ2K decode, K3's forms), lab/delivery/rows/judged/<CELL>.txt (C1 latency = predicted x median ratio),
claude/device-theory docs/decode/mobile/device-model.md section 4 (HTJ2K a dbts_b1 frame on a fast core per class).
Run: python3 size.py > size-output.txt
"""

IW = 12_000
PAINT_MS = 17

FORMS = {  # rttMs, goodput Mbit/s: predictions.json inputs.forms
    "CLEAN": (2, 86.79653506464592),
    "PUB": (20, 86.79028533226581),
    "CR": (800, 31.19683220916046),
    "LTE": (38, 11.04997628213405),
    "LOSS": (40, 4.727548421670031),
}
VOLUMES = {  # shown exact frame's bytes, lone decode ms, view bytes / exact bytes (whole series)
    "dbts_a1": (1_256_607, 14.677490234375, 4_640_828 / 67_812_443),
    "dbts_b1": (2_113_277, 41.7850341796875, 23_206_924 / 107_407_602),
    "dbts_c1": (1_094_218, 14.494873046875, 6_238_085 / 70_664_924),
}
C1_MEASURED_MS = {  # judged/<CELL>.txt: predicted ms, median ratio
    ("CLEAN", "dbts_a1"): (150, 1.285), ("CLEAN", "dbts_b1"): (256, 1.323), ("CLEAN", "dbts_c1"): (135, 1.378),
    ("PUB", "dbts_a1"): (233, 1.251), ("PUB", "dbts_b1"): (339, 1.346), ("PUB", "dbts_c1"): (218, 1.289),
    ("CR", "dbts_a1"): (5760, 1.110), ("CR", "dbts_b1"): (6610, 1.080), ("CR", "dbts_c1"): (5718, 1.088),
    ("LTE", "dbts_a1"): (1033, 0.452), ("LTE", "dbts_b1"): (1680, 0.410), ("LTE", "dbts_c1"): (915, 0.502),
    ("LOSS", "dbts_a1"): (2218, 0.346), ("LOSS", "dbts_b1"): (3695, 0.316), ("LOSS", "dbts_c1"): (1943, 0.350),
}
CLASS_B1_MS = {"entry": (100, 143), "middle": (46, 94), "premium": (37, 59)}
DWELL_S = (0.2, 0.54)
DWELL_SHARES = (0.05, 0.10, 0.25, 0.50)


def slow_start_ms(nbytes, rtt_ms, mbit):
    """Section 4.1's T_ss: from quinn's 12 000 B, doubling each round trip up to the BDP, then at G."""
    bps = mbit * 1e6 / 8
    bdp = bps * rtt_ms / 1000
    cwnd, sent, t = IW, 0.0, 0.0
    while sent < nbytes:
        if cwnd >= bdp:
            return t + (nbytes - sent) / bps * 1000
        if sent + cwnd >= nbytes:
            return t + (nbytes - sent) / bps * 1000
        sent += cwnd
        t += rtt_ms
        cwnd *= 2
    return t


def model_ms(form, vol, frames=1):
    rtt, g = FORMS[form]
    f, h1, _ = VOLUMES[vol]
    return rtt + slow_start_ms(f * frames, rtt, g) + frames * h1 + PAINT_MS


def measured_ms(form, vol):
    p, r = C1_MEASURED_MS[(form, vol)]
    return p * r


def class_h1(vol, cls):
    lo, hi = CLASS_B1_MS[cls]
    scale = VOLUMES[vol][1] / VOLUMES["dbts_b1"][1]
    return lo * scale, hi * scale


def main():
    print("1. Model check: section 4.1 single frame against predictions.json's C1 (ms)")
    for (form, vol), (p, _) in C1_MEASURED_MS.items():
        print(f"  {form:5} {vol}  model {model_ms(form, vol):7.0f}  file {p:5d}")

    print("\n2. Ask -> painted, measured on the cloud host, then per class (h1 swapped), ms")
    for form in FORMS:
        for vol in VOLUMES:
            m = measured_ms(form, vol)
            h1 = VOLUMES[vol][1]
            cells = []
            for cls in CLASS_B1_MS:
                lo, hi = class_h1(vol, cls)
                cells.append(f"{cls} {m - h1 + lo:5.0f}-{m - h1 + hi:5.0f}")
            print(f"  {form:5} {vol}  cloud {m:5.0f}  " + "  ".join(cells))

    print("\n3. Dwell start -> painted exact (s): dwell trigger + the class range across the three volumes")
    for form in FORMS:
        row = []
        for cls in CLASS_B1_MS:
            vals = []
            for vol in VOLUMES:
                m = measured_ms(form, vol) - VOLUMES[vol][1]
                lo, hi = class_h1(vol, cls)
                vals += [m + lo, m + hi]
            row.append((cls, min(vals) / 1000, max(vals) / 1000))
        for td in DWELL_S:
            print(f"  {form:5} dwell {td:.2f}  " + "  ".join(f"{c} {td + a:4.2f}-{td + b:4.2f}" for c, a, b in row))

    print("\n4. The window +-1 (three frames, centre first, one idle session): the neighbours' extra wait, model, ms")
    for form in FORMS:
        print(f"  {form:5} " + "  ".join(
            f"{vol} +{model_ms(form, vol, 3) - model_ms(form, vol, 1):5.0f}" for vol in VOLUMES))

    print("\n5. Bytes a session against B (the exact series alone): view + dwelt share of distinct frames")
    for vol, (f, _, ra) in VOLUMES.items():
        cells = "  ".join(f"d {d:.2f}: {ra + d:.3f}" for d in DWELL_SHARES)
        print(f"  {vol} view {ra:.4f}  {cells}  break-even d = {1 - ra:.3f}  a frame {f / 1e6:.2f} MB"
              f" = {f / (ra * sum_bytes(vol) / frames_of(vol)):.1f} view frames")


FRAMES = {"dbts_a1": (56, 67_812_443), "dbts_b1": (50, 107_407_602), "dbts_c1": (69, 70_664_924)}


def frames_of(vol):
    return FRAMES[vol][0]


def sum_bytes(vol):
    return FRAMES[vol][1]


if __name__ == "__main__":
    main()
