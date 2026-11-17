#!/usr/bin/env python3
"""Cell B's last reading: each codec's median in-window error where its worst frame reaches e_N ÷ σ = 1.00,
interpolated linearly between the tested points around it; same inputs as report.py.

usage: e_at_bar.py CELL_B.jsonl HARNESS DEPTH8_STAGE_C.jsonl
"""
import sys
from pathlib import Path

import numpy as np

import report as R


def e_at(points, bar):
    pts = sorted((w, e) for _, w, _, e in points)
    for (w0, e0), (w1, e1) in zip(pts, pts[1:]):
        if w0 <= bar <= w1 and w1 > w0:
            return e0 + (bar - w0) / (w1 - w0) * (e1 - e0)
    return None


def main():
    b, metrics, stage_c = R.rows(sys.argv[1]), Path(sys.argv[2]) / "lab/av1/metrics", R.rows(sys.argv[3])
    av1 = [r for p in sorted(metrics.glob("rows/shard-*.jsonl")) + [metrics / "pilot/dbt12_ea1141.jsonl"]
           for r in R.rows(p)]
    ratios = []
    for s in (r for r in b if r["kind"] == "series"):
        name, sigma = s["set"], s["sigma"]
        hj = [(r["delta"], R.worst(r, sigma), R.size(r), R.e_med(r)) for r in b
              if r["kind"] == "cell" and r["set"] == name and r["delta"]]
        form = "top10" if s["b"] > 10 else f"{s['b']}bit"
        ref = [r for r in av1 if r["kind"] == "cell" and r["set"] == name and r["form"] == form and r["g"] == 8] or \
              [r for r in stage_c if r["kind"] == "cell" and r["set"] == name and r["form"] == form and r["g"] == 1]
        a = list({r["q"]: (r["q"], R.worst(r, sigma), R.size(r), R.e_med(r)) for r in ref}.values())
        eh, ea = e_at(hj, 1.0), e_at(a, 1.0)
        ratios.append(eh / ea)
        print(f"| `{name}` | {eh:.2f} | {ea:.2f} | {eh / ea:.2f} |")
    print(f"\nHTJ2K ÷ AV1: {min(ratios):.2f}–{max(ratios):.2f}, median {np.median(ratios):.2f}, n {len(ratios)}")


if __name__ == "__main__":
    main()
