#!/usr/bin/env python3
"""R2's table and verdict from its rows, by the rule, R0's A/A tolerance and the saturation bar of
docs/lines/proposals.md §R2 and its amendment 1.

usage: r2_summary.py ROWS.jsonl
"""
import json
import re
import statistics
import sys

rows = [json.loads(line) for line in open(sys.argv[1])]
cells, loop = {}, {}
for r in rows:
    if r["cell"] == "loopback":
        if r["run"].get("jumpMs") is not None:
            loop.setdefault(r["run"]["id"], []).append(r["run"]["jumpMs"])
        continue
    cells.setdefault((r["cell"], r["run"]["id"], r["arm"]), []).append(r["run"])


def med(runs, key):
    xs = [u[key] for u in runs if u.get(key) is not None]
    return statistics.median(xs) if xs else None


def sojourn(runs):
    """The optimal-quality flow's sojourn p50 over the jump (the second WINDOW group), median over runs."""
    p50 = []
    for u in runs:
        w = [s for s in u.get("relay", []) if s.startswith("WINDOW flow client") and ":5433 " in s]
        if w:
            p50.append(float(re.search(r"p50 ([\d.]+)", w[-1]).group(1)))
    return statistics.median(p50) if p50 else None


fmt = lambda x, f="{:.0f}": "—" if x is None else f.format(x)
ok, notes = True, []
print("| cell | series | Cubic jump ms | BBR jump ms | ratio | bar | sojourn p50 ms C / B | fill ms C / B | misses |")
print("| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |")
for cell in ("0", "iid1", "ge"):
    for sid in sorted({k[1] for k in cells}):
        c, b = cells.get((cell, sid, "cubic-restart"), []), cells.get((cell, sid, "bbr"), [])
        cj, bj = med(c, "jumpMs"), med(b, "jumpMs")
        r = bj / cj if cj and bj else None
        bar = 1.0 if cell == "iid1" else 1.25
        aa = med(cells.get((cell, sid, "cubic-aa"), []), "jumpMs")
        if aa and cj:
            bar += abs(aa / cj - 1)
        lb = statistics.median(loop[sid]) if loop.get(sid) else None
        bound = lb is not None and cj is not None and bj is not None and max(cj, bj) <= 1.1 * lb
        misses = sum(1 for u in c + b if not u.get("jumped"))
        if r is None or r > bar:
            ok = False
            notes.append(f"{cell} {sid}: {fmt(r, '{:.2f}')}× against {bar:.2f}")
        print(f"| {cell} | {sid} | {fmt(cj)} | {fmt(bj)} | {fmt(r, '{:.2f}')}{' (decode-bound)' if bound else ''} | "
              f"{bar:.2f}{f' (A/A {aa / cj:.2f})' if aa and cj else ''} | {fmt(sojourn(c), '{:.1f}')} / {fmt(sojourn(b), '{:.1f}')} | "
              f"{fmt(med(c, 'fillMs'))} / {fmt(med(b, 'fillMs'))} | {misses} of {len(c) + len(b)} |")
print()
print("loopback &fill=0 jump ms (median):", {k: statistics.median(v) for k, v in loop.items()})
print("verdict:", "P1's claim stands for the jump during the fill" if ok else "P1 corrected: " + "; ".join(notes))
