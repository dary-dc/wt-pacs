import json, statistics as st, collections, sys
d = sys.argv[1]
ls = [json.loads(l) for l in open(f"{d}/m5-firefox.jsonl")][1:]
by = collections.defaultdict(dict)
for r in ls: by[r["arm"]][r["round"]] = r
print("3b", {a: len(v) for a, v in by.items()}, "every row 80 exact and on disk:", all(r["exact"] == 80 and r["onDisk"] == 80 for r in ls))
for a in by:
    g = [r["growthMiB"] for r in by[a].values()]
    print(f"  {a:10s} growth {st.median(g):.0f} [{min(g):.0f}-{max(g):.0f}] diskMs {st.median(r['diskMs'] for r in by[a].values()):.0f}")
bar = st.median(r["growthMiB"] for r in by["disk"].values()) + 320
print(f"  bar {bar:.0f}; ring rounds under {sum(r['growthMiB'] <= bar for r in by['ring'].values())}; least room {min(bar - r['growthMiB'] for r in by['ring'].values()):.0f}")
for key in ["diskMs", "fillMs", "diskSeenMs"]:
    rs = sorted(by["ring"][k][key] / by["today"][k][key] for k in by["ring"])
    print(f"  ring/today by {key}: {st.median(rs):.3f} [{rs[0]:.3f}-{rs[-1]:.3f}], rounds over 1.10: {sum(x > 1.1 for x in rs)}")
print(f"  ring-disk: of medians {st.median(r['growthMiB'] for r in by['ring'].values()) - st.median(r['growthMiB'] for r in by['disk'].values()):.0f}, paired {st.median(by['ring'][k]['growthMiB'] - by['disk'][k]['growthMiB'] for k in by['ring']):.0f}")
print(f"  A/A |ring2-ring| {st.median(abs(by['ring2'][k]['growthMiB'] - by['ring'][k]['growthMiB']) for k in by['ring']):.0f} MiB, fill {st.median(by['ring2'][k]['diskMs'] / by['ring'][k]['diskMs'] for k in by['ring']):.3f}; cpu median {st.median(r['cpuBusy'] for r in ls):.2f}")
c = sys.argv[2]
for f in ["L-512-1x", "L-2560-1x"]:
    rs = [o for o in map(json.loads, open(f"{c}/{f}.jsonl")) if "pssGrowthMiB" in o and not o.get("mutant")]
    byu = collections.defaultdict(list)
    for r in rs: byu[r["unit"]].append(r)
    for u, xs in byu.items():
        proc = collections.defaultdict(list)
        for r in xs:
            for p in r["pssByProcess"]: proc[p["type"]].append(p["peakMiB"] - p["baseMiB"])
        print(f"  {f} {u:13s} n{len(xs)} growth {st.median(r['pssGrowthMiB'] for r in xs):6.1f}", {k: round(st.median(v), 1) for k, v in proc.items()})
for f in ["O-512-1x", "O-3328-1x"]:
    rs = [o for o in map(json.loads, open(f"{c}/{f}.jsonl")) if o.get("warm") and not o.get("mutant")]
    byu = collections.defaultdict(dict)
    for r in rs: byu[r["unit"]][r["round"]] = r
    for m in ["warm", "cold"]:
        ms = lambda u, k: byu[u][k][m]["read"]["fromStartMs"]
        med = {u: st.median(ms(u, k) for k in byu[u]) for u in byu}
        n = next(iter(byu["opfs-async"].values()))[m]["opened"]["present"]
        aa_paired = st.median(ms("opfs-sync-aa", k) / ms("opfs-sync", k) for k in byu["opfs-sync"])
        rel = st.median(ms("opfs-async", k) / ms("opfs-sync", k) for k in byu["opfs-sync"])
        print(f"  {f} {m}: medians {({u: round(v, 1) for u, v in med.items()})}; async {med['opfs-async'] / n:.3f} ms a frame;"
              f" A/A median of paired ratios {aa_paired:.3f}, ratio of medians {med['opfs-sync-aa'] / med['opfs-sync']:.3f}; async/sync paired {rel:.3f}")
rs = [o for o in map(json.loads, open(f"{c}/T-2560-1x.jsonl")) if o.get("second") and not o.get("mutant")]
bad = collections.Counter(); rounds = set(); n = 0
for r in rs:
    for e in r["second"]["verify"]["records"]:
        n += 1
        if not (e["hit"] and e["xxh3"] and e["sha"]): bad[(e["hit"], e["why"])] += 1; rounds.add(r["round"])
print(f"  T: {len(rs)} rounds, tab 2 {n} indices, not exact {dict(bad)} in rounds {sorted(rounds)}, sha after xxh3 {sum(r['second']['verify'].get('shaAfterXxh3', 0) for r in rs)}")
