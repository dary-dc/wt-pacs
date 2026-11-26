import json, statistics as st, sys, math, collections
d = sys.argv[1]
def load(n):
    ls = [json.loads(l) for l in open(f"{d}/r3-{n}.jsonl") if l.strip()]
    return [o for o in ls if "unit" in o], [o for o in ls if "cell" in o]
u, c = load("chromium-D5a-busy")
by = collections.defaultdict(list)
for r in u: by[r["unit"]].append(r)
print("D5a-busy", len(u), "rows; rounds per unit", {k: len(v) for k, v in by.items()})
pt = []
for k, xs in by.items():
    ok = [r for r in xs if r["reached"] == "mismatch" and r.get("kill")]
    dl = sum(r["safety"] >= 1 for r in ok)
    exp = len(ok) - sum(0.5 * (1 - min(r["kill"]["atKill"], 50) / 50) for r in ok)
    lost_d = sorted(round(min(r["kill"]["atKill"], 50), 1) for r in ok if r["safety"] < 1)
    kept_d = sorted(round(min(r["kill"]["atKill"], 50), 1) for r in ok if r["safety"] >= 1)
    print(f"  {k:24s} n{len(ok)} safety {dl} fill {sum(bool(r['fill']) for r in xs)} exp {exp:.1f} late {sum(r['kill']['late'] for r in ok)}")
    print(f"      lost at d {lost_d}\n      kept at d {kept_d}")
    if k in ("off", "off'", "beacon:H", "beacon:Y"):
        pt += [(min(r["kill"]["atKill"], 50), r["safety"] >= 1) for r in ok]
# loss vs delay for page-thread carriers
for lo, hi in [(0, 12.5), (12.5, 25), (25, 37.5), (37.5, 50.01)]:
    b = [k for dd, k in pt if lo <= dd < hi]
    mid = (lo + hi) / 2
    print(f"  page-thread d {lo}-{hi}: n {len(b)} lost {len(b) - sum(b)} ({(len(b)-sum(b))/max(1,len(b)):.2f}); model P(lost) {0.5*(1-mid/50):.2f}")
def p99(xs):
    s = sorted(xs); return s[max(0, math.ceil(0.99 * len(s)) - 1)]
u, c = load("chromium-Lbusy")
by = collections.defaultdict(list)
for r in u: by[r["unit"]].append(r)
print("Lbusy", len(u), {k: len(v) for k, v in by.items()})
for k, xs in by.items():
    per = [p99(r["latency"]["later"]) for r in xs if r["latency"] and r["latency"].get("later")]
    pooled = [x for r in xs if r["latency"] for x in r["latency"].get("later", [])]
    print(f"  {k:12s} per-load p99 median {st.median(per):.2f} pooled {p99(pooled):.2f}")
bh = [r for r in by["beacon:H"]]
ev = [r["floor"]["appendMs"] for r in bh if r["round"] % 2 == 0]; od = [r["floor"]["appendMs"] for r in bh if r["round"] % 2 == 1]
print(f"  A/A floor beacon:H even {st.median(ev):.3f} odd {st.median(od):.3f} ratio {st.median(ev)/st.median(od):.3f}")
u, c = load("chromium-C")
by = collections.defaultdict(dict)
for r in u: by[r["unit"]][r["round"]] = r
print("C", len(u))
off = by["off"]
for k, xs in by.items():
    rs = sorted(xs[i]["fillMs"] / off[i]["fillMs"] for i in xs if i in off)
    dms = sorted(xs[i]["fillMs"] - off[i]["fillMs"] for i in xs if i in off)
    q = lambda p: rs[max(0, math.ceil(p * len(rs)) - 1)]
    lt = sum(1 for r in xs.values() if any(t >= 50 for t in (r["cost"].get("longTasks") or [])))
    print(f"  {k:24s} n{len(rs)} med {st.median(rs):.3f} IQR {q(.25):.3f}-{q(.75):.3f} dms {st.median(dms):+.1f} slower {sum(x>0 for x in dms)} cost {st.median(r['cost']['ms'] for r in xs.values()):.2f} longTasks {lt}")
