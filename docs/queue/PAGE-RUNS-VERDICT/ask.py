import json, statistics as st, sys, collections, ast
rows = [json.loads(l) for f in sys.argv[1:] for l in open(f) if l.strip()]
def read(r):
    if r.get("void") or r.get("failure") or not r.get("legs"): return None
    L = r["legs"]; steps = L["steps"]
    if isinstance(steps, str): steps = ast.literal_eval(steps)
    one = L["spec"]["oneWay"]
    c = [x for x in steps if x["leg"] >= (1 if one else 2)][(L["w"] if one else 0):]
    legs = sorted(set(x["leg"] for x in c))
    per = [sum(max(0, x["heldMs"] - x["dueMs"]) for x in c if x["leg"] == k) / 1000 for k in legs]
    return sum(per) / len(per), sum(not x["heldAtDue"] for x in c) / len(c)
cells = collections.defaultdict(list)
for r in rows: cells[(r["cell"], r["link"])].append(r)
for k, rs in cells.items():
    v = collections.defaultdict(dict)
    for r in rs:
        x = read(r)
        if x: v[r["variant"]][r["round"]] = x
    nvoid = sum(1 for r in rs if read(r) is None)
    ref = v["centred"]
    aa = [v["centredaa"][i][0] - ref[i][0] for i in v["centredaa"] if i in ref]
    q = lambda a, p: sorted(a)[min(len(a) - 1, max(0, round(p * (len(a) - 1))))]
    lo, hi = q(aa, .1), q(aa, .9)
    print(k, len(rs), "visits", nvoid, "not counted; A/A med|d| %.3f spread %.3f..%.3f" % (st.median(map(abs, aa)), lo, hi))
    for a, d in v.items():
        diff = [d[i][0] - ref[i][0] for i in d if i in ref]
        print(f"   {a:10s} n{len(d):2d} wait {st.median(x[0] for x in d.values()):6.2f} live {st.median(x[1] for x in d.values())*100:3.0f}% vs centred {st.median(diff):+.2f} below {sum(x<lo for x in diff)} above {sum(x>hi for x in diff)} of {len(diff)}")
