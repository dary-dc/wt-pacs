#!/usr/bin/env python3
"""P5's table and verdict from its rows, by docs/lines/proposals.md §P5 amendment 1: the throttled 4-core cell decides;
the 2-core cell is shown beside. A run that does not end at Lossless counts against its arm.

usage: p5_summary.py ROWS.jsonl
"""
import json
import statistics
import sys

rows = [json.loads(line) for line in open(sys.argv[1])]
cells = {}
for r in rows:
    c = cells.setdefault((r["cores"], r["run"]["id"], r["arm"]), {"first": [], "l": [], "failed": 0})
    u = r["run"]
    if u.get("firstPictureMs"):
        c["first"].append(u["firstPictureMs"])
    if u.get("lossless"):
        c["l"].append(u["losslessMs"])
    else:
        c["failed"] += 1

med = lambda xs: statistics.median(xs) if xs else float("nan")
verdict = "adopt"
print("| cores | series | first picture today ms | after ms | after − today | `l` today ms | after ms | ratio | n | not Lossless |")
print("| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |")
for cores in (4, 2):
    for sid in sorted({k[1] for k in cells}):
        t, a = cells.get((cores, sid, "today")), cells.get((cores, sid, "after"))
        if not t or not a:
            continue
        gain, ratio = med(a["first"]) - med(t["first"]), med(a["l"]) / med(t["l"])
        if cores == 4 and (a["failed"] > t["failed"] or not (gain <= -30 and ratio <= 1.05)):
            verdict = "drop as inert"
        print(f"| {cores} | {sid} | {med(t['first']):.0f} | {med(a['first']):.0f} | {gain:+.0f} | {med(t['l']):.0f} | "
              f"{med(a['l']):.0f} | {ratio:.2f} | {len(a['first'])} and {len(t['first'])} | {a['failed']} and {t['failed']} |")
print(f"\nrule (4-core cell): {verdict} (first picture lower by >= 30 ms and `l` <= 1.05x on every series)")
