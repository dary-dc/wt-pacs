# PR 417 §6.1: P4 - P3 = (snapshot + listing - item list) / uplink rate; inputs from rsync-updates.md §2 and #223.
snap = {"ct": 35.3, "2000": 116.0}   # KB, #223 zstd-1
lst  = {"ct": 47.0, "2000": 360.0}   # KB, rsync's file list raw (estimate, §2)
item = {"ct": 7.0,  "2000": 25.0}    # KB, P3's item list (#223's B list, zstd-1)
bar  = {"ct": 1.0,  "2000": 5.0}     # s, #223's rule
links = {"sat 2 Mbit/s": 250, "sat 1 Mbit/s": 125, "ADSL 0.5 Mbit/s": 62.5}  # KB/s
for name, rate in links.items():
    for f in (1.0, 0.6):
        if f != 1.0 and not name.startswith("ADSL"):
            continue
        cells = {s: (snap[s] + f * lst[s] - item[s]) / rate for s in snap}
        print(f"{name} listing x{f}: " + ", ".join(f"{s} {v:.2f} s ({'P3' if v > bar[s] else 'E'})" for s, v in cells.items()))
for raw in (300, 360, 420):
    v = (snap["2000"] + 0.6 * raw - item["2000"]) / 62.5
    print(f"ADSL 0.5, 2000, raw listing {raw} KB at 0.6x: {v:.2f} s ({'P3' if v > 5 else 'E'})")
for s in snap:
    print(f"compressed listing at which E holds on ADSL 0.5, {s}: <= {bar[s] * 62.5 - snap[s] + item[s]:.1f} KB")
for s, p3, p4, k in (("ct", 1.4, 1.7, 7.0), ("2000", 2.2, 4.0, 25.0)):
    print(f"round trips back-solved, satellite 700 ms, {s}: P3 {(p3 - k / 250) / 0.7:.2f}, P4 {(p4 - (snap[s] + lst[s]) / 250) / 0.7:.2f}")
