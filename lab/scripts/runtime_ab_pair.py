#!/usr/bin/env python3
"""Pair `runtime_ab.sh` rows by repeat: medians per variant, paired median deltas and sign counts.

    lab/scripts/runtime_ab_pair.py <tsv> <variant-a> <variant-b> [<variant-c> ...]
"""
import statistics
import sys

rows = [l.rstrip("\n").split("\t") for l in open(sys.argv[1]) if l.strip() and not l.startswith("label")]
variants = sys.argv[2:]
by = {a: {r[0]: r for r in rows if r[1] == a} for a in variants}
cols = {"p50_us": (6, 1e-3), "p99_us": (8, 1e-3), "asks_per_s": (10, 1), "cpu_us_per_ask": (11, 1e-3), "ctx_per_ask": (15, 1), "rcvbuf_drops": (16, 1), "server_lost": (17, 1), "per_sendmsg": (18, 1), "rss_after_mib": (19, 1 / 1024)}
print(f"{'metric':16}" + "".join(f"{a:>16}" for a in variants) + "".join(f"{'Δ ' + b + ' vs ' + variants[0]:>24}" for b in variants[1:]))
for name, (ci, k) in cols.items():
    line = f"{name:16}" + "".join(f"{statistics.median([float(r[ci]) * k for r in by[a].values() if len(r) > ci] or [0]):16.1f}" for a in variants)
    for b in variants[1:]:
        common = sorted(set(by[variants[0]]) & set(by[b]))
        pairs = [(float(by[b][l][ci]), float(by[variants[0]][l][ci])) for l in common if len(by[b][l]) > ci]
        d = [(n - o) / o * 100 for n, o in pairs if o != 0]
        line += f"{statistics.median(d):+10.1f}% {sum(x < 0 for x in d)}/{len(d)} lower" if d else f"{'n/a':>24}"
    print(line)
