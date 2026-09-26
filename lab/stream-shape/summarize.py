#!/usr/bin/env python3
"""HOL1's reading of run.mjs rows, by the rule fixed in docs/adr-stream-shape.md §HOL1 before
the first run: pooled nearest-rank p95s, and per-round p95s paired against `shared` for the win count.

usage: summarize.py rows.jsonl [...]          the cells
       summarize.py --sweep sweep.jsonl        each arm's D_min
"""
import collections
import json
import math
import statistics
import sys


def p(values, q):
    v = sorted(values)
    return v[max(0, math.ceil(q * len(v)) - 1)] if v else None


def gaps(arrived):
    """What an in-order viewer waits between frames: frame i shows once 0..i have all landed."""
    out, shown = [], None
    for t in arrived:
        if t is None:
            break
        now = t if shown is None else max(shown, t)
        if shown is not None:
            out.append(now - shown)
        shown = now
    return out


def sweep(rows):
    by = collections.defaultdict(lambda: collections.defaultdict(list))
    for r in rows:
        by[r["arm"]][r["depth"]].append(1000 * len(r["latencies"]) / r["asksMs"])
    print("asks/s, median of rounds, by depth; D_min is the smallest depth within 95 % of the arm's best")
    for arm, depths in by.items():
        med = {d: statistics.median(v) for d, v in sorted(depths.items())}
        best = max(med.values())
        d_min = min(d for d, v in med.items() if v >= 0.95 * best)
        print(f"  {arm:9} " + "  ".join(f"{d}:{v:5.2f}" for d, v in med.items()) + f"   D_min {d_min}")


def cells(rows):
    by = collections.defaultdict(list)
    for r in rows:
        by[(r["cell"], r["arm"])].append(r)
    for cell in sorted({c for c, _ in by}):
        ref = {r["round"]: r for r in by.get((cell, "shared"), [])}
        print(f"\n{cell}: pooled p50 / p95 ms; rounds whose own p95 beat shared's")
        for (c, arm), rs in sorted(by.items()):
            if c != cell:
                continue
            fill = [g for r in rs for g in gaps(r["arrived"])]
            asks = [x for r in rs for x in r["latencies"]]
            got = sum(sum(t is not None for t in r["arrived"]) for r in rs)
            owed = sum(len(r["arrived"]) for r in rs)
            asked = sum(len(r["latencies"]) for r in rs)
            failed = sum(r["failures"] for r in rs)

            def won(metric):
                pairs = [(metric(r), metric(ref[r["round"]])) for r in rs if r["round"] in ref]
                pairs = [(a, b) for a, b in pairs if a is not None and b is not None]
                return f"{sum(a < b for a, b in pairs)}/{len(pairs)}"

            fill_won = won(lambda r: p(gaps(r["arrived"]), 0.95))
            ask_won = won(lambda r: p(r["latencies"], 0.95))
            print(f"  {arm:9} d={rs[0]['depth']}  received {got}/{owed}, asks {asked} ({failed} failed)"
                  f"  fill gap {p(fill, .5):6.1f} / {p(fill, .95):7.1f} over {len(fill):3}  won {fill_won}"
                  f"  ask {p(asks, .5):7.1f} / {p(asks, .95):7.1f} over {len(asks):3}  won {ask_won}"
                  f"  fill {statistics.median(r['fillMs'] for r in rs) / 1000:6.1f} s")


if __name__ == "__main__":
    if sys.argv[1] == "--sweep":
        sweep([json.loads(line) for f in sys.argv[2:] for line in open(f)])
    else:
        cells([json.loads(line) for f in sys.argv[1:] for line in open(f)])
