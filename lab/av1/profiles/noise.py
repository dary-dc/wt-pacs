#!/usr/bin/env python3
"""σ per series (README.md §5, Noise σ and ρ): the finest diagonal Haar detail, (a − b − c + d) ÷ 2 over 2×2 blocks,
its median absolute value over in-window blocks ÷ 0.6745, per frame; the series' σ is the median of its frames'.

usage: noise.py WORK OUT.jsonl SETDIR ...      (WORK holds bytes.py's <set>.display.json)
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from size import Set  # noqa: E402
from voi import window_codes  # noqa: E402


def diagonal(x):
    h, w = x.shape[0] // 2 * 2, x.shape[1] // 2 * 2
    x = x[:h, :w].astype(np.float64)
    return (x[0::2, 0::2] - x[0::2, 1::2] - x[1::2, 0::2] + x[1::2, 1::2]) / 2


def blocks_inside(mask):
    h, w = mask.shape[0] // 2 * 2, mask.shape[1] // 2 * 2
    m = mask[:h, :w]
    return m[0::2, 0::2] & m[0::2, 1::2] & m[1::2, 0::2] & m[1::2, 1::2]


def sigma(frame, inside=None):
    d = diagonal(frame)
    if inside is not None:
        d = d[blocks_inside(inside)]
    return float(np.median(np.abs(d)) / 0.6745) if d.size else float("nan")


def series(path, work):
    s = Set(Path(path))
    meta = json.loads((Path(work) / f"{s.name}.display.json").read_text())
    table = window_codes(meta["windows"][0], meta["rescale"], (1 << s.stored) - 1) if meta["windows"] else None
    per = []
    for i in range(s.n):
        v = s.frame(i)
        for c in range(s.ch):
            inside = None if table is None else (lambda a: (a > 0) & (a < 255))(table[v[..., c]])
            per.append(sigma(v[..., c], inside))
    return dict(set=s.name, sigma=float(np.median(per)), sigma_frames=[round(x, 3) for x in per])


def main():
    work, out = sys.argv[1], Path(sys.argv[2])
    with open(out, "a") as fh:
        for path in sys.argv[3:]:
            row = series(path, work)
            fh.write(json.dumps(row) + "\n")
            print(row["set"], f"σ {row['sigma']:.3f}", flush=True)


if __name__ == "__main__":
    main()
