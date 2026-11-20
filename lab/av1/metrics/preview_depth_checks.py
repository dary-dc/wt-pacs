#!/usr/bin/env python3
"""Row PREVIEWDEPTH's checks, each run as built and mutated (preview-depth.md §7); prints and writes JSON.

usage: preview_depth_checks.py OUT.json [--vmaf VMAF] [--work DIR]
"""
import argparse
import json
import math
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "profiles"))
import preview_depth as pd  # noqa: E402
import preview_depth_report as report  # noqa: E402
import quality  # noqa: E402

RNG = np.random.default_rng(20261104)
PEAK = 4095


def top(v, rounding=2):
    return np.minimum((v + rounding) >> 2, PEAK >> 2) << 2


def windows_tab():
    wins = [dict(center=c, width=w, function="LINEAR", source="sweep") for w in (64, 512) for c in (1000, 2000)]
    return wins, pd.tables(type("S", (), dict(b=12))(), dict(rescale=dict(slope=1.0, intercept=0.0)), wins)


def brute(v, x, tabs):
    out = []
    for t in tabs:
        s, l = t[v].astype(np.int16), t[x].astype(np.int16)
        k = (s > 0) & (s < 255)
        m = np.abs(l - s)[k]
        out.append(dict(n=int(k.sum()), ge1=int((m >= 1).sum()), ge2=int((m >= 2).sum()), ge4=int((m >= 4).sum()),
                        max=int(m.max()), levels_source=len(set(np.unique(s[k])) - {0, 255}),
                        levels_lossy=len(set(np.unique(l[k])) - {0, 255})))
    return out


def histogram_check():
    """Window statistics from the joint histogram equal a per-sample count; the mutation shifts the difference by 1."""
    v = np.clip(RNG.normal(1500, 400, (300, 400)), 0, PEAK).astype(np.int32)
    x = np.clip(v + RNG.normal(0, 6, v.shape).round().astype(np.int32), 0, PEAK)
    _, tabs = windows_tab()
    want = brute(v, x, tabs)
    got = pd.window_stats(pd.joint(v, x, PEAK), tabs, PEAK)
    bad = pd.window_stats(pd.joint(v, np.clip(x + 1, 0, PEAK), PEAK), tabs, PEAK)
    return dict(check="window statistics from the histogram = per-sample count", as_run=got == want,
                mutated="lossy + 1", mutated_equal=bad == want, sees=got == want and bad != want)


def cut_check():
    """The 10-bit series' reduced form (top 8): lossy − source ∈ {−1, 0, +1, +2}, mean square 1.5, below the clamp;
    without the rounding offset it is in {−3 … 0}, mean square 3.5."""
    s = type("S", (), dict(b=10, ch=1))()
    reduced = pd.arms(s, [])[1]
    v = np.arange(0, 1020, dtype=np.int32)[None, :, None]
    e = (reduced.back(reduced.fwd(v)) - v).ravel()
    bad = ((v >> 2) << 2) - v
    return dict(check=f"{reduced.name}: depth cut error ∈ {{−1 … +2}}, mean square 1.5",
                as_run=[sorted(map(int, set(e))), float(np.mean(e * e))], mutated="no rounding offset",
                mutated_value=[sorted(map(int, set(bad.ravel()))), float(np.mean(bad * bad))],
                sees=set(e.tolist()) == {-1, 0, 1, 2} and abs(np.mean(e * e) - 1.5) < 1e-9
                and abs(np.mean(bad * bad) - 1.5) > 0.5)


def levels_check():
    """Under a window 64 units wide the depth cut paints ≤ 64 ÷ 4 + 1 = 17 levels where the source paints ≥ 60."""
    ramp = np.tile(np.linspace(900, 1100, 400), (200, 1)) + RNG.normal(0, 8, (200, 400))
    v = np.clip(ramp.round(), 0, PEAK).astype(np.int32)
    _, tabs = windows_tab()
    got = pd.window_stats(pd.joint(v, top(v), PEAK), tabs[:1], PEAK)[0]
    bad = pd.window_stats(pd.joint(v, v, PEAK), tabs[:1], PEAK)[0]
    return dict(check="levels under a 64-wide window: cut ≤ 17, source ≥ 60",
                as_run=[got["levels_lossy"], got["levels_source"]], mutated="no cut", mutated_value=bad["levels_lossy"],
                sees=got["levels_lossy"] <= 17 and got["levels_source"] >= 60 and bad["levels_lossy"] > 17)


def dither_check():
    """Rounding to a step of 4 leaves a ramp's local mean within the predicted ripple (4 ÷ π) e^(−2π²σ²/16) when the
    noise is σ = 2; at σ = 0.5 the predicted ripple, 0.94 units, appears as stairs."""
    def worst(sig):
        x = np.linspace(1000, 1064, 4096)
        noisy = x + RNG.normal(0, sig, (512, x.size))
        r = np.round(noisy / 4) * 4
        dev = r.mean(0) - noisy.mean(0)
        return float(np.max(np.abs(np.convolve(dev, np.ones(16) / 16, "valid"))))
    ripple = lambda s: 4 / math.pi * math.exp(-2 * math.pi ** 2 * s * s / 16)
    ok, bad = worst(2.0), worst(0.5)
    return dict(check="dither: σ = Δ ÷ 2 leaves no stair", as_run=ok, predicted=ripple(2.0), mutated="σ = Δ ÷ 8",
                mutated_value=bad, mutated_predicted=ripple(0.5),
                sees=ok < 0.1 and abs(bad - ripple(0.5)) < 0.25 * ripple(0.5))


