#!/usr/bin/env python3
"""ENCX's cheap estimate of how many low bits are noise, per frame, over the samples whose 2×2
neighbourhood is not flat: the noise's scale σ from the residual of LOCO-I's median predictor, and the
estimate k̂ = ⌊log2 σ⌋ clamped to the k a set can be split at. Beside it, each of the four lowest bit
planes' entropy given the same plane's left, upper and upper-left neighbours (1 = nothing predicts it).

usage: noise.py OUT.json SET_DIR ...   — README.md here
"""
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "llsize"))
import encx  # noqa: E402
import llsize  # noqa: E402
import size  # noqa: E402



def active(v):
    """Samples whose 2×2 neighbourhood is not flat: a flat background predicts its low bits for free."""
    x, l, u, ul = v[1:, 1:], v[1:, :-1], v[:-1, 1:], v[:-1, :-1]
    return ~((x == l) & (x == u) & (x == ul))


def conditional_entropy(b, mask):
    """b: h×w of 0/1. H(b | left, up, up-left) in bits, over the samples in mask."""
    x, l, u, ul = b[1:, 1:], b[1:, :-1], b[:-1, 1:], b[:-1, :-1]
    ctx = ((l << 2 | u << 1 | ul) * 2 + x)[mask]
    counts = np.bincount(ctx, minlength=16).reshape(8, 2).astype(float)
    n = counts.sum()
    h = 0.0
    for c in counts:
        t = c.sum()
        if t:
            p = c[c > 0] / t
            h -= t / n * (p * np.log2(p)).sum()
    return h


def noise_sigma(v, mask):
    """The noise's scale: 1.4826 × the median |residual| of LOCO-I's median predictor, over mask."""
    v = v.astype(np.int64)
    x, a, b, c = v[1:, 1:], v[1:, :-1], v[:-1, 1:], v[:-1, :-1]
    pred = np.where(c >= np.maximum(a, b), np.minimum(a, b), np.where(c <= np.minimum(a, b), np.maximum(a, b), a + b - c))
    return 1.4826 * float(np.median(np.abs(x - pred)[mask]))


def estimate(sigma, allowed):
    """The low bits under the noise's scale: 2^k ≤ σ."""
    k = int(np.floor(np.log2(sigma))) if sigma >= 1 else 0
    return min(max(k, min(allowed)), max(allowed))


def main():
    out, *sets = sys.argv[1:]
    rows = []
    for path in sets:
        s = size.Set(Path(path))
        allowed = encx.low_split(s)
        _, _, take = encx.plane(s, "direct")
        for i in range(llsize.frames(s)):
            px = take(i)
            masks = [active(px[..., c]) for c in range(s.ch)]
            h = [round(float(np.mean([conditional_entropy((px[..., c] >> j) & 1, masks[c]) for c in range(s.ch)])), 4)
                 for j in range(4)]
            sigma = round(float(np.mean([noise_sigma(px[..., c], masks[c]) for c in range(s.ch)])), 3)
            rows.append(dict(set=s.name, frame=i, h=h, sigma=sigma, k=estimate(sigma, allowed),
                             active=round(float(np.mean([m.mean() for m in masks])), 3)))
            print(rows[-1], flush=True)
    Path(out).write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
