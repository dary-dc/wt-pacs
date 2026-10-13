#!/usr/bin/env python3
"""Row 172's numbers from writer.py's JSON lines: each arm against A0, paired by round, beside the A/A resolution
(the p90 of |A0aa/A0 - 1| over the rounds), and the decision rule's inputs.

    writer_summary.py WORK
"""
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

LOWER = {"tile_hit_p50_ns", "tile_hit_p99_ns", "tile_miss_p50_ns", "fill_hit_cpu_ns_per_gb", "fill_miss_cpu_ns_per_gb",
         "write_ms"}
METRICS = ["tile_hit_p50_ns", "tile_hit_p99_ns", "tile_miss_p50_ns", "fill_hit_fps", "fill_miss_fps",
           "fill_hit_cpu_ns_per_gb", "fill_miss_cpu_ns_per_gb"]


def p90(xs):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(0.9 * len(xs)))]


def compare(rows, metrics, base="A0"):
    """{(fs, set, codec): {metric: {arm: (median ratio to base, resolution, share of rounds better)}}}."""
    by = defaultdict(dict)
    for r in rows:
        by[(r["fs"], r["set"], r["codec"], r["round"])][r["arm"]] = r
    ratios = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    for (fs, name, codec, _), arms in by.items():
        if base not in arms:
            continue
        for m in metrics:
            b = arms[base].get(m)
            if not b:
                continue
            for arm, row in arms.items():
                if row.get(m) is not None:
                    ratios[(fs, name, codec)][m][arm].append(row[m] / b)
    out = {}
    for cell, ms in ratios.items():
        out[cell] = {}
        for m, arms in ms.items():
            res = p90([abs(x - 1) for x in arms.get("A0aa", [1.0])])
            better = (lambda x: x < 1) if m in LOWER else (lambda x: x > 1)
            out[cell][m] = {arm: (statistics.median(xs), res, sum(map(better, xs)) / len(xs), len(xs))
                            for arm, xs in arms.items()}
    return out


def main():
    work = Path(sys.argv[1])
    load = lambda f: [json.loads(x) for x in (work / f).read_text().splitlines() if x.startswith("{")]  # noqa: E731
    made = load("writer-make.jsonl")
    print("## folios per frame (made) and extents")
    cells = sorted({(r["fs"], r["set"], r["codec"]) for r in made})
    arms = list(dict.fromkeys(r["arm"] for r in made))
    print("fs set codec | " + " | ".join(arms))
    for c in cells:
        rs = {r["arm"]: r for r in made if (r["fs"], r["set"], r["codec"]) == c}
        print(" ".join(c), "|", " | ".join(f"{rs[a]['folios_per_frame']:.2f} ({rs[a]['extents']})" for a in arms))
    print("void arms:", sum(r["void"] for r in made))

    time_rows = load("writer-time.jsonl")
    print(f"\n## read path: median ratio to A0 over rounds [A/A resolution, share of rounds better], n = rounds")
    print("inexact:", sum(r["inexact"] for r in time_rows), "of", sum(r["checked"] for r in time_rows), "reads")
    absolute = defaultdict(list)
    for r in time_rows:
        absolute[(r["fs"], r["set"], r["codec"], r["arm"])].append(r)
    for cell, ms in sorted(compare(time_rows, METRICS).items()):
        print(f"\n### {' '.join(cell)}")
        a0 = absolute[(*cell, "A0")]
        print("A0 absolute medians: " + ", ".join(f"{m} {statistics.median(r[m] for r in a0):.4g}" for m in METRICS))
        for m in METRICS:
            row = ms[m]
            print(f"{m:26s} " + "  ".join(f"{a} {row[a][0]:.3f} [{row[a][1]:.3f}, {row[a][2]:.2f}]" for a in arms if a in row)
                  + f"  n={row['A0'][3]}")

    pt = work / "writer-packtime.jsonl"
    if pt.exists():
        rows = [dict(r, arm=r["arm"]) for r in load("writer-packtime.jsonl")]
        print("\n## pack wall time, ms: median over rounds (write; warm)")
        agg = defaultdict(list)
        for r in rows:
            agg[(r["fs"], r["set"], r["codec"], r["arm"])].append(r)
        for c in cells:
            print(" ".join(c), "|", " | ".join(
                f"{a} {statistics.median(r['write_ms'] for r in agg[(*c, a)]):.1f}"
                + (f"+{statistics.median(r['warm_ms'] for r in agg[(*c, a)]):.1f}" if agg[(*c, a)] and agg[(*c, a)][0]["warm_ms"] else "")
                for a in arms if agg[(*c, a)]))


if __name__ == "__main__":
    main()
