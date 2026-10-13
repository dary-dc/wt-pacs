#!/usr/bin/env python3
"""Row 160's tables from run.py's JSON lines: each arm against `.sbnd` v1 under disk-access.md §2's paired rule.

A difference counts when the median of the per-round ratios (arm / sbnd1, the same set, payload and round) is
further from 1 than the resolution, and at least 80 % of those pairs agree in sign; anything else is a tie. The
resolution is measured here, not borrowed: the 90th percentile of |ratio − 1| between `sbnd1` and `sbnd1-aa`, the
same packer's output at another path.

    summary.py WORK [SET ...]
"""
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

METRICS = {
    "tile_hit_p50_ns": ("read latency, hit (p50)", "µs", 1e-3, -1),
    "tile_miss_p50_ns": ("read latency, forced miss (p50)", "µs", 1e-3, -1),
    "fill_hit_fps": ("fill, hit", "frames/s", 1, 1),
    "fill_miss_fps": ("fill, forced miss", "frames/s", 1, 1),
    "fill_hit_cpu_ns_per_gb": ("CPU per GB, fill hit", "ms/GB", 1e-6, -1),
    "fill_miss_cpu_ns_per_gb": ("CPU per GB, fill forced miss", "ms/GB", 1e-6, -1),
    "open_warm_ns": ("open, warm (p50)", "µs", 1e-3, -1),
    "open_cold_ns": ("open, cold O_DIRECT (p50)", "µs", 1e-3, -1),
}
ARM_ORDER = ["sbnd1", "sbnd1-aa", "sbnd2", "mp4", "mp4-ff", "fmp4-1", "fmp4-30", "mkv", "mkv-ff", "dicom", "dicom-fg",
             "mxf", "mxf-ff", "ivf"]


def q(v, p):
    v = sorted(v)
    return v[min(len(v) - 1, int(len(v) * p))]


def load(work, sets):
    rows = [json.loads(line) for line in (work / "time.jsonl").open()]
    return [r for r in rows if not sets or r["set"] in sets]


def pairs(rows, metric):
    """{(set, codec, arm): [arm / sbnd1 per round]}"""
    base = {(r["set"], r["codec"], r["round"]): r[metric] for r in rows if r["arm"] == "sbnd1"}
    out = defaultdict(list)
    for r in rows:
        b = base.get((r["set"], r["codec"], r["round"]))
        if b and r["arm"] != "sbnd1":
            out[(r["set"], r["codec"], r["arm"])].append(r[metric] / b)
    return out


def verdict(ratios, resolution, better_sign):
    med = statistics.median(ratios)
    up = sum(x > 1 for x in ratios) / len(ratios)
    agree = max(up, 1 - up)
    if abs(med - 1) < resolution or agree < 0.8:
        return med, agree, "tie"
    return med, agree, "better" if (med - 1) * better_sign > 0 else "worse"


def main():
    work, sets = Path(sys.argv[1]), sys.argv[2:]
    rows = load(work, sets)
    print(f"{len(rows)} cells, {len({r['round'] for r in rows})} rounds, "
          f"{sum(r['checked'] for r in rows)} frames read and checked, {sum(r['inexact'] for r in rows)} inexact")
    res = {}
    for m in METRICS:
        aa = [abs(x - 1) for k, v in pairs(rows, m).items() if k[2] == "sbnd1-aa" for x in v]
        res[m] = q(aa, 0.9)
    print("\nresolution (p90 |sbnd1-aa / sbnd1 - 1|): " + ", ".join(f"{METRICS[m][0]} {res[m]:.1%}" for m in METRICS))

    for m, (label, unit, scale, sign) in METRICS.items():
        print(f"\n## {label} [{unit}] — median over rounds per set·payload; pooled ratio vs sbnd1, agreement, verdict")
        p = pairs(rows, m)
        cells = sorted({(r["set"], r["codec"]) for r in rows})
        print("arm | " + " | ".join(f"{s} {c}" for s, c in cells) + " | ratio | agree | verdict")
        for arm in ARM_ORDER:
            vals = []
            for s, c in cells:
                v = [r[m] for r in rows if (r["set"], r["codec"], r["arm"]) == (s, c, arm)]
                vals.append(f"{statistics.median(v) * scale:.4g} [{min(v) * scale:.3g}–{max(v) * scale:.3g}]" if v else "—")
            if arm == "sbnd1":
                print(f"{arm} | " + " | ".join(vals) + " | 1 | — | —")
                continue
            pooled = [x for k, v in p.items() if k[2] == arm for x in v]
            if not pooled:
                continue
            med, agree, word = verdict(pooled, res[m], sign)
            print(f"{arm} | " + " | ".join(vals) + f" | {med:.3f} | {agree:.0%} | {word}")

    print("\n## open: reads and bytes the open made (constant per file)")
    seen = {}
    for r in rows:
        seen[(r["set"], r["codec"], r["arm"])] = (r["open_reads"], r["open_bytes"], r["file_bytes"], r["frames"])
    for k in sorted(seen, key=lambda k: (k[0], k[1], ARM_ORDER.index(k[2]))):
        print(" ".join(map(str, k)), *seen[k])


if __name__ == "__main__":
    main()
