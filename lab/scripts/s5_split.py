#!/usr/bin/env python3
"""Split the read-path margin into the reader loop and io_uring, per regime.

`pool` and `hybrid` differ in **two** things at once — the reader loop and the miss
mechanism — so neither isolates either (risk **R8**). `pool_ringloop` holds the loop fixed
against `hybrid` and the miss mechanism fixed against `pool`, which makes the split
subtraction valid:

    L    = pool_ringloop - pool             the loop alone
    R    = hybrid       - pool_ringloop     the ring alone
    L+R  = hybrid       - pool              what the campaign reports

`hybrid_lazyring` is reported alongside where present: `hybrid` with the ring built on the
first miss, which is the design the split implies (keep L on hits, keep R on misses, skip
the idle ring).

The rule is `RERUN.md` §Precision, applied mechanically: a difference counts only if
|median| >= 28.5% **and** sign agreement >= 0.8n **and** it keeps its sign across runs.
Regime is read off `pool`'s miss rate so every arm in a cell is classified identically.

    lab/scripts/s5_split.py docs/disk-access/v24_s5_loop_vs_ring.tsv [more.tsv ...]
"""
import csv
import math
import statistics as st
import sys
from pathlib import Path

KEY = ["label", "prefetch", "temp", "shape", "size", "stride", "depth", "readers", "repeat"]
DRIFT = 28.5
MIN_N = 5


def regime(miss_pct: float) -> str:
    return "hit" if miss_pct < 5 else ("miss" if miss_pct >= 50 else "mix")


def load(path):
    cells = {}
    with open(path, newline="") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            cells.setdefault(tuple(r[k] for k in KEY), {})[r["arm"]] = r
    return cells


def deltas(cells, a, b, run):
    """% change of arm `a` against baseline `b`, paired per cell, bucketed by regime."""
    out = {}
    for key, arms in cells.items():
        if a not in arms or b not in arms or "pool" not in arms:
            continue
        if run and not key[0].startswith(run):
            continue
        base = int(arms[b]["cpu_ns_per_ask"])
        if not base:
            continue
        got = int(arms[a]["cpu_ns_per_ask"])
        out.setdefault(regime(float(arms["pool"]["miss_pct"])), []).append(
            (got - base) / base * 100
        )
    return out


def verdict(vals):
    if len(vals) < MIN_N:
        return f"{'n/a':>28}"
    med, n = st.median(vals), len(vals)
    agree = max(sum(1 for v in vals if v < 0), sum(1 for v in vals if v > 0))
    ok = abs(med) >= DRIFT and agree >= math.ceil(0.8 * n)
    return f"{med:+7.1f}%  {agree:>3}/{n:<4} {'RESOLVED' if ok else 'tie':<8}"


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for arg in sys.argv[1:]:
        cells = load(Path(arg))
        runs = sorted({k[0].split("_")[0] for k in cells})
        arms = {a for v in cells.values() for a in v}
        pairs = [
            ("L   loop alone       pool_ringloop - pool", "pool_ringloop", "pool"),
            ("R   ring alone       hybrid - pool_ringloop", "hybrid", "pool_ringloop"),
            ("L+R campaign reports hybrid - pool", "hybrid", "pool"),
        ]
        if "hybrid_lazyring" in arms:
            pairs.append(
                ("Z   lazy ring        hybrid_lazyring - pool", "hybrid_lazyring", "pool")
            )
        print(f"=== {Path(arg).name} ===")
        for title, a, b in pairs:
            if a not in arms or b not in arms:
                continue
            print(title)
            for g in ["hit", "mix", "miss"]:
                cols = "".join(
                    f"{r:>6} {verdict(deltas(cells, a, b, r).get(g, []))}" for r in runs
                )
                print(f"   {g:5}{cols}")
            print()


if __name__ == "__main__":
    main()
