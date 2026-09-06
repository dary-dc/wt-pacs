#!/usr/bin/env python3
"""Pool `--samples` rows across repeats into percentiles with bootstrap 95% CIs.

A cell's `later_p99` is the 316th of 319 samples — nearly a single observation, which is
how a tail swings 10x on luck. `disk-access-bench --samples <path>` writes one row per ask;
this pools them across repeats so a percentile rests on thousands of observations and
carries an interval instead of a bare number.

Produces `docs/disk-access/v5_warm_pooled_ci.tsv`. See `docs/disk-access/RERUN.md`
(section: Pooled percentiles beat any change of unit).

Convention, matching the bench's own `later_*` columns: **ask ordinal 0 is dropped** (it is
the first-frame cost, reported separately as `first_frame_ns`), so a 320-ask 9-repeat cell
pools 319 x 9 = 2871 samples per arm.

Usage:
    pool_samples_ci.py --run 1 run1_samples.tsv --run 2 run2_samples.tsv \
        [--temp warm] [--runtime multi] [--resamples 10000] [--seed 20260904]
"""
import argparse
import csv
import math
import random
import sys


def percentile(sorted_vals, p):
    """Nearest-rank percentile, byte-for-byte the bench's `percentile()`:
    `((len - 1) * p).round()`, clamped. Rust's `f64::round` is half-away-from-zero, so
    `math.floor(x + 0.5)` — not Python's banker's-rounding `round()`.

    This rule is what makes a 319-sample cell's p99 "the 316th of 319" (index 315)."""
    if not sorted_vals:
        raise ValueError("empty sample")
    n = len(sorted_vals)
    idx = math.floor((n - 1) * p + 0.5)
    return sorted_vals[min(idx, n - 1)]


def bootstrap_ci(vals, p, resamples, rng):
    """Percentile-method bootstrap: resample with replacement, take the 2.5/97.5 quantiles
    of the resampled statistic. Returns (lo, hi) as ints."""
    n = len(vals)
    stats = []
    for _ in range(resamples):
        draw = sorted(vals[rng.randrange(n)] for _ in range(n))
        stats.append(percentile(draw, p))
    stats.sort()
    return percentile(stats, 0.025), percentile(stats, 0.975)


def load(path, temp, trace, runtime):
    """Return {arm: [latency_ns, ...]} pooled across repeats, ordinal 0 dropped."""
    by_arm = {}
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            if temp and row["temp"] != temp:
                continue
            if trace and row["trace"] != trace:
                continue
            if runtime and row["runtime"] != runtime:
                continue
            if int(row["ordinal"]) == 0:
                continue  # first-frame cost; the bench reports it as first_frame_ns
            by_arm.setdefault(row["arm"], []).append(int(row["latency_ns"]))
    return by_arm


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", action="append", nargs=2, metavar=("LABEL", "PATH"),
                    required=True, help="run label and its samples TSV; repeatable")
    ap.add_argument("--temp", default="warm", help="filter to this temp ('' for all)")
    ap.add_argument("--trace", default="forward", help="filter to this trace ('' for all)")
    ap.add_argument("--runtime", default="multi", help="filter to this runtime ('' for all)")
    ap.add_argument("--resamples", type=int, default=10000)
    ap.add_argument("--seed", type=int, default=20260904,
                    help="fixed so the interval is reproducible, not re-rolled per run")
    ap.add_argument("--out", default="-")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    out = sys.stdout if args.out == "-" else open(args.out, "w")
    print("run\tarm\tsamples\tp50_ns\tp50_ci_lo_ns\tp50_ci_hi_ns"
          "\tp99_ns\tp99_ci_lo_ns\tp99_ci_hi_ns", file=out)

    for label, path in args.run:
        by_arm = load(path, args.temp, args.trace, args.runtime)
        if not by_arm:
            sys.exit(f"{path}: no rows matched "
                     f"temp={args.temp!r} trace={args.trace!r} runtime={args.runtime!r}")
        for arm, vals in by_arm.items():
            s = sorted(vals)
            p50, p99 = percentile(s, 0.50), percentile(s, 0.99)
            lo50, hi50 = bootstrap_ci(vals, 0.50, args.resamples, rng)
            lo99, hi99 = bootstrap_ci(vals, 0.99, args.resamples, rng)
            print(f"{label}\t{arm}\t{len(vals)}\t{p50}\t{lo50}\t{hi50}"
                  f"\t{p99}\t{lo99}\t{hi99}", file=out)
    if out is not sys.stdout:
        out.close()


if __name__ == "__main__":
    main()
