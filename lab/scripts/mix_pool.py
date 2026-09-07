#!/usr/bin/env python3
"""Pool a mix campaign's per-ask samples into percentiles with bootstrap CIs.

A cell's own p99 is one observation with a tail's worth of leverage, and the mix cells are
smaller than the first campaign's (128 asks, not 320). Pooling across repeats is what makes
a percentile mean anything here. The CI is still only sampling noise inside one run --
`docs/disk-access/RERUN.md` Precision has the rule that follows from that.

Usage:
  mix_pool.py SAMPLES.tsv [--summary SUMMARY.tsv] [--by mix_target|concurrency]
"""
import argparse, collections, random, statistics, sys


def pct(xs, p):
    if not xs:
        return 0
    k = max(0, min(len(xs) - 1, int(round(p * (len(xs) - 1)))))
    return xs[k]


def boot(xs, p, n=400, seed=7):
    if len(xs) < 20:
        return (0, 0)
    rnd = random.Random(seed)
    out = []
    for _ in range(n):
        s = sorted(rnd.choices(xs, k=len(xs)))
        out.append(pct(s, p))
    out.sort()
    return (pct(out, 0.025), pct(out, 0.975))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("samples")
    ap.add_argument("--summary")
    ap.add_argument("--by", default="mix_target")
    ap.add_argument("--baseline", default="pread_nowait_chunked")
    a = ap.parse_args()

    rows = collections.defaultdict(list)
    with open(a.samples) as f:
        head = f.readline().rstrip("\n").split("\t")
        ix = {c: i for i, c in enumerate(head)}
        for line in f:
            c = line.rstrip("\n").split("\t")
            rows[(c[ix["arm"]], f"{float(c[ix[a.by]]):.4f}")].append(
                (int(c[ix["latency_ns"]]), int(c[ix["hop_events"]]))
            )

    agg = {}
    if a.summary:
        s = collections.defaultdict(list)
        with open(a.summary) as f:
            head = f.readline().rstrip("\n").split("\t")
            ix = {c: i for i, c in enumerate(head)}
            for line in f:
                c = line.rstrip("\n").split("\t")
                key = (c[ix["arm"]], f"{float(c[ix[a.by]]):.4f}")
                s[key].append(
                    (
                        float(c[ix["throughput_fps"]]),
                        int(c[ix["cpu_per_ask_ns"]]),
                        int(c[ix["threads_max"]]),
                    )
                )
        for k, v in s.items():
            agg[k] = (
                statistics.median(x[0] for x in v),
                statistics.median(x[1] for x in v),
                max(x[2] for x in v),
            )

    groups = sorted({k[1] for k in rows}, key=float)
    for g in groups:
        base = rows.get((a.baseline, g))
        base_p50 = pct(sorted(x[0] for x in base), 0.50) if base else None
        print(f"\n=== {a.by} = {g} ===")
        print(
            f"{'arm':24s} {'n':>6s} {'p50 us':>9s} {'95% CI':>19s} {'p99 us':>9s} "
            f"{'hop/ask':>8s} {'fps':>8s} {'cpu/ask us':>11s} {'thr':>4s} {'vs base':>8s}"
        )
        for arm in sorted({k[0] for k in rows}):
            v = rows.get((arm, g))
            if not v:
                continue
            lat = sorted(x[0] for x in v)
            hops = sum(x[1] for x in v) / len(v)
            lo, hi = boot(lat, 0.50)
            fps, cpu, thr = agg.get((arm, g), (0, 0, 0))
            p50 = pct(lat, 0.50)
            rel = f"{(p50/base_p50 - 1)*100:+7.1f}%" if base_p50 else "      -"
            print(
                f"{arm:24s} {len(lat):6d} {p50/1000:9.1f} "
                f"[{lo/1000:8.1f},{hi/1000:8.1f}] {pct(lat,0.99)/1000:9.1f} "
                f"{hops:8.2f} {fps:8.1f} {cpu/1000:11.1f} {thr:4d} {rel:>8s}"
            )


if __name__ == "__main__":
    sys.exit(main())
