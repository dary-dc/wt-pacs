#!/usr/bin/env python3
"""I2's cut cell (claude/unified:docs/lines/proposals.md §I2): a smooth ramp with Gaussian noise of known σ, cut to
10 bits by the ingest's `depth_cut`, so the coding error is the cut's rounding alone and known in advance.

usage: i2_synthetic.py OUT.jsonl [--mutant NAME]
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ingest/coded-frames"))
import coding_error  # noqa: E402
import ingest  # noqa: E402

DEPTH, H, W = 12, 512, 512
SIGMAS = (1.0, 4.0, 16.0)
SIGMA_SHARE = 0.03
CUT_RMS, CUT_BAND = np.sqrt(1.5), np.sqrt(1.25)  # a half-up cut by 4 leaves Δ ∈ {0, −1, +2, +1}, uniform: mean ½


def scene(sigma, seed):
    ramp = np.linspace(400, 3600, W)[None, :].repeat(H, 0)
    noisy = ramp + np.random.default_rng(seed).normal(0, sigma, (H, W))
    return np.clip(np.rint(noisy), 0, (1 << DEPTH) - 1).astype(np.int64)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out", type=Path)
    ap.add_argument("--mutant", default="")
    a = ap.parse_args()
    shift = DEPTH - ingest.CUT_DEPTH
    for k, sigma in enumerate(SIGMAS):
        src = scene(sigma, k)
        codes = ingest.depth_cut(src, DEPTH)
        got = coding_error.coding_error(src, codes, shift)
        est = coding_error.sigma(src)
        want = dict(rms=float(CUT_RMS), max=2, noiseBandRatio=float(CUT_BAND / sigma))
        row = dict(sigma=sigma, mutant=a.mutant or None, got=got, sigma_est=est, want=want,
                   sigma_ok=bool(abs(est - sigma) / sigma <= SIGMA_SHARE), rms_ok=bool(abs(got["rms"] - CUT_RMS) <= 0.01),
                   max_ok=got["max"] == 2, ratio_ok=bool(abs(got["noiseBandRatio"] - want["noiseBandRatio"]) / want["noiseBandRatio"] <= SIGMA_SHARE))
        with a.out.open("a") as f:
            f.write(json.dumps(row) + "\n")
        print(sigma, a.mutant, {k: row[k] for k in ("sigma_ok", "rms_ok", "max_ok", "ratio_ok")}, got, round(est, 4))


if __name__ == "__main__":
    main()
