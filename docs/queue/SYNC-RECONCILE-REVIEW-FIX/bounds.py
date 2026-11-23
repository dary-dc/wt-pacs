# SYNC-RECONCILE-REVIEW-FIX: P4 - P3 = (metadata + listing - item list) / uplink, rsync-updates.md §2-§3.4 and #223.
meta = {"ct": 35.3, "2000": 116.0}        # KB, #223's zstd-1 snapshot (one stream; M-R3 unmeasured)
meta_per_file_ct = (190.0, 390.0)         # KB, §3.4: each file compressed alone (zlib resets per file)
listing = {"ct": 47.0, "2000": 360.0}     # KB, rsync's file list raw (§2 estimate); M-R2 range 40-60, 300-420
item = {"ct": 7.0, "2000": 25.0}          # KB, P3's item list (#223's groups-only list)
bar = {"ct": 1.0, "2000": 5.0}            # s, #223's rule
rate = {"sat 2": 250.0, "sat 1": 125.0, "adsl 1": 125.0, "adsl 0.5": 62.5}  # KB/s
for s in meta:
    print(f"E holds on adsl 0.5, {s}: compressed listing <= {bar[s]*rate['adsl 0.5'] - meta[s] + item[s]:.1f} KB")
for raw in (300, 360, 420):
    v = (meta["2000"] + 0.6*raw - item["2000"]) / rate["adsl 0.5"]
    print(f"adsl 0.5, 2000, raw {raw} KB at 0.6x: {v:.2f} s")
for link in ("sat 2", "sat 1"):
    lo, hi = ((m + listing["ct"] - item["ct"]) / rate[link] for m in meta_per_file_ct)
    print(f"{link} Mbit/s, ct, metadata per file (zlib): {lo:.2f}-{hi:.2f} s")
for link in rate:
    print(link, {s: round((meta[s] + listing[s] - item[s]) / rate[link], 2) for s in meta})
