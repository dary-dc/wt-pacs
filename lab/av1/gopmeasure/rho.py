#!/usr/bin/env python3
"""ρ of docs/av1/gop-protocol.md §2: how much of frame t's LOCO-I residual frame t + 1's predicts, before any encoder.

Per 64×64 block of frame t, the Pearson correlation of its residual with frame t + 1's at the best integer offset
within ±8 px, and at offset 0; on the optimized representation's top stream and its low stream.

usage: rho.py OUT.jsonl SET_DIR ... [--jobs N]   — README.md here
"""
import argparse
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "item"))
import ingest  # noqa: E402
import size  # noqa: E402

BLOCK, REACH = 64, 8


def residual(px):
    """LOCO-I's median predictor; the first row and column, which have no full neighbourhood, dropped."""
    a, b, c = px[1:, :-1], px[:-1, 1:], px[:-1, :-1]
    lo, hi = np.minimum(a, b), np.maximum(a, b)
    pred = np.where(c >= hi, lo, np.where(c <= lo, hi, a + b - c))
    return px[1:, 1:] - pred


def integral(x):
    s = np.zeros((x.shape[0] + 1, x.shape[1] + 1), np.int64)
    s[1:, 1:] = x.cumsum(0).cumsum(1)
    return s


def pair(r0, r1):
    """Each block's best-offset and zero-offset correlation; blocks either side of which is constant are left out."""
    nb_y, nb_x = (r0.shape[0] - 2 * REACH) // BLOCK, (r0.shape[1] - 2 * REACH) // BLOCK
    span_y, span_x = nb_y * BLOCK, nb_x * BLOCK
    n = BLOCK * BLOCK

    def sums(x):
        return x.reshape(nb_y, BLOCK, nb_x, BLOCK).sum((1, 3))
    x = r0[REACH:REACH + span_y, REACH:REACH + span_x]
    sx, sxx = sums(x), sums(x * x)
    vx = n * sxx - sx * sx
    s1, s2 = integral(r1), integral(r1 * r1)
    ys, xs = np.arange(nb_y)[:, None] * BLOCK, np.arange(nb_x)[None, :] * BLOCK
    best = np.full((nb_y, nb_x), -np.inf)
    zero = None
    defined = vx > 0
    for dy in range(-REACH, REACH + 1):
        for dx in range(-REACH, REACH + 1):
            oy, ox = REACH + dy, REACH + dx
            y = r1[oy:oy + span_y, ox:ox + span_x]
            sxy = sums(x * y)
            t, l = ys + oy, xs + ox
            sy = s1[t + BLOCK, l + BLOCK] - s1[t, l + BLOCK] - s1[t + BLOCK, l] + s1[t, l]
            syy = s2[t + BLOCK, l + BLOCK] - s2[t, l + BLOCK] - s2[t + BLOCK, l] + s2[t, l]
            vy = n * syy - sy * sy
            ok = defined & (vy > 0)
            cov = (n * sxy - sx * sy).astype(np.float64)
            rho = np.where(ok, cov / np.sqrt(np.where(ok, vx.astype(np.float64) * vy, 1.0)), np.nan)
            best = np.fmax(best, rho)
            if dy == dx == 0:
                zero = rho
    keep = defined & np.isfinite(best) & np.isfinite(zero)
    return best[keep], zero[keep]


def stream_planes(s):
    _, streams = ingest.plan(s, "optimized")
    return [(name, plane) for name, (_, _, plane) in zip(("top", "low"), streams)]


def series(path):
    s = size.Set(Path(path))
    row = dict(set=s.name, frames=s.n, pairs=s.n - 1)
    for name, plane in stream_planes(s):
        best, zero = [], []
        prev = residual(plane(0)[..., 0].astype(np.int64))
        for i in range(1, s.n):
            cur = residual(plane(i)[..., 0].astype(np.int64))
            b, z = pair(prev, cur)
            best.append(b)
            zero.append(z)
            prev = cur
        best, zero = np.concatenate(best), np.concatenate(zero)
        row[name] = dict(blocks=int(best.size), best=quantiles(best), zero=quantiles(zero))
    return row


def quantiles(x):
    return dict(p10=round(float(np.percentile(x, 10)), 4), median=round(float(np.median(x)), 4),
                p90=round(float(np.percentile(x, 90)), 4))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", nargs="+")
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    with open(a.out, "a") as fh, ProcessPoolExecutor(a.jobs) as pool:
        for row in pool.map(series, a.sets):
            fh.write(json.dumps(row) + "\n")
            fh.flush()
            print(json.dumps(row), flush=True)


if __name__ == "__main__":
    main()
