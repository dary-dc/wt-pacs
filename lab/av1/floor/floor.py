#!/usr/bin/env python3
"""Row 194: per series, the noise floor every lossless coder pays, and what a linear predictor in 2D and across
slices leaves — docs/codecs/README.md §Beside the codec.

    python3 lab/av1/floor/floor.py lab/av1/data/ct_lidc [more sets...]
"""
import json
import math
import sys
import tempfile
from pathlib import Path

import numpy as np

BLOCK = 16
BINS = 24  # intensity bins for the noise level function
FLOOR_QUANTILE = 0.25  # the flattest blocks of an intensity: their spread is noise, not texture
MARGIN = 2
LAPLACE = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], dtype=np.float64)
CAUSAL = [(0, -1), (-1, 0), (-1, -1), (-1, 1), (0, -2), (-2, 0), (-1, -2), (-1, 2), (-2, -1), (-2, 1)]  # (dy, dx)
ACROSS = [(0, 0), (0, -1), (0, 1), (-1, 0), (1, 0)]  # the previous slice, co-located and its four neighbours


def frames(path):
    meta = json.loads((path / "metadata.json").read_text())
    dtype = "<i2" if meta["signed"] else "<u2"
    shape = (meta["height"], meta["width"], meta["channels"])
    for i in range(meta["frameCount"]):
        f = np.fromfile(path / f"{i:03d}.raw", dtype=dtype).reshape(shape)
        yield f[..., 0].astype(np.float64)
    return meta


def gauss_bits(sigma):
    """Entropy, bits, of a Gaussian of `sigma` rounded to integers: the least any coder spends on such a sample."""
    if sigma < 0.05:
        return 0.0
    k = np.arange(-int(12 * sigma) - 2, int(12 * sigma) + 3)
    cdf = np.vectorize(lambda v: 0.5 * (1 + math.erf(v / (sigma * math.sqrt(2)))))
    p = cdf(k + 0.5) - cdf(k - 0.5)
    p = p[p > 0]
    return float(-(p * np.log2(p)).sum())


def shifted(a, dy, dx):
    """a[y + dy, x + dx], valid on the interior the caller crops to."""
    return np.roll(a, (-dy, -dx), axis=(0, 1))


def design(cur, prev, taps):
    """The causal neighbours (and the previous slice's) of every interior sample, a constant last; and the samples."""
    cols = [shifted(cur, dy, dx) for dy, dx in CAUSAL]
    if prev is not None:
        cols += [shifted(prev, dy, dx) for dy, dx in taps]
    h, w = (cur.shape[0] - 2 * MARGIN) // BLOCK * BLOCK, (cur.shape[1] - 2 * MARGIN) // BLOCK * BLOCK
    crop = (slice(MARGIN, MARGIN + h), slice(MARGIN, MARGIN + w))
    a = np.stack([c[crop].ravel() for c in cols] + [np.ones(h * w)], 1)
    return a, cur[crop].ravel(), (h, w)


def residual(cur, prev, taps, weights=None):
    """Integer residual of a least-squares causal linear predictor (fitted to this frame unless given), as h × w."""
    a, y, shape = design(cur, prev, taps)
    w = np.linalg.lstsq(a, y, rcond=None)[0] if weights is None else weights
    return (y - np.rint(a @ w)).reshape(shape)


def entropy_bits(values):
    _, n = np.unique(values, return_counts=True)
    p = n / n.sum()
    return float(-(p * np.log2(p)).sum())


