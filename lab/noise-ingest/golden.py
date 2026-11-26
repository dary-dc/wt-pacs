#!/usr/bin/env python3
"""The golden frames of `sigma.rs`'s test, made by the same integer generator, and σ by `quality.sigma` on each.

usage: golden.py   — prints each frame's σ as the bits the test pins
"""
import struct
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "av1/metrics"))
import quality  # noqa: E402

SIZES = [(16, 12), (64, 48), (203, 151)]
NOISE = [0.3, 3.0, 30.0]
MASK64 = (1 << 64) - 1


def frame(i):
    w, h = SIZES[i % 3]
    noise, masked = NOISE[i // 4], (i // 2) % 2 == 1
    state = i + 1
    v, inside = np.zeros((h, w), np.int64), np.zeros((h, w), bool)
    for y in range(h):
        for x in range(w):
            u = 0.0
            for _ in range(12):
                state = (state + 0x9E3779B97F4A7C15) & MASK64
                z = state
                z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & MASK64
                z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & MASK64
                u += (z ^ (z >> 31)) >> 11
            level = 2000 + (300 if 2 * x >= w else 0) + 3 * y
            v[y, x] = min(4095, max(0, int(np.floor(level + (u * 2.0**-53 - 6.0) * noise + 0.5))))
            inside[y, x] = not masked or ((x + y) % 7 != 0 and 4 * x < 3 * w)
    return v, inside


if __name__ == "__main__":
    for i in range(12):
        v, inside = frame(i)
        s = quality.sigma(v, inside.copy())
        print(f"0x{struct.unpack('<Q', struct.pack('<d', s))[0]:016x}, // {s!r}")
