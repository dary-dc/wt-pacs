#!/usr/bin/env python3
"""Summarise an l7_read_path.sh TSV: per cell and arm, median [range] over rounds of p50, p99, wall,
server CPU per ask and the server's own miss rate; read_ahead 128 against 2048 paired by round.

    lab/scripts/l7_summary.py .local/measurements/l7-*.tsv
"""
import csv, statistics as st, sys
from collections import defaultdict

rows = [r for r in csv.DictReader(open(sys.argv[1]), delimiter="\t") if r.get("p50_ns", "").isdigit()]
by = defaultdict(list)
for i, r in enumerate(rows):
    by[(r["label"], r["arm"])].append(r)

def m(xs, f="{:.1f}"):
    return f"{f.format(st.median(xs))} [{f.format(min(xs))}–{f.format(max(xs))}]"

print(f"{'cell':5} {'arm':7} {'n':>2} {'p50 ms':>18} {'p99 ms':>20} {'wall s':>18} {'cpu/ask ms':>16} {'miss %':>8}")
for (cell, arm), rs in sorted(by.items()):
    p50 = [int(r["p50_ns"]) / 1e6 for r in rs]
    p99 = [int(r["p99_ns"]) / 1e6 for r in rs]
    wall = [int(r["wall_ns"]) / 1e9 for r in rs]
    cpu = [int(r["cpu_ns_per_ask"]) / 1e6 for r in rs]
    miss = [100 * int(r["misses"]) / max(1, int(r["hits"]) + int(r["misses"])) for r in rs]
    print(f"{cell:5} {arm:7} {len(rs):>2} {m(p50):>18} {m(p99):>20} {m(wall, '{:.2f}'):>18} {m(cpu, '{:.2f}'):>16} {st.median(miss):>7.0f}%")

for cell in ("od1", "od4", "od4s", "fill"):
    a, b = by.get((cell, "ra128"), []), by.get((cell, "ra2048"), [])
    if a and b:
        n = min(len(a), len(b))
        for key, name in (("p50_ns", "p50"), ("p99_ns", "p99"), ("wall_ns", "wall")):
            better = sum(int(a[i][key]) < int(b[i][key]) for i in range(n))
            print(f"   {cell:5} ra128 lower than ra2048 on {name}: {better}/{n}")
