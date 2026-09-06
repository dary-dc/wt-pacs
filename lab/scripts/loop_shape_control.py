#!/usr/bin/env python3
"""How much of `hybrid` beating `pool` is the ring, and how much is the reader loop?

`docs/disk-access/adr.md` says that on a page-cache hit "the hybrid **is** the accepted
path — the ring only serves the miss". That is true of the *product design*. It is **not**
true of the arms in `read_campaign`, which reach a hit through two different loops:

    pool            reader_pool  — `depth` Tokio tasks pulling asks off a shared atomic,
                                   each with its own heap buffer
    hybrid / uring  reader_ring  — ONE task holding `depth` ring slots, reading into
                                   registered buffers

So in the **hit** regime, where no read ever reaches the ring, `hybrid` vs `pool` measures
reader-loop concurrency shape and nothing else. That is the confound this script sizes.

Read it as: the `hit` column is the loop-shape effect alone; the `miss` column is loop shape
*plus* the ring actually serving misses. Where the two have opposite signs — the depth-64
rows on the lab and CI hosts — the ring effect is isolated cleanly, because the loop shape is
working against the hybrid there and it still wins.

    lab/scripts/loop_shape_control.py docs/disk-access/v10_campaign.tsv [more.tsv ...]
"""
import csv
import statistics as st
import sys
from pathlib import Path

# Everything that identifies a cell except the arm — pairing key. `pos` is the interleave
# position and differs between arms within a repeat, so it must not be part of the key.
KEY = ["label", "prefetch", "temp", "shape", "size", "stride", "depth", "readers", "repeat"]
MIN_N = 5


def regime(miss_pct: float) -> str:
    return "hit" if miss_pct < 5 else ("miss" if miss_pct >= 50 else "mix")


def paired(path: Path):
    """{(depth, regime): [pct delta of hybrid vs pool, ...]} — regime from pool's miss rate."""
    cells = {}
    with open(path, newline="") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            cells.setdefault(tuple(r[k] for k in KEY), {})[r["arm"]] = r
    out = {}
    for arms in cells.values():
        if "pool" not in arms or "hybrid" not in arms:
            continue
        p = int(arms["pool"]["cpu_ns_per_ask"])
        if not p:
            continue
        h = int(arms["hybrid"]["cpu_ns_per_ask"])
        reg = regime(float(arms["pool"]["miss_pct"]))
        out.setdefault((int(arms["pool"]["depth"]), reg), []).append((h - p) / p * 100)
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    print("hybrid vs pool, paired by cell. Negative = hybrid cheaper.")
    print("  hit  = reader-loop shape ONLY (the ring is never engaged on a hit)")
    print("  miss = loop shape + the ring serving the miss\n")
    print(f"{'campaign':28}{'depth':>7}{'hit (loop)':>14}{'n':>6}{'miss (loop+ring)':>19}{'n':>6}")
    for arg in sys.argv[1:]:
        path = Path(arg)
        d = paired(path)
        name = path.stem.replace("_campaign", "").replace("campaign_", "")
        for depth in sorted({k[0] for k in d}):
            hv, mv = d.get((depth, "hit"), []), d.get((depth, "miss"), [])
            if len(hv) < MIN_N and len(mv) < MIN_N:
                continue
            hs = f"{st.median(hv):13.1f}%" if len(hv) >= MIN_N else f"{'-':>14}"
            ms = f"{st.median(mv):18.1f}%" if len(mv) >= MIN_N else f"{'-':>19}"
            hn = f"{len(hv):6}" if len(hv) >= MIN_N else f"{'':6}"
            mn = f"{len(mv):6}" if len(mv) >= MIN_N else f"{'':6}"
            print(f"{name:28}{depth:>7}{hs}{hn}{ms}{mn}")
        print()


if __name__ == "__main__":
    main()
