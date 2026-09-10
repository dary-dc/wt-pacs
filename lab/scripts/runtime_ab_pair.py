#!/usr/bin/env python3
"""Pair `runtime_ab.sh` rows by repeat: medians per arm, paired median deltas and sign counts.

    lab/scripts/runtime_ab_pair.py <tsv> <arm-a> <arm-b> [<arm-c> ...]
"""
import statistics
import sys

rows = [l.rstrip("\n").split("\t") for l in open(sys.argv[1]) if l.strip() and not l.startswith("label")]
arms = sys.argv[2:]
by = {a: {r[0]: r for r in rows if r[1] == a} for a in arms}
cols = {"p50_us": (6, 1e-3), "p99_us": (8, 1e-3), "asks_per_s": (10, 1), "cpu_us_per_ask": (11, 1e-3), "ctx_per_ask": (15, 1)}
print(f"{'metric':16}" + "".join(f"{a:>16}" for a in arms) + "".join(f"{'Δ ' + b + ' vs ' + arms[0]:>24}" for b in arms[1:]))
for name, (ci, k) in cols.items():
    line = f"{name:16}" + "".join(f"{statistics.median(float(r[ci]) * k for r in by[a].values()):16.1f}" for a in arms)
    for b in arms[1:]:
        common = sorted(set(by[arms[0]]) & set(by[b]))
        d = [(float(by[b][l][ci]) - float(by[arms[0]][l][ci])) / float(by[arms[0]][l][ci]) * 100 for l in common]
        line += f"{statistics.median(d):+10.1f}% {sum(x < 0 for x in d)}/{len(d)} lower"
    print(line)
