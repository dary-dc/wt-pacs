#!/usr/bin/env python3
"""Medians of rows.jsonl by cell, the checks, the breakages and the host's rates.  usage: summary.py OUT"""
import json
import sys
from collections import defaultdict
from pathlib import Path
from statistics import median

out = Path(sys.argv[1])
rows = [json.loads(line) for line in open(out / "rows.jsonl")]
cells = defaultdict(list)
for r in rows:
    cells[(r["fs"], r["n"], r["place"], r["position"], r["method"], r["mode"])].append(r)


def mb(b):
    return f"{b / 1e6:.1f} MB" if b >= 1e6 else f"{b / 1e3:.0f} kB"


def t(ns):
    s = ns / 1e9
    return f"{s:.2f} s" if s >= 0.1 else f"{s * 1e3:.1f} ms"


print("fs n place position method | written dev_written | read readback | warm (min-max) | durable (min-max) | clone")
for (fs, n, place, pos, method, mode), rs in sorted(cells.items()):
    if mode != "warm":
        continue
    d = cells[(fs, n, place, pos, method, "durable")]
    walls = sorted(r["wall_ns"] for r in rs)
    dwalls = sorted(r["wall_ns"] for r in d)
    print(f"{fs} {n} {place} {pos} {method} | {mb(median(r['written'] for r in rs))} {mb(median(r['dev_written'] for r in d))}"
          f" | {mb(median(r['read'] for r in rs))} {mb(median(r['readback'] for r in rs))}"
          f" | {t(median(walls))} ({t(walls[0])}-{t(walls[-1])}) | {t(median(dwalls))} ({t(dwalls[0])}-{t(dwalls[-1])})"
          f" | {rs[0]['clone']} {t(median(r['clone_ns'] for r in rs))}")
print()
for c in map(json.loads, open(out / "checks.jsonl")):
    print(c)
print((out / "mutate.txt").read_text())
for fs in ("xfs", "ext4"):
    h = [json.loads(line) for line in open(out / "host.jsonl")]
    h = [r for r in h if r["fs"] == fs]
    for k in ("write_cached_s", "write_fsync_s", "read_direct_s"):
        v = sorted(r["bytes"] / r[k] / 1e9 for r in h)
        print(f"{fs} {k}: {median(v):.2f} GB/s ({v[0]:.2f}-{v[-1]:.2f})")
