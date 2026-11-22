import json, sys, statistics as st, math, os
D = sys.argv[1]
UNITS = ["off","off'","beacon:H","beacon:Y","keepalive:H","keepalive:Y","session:1","session:Y","session:H"]
def load(name):
    rows, cells = [], []
    for l in open(os.path.join(D, name)):
        o = json.loads(l)
        (cells if "cell" in o else rows).append(o)
    return rows, cells
def q(xs, p):  # nearest rank
    xs = sorted(xs); return xs[max(0, math.ceil(p * len(xs)) - 1)]
med = st.median
for cell in ["D5a", "D5b", "D6"]:
    rows, cells = load(f"r2-chromium-{cell}.jsonl")
    print(f"== {cell} rows {len(rows)} balanced {all(cells[0]['balanced'].values())} errors {sum(1 for r in rows if r['error'])}")
    for u in UNITS:
        rs = [r for r in rows if r["unit"] == u]
        fill = sum(1 for r in rs if r["fill"]); delta = sum(1 for r in rs if any(s >= 1 for s in r["seqs"]))
        saf = sum(1 for r in rs if r["safety"] >= 1); dup = sum(r["duplicates"] for r in rs)
        extra = ""
        if "kill" in rs[0]:
            ks = [r["kill"] for r in rs]
            extra = f"handed {sum(1 for k in ks if k['safetyHanded'])} atKill {min(k['atKill'] for k in ks):.1f}-{max(k['atKill'] for k in ks):.1f} learned {min(k['learned'] for k in ks):.1f}-{max(k['learned'] for k in ks):.1f} late {sum(k['late'] for k in ks)}"
        print(f"  {u:12} n {len(rs)} fill {fill} delta {delta} safety {saf} dup {dup} {extra}")
for cell in ["L", "Lbusy"]:
    rows, cells = load(f"r2-chromium-{cell}.jsonl")
    print(f"== {cell} rows {len(rows)} balanced {all(cells[0]['balanced'].values())} errors {sum(1 for r in rows if r['error'])}")
    bh = [r for r in rows if r["unit"] == "beacon:H"]
    ev = med([r["floor"]["appendMs"] for r in bh if r["round"] % 2 == 0]); od = med([r["floor"]["appendMs"] for r in bh if r["round"] % 2 == 1])
    print(f"  VOID check beacon:H floor appendMs even {ev:.3f} odd {od:.3f} ratio {ev/od:.3f}")
    for u in UNITS:
        rs = [r for r in rows if r["unit"] == u]
        p50 = [q(r["latency"]["later"], .5) for r in rs]; p99 = [q(r["latency"]["later"], .99) for r in rs]
        n = sum(len(r["latency"]["later"]) for r in rs)
        within = sum(1 for a, b in zip(p50, p99) if a <= 250 and b <= 1000)
        fl = [r["floor"] for r in rs if r.get("floor")]
        fls = f"floor {sum(f['delivered'] for f in fl)}/{sum(f['n'] for f in fl)} {med([f['appendMs'] for f in fl]):.2f}" if fl else "floor none"
        print(f"  {u:12} faults {n} p50 {med(p50):.2f} ({max(p50):.2f}) p99 {med(p99):.2f} ({max(p99):.2f}) within {within} fill-fault {med([r['latency']['fill'] for r in rs]):.1f} {fls}")
rows, cells = load("r2-chromium-C.jsonl")
print(f"== C rows {len(rows)} balanced {all(cells[0]['balanced'].values())} errors {sum(1 for r in rows if r['error'])} fill range {min(r['fillMs'] for r in rows):.1f}-{max(r['fillMs'] for r in rows):.1f}")
off = {r["round"]: r["fillMs"] for r in rows if r["unit"] == "off"}
for u in UNITS:
    rs = [r for r in rows if r["unit"] == u]
    ratios = [r["fillMs"] / off[r["round"]] for r in rs]
    within = sum(1 for x in ratios if 0.98 <= x <= 1.02)
    lt = sum(len(r["cost"]["longTasks"]) for r in rs); obs = all(r["cost"]["longTasksObserved"] for r in rs)
    print(f"  {u:12} fill {med([r['fillMs'] for r in rs]):.1f} ratio med {med(ratios):.3f} within {within}/18 pagems {med([r['cost']['ms'] for r in rs]):.2f} ({max(r['cost']['ms'] for r in rs):.2f}) longtasks {lt} obs {obs} fillrec {sum(r['fill'] for r in rs)} recs {med([r['y']['records'] for r in rs])} bytes {med([r['y']['bytes'] for r in rs])} largest {max(r['y']['largest'] for r in rs)}")
# A/A by fill time median ratio, off' over off
offp = [r for r in rows if r["unit"] == "off'"]
print("  VOID C: median off'/off per-round", round(med([r["fillMs"] / off[r["round"]] for r in offp]), 3), "ratio of medians", round(med([r["fillMs"] for r in offp]) / med(off.values()), 3))
# spread of off against itself: adjacent rounds
offs = [off[k] for k in sorted(off)]
print("  off round-to-round ratio within 0.98-1.02:", sum(1 for a, b in zip(offs, offs[1:]) if 0.98 <= b / a <= 1.02), "of", len(offs) - 1, " off CV", round(st.pstdev(offs) / st.mean(offs), 3))
R = [json.loads(l) for l in open(os.path.join(D, "r2-R.jsonl"))]
R = [r for r in R if "target" in r]
print("== R bursts", len(R), "saturated", sum(r["saturated"] for r in R), "gen max", round(max(r["generatorCores"] for r in R), 2))
for t in sorted({r["target"] for r in R}):
    for rate in (10, 100, 1000):
        for k in ("load", "safety"):
            b = [r for r in R if r["target"] == t and r["rate"] == rate and r["kind"] == k]
            if not b: continue
            ref = sum(sum(r["refused"].values()) for r in b)
            print(f"  {t:9} {rate:5} {k:6} rounds {len(b)} sent {sum(r['sent'] for r in b)} 204 {sum(r['statuses'].get('204',0) for r in b)} lines {sum(r['lines'] for r in b)} refused {ref} core {100*med([r['coreShare'] for r in b]):.2f} ({100*max(r['coreShare'] for r in b):.2f}) per1000 {med([r['cpuPer1000'] for r in b]):.3f} peak {max(r['peakKb'] for r in b)}")
