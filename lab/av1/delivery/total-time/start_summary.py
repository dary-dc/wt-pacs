#!/usr/bin/env python3
"""P-START's reading from run.mjs rows: `need` against `today` per cell, paired by round, and its rule.

usage: start_summary.py ROWS.jsonl   — lab/av1/delivery/total-time/README.md §Row STARTMEASURE
A fill row has frames; a cold-ask row (`--fill 0 --asks-after 1`) has one ask. Strict keeps a round when neither
visit is VOID; round-paired keeps every round both visits finished.
"""
import json
import sys
from statistics import median

rows = [json.loads(line) for line in open(sys.argv[1])]
for r in rows:
    r["kind"] = "ask" if r["owed"] == 1 and r.get("afterMs") else "fill"
cells = sorted({(r["kind"], r["set"], r["link"], r["throttle"]) for r in rows})
by = {(r["kind"], r["set"], r["link"], r["throttle"], r["variant"], r["round"]): r for r in rows}
ms = {"fill": lambda r: r["decodedMs"], "ask": lambda r: r["afterMs"][0]}


def pairs(cell, strict):
    out = []
    for rnd in sorted({r["round"] for r in rows}):
        t, n = (by.get((*cell, v, rnd)) for v in ("today", "need"))
        if not t or not n or t["exact"] < t["owed"] or n["exact"] < n["owed"] or (strict and (t["void"] or n["void"])):
            continue
        out.append((t, n))
    return out


def ratio(ps, k):
    xs = [n[k] / t[k] for t, n in ps if t.get(k)]
    return median(xs) if xs else float("nan")


print(f"{len(rows)} visits, {sum(r['void'] for r in rows)} VOID, {sum(r['exact'] for r in rows)}/{sum(r['owed'] for r in rows)} frames exact")
print("kind set link throttle | reading | n | today ms [range] | × need [range] (within bar) | × CPU | × wake-ups | decoders used today → need")
verdict = {}
for strict in (True, False):
    ok = True
    for cell in cells:
        ps = pairs(cell, strict)
        name = f"{cell[0]} {cell[1]} {cell[2]} {cell[3]}x | {'strict' if strict else 'paired'}"
        if not ps:
            print(f"{name}: none")
            ok = False
            continue
        x = [ms[cell[0]](n) / ms[cell[0]](t) for t, n in ps]
        bar = 1.01 if cell[0] == "fill" else 1.02
        within = sum(v <= bar for v in x)
        tm = [ms[cell[0]](t) for t, _ in ps]
        line = (f"{name} | {len(ps)} | {median(tm):.0f} [{min(tm):.0f}–{max(tm):.0f}] | ×{median(x):.3f} "
                f"[{min(x):.3f}–{max(x):.3f}] ({within}/{len(ps)})")
        if cell[0] == "fill":
            cpu, wakes = ratio(ps, "cpuMs"), ratio(ps, "wakes")
            ok &= within >= 0.8 * len(ps) and cpu <= 1.00
            line += (f" | ×{cpu:.3f} | ×{wakes:.3f} | {median(t['decodersUsed'] for t, _ in ps):g} → "
                     f"{median(n['decodersUsed'] for _, n in ps):g}")
        else:
            ok &= median(x) <= bar
        print(line)
    verdict["strict" if strict else "paired"] = ok
print("container stage passes:", verdict)
