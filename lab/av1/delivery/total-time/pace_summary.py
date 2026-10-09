#!/usr/bin/env python3
"""Row DECODEPACE's reading from run.mjs rows: `pace` against `today` per cell, paired by round.

usage: pace_summary.py ROWS.jsonl   — lab/av1/delivery/total-time/README.md §Row DECODEPACE
Strict keeps a round when neither visit is VOID; round-paired keeps every round both visits finished.
"""
import json
import sys
from statistics import median

rows = [json.loads(line) for line in open(sys.argv[1])]
cells = sorted({(r["set"], r["link"], r["throttle"]) for r in rows})
by = {(r["set"], r["link"], r["throttle"], r["variant"], r["round"]): r for r in rows}


def pairs(cell, strict):
    out = []
    for rnd in sorted({r["round"] for r in rows}):
        t, p = (by.get((*cell, v, rnd)) for v in ("today", "pace"))
        if not t or not p or not t["frames"] or not p["frames"] or (strict and (t["void"] or p["void"])):
            continue
        out.append((t, p))
    return out


def ratio(ps, k):
    xs = [p[k] / t[k] for t, p in ps if t.get(k)]
    return median(xs) if xs else float("nan")


exact = sum(r["exact"] for r in rows)
owed = sum(r["owed"] for r in rows)
print(f"{len(rows)} visits, {sum(r['void'] for r in rows)} VOID, {exact}/{owed} frames exact")
print("cell | reading | n | today ms | × fill (≤1.01 in) | × CPU | × wake-ups | decoders used, peak, mean busy today → pace")
verdict = {}
for strict in (True, False):
    ok = True
    for cell in cells:
        ps = pairs(cell, strict)
        if not ps:
            print(f"{cell} {'strict' if strict else 'paired'}: none")
            ok = False
            continue
        fill = [p["decodedMs"] / t["decodedMs"] for t, p in ps]
        within = sum(x <= 1.01 for x in fill)
        cpu, wakes = ratio(ps, "cpuMs"), ratio(ps, "wakes")
        tm = median(t["decodedMs"] for t, _ in ps)
        use = lambda side, k: median(pair[side][k] for pair in ps)
        ok &= within >= 0.8 * len(ps) and cpu <= 1.03 and wakes <= 1
        print(f"{cell[0]} {cell[1]} {cell[2]}x | {'strict' if strict else 'paired'} | {len(ps)} | {tm:.0f} "
              f"[{min(t['decodedMs'] for t, _ in ps)}–{max(t['decodedMs'] for t, _ in ps)}] | ×{median(fill):.3f} "
              f"[{min(fill):.3f}–{max(fill):.3f}] ({within}/{len(ps)}) | ×{cpu:.3f} | ×{wakes:.3f} | "
              f"{use(0, 'decodersUsed'):g}, {use(0, 'peakBusy'):g}, {use(0, 'meanBusy'):.2f} → "
              f"{use(1, 'decodersUsed'):g}, {use(1, 'peakBusy'):g}, {use(1, 'meanBusy'):.2f}")
    verdict["strict" if strict else "paired"] = ok
print("container stage passes:", verdict)
