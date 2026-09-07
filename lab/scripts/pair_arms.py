#!/usr/bin/env python3
"""Paired arm-vs-arm delta by regime, under the campaign's own rule.

`s5_split.py` answers one question — how the `pool` -> `hybrid` margin splits into the
reader loop and the ring — and only ever compares against `pool` or `pool_ringloop`. The
question that decides which arm ships is a different one: **is any arm established better
than `hybrid_lazyring`?** That needs arbitrary pairs, and this runs them.

It exists because the two statistics disagree, and the readable one is not the one the rule
is defined on:

    ratio of pooled medians   median(uring) / median(hybrid_lazyring) - 1  = -41.9%
    median of paired ratios   median over cells of (uring - lazyring)/lazy = -24.0%

Both are arithmetically right on the same 84 cells of `v27_lazyring.tsv`. Only the second is
what `RERUN.md` Precision defines the threshold against, and the first is what the candidate
table in `EVIDENCE.md` shows — which is how a 24% near-miss came to be read as a 42% win,
twice. Pair before concluding.

    lab/scripts/pair_arms.py FILE.tsv [more.tsv ...]
    lab/scripts/pair_arms.py --pairs uring:hybrid_lazyring FILE.tsv
    lab/scripts/pair_arms.py --by size FILE.tsv       # split each regime by frame size
    lab/scripts/pair_arms.py --by readers FILE.tsv

Archived campaign files come out of git:

    git show a330783:docs/disk-access/v27_lazyring.tsv > /tmp/v27.tsv
"""
import argparse
import collections
import csv
import math
import statistics as st
import sys
from pathlib import Path

# One cell = one (config, repeat). Arms are compared inside a cell and never across cells.
KEY = ["label", "prefetch", "temp", "shape", "size", "stride", "depth", "readers", "repeat"]
DRIFT = 28.5
MIN_N = 5
DEFAULT_PAIRS = [
    ("uring", "hybrid_lazyring"),
    ("uring", "hybrid"),
    ("hybrid_lazyring", "hybrid"),
    ("hybrid_lazyring", "pool"),
    ("hybrid", "pool"),
]


def regime(miss_pct: float) -> str:
    return "hit" if miss_pct < 5 else ("miss" if miss_pct >= 50 else "mix")


def load(path: Path):
    cells = {}
    with open(path, newline="") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            cells.setdefault(tuple(r[k] for k in KEY), {})[r["arm"]] = r
    return cells


def deltas(cells, a, b, run=None, by=None):
    """% change of `a` against `b`, paired inside each cell, bucketed by regime (and `by`).

    Regime is read off `pool`'s miss rate so every arm in a cell is classified identically —
    an arm that misses less would otherwise classify itself into an easier bucket.
    """
    out = collections.defaultdict(list)
    for key, arms in cells.items():
        if a not in arms or b not in arms or "pool" not in arms:
            continue
        if run and not key[0].startswith(run):
            continue
        base = int(arms[b]["cpu_ns_per_ask"])
        if not base:
            continue
        got = int(arms[a]["cpu_ns_per_ask"])
        bucket = regime(float(arms["pool"]["miss_pct"]))
        if by:
            bucket = (bucket, arms["pool"][by])
        out[bucket].append((got - base) / base * 100)
    return out


def verdict(vals):
    """RESOLVED only if it beats drift **and** the sign is consistent. Otherwise a tie.

    A tie is not "no difference" — it is "not established". The margin and the sign count
    are printed so a near miss stays visible as one.
    """
    if len(vals) < MIN_N:
        return f"{'n/a (n=' + str(len(vals)) + ')':>26}"
    med, n = st.median(vals), len(vals)
    agree = max(sum(1 for v in vals if v < 0), sum(1 for v in vals if v > 0))
    ok = abs(med) >= DRIFT and agree >= math.ceil(0.8 * n)
    return f"{med:+7.1f}%  {agree:>4}/{n:<4} {'RESOLVED' if ok else 'tie':<8}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--pairs", help="comma-separated a:b pairs (default: the arm-choice set)")
    ap.add_argument("--by", choices=["size", "readers", "stride", "depth"],
                    help="split every regime by this column — frame size is the one that moves")
    a = ap.parse_args()
    pairs = DEFAULT_PAIRS
    if a.pairs:
        pairs = [tuple(p.split(":", 1)) for p in a.pairs.split(",")]

    for f in a.files:
        cells = load(Path(f))
        runs = sorted({k[0].split("_")[0] for k in cells})
        arms = {arm for v in cells.values() for arm in v}
        print(f"=== {Path(f).name} — arms: {', '.join(sorted(arms))} ===")
        for x, y in pairs:
            if x not in arms or y not in arms:
                continue
            print(f"{x} vs {y}")
            if a.by:
                for run in runs:
                    d = deltas(cells, x, y, run, a.by)
                    for g in ["hit", "mix", "miss"]:
                        rows = sorted((k for k in d if k[0] == g), key=lambda k: int(k[1]))
                        for k in rows:
                            print(f"   {run:>6} {g:5} {a.by}={k[1]:>7}  {verdict(d[k])}")
            else:
                for g in ["hit", "mix", "miss"]:
                    print(f"   {g:5}" + "".join(
                        f"{r:>6} {verdict(deltas(cells, x, y, r).get(g, []))}" for r in runs))
            print()


if __name__ == "__main__":
    sys.exit(main())