def blocks(a):
    h, w = a.shape
    return a.reshape(h // BLOCK, BLOCK, w // BLOCK, BLOCK).swapaxes(1, 2).reshape(-1, BLOCK * BLOCK)


def high_pass_sigma(f, shape):
    """Per block, Immerkær's noise σ (CVIU 64(2), 1996): the Laplacian mask's mean response, exact for white noise."""
    h, w = shape
    r = sum(LAPLACE[i, j] * f[MARGIN - 1 + i:MARGIN - 1 + i + h, MARGIN - 1 + j:MARGIN - 1 + j + w]
            for i in range(3) for j in range(3))
    return blocks(np.abs(r)).mean(1) * math.sqrt(math.pi / 2) / 6


def block_ids(shape):
    """Each sample's block, in blocks()' order."""
    y, x = np.indices(shape)
    return ((y // BLOCK) * (shape[1] // BLOCK) + x // BLOCK).ravel()


def bin_of(means, edges):
    return np.clip(np.searchsorted(edges, means, side="right") - 1, 0, len(edges) - 2)


def series(path):
    """The flattest quarter of each intensity's blocks is noise. The floor is its rounded-Gaussian entropy, twice:
    from Immerkær's σ (low for correlated noise) and from one predictor's residual fitted on those blocks (high)."""
    fs = list(frames(path))
    r2, r3, means, spreads, highs = [], [], [], [], []
    for i, f in enumerate(fs):
        r = residual(f, None, ())
        r2.append(r.ravel())
        if i:
            r3.append(residual(f, fs[i - 1], ACROSS).ravel())
        _, y, shape = design(f, None, ())
        means.append(blocks(y.reshape(shape)).mean(1))
        spreads.append(blocks(r).std(1))
        highs.append(high_pass_sigma(f, shape))
    means, spreads, highs = np.concatenate(means), np.concatenate(spreads), np.concatenate(highs)
    edges = np.unique(np.quantile(means, np.linspace(0, 1, BINS + 1)))
    which = bin_of(means, edges)
    cut = np.array([np.quantile(spreads[which == b], FLOOR_QUANTILE) for b in range(len(edges) - 1)])
    flat = spreads <= cut[which]
    ata, aty, n = 0, 0, 0
    for f, sel in zip(fs, np.split(flat, len(fs))):
        a, y, shape = design(f, None, ())
        rows = sel[block_ids(shape)]
        ata, aty = ata + a[rows].T @ a[rows], aty + a[rows].T @ y[rows]
    weights = np.linalg.solve(ata + 1e-9 * np.eye(len(aty)), aty)
    inn = []
    for f, sel in zip(fs, np.split(flat, len(fs))):
        inn.append(blocks(residual(f, None, (), weights))[sel])
    inn_which = which[flat]
    sigma = np.array([np.concatenate(inn)[inn_which == b].std() for b in range(len(edges) - 1)])
    low = np.array([highs[flat & (which == b)].mean() for b in range(len(edges) - 1)])
    bits = np.array([gauss_bits(s) for s in sigma])[which].mean()
    low_bits = np.array([gauss_bits(s) for s in low])[which].mean()
    h3 = entropy_bits(np.concatenate(r3)) if r3 else float("nan")
    return {"series": path.name, "frames": len(fs), "floor_bits": [round(float(low_bits), 3), round(float(bits), 3)],
            "pred2d_bits": round(entropy_bits(np.concatenate(r2)), 3), "pred3d_bits": round(h3, 3),
            "pred2d_bits_same_frames": round(entropy_bits(np.concatenate(r2[1:])), 3) if r3 else None,
            "sigma_by_intensity": [[round(float(e), 1), round(float(lo), 2), round(float(hi), 2)]
                                   for e, lo, hi in zip(edges, low, sigma)]}


def check():
    """The estimators recover what they are given."""
    rng = np.random.default_rng(1)
    flat = 1000 + rng.normal(0, 8, (256, 256))
    assert abs(gauss_bits(8) - math.log2(8 * math.sqrt(2 * math.pi * math.e))) < 0.01
    assert gauss_bits(0.01) == 0.0 and 1.1 < gauss_bits(0.5) < 1.35
    ramp = np.add.outer(np.arange(256.0), 2 * np.arange(256.0))
    assert entropy_bits(residual(ramp, None, ())) == 0.0  # a plane is predicted exactly
    noisy = np.rint(flat)
    assert abs(entropy_bits(residual(noisy, None, ())) - gauss_bits(8)) < 0.15
    assert abs(residual(noisy, None, ()).mean()) < 0.2  # rounded, not truncated
    twin = noisy + 0
    assert entropy_bits(residual(twin, noisy, ACROSS)) == 0.0  # a slice equal to the last is free across slices
    assert (blocks(block_ids((64, 48)).reshape(64, 48)) == np.arange(12)[:, None]).all()
    with tempfile.TemporaryDirectory() as d:  # a smooth body under σ 6 noise, and a flat pad: the floor is the noise's
        d = Path(d)
        body = 2000 + 400 * np.sin(np.add.outer(np.arange(256), np.arange(256)) / 40)
        for i in range(4):
            f = body + rng.normal(0, 6, body.shape)
            f[192:] += rng.normal(0, 30, (64, 256))  # texture, not noise: the flattest blocks must skip it
            f = np.rint(f)
            f[:, :64] = 0
            f.astype("<u2").tofile(d / f"{i:03d}.raw")
        (d / "metadata.json").write_text(json.dumps({"signed": False, "height": 256, "width": 256, "channels": 1,
                                                     "frameCount": 4}))
        low, high = series(d)["floor_bits"]
        want = gauss_bits(6) * 180 / 240  # cropped to 240 columns from 2, 62 of them the pad
        assert abs(low - want) < 0.1 and high >= low, (low, high, want)


if __name__ == "__main__":
    check()
    for arg in sys.argv[1:]:
        print(json.dumps(series(Path(arg))))
