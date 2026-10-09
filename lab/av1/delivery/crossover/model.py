"""CROSSOVER: fill time per codec from measured bytes and decode times, no new timing. README.md beside this.

    python3 lab/av1/delivery/crossover/model.py
"""
import math

# A fill of N frames through D decoders on P cores: the first frame's bytes, its decode, then the slower of the
# wire and the decoders for the rest, plus a constant (the ask's round trips) fitted on HTJ2K at 5 Mbit/s.
P = 3


def fill(n, mb, ms, p, mbit, c):
    wire = mb * 8 / mbit  # seconds a frame on the link
    dec = ms / 1000
    return c + wire + dec + (n - 1) * max(wire, dec / p)


# Rows 95 and 96, Chromium 141, every input from lab/av1/bytes/{dbt,mammography}-at-scale/README.md:
# frames timed, HTJ2K MB of them (DBT given; FFDM from the 5 Mbit/s 1x cell), AV1's best variant's bytes over HTJ2K's,
# HTJ2K ms a frame 1x and 4x, AV1 over HTJ2K a frame 1x and 4x (WebCodecs, the split's top <= 10 bits),
# and the measured fill ratios at 5, 20, 50 Mbit/s, 1x and 4x.
SERIES = {
    "DBT 12 dbts_a5": (9, 9.3, 0.953, (28.0, 113), (3.80, 3.78), ((0.96, 0.97), (0.97, 1.02), (0.99, 1.39)), (15.3, 15.4)),
    "DBT 10 dbts_b2": (9, 18.2, 0.956, (70.1, 308), (2.64, 2.46), ((0.96, 0.97), (0.97, 1.02), (1.00, 1.32)), (29.8, 30.1)),
    "DBT 12 dbts_c5": (10, 11.2, 0.952, (29.8, 133), (3.86, 3.40), ((0.96, 0.97), (0.97, 1.01), (0.99, 1.30)), (18.4, 18.5)),
    "FFDM 12 ffdms_a3": (4, None, 0.983, (47.5, 207), (3.79, 3.35), ((1.00, 1.03), (1.03, 1.16), (1.08, 1.68)), (10.9, 11.1)),
    "FFDM 12 ffdms_b2 k=3": (4, None, 0.990, (95.5, 381), (3.60, 3.46), ((1.01, 1.05), (1.04, 1.19), (1.11, 1.45)), (20.0, 20.3)),
    "FFDM 12 ffdms_c1": (4, None, 0.992, (70.7, 278), (3.43, 3.59), ((1.00, 1.04), (1.04, 1.15), (1.08, 1.45)), (17.9, 18.1)),
    "syn2D 12 syn2ds_a3": (4, None, 0.966, (94.8, 401), (3.38, 3.10), ((0.98, 1.01), (1.01, 1.14), (1.06, 1.47)), (20.6, 21.0)),
    "syn2D 10 syn2ds_b3": (4, None, 0.940, (122, 521), (1.80, 1.68), ((0.95, 0.98), (0.99, 1.07), (1.04, 1.28)), (12.1, 12.5)),
}
LINKS = (5, 20, 50)
# Firefox has no exact WebCodecs path for these streams, so every AV1 frame is dav1d-WASM's: docs/decode/README.md
# §AV1 in WebKit and Firefox. dav1d over WebCodecs a frame in Chromium, the same sets: 5.0-9.9 against 2.6-5.0.
FIREFOX_DAV1D = (1.6, 1.9, 2.2)


def calibrate(name, s):
    n, mb, rho, t, tau, cells, h5 = s
    if mb is None:  # the 5 Mbit/s 1x HTJ2K cell is wire-bound: its bytes, less ~0.5 s of round trips
        mb = (h5[0] - 0.5) * 5 / 8
    c = h5[0] - fill(n, mb / n, t[0], P, 5, 0)
    return n, mb / n, rho, t, tau, cells, c


def ratio(s, mbit, th, p_av1, tau_scale=1.0):
    n, mb, rho, t, tau, _, c = s
    h = fill(n, mb, t[th], P, mbit, c)
    a = fill(n, mb * rho, t[th] * tau[th] * tau_scale, p_av1, mbit, c)
    return a / h


