#!/usr/bin/env python3
"""The ask's loss sensitivity (ASKL): each variant's steady depth-1 ask at each loss, pooled over its runs that were not
VOID nor short of a steady ask (counted with the VOID), and the least-squares slope of its p50 and p99 per 1 % loss; the first ask (a fresh session)
by its median; and each round's steady median paired against the first variant's.

usage: askl.py loss0.jsonl ge0.5.jsonl ge1.jsonl ge2.jsonl ge4.jsonl
       askl.py --fill fill.jsonl     each variant's gap between consecutive frames of a fill, pooled
"""
import collections
import json
import statistics
import sys

LOSS = {"loss0": 0.0, "ge0.5": 0.5, "ge1": 1.0, "ge2": 2.0, "ge4": 4.0}


def quantile(v, q):
    s = sorted(v)
    return s[min(len(s) - 1, int(q * len(s)))]


def slope(points):
    xs, ys = zip(*points)
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    return sum((x - mx) * (y - my) for x, y in points) / sum((x - mx) ** 2 for x in xs)


def fill(rows):
    gaps, took = collections.defaultdict(list), collections.defaultdict(list)
    for r in rows:
        if r["void"] or None in r["arrived"]:
            continue
        t = sorted(r["arrived"])
        gaps[r["variant"]] += [b - a for a, b in zip(t, t[1:])]
        took[r["variant"]].append(r["fillMs"])
    print("variant         runs   fill ms   gap p50   p90     p99     max")
    for variant, g in gaps.items():
        print("%-10s %5d %9.0f %9.1f %7.1f %7.1f %7.1f" % (
            variant, len(took[variant]), statistics.median(took[variant]), quantile(g, 0.5), quantile(g, 0.9),
            quantile(g, 0.99), max(g)))


if sys.argv[1] == "--fill":
    sys.exit(fill([json.loads(line) for line in open(sys.argv[2]) if line.strip()]))
rows = [json.loads(line) for path in sys.argv[1:] for line in open(path) if line.strip()]
variants = list(dict.fromkeys(r["variant"] for r in rows))
cells = sorted({r["cell"] for r in rows}, key=LOSS.get)
steady, first, voided, per_round = (collections.defaultdict(list) for _ in range(4))
for r in rows:
    key = (r["cell"], r["variant"])
    if r["void"] or len(r["latencies"]) < 2:
        voided[key].append(r["round"])
        continue
    steady[key] += r["latencies"][1:]
    first[key].append(r["latencies"][0])
    per_round[(r["cell"], r["round"])].append((r["variant"], statistics.median(r["latencies"][1:])))

print("cell   variant         runs void  asks  first p50   steady p50   p99    paired vs %s" % variants[0])
fits = collections.defaultdict(list)
for cell in cells:
    for variant in variants:
        v = steady[(cell, variant)]
        if not v:
            continue
        p50, p99 = quantile(v, 0.5), quantile(v, 0.99)
        fits[variant].append((LOSS[cell], p50, p99))
        diffs = [dict(pair)[variant] - dict(pair)[variants[0]] for (c, _), pair in per_round.items()
                 if c == cell and variant != variants[0] and {variant, variants[0]} <= dict(pair).keys()]
        paired = ("%+.1f (%d/%d lower)" % (statistics.median(diffs), sum(d < 0 for d in diffs), len(diffs))
                  if diffs else "")
        print("%-6s %-10s %5d %4d %5d %10.1f %12.1f %7.1f    %s" % (
            cell, variant, len(first[(cell, variant)]), len(voided[(cell, variant)]), len(v),
            statistics.median(first[(cell, variant)]), p50, p99, paired))
print()
for variant, pts in fits.items():
    if len(pts) > 1:
        print("%-10s per 1 %% loss: p50 %+.1f ms, p99 %+.1f ms (%d cells)" % (
            variant, slope([(x, a) for x, a, _ in pts]), slope([(x, b) for x, _, b in pts]), len(pts)))
