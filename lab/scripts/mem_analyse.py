#!/usr/bin/env python3
"""Fit per-connection server memory from a `mem_per_connection.sh` TSV.

Reports the **slope** of RssAnon against concurrent clients, not RssAnon/N: the intercept
is fixed server cost and dividing it into small-N rows would inflate them badly.

Uses RssAnon rather than RSS throughout. The study file is mmapped, so total RSS grows as
frames are touched and would attribute the study mapping to connection state — an effect
larger than the one being measured. Total RSS is carried alongside only so the gap is
visible.
"""
import sys
from collections import defaultdict


def load(path):
    rows = [l.rstrip("\n").split("\t") for l in open(path) if l.strip()]
    return [dict(zip(rows[0], r)) for r in rows[1:]]


def fit(xs, ys):
    """Ordinary least squares. Returns (slope, intercept, r2)."""
    n = len(xs)
    if n < 2:
        return float("nan"), float("nan"), float("nan")
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return float("nan"), float("nan"), float("nan")
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    intercept = my - slope * mx
    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys))
    ss_tot = sum((y - my) ** 2 for y in ys)
    r2 = 1 - ss_res / ss_tot if ss_tot else float("nan")
    return slope, intercept, r2


def main(path):
    rows = load(path)
    by_arm = defaultdict(list)
    incomplete = []
    for r in rows:
        # A row where fewer clients survived than it claims measured fewer connections
        # than its N says. Excluded from the fit and reported, never silently averaged.
        if int(r["connected"]) < int(r["clients"]):
            incomplete.append(r)
            continue
        by_arm[r["arm"]].append((int(r["clients"]), int(r["rss_anon_kb"]), int(r["rss_total_kb"])))

    if incomplete:
        print("EXCLUDED — clients died before the memory sample:")
        for r in incomplete:
            print(f"  arm={r['arm']:8s} N={r['clients']:>3s} run={r['run']} "
                  f"connected={r['connected']}")
        print()

    results = {}
    for arm, pts in sorted(by_arm.items()):
        print(f"=== arm {arm} " + "=" * 46)
        print(f"  {'clients':>7} {'RssAnon MB':>11} {'RSS MB':>9} {'file-backed MB':>15}")
        agg = defaultdict(list)
        for n, anon, rss in pts:
            agg[n].append((anon, rss))
        xs, ys = [], []
        for n in sorted(agg):
            a = sum(v[0] for v in agg[n]) / len(agg[n])
            t = sum(v[1] for v in agg[n]) / len(agg[n])
            print(f"  {n:>7} {a/1024:>11.1f} {t/1024:>9.1f} {(t-a)/1024:>15.1f}")
            xs.append(n)
            ys.append(a)
        slope, intercept, r2 = fit(xs, ys)
        results[arm] = (slope, intercept, r2)
        print()
        print(f"  per connection : {slope:>8.0f} KB   ({slope/1024:.2f} MB)")
        print(f"  fixed baseline : {intercept:>8.0f} KB   ({intercept/1024:.1f} MB)")
        print(f"  fit quality    : r2 = {r2:.4f}")
        if slope > 0:
            for viewers in (1000, 5000):
                gb = (intercept + slope * viewers) / 1024 / 1024
                print(f"  extrapolated   : {viewers:>5} viewers -> {gb:6.1f} GB")
        print()

    if "default" in results and "bounded" in results:
        d, b = results["default"][0], results["bounded"][0]
        print("=== bounded windows vs quinn defaults " + "=" * 24)
        if d > 0:
            print(f"  per connection: {d:.0f} KB -> {b:.0f} KB  ({(b-d)/d*100:+.1f} %)")
            print(f"  at 1000 viewers: {d*1000/1024/1024:.2f} GB -> {b*1000/1024/1024:.2f} GB")
        print()
        print("  NOTE: flow-control windows are *ceilings*, not allocations — a connection")
        print("  buffers only what is in flight. A small difference here does NOT mean the")
        print("  knobs are pointless: it means this workload never approached the ceiling.")
        print("  What they bound is the worst case, which is the case that matters at scale.")


if __name__ == "__main__":
    main(sys.argv[1])