def ssim_check():
    """SSIM in the window is 1 on identical codes, float32 within 1e-4 of float64, and reads only shown positions:
    with a clipped half the lossy frame paints 40 counted, it falls."""
    v = RNG.normal(128, 40, (256, 256)).clip(1, 254).astype(np.uint8)
    v[:, :128] = 0
    x = (v.astype(np.int16) + RNG.integers(-3, 4, v.shape)).clip(0, 255).astype(np.uint8)
    x[v == 0] = 40
    same, _ = pd.ssim_in_window(v, v)
    f32, _ = pd.ssim_in_window(v, x)
    lum, cs = quality.ssim_terms(v.astype(np.float64), x.astype(np.float64), 255)
    keep = ((v > 0) & (v < 255))[5:-5, 5:-5]
    f64, every = float(np.mean((lum * cs)[keep])), float(np.mean(lum * cs))
    return dict(check="SSIM in window: identical 1, float32 = float64 to 1e-4, shown positions only",
                as_run=[same, f32, f64], mutated="every position", mutated_value=every,
                sees=abs(same - 1) < 1e-6 and abs(f32 - f64) < 1e-4 and abs(every - f64) > 0.01)


def sigma_check():
    """σ of a reduced frame, measured in coded units and scaled by 4, reads the source's σ 8; unscaled it reads 2."""
    v = (2000 + RNG.normal(0, 8, (512, 512))).round().astype(np.int32)
    p = np.minimum((v + 2) >> 2, 1023)
    got, bad = quality.sigma(p) * 4, quality.sigma(p)
    return dict(check="σ of the reduced frame ×4 reads 8 to 10 %", as_run=got, mutated="no ×4", mutated_value=bad,
                sees=abs(got - 8) < 0.8 and abs(bad - 8) > 0.8)


def bytes_check():
    """Equal-bytes interpolation is exact at a rung's bytes and linear in ln bytes between rungs; linear in bytes
    gives another value at the geometric midpoint."""
    pts = [(100.0, 1.0), (400.0, 3.0)]
    at, mid = report.at_bytes(pts, 100.0), report.at_bytes(pts, 200.0)
    lin = 1.0 + 2.0 * (200 - 100) / 300
    return dict(check="equal bytes: exact at a rung, ln-linear between", as_run=[at, mid], mutated="linear in bytes",
                mutated_value=lin, sees=at == 1.0 and abs(mid - 2.0) < 1e-12 and abs(lin - 2.0) > 0.1)


def cambi_check(vmaf, work):
    """CAMBI full-reference: 0 for identical frames; above 0 at max_log_contrast 5 for a smooth ramp shown in
    4-level stairs (the mutation is that second case)."""
    if not vmaf:
        return dict(check="CAMBI", as_run=None, sees=None, note="no vmaf given: banding columns not run")
    ramp = np.tile(np.linspace(40, 200, 1024), (512, 1))
    smooth = np.stack([ramp.round().astype(np.uint8)] * 2)
    stairs = np.stack([(np.round(ramp / 4) * 4).astype(np.uint8)] * 2)
    same = pd.cambi(vmaf, work, smooth, smooth, 5)
    band = pd.cambi(vmaf, work, smooth, stairs, 5)
    band2 = pd.cambi(vmaf, work, smooth, stairs, 2)
    return dict(check="CAMBI: identical 0; 4-level stairs > 0 at contrast 5", as_run=same, mutated="4-level stairs",
                mutated_value=band, at_contrast_2=band2,
                sees=all(max(f.values()) == 0 for f in same) and any(max(f.values()) > 0 for f in band))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out", type=Path)
    ap.add_argument("--vmaf", type=Path)
    ap.add_argument("--work", type=Path)
    a = ap.parse_args()
    work = a.work or Path(tempfile.mkdtemp())
    work.mkdir(parents=True, exist_ok=True)
    rows = [histogram_check(), cut_check(), levels_check(), dither_check(), ssim_check(), sigma_check(),
            bytes_check(), cambi_check(a.vmaf, work)]
    a.out.write_text(json.dumps(rows, indent=1, default=float) + "\n")
    for r in rows:
        print(f"{'ok ' if r['sees'] else ('-- ' if r['sees'] is None else 'FAIL')} {r['check']}: {r.get('as_run')}"
              f" | mutated {r.get('mutated')}: {r.get('mutated_value', r.get('mutated_equal'))}")
    if any(r["sees"] is False for r in rows):
        sys.exit(1)


if __name__ == "__main__":
    main()