def crossover(s, th, p_av1, tau_scale=1.0):
    """The link speed in Mbit/s where AV1 stops filling first, or None when it never wins / never loses in 1-1000."""
    lo, hi = 1.0, 1000.0
    if ratio(s, lo, th, p_av1, tau_scale) >= 1:
        return 0.0
    if ratio(s, hi, th, p_av1, tau_scale) < 1:
        return math.inf
    for _ in range(60):
        mid = math.sqrt(lo * hi)
        lo, hi = (mid, hi) if ratio(s, mid, th, p_av1, tau_scale) < 1 else (lo, mid)
    return lo


cal = {k: calibrate(k, v) for k, v in SERIES.items()}
# WebCodecs decodes outside the decoder workers; its concurrency is the one parameter fitted, on DBT 12-bit at 4x on 50.
fit = min((abs(ratio(cal["DBT 12 dbts_a5"], 50, 1, p) - 1.39), p) for p in [x / 20 for x in range(20, 61)])[1]

print(f"P (OpenJPH, dav1d) = {P}; P (WebCodecs) fitted = {fit:.2f}\n")
print("| series | 5 Mbit 1x | 4x | 20 Mbit 1x | 4x | 50 Mbit 1x | 4x |")
print("| --- | --- | --- | --- | --- | --- | --- |")
errs = []
for k, s in cal.items():
    row = []
    for i, mbit in enumerate(LINKS):
        for th in (0, 1):
            pred, meas = ratio(s, mbit, th, fit), s[5][i][th]
            errs.append(pred - meas)
            row.append(f"{pred:.2f} ({meas:.2f})")
    print(f"| {k} | " + " | ".join(row) + " |")
print(f"\npredicted - measured over {len(errs)} cells: median {sorted(errs)[len(errs) // 2]:+.3f}, "
      f"max |{max(errs, key=abs):+.3f}|; within 0.05: {sum(abs(e) <= 0.05 for e in errs)}/{len(errs)}")

# The band: AV1's decode a frame +-15 %, the spread of k = 2's ratio across the volumes or exams of one kind.
print("\nCrossover, Mbit/s (AV1 fills first below it); Chromium [AV1 decode +15 % – -15 %], Firefox by dav1d over WebCodecs 1.6 / 1.9 / 2.2:\n")
print("| series | Chromium 1x | Chromium 4x | Firefox 1x | Firefox 4x |")
print("| --- | --- | --- | --- | --- |")
fmt = lambda x: "never" if x == 0 else ("> 1000" if x == math.inf else f"{x:.0f}")
for k, s in cal.items():
    ff = [" / ".join(fmt(crossover(s, th, P, f)) for f in FIREFOX_DAV1D) for th in (0, 1)]
    band = [f"{fmt(crossover(s, th, fit))} [{fmt(crossover(s, th, fit, 1.15))}–{fmt(crossover(s, th, fit, 0.85))}]" for th in (0, 1)]
    print(f"| {k} | {band[0]} | {band[1]} | {ff[0]} | {ff[1]} |")

print("\nGain (1 - AV1/HTJ2K) at 5, 16.7 (LTE trace mean) and 20 Mbit/s, Chromium 1x / 4x:")
for k, s in cal.items():
    print(f"  {k}: " + ", ".join(f"{m} Mbit {1 - ratio(s, m, 0, fit):+.3f} / {1 - ratio(s, m, 1, fit):+.3f}" for m in (5, 16.7, 20)))

# Predicted only: the two 10-bit volumes AV1 codes a fifth smaller, never timed whole. Bytes from their bit/sample,
# every 8th slice as rows 95 and 96 timed, the round-trip constant the timed volumes' median.
for name, slices, w, h, bps, rho, t, tau in (("DBT 10 dbts_b4", 84, 1996, 2457, 2.44, 0.760, (61.9, 279), (2.25, 2.00)),
                                             ("DBT 10 dbts_b5", 66, 1890, 2457, 2.39, 0.797, (65.0, 252), (2.11, 2.09))):
    s = (math.ceil(slices / 8), w * h * bps / 8 / 1e6, rho, t, tau, None, 0.5)
    print(f"  {name}: crossover Chromium {fmt(crossover(s, 0, fit))} · {fmt(crossover(s, 1, fit))} Mbit/s; "
          + ", ".join(f"{m} Mbit gain {1 - ratio(s, m, 0, fit):+.3f} / {1 - ratio(s, m, 1, fit):+.3f}" for m in (5, 16.7, 20, 50)))
