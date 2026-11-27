#!/usr/bin/env python3
"""P1's table and verdict from its rows, by the rule and saturation test docs/lines/proposals.md §P1 pre-registered.

usage: p1_summary.py ROWS.jsonl
"""
import json
import statistics
import sys

LOOPBACK_FILL_MS = {"dbts_a1": 1700, "dbts_b1": 4600, "dbts_c1": 2000}  # §P1's saturation reference
rows = [json.loads(line) for line in open(sys.argv[1])]
cells = {}
for r in rows:
    run = r["run"]
    cells.setdefault((r["cell"], run["id"], r["arm"]), []).append(run)


def med(runs, key):
    xs = [u[key] for u in runs if u.get(key) is not None]
    return (statistics.median(xs), len(xs), len(runs)) if xs else (None, 0, len(runs))


ok = True
print("| cell | series | Cubic fill ms | BBR fill ms | ratio | Cubic `l` ms | BBR `l` ms | ratio | n |")
print("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |")
for cell in ("0", "iid1", "ge"):
    for sid in sorted({k[1] for k in cells}):
        c, b = cells.get((cell, sid, "cubic-restart"), []), cells.get((cell, sid, "bbr"), [])
        cf, cl, bf, bl = med(c, "fillMs"), med(c, "losslessMs"), med(b, "fillMs"), med(b, "losslessMs")
        rf = bf[0] / cf[0] if cf[0] and bf[0] else None
        rl = bl[0] / cl[0] if cl[0] and bl[0] else None
        ceiling = bf[0] is not None and bf[0] <= 1.1 * LOOPBACK_FILL_MS[sid.split("-")[0]]
        if cell == "iid1":
            ok &= rf is not None and rl is not None and rf <= 0.7 and rl <= 0.7
        if cell == "0":
            ok &= rf is not None and rf <= 1.05
        fmt = lambda x: "—" if x is None else f"{x:.0f}"
        ratio = ("—" if rf is None else f"{rf:.2f}") + (", at the host's ceiling" if ceiling else "")
        n = f"{bf[1]}/{bf[2]} BBR, {cf[1]}/{cf[2]} Cubic"
        print(f"| {cell} | {sid} | {fmt(cf[0])} | {fmt(bf[0])} | {ratio} | {fmt(cl[0])} | {fmt(bl[0])} | "
              f"{'—' if rl is None else f'{rl:.2f}'} | {n} |")
print(f"\nrule: {'adopt' if ok else 'reject'} (BBR fill and `l` <= 0.7x in the 1 % cell on all three, fill <= 1.05x clean)")
