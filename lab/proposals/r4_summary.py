#!/usr/bin/env python3
"""R4's table and verdict from its rows, by docs/lines/proposals.md §R4 and its amendment 1: with both servers on
BBR, 38 400 B's median `l` ≤ 0.92× the default's clean on every series, and ≤ 1.0× plus the A/A arm's |ratio − 1| at
1 % loss; the three frames pooled. Path RTT stands in as 60 ms plus the exact flow's server-to-client sojourn p50 over
the `l` (the last WINDOW group on relay port 5434).

usage: r4_summary.py ROWS.jsonl
"""
import json
import re
import statistics
import sys

rows = [json.loads(line) for line in open(sys.argv[1])]
ms, soj, failed = {}, {}, {}
for r in rows:
    u, key = r["run"], (r["cell"], r["run"]["id"], r["arm"])
    if u.get("lossless"):
        ms.setdefault(key, []).append(u["losslessMs"])
    else:
        failed[key] = failed.get(key, 0) + 1
    w = [s for s in u.get("relay", []) if s.startswith("WINDOW flow client udp :5434 ")]
    if w:
        soj.setdefault(key, []).append(float(re.search(r"p50 ([\d.]+)", w[-1])[1]))

med = lambda xs: statistics.median(xs) if xs else None
fmt = lambda x, f="{:.0f}": "—" if x is None else f.format(x)
ok, notes = True, []
print("| cell | series | default `l` ms | 38 400 `l` ms | ratio | bar | A/A | sojourn p50 ms d / 38 400 | n | failed |")
print("| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |")
for cell in ("0", "iid1"):
    for sid in sorted({k[1] for k in ms}):
        d, w, aa = (med(ms.get((cell, sid, a), [])) for a in ("default", "iw38400", "default-aa"))
        r = w / d if d and w else None
        bar = 0.92 if cell == "0" else 1.0 + (abs(aa / d - 1) if aa and d else 0)
        bad = sum(failed.get((cell, sid, a), 0) for a in ("default", "iw38400", "default-aa"))
        if r is None or r > bar:
            ok = False
            notes.append(f"{cell} {sid} {fmt(r, '{:.2f}')}×")
        n = "/".join(str(len(ms.get((cell, sid, a), []))) for a in ("default", "iw38400", "default-aa"))
        print(f"| {cell} | {sid} | {fmt(d)} | {fmt(w)} | {fmt(r, '{:.2f}')} | {bar:.2f} | {fmt(aa / d if aa and d else None, '{:.2f}')} | "
              f"{fmt(med(soj.get((cell, sid, 'default'), [])), '{:.1f}')} / {fmt(med(soj.get((cell, sid, 'iw38400'), [])), '{:.1f}')} | {n} | {bad} |")
print("\nverdict:", "a documented option beside --congestion bbr" if ok else "withdrawn for BBR too: " + "; ".join(notes))
