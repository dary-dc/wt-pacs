import json, statistics as st, sys, collections
d = sys.argv[1]
for cell in ["flags-AD", "flags-CR"]:
    rows = [json.loads(l) for l in open(f"{d}/{cell}.jsonl") if l.strip()]
    for form in dict.fromkeys(r["form"] for r in rows):
        fr = [r for r in rows if r["form"] == form]
        void = [r for r in fr if r.get("void") or r.get("error")]
        why = collections.Counter(w for r in void for w in (r.get("void") or ["error"]))
        ok = [r for r in fr if not r.get("void") and not r.get("error") and r.get("v")]
        ref = {r["round"]: r["v"] for r in ok if r["arm"] == "WT-TS"}
        print(f"{form}: {len(fr)} visits, {len(void)} void {dict(why)}, exact {sum(r.get('exact') or 0 for r in fr)}, "
              f"busiest max {max(r['busiestCore'] for r in fr):.2f}, WT-TS median {st.median(ref.values()):.0f}")
        pos = collections.defaultdict(collections.Counter)
        for r in fr:
            order = sorted([x for x in fr if x["round"] == r["round"]], key=lambda x: x["at"])
            pos[r["arm"]][order.index(r)] += 1
        for arm in dict.fromkeys(r["arm"] for r in fr):
            rs = sorted(r["v"] / ref[r["round"]] for r in ok if r["arm"] == arm and r["round"] in ref)
            print(f"  {arm:9s} n{len(rs):3d} med {st.median(rs):.3f} ({rs[0]:.3f}-{rs[-1]:.3f}) better {sum(x<1 for x in rs)} "
                  f"pos {sorted(pos[arm].values())}")
