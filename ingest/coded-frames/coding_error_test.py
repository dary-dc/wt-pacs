#!/usr/bin/env python3
"""The coding error's noise estimate reads a known noise σ within 3 %, on a smooth scene and on one with a 300-unit
edge, and the error itself is the reconstruction against its source in source units — coding_error.py,
docs/av1/payload-format.md §Coding error.

usage: python3 ingest/coded-frames/coding_error_test.py   — numpy only
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import coding_error  # noqa: E402

H, W = 512, 512
failures = []


def check(ok, claim):
    if not ok:
        failures.append(claim)
        print(f"FAIL {claim}")


def scenes():
    """A smooth ramp, and the same with a disc 300 units above it: the quality study's §4.4 check."""
    y, x = np.mgrid[:H, :W]
    smooth = 2000 + 400 * np.sin(x / 90) * np.cos(y / 70)
    return {"smooth": smooth, "edge": smooth + 300 * ((x - W / 2) ** 2 + (y - H / 2) ** 2 < (W / 4) ** 2)}


def sigma_claims():
    """σ of white Gaussian noise of known σ added to an integer frame reads within 3 %; the scene alone under 0.1."""
    rng = np.random.default_rng(7)
    for name, scene in scenes().items():
        check(coding_error.sigma(np.rint(scene).astype(np.int32)) < 0.1, f"{name}: the scene alone reads no noise")
        for s in (0.5, 1, 2, 4, 8, 16):
            frame = np.rint(scene + rng.normal(0, s, scene.shape)).astype(np.int32)
            got = coding_error.sigma(frame)
            check(abs(got / s - 1) <= 0.03, f"{name}: σ {s} reads {got:.3f}, within 3 %")


def error_claims():
    """rms and max are the reconstruction's difference from the source in source units; a depth cut's codes count
    as c · 2^(D−10); the ratio is the difference's noise-band RMS over the source's σ."""
    rng = np.random.default_rng(3)
    source = np.rint(scenes()["smooth"] + rng.normal(0, 4, (H, W))).astype(np.int32)
    recon = source + rng.integers(-2, 3, source.shape)
    recon[10, 20] = source[10, 20] - 9
    e = coding_error.coding_error(source, recon)
    want = np.sqrt(np.mean((recon - source).astype(float) ** 2))
    check(abs(e["rms"] - want) < 1e-3, f"rms {e['rms']} is {want:.4f}")
    check(e["max"] == 9, f"max {e['max']} is the one sample 9 away")
    check(0 < e["noiseBandRatio"] < 1.5, f"noiseBandRatio {e['noiseBandRatio']}: uniform ±2 against σ 4")
    check(coding_error.coding_error(source, source) == {"rms": 0.0, "max": 0, "noiseBandRatio": 0.0},
          "a reconstruction equal to its source has no error")
    codes = (source + 2) >> 2
    cut = coding_error.coding_error(source, codes, shift=2)
    want = np.sqrt(np.mean(((codes << 2) - source).astype(float) ** 2))
    check(abs(cut["rms"] - want) < 1e-3, f"a cut's rms {cut['rms']} counts its codes as c · 4: {want:.4f}")
    flat = np.full((H, W), 100, np.int32)
    check(coding_error.coding_error(flat, flat + 1)["noiseBandRatio"] is None, "a frame with no noise has no ratio")


def main():
    sigma_claims()
    error_claims()
    print(f"coding error: {'every claim holds' if not failures else f'{len(failures)} claims fail'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
