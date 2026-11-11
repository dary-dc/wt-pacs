#!/usr/bin/env python3
"""P4's table and verdict from its rows, by the rule docs/lines/proposals.md §P4 pre-registered: a cell is a link
cell and series, its three frames pooled; the frames' own medians are shown beside.

usage: p4_summary.py ROWS.jsonl
"""
import json
import statistics
import sys

rows = [json.loads(line) for line in open(sys.argv[1])]
ms = {}
for r in rows:
    u = r["run"]
    if u.get("losslessMs") is not None:
        ms.setdefault((r["cell"], u["id"], r["arm"], u["frame"]), []).append(u["losslessMs"])


def med(cell, sid, arm, frames=("first", "middle", "last")):
    xs = [x for f in frames for x in ms.get((cell, sid, arm, f), [])]
    return (statistics.median(xs), len(xs)) if xs else (None, 0)


verdict = "adopt"
print("| cell | series | `l` default ms | `l` 38 400 ms | ratio | first · middle · last ratios | n |")
print("| --- | --- | ---: | ---: | ---: | --- | --- |")
for cell in ("0", "iid1", "ge", "q20"):
    for sid in sorted({k[1] for k in ms}):
        (d, nd), (w, nw) = med(cell, sid, "default"), med(cell, sid, "iw38400")
        if d is None or w is None:
            continue
        ratio = w / d
        if ratio > 1.05:
            verdict = "reject"
        elif verdict == "adopt" and ratio > (0.9 if cell == "0" else 1.0):
            verdict = "no adopt (rule not met, none above 1.05)"
        per = " · ".join(f"{med(cell, sid, 'iw38400', (f,))[0] / med(cell, sid, 'default', (f,))[0]:.2f}"
                         for f in ("first", "middle", "last"))
        print(f"| {cell} | {sid} | {d:.0f} | {w:.0f} | {ratio:.2f} | {per} | {nw} and {nd} |")
print(f"\nrule: {verdict} (<= 0.9x clean on all three, <= 1.0x elsewhere; any cell above 1.05x rejects)")
