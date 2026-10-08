#!/usr/bin/env python3
"""LOCO-I's median predictor takes each of its three branches as JPEG-LS defines them; ρ is ≈ 0 between frames of independent noise and exactly 1 between a frame and its repeat, at the best offset
and at offset 0 (docs/av1/gop-protocol.md §2's mutation).

usage: rho_test.py   — exits 1 naming each wrong case
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rho import pair, residual  # noqa: E402


def median_rho(frames):
    best, zero = zip(*(pair(residual(a), residual(b)) for a, b in zip(frames, frames[1:])))
    return float(np.median(np.concatenate(best))), float(np.median(np.concatenate(zero)))


def main():
    rng = np.random.default_rng(1)
    noise = [rng.integers(0, 1024, (400, 500)).astype(np.int64) for _ in range(3)]
    repeat = [noise[0]] * 3
    wrong = []
    for px, want in (([[4, 1], [2, 9]], 8), ([[1, 5], [3, 2]], -3), ([[2, 1], [3, 9]], 7)):
        got = int(residual(np.array(px, np.int64))[0, 0])
        if got != want:
            wrong.append(f"residual of {px}: {got}, want {want}")
    best, zero = median_rho(noise)
    if not (abs(zero) < 0.03 and 0 <= best < 0.1):
        wrong.append(f"independent noise: best {best:.4f}, zero {zero:.4f}, want ≈ 0")
    best, zero = median_rho(repeat)
    if not (abs(best - 1) < 1e-12 and abs(zero - 1) < 1e-12):
        wrong.append(f"one frame repeated: best {best:.6f}, zero {zero:.6f}, want 1")
    for w in wrong:
        print(w)
    sys.exit(1 if wrong else 0)


if __name__ == "__main__":
    main()
