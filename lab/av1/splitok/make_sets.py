#!/usr/bin/env python3
"""Row 43's synthetic sources: per depth b = 8…16 and signedness, one set a geometry, each frame
written with the SHA-256 of its samples before anything codes it, as lab/av1/fetch_data.py writes a set.

  OUT/{b}{u|s}/{geometry}/NNN.raw, NNN.sha256, metadata.json

Frames of every set: a ramp (every value of the range when the frame holds 2^b samples, else both
ends and evenly between), all zero, all max, a zero/max checkerboard, uniform noise, a smooth
gradient, the range's two extremes in rows. `pad` sets: real-looking data over the upper part of the
range and, in one frame only, a border at the range's minimum (the CT's −2048), so the offset is the
series'. Every set's range is the full b bits, so its bits after the offset are b.

usage: make_sets.py OUT [--large]   — lab/av1/splitok/README.md
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

SMALL = {"16x16": (16, 16), "17x13": (17, 13), "1x64": (1, 64), "64x1": (64, 1), "65x127": (65, 127),
         "256x256": (256, 256)}
LARGE = {"1914x2572": (1914, 2572), "4096x5120": (4096, 5120)}
DEPTHS = range(8, 17)


def splits(b):
    """Every k a rule could pick: the smallest whose top fits a 12-bit stream, up to a top of 8 bits."""
    return range(max(0, b - 12), max(b - 8, 4) + 1)


def frames(b, signed, w, h, rng):
    lo = -(1 << (b - 1)) if signed else 0
    hi = lo + (1 << b) - 1
    n = w * h
    full = np.arange(n) % (1 << b) if n >= 1 << b else np.round(np.linspace(0, (1 << b) - 1, n))
    y, x = np.mgrid[0:h, 0:w]
    zero = max(lo, 0)
    yield "ramp", (lo + full).reshape(h, w)
    yield "zero", np.full((h, w), zero)
    yield "max", np.full((h, w), hi)
    yield "checker", np.where((x + y) % 2, hi, zero)
    yield "noise", rng.integers(lo, hi + 1, (h, w))
    yield "gradient", lo + np.round((x + y) / max(w + h - 2, 1) * (hi - lo))
    yield "extremes", np.where(y % 2 if h > 1 else x % 2, hi, lo)


def pad_frames(b, signed, w, h, rng):
    """Four frames of soft discs with grain over the range's upper three quarters; frame 2 has a border at its minimum."""
    lo = -(1 << (b - 1)) if signed else 0
    hi = lo + (1 << b) - 1
    floor = lo + (1 << (b - 2))
    y, x = np.mgrid[0:h, 0:w] / max(w, h)
    for i in range(4):
        v = 0.5 + 0.3 * np.sin(6 * x + 2 * i) * np.cos(5 * y)
        for _ in range(4):
            cx, cy, r = rng.random(3) * [1, 1, 0.3]
            v = v + 0.25 * np.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (r * r + 0.01))
        v = v + rng.normal(0, 0.02, v.shape)
        v = floor + np.round((v - v.min()) / (v.max() - v.min()) * (hi - floor))
        if i == 2:
            v[:, : max(1, w // 8)] = lo
        yield f"pad{i}", v


def write_set(d, b, signed, w, h, named):
    d.mkdir(parents=True, exist_ok=True)
    dtype = ("i1" if signed else "u1") if b <= 8 else ("<i2" if signed else "<u2")
    lo, hi, names = None, None, []
    for i, (name, v) in enumerate(named):
        px = v.astype(np.int64).astype(dtype).reshape(h, w, 1)
        assert np.array_equal(px.astype(np.int64)[..., 0], v.astype(np.int64)), name
        px.tofile(d / f"{i:03d}.raw")
        (d / f"{i:03d}.sha256").write_text(hashlib.sha256(px.tobytes()).hexdigest() + "\n")
        lo = int(px.min()) if lo is None else min(lo, int(px.min()))
        hi = int(px.max()) if hi is None else max(hi, int(px.max()))
        names.append(name)
    stored = 8 if dtype in ("u1", "i1") else 16
    meta = dict(frameCount=len(names), width=w, height=h, channels=1, bitsStored=stored, signed=signed,
                min=lo, max=hi, frames=names, bits=b)
    (d / "metadata.json").write_text(json.dumps(meta) + "\n")
    offset = -lo if lo < 0 else 0
    assert (hi + offset).bit_length() == b, (d, lo, hi)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out", type=Path)
    ap.add_argument("--large", action="store_true")
    a = ap.parse_args()
    geometries = LARGE if a.large else SMALL
    for b in DEPTHS:
        for signed in (False, True):
            rng = np.random.default_rng(b * 2 + signed)
            for g, (w, h) in geometries.items():
                d = a.out / f"{b}{'s' if signed else 'u'}" / g
                named = list(frames(b, signed, w, h, rng))
                if a.large:
                    named = [f for f in named if f[0] in ("ramp", "noise", "extremes")]
                write_set(d, b, signed, w, h, named)
            if not a.large:
                write_set(a.out / f"{b}{'s' if signed else 'u'}" / "pad", b, signed, 65, 127,
                          list(pad_frames(b, signed, 65, 127, rng)))
    print(f"{a.out}: {len(DEPTHS) * 2} depths × signs, geometries {', '.join(geometries)}")


if __name__ == "__main__":
    main()
