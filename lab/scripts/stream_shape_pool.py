#!/usr/bin/env python3
"""T3's estimator, fixed before the run: pooled miss samples, not median-of-p95.

The Phase C review found the two disagree on sign of slope over the same 80 rows, and N11
asked for pooling. This reads `stream_shape_cells.sh`'s JSONs, pools every positive wait
across repeats per arm, and bootstraps a CI on each arm's p95 ratio against the reference.

    lab/scripts/stream_shape_pool.py <out-dir> [--ref shared] [--boot 10000]

Void checks run first and are fatal to the cell, not a footnote: a cell whose reference arm
records fewer than 20 misses cannot separate anything, and one whose reader never met its
schedule is outside the model the metric is defined in.
"""
from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

MIN_MISSES = 20


def nearest_rank(xs: list[float], p: float) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    return s[min(max(math.ceil(p / 100 * len(s)), 1), len(s)) - 1]


def load(out_dir: Path) -> dict[str, list[dict]]:
    arms: dict[str, list[dict]] = {}
    for f in sorted(out_dir.glob("*.r*.json")):
        run = json.loads(f.read_text())
        arms.setdefault(run.get("stream_mode") or run.get("arm_label", ""), []).append(run)
    return arms


def ratio_ci(a: list[float], b: list[float], boot: int) -> tuple[float, float]:
    """Bootstrap CI on p95(a)/p95(b) - 1, resampling each pool independently."""
    rs = random.Random(20260914)
    out = []
    for _ in range(boot):
        ra = [a[rs.randrange(len(a))] for _ in range(len(a))]
        rb = [b[rs.randrange(len(b))] for _ in range(len(b))]
        pb = nearest_rank(rb, 95)
        if pb > 0:
            out.append(nearest_rank(ra, 95) / pb - 1)
    out.sort()
    return (out[int(0.025 * len(out))] * 100, out[int(0.975 * len(out))] * 100)


def main() -> int:
    args = sys.argv[1:]
    out_dir = Path(args[0])
    ref = args[args.index("--ref") + 1] if "--ref" in args else "shared"
    boot = int(args[args.index("--boot") + 1]) if "--boot" in args else 10000

    arms = load(out_dir)
    if ref not in arms:
        print(f"reference arm `{ref}` has no runs in {out_dir}", file=sys.stderr)
        return 2

    pools = {a: [w for r in runs for w in r["wait_ms"] if w > 0] for a, runs in arms.items()}
    void = []
    if len(pools[ref]) < MIN_MISSES:
        void.append(f"{ref} pooled only {len(pools[ref])} misses, under {MIN_MISSES}")
    for a, runs in arms.items():
        on_time = [r["on_time_rate"] for r in runs]
        if max(on_time) == 0.0:
            void.append(f"{a} never met its schedule (on_time_rate 0 in every repeat)")
        if max(r["censored_frac"] for r in runs) > 0.1:
            void.append(f"{a} censored over 10% of waits")
        if min(r["cache_hit_rate"] for r in runs) > 0.9:
            void.append(f"{a} served over 90% from cache — the link is not in the loop")

    print(f"{'arm':<12} {'runs':>4} {'misses':>7} {'p95_ms':>9} {'median_ms':>10} {'vs ref':>9}  CI95")
    for a in sorted(pools, key=lambda x: (x != ref, x)):
        p95 = nearest_rank(pools[a], 95)
        med = nearest_rank(pools[a], 50)
        if a == ref or not pools[a] or not pools[ref]:
            delta, ci = "—", ""
        else:
            lo, hi = ratio_ci(pools[a], pools[ref], boot)
            delta = f"{(p95 / nearest_rank(pools[ref], 95) - 1) * 100:+.1f}%"
            ci = f"[{lo:+.1f}, {hi:+.1f}]"
        print(f"{a:<12} {len(arms[a]):>4} {len(pools[a]):>7} {p95:>9.2f} {med:>10.2f} {delta:>9}  {ci}")

    if void:
        print("\nVOID — this cell decides nothing:", file=sys.stderr)
        for v in void:
            print(f"  · {v}", file=sys.stderr)
        return 1
    print("\nA CI spanning zero is not a result. T3's bar is 15% on the reference arm.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
