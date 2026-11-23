# Re-review of PR 417's fix (9f9634c66): P4 - P3 = (snapshot + listing - item list) / rate; #223's bar 1 s (ct), 5 s (2 000).
KB_PER_S = lambda mbit: mbit * 125.0
SNAP = {"ct": 35.3, "2000": 116.0}
ITEMS = {"ct": 7.0, "2000": 25.0}
BAR = {"ct": 1.0, "2000": 5.0}
RAW = {"ct": (40.0, 60.0), "2000": (300.0, 420.0)}

def gap(series, listing, mbit, snap=None):
    return ((snap if snap is not None else SNAP[series]) + listing - ITEMS[series]) / KB_PER_S(mbit)

for s in ("ct", "2000"):
    print(f"bound, ADSL 0.5, {s}: listing <= {BAR[s] * KB_PER_S(0.5) - SNAP[s] + ITEMS[s]:.1f} KB")
    for mbit in (1, 2):
        print(f"bound, satellite {mbit} Mbit/s, {s}: listing <= {BAR[s] * KB_PER_S(mbit) - SNAP[s] + ITEMS[s]:.1f} KB (raw top {RAW[s][1]:.0f})")
for s in ("ct", "2000"):
    for raw in RAW[s]:
        g = gap(s, 0.6 * raw, 0.5)
        print(f"ADSL 0.5, {s}, raw {raw:.0f} KB x0.6: {g:.2f} s ({'E' if g <= BAR[s] else 'P3'})")
L_ct = 1.2 * KB_PER_S(0.5) - SNAP["ct"] + ITEMS["ct"]
print(f"ct raw listing implied by the 1.2 s cell: {L_ct:.1f} KB")
for mbit in (2, 1):
    lo, hi = gap("ct", L_ct, mbit, 190), gap("ct", L_ct, mbit, 390)
    print(f"satellite {mbit} Mbit/s, ct, zlib metadata 190-390 KB: {lo:.2f}-{hi:.2f} s")
print(f"satellite 2 Mbit/s, ct: P3 above metadata {BAR['ct'] * KB_PER_S(2) - L_ct + ITEMS['ct']:.1f} KB")
