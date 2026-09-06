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

**Compare campaigns only on a shared cell population.** A regime bucket is whatever cells
land in it, so a campaign that includes `C_readers` and one that does not are not comparable
bucket-for-bucket — v25's L-on-mix reads a flat tie with `C_readers` in and RESOLVED at -53%
with it out, on the same runs. Pass `--phases` to restrict every file to the same phases;
without it, a warning is printed whenever the files disagree about which phases they contain.

    lab/scripts/s5_split.py docs/disk-access/v24_s5_loop_vs_ring.tsv [more.tsv ...]
    lab/scripts/s5_split.py --phases A_stride,A_sweep v25_*.tsv v28_*.tsv
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


def phase_of(label: str) -> str:
    """`run1_A_stride` -> `A_stride`. The phase is what decides which cells exist."""
    return label.split("_", 1)[1] if "_" in label else label


def load(path, phases=None):
    cells, seen = {}, set()
    with open(path, newline="") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            ph = phase_of(r["label"])
            seen.add(ph)
            if phases and ph not in phases:
                continue
            cells.setdefault(tuple(r[k] for k in KEY), {})[r["arm"]] = r
    return cells, seen


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
    args = sys.argv[1:]
    phases = None
    if args and args[0] == "--phases":
        phases = set(args[1].split(","))
        args = args[2:]
    if not args:
        sys.exit(__doc__)

    # Comparing buckets across files only means something if the same cells feed them.
    if len(args) > 1 and phases is None:
        present = {a: load(Path(a))[1] for a in args}
        if len({frozenset(v) for v in present.values()}) > 1:
            print("WARNING: these files do not contain the same phases, so their regime")
            print("buckets are not comparable. Re-run with --phases <shared,phases>.")
            for a, v in present.items():
                print(f"  {Path(a).name}: {','.join(sorted(v))}")
            print()

    for arg in args:
        cells, _ = load(Path(arg), phases)
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
