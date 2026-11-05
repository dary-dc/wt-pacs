#!/usr/bin/env python3
"""The checks of README.md §Quality metrics protocol, pre-registered, each run as written and then broken on purpose:
a check that still passes its mutation is reported as unable to see it.

usage: checks.py BUILD WORK SETDIR OUT.json [--vdp TORCH_PYTHON]     (SETDIR: a fetched grey set; its middle 4 frames)
"""
import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from skimage.metrics import structural_similarity

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import cell  # noqa: E402
import collect  # noqa: E402
import quality  # noqa: E402
import vdp  # noqa: E402
from bytes import AOM, Middle, aomenc_args, forms, write_y4m, y4m_frames  # noqa: E402
from voi import display_windows  # noqa: E402

SIGMAS = (0.25, 0.5, 1, 2, 3, 4, 8, 16)


def scene(edges):
    yy, xx = np.mgrid[0:512, 0:768]
    base = 200 + 0.8 * xx + 0.3 * yy + 60 * np.sin(xx / 40) * np.cos(yy / 55)
    return base + 300 * (((xx - 380) ** 2 + (yy - 250) ** 2) < 150 ** 2) if edges else base


def noisy(base, sd, rng, blur=0.0):
    from scipy.ndimage import gaussian_filter
    n = rng.normal(0, 1, base.shape)
    if blur:
        n = gaussian_filter(n, blur)
        n /= n.std()
    return np.rint(base + sd * n).astype(np.int32)


def sigma_check(**mutation):
    """Integer frames, a smooth scene and one with a 300-unit disc edge, plus white noise of known σ: every σ ≥ 0.5
    within 10 %; the scene alone under 0.5."""
    rng = np.random.default_rng(7)
    got = {}
    for name in ("smooth", "edge"):
        base = scene(name == "edge")
        got[name] = {sd: round(quality.sigma(noisy(base, sd, rng), **mutation), 3) for sd in SIGMAS}
        got[name][0] = round(quality.sigma(np.rint(base).astype(np.int32), **mutation), 3)
    held = all(abs(v - sd) <= 0.1 * sd for g in got.values() for sd, v in g.items() if sd >= 0.5) and \
        all(g[0] < 0.5 for g in got.values())
    return dict(estimates=got, held=held)


def correlated():
    """Reported, no verdict: noise blurred by a Gaussian of 0.5 and 1 px, rescaled to σ 8, read by the estimator."""
    rng = np.random.default_rng(8)
    return {blur: round(quality.sigma(noisy(scene(False), 8, rng, blur)), 3) for blur in (0.5, 1.0)}


def ssim_check(peak_used=4095):
    """quality.ssim's single scale equals scikit-image's structural_similarity set as Wang et al. (README [L6])."""
    rng = np.random.default_rng(1)
    x = noisy(scene(True), 4, rng)
    y = x + rng.integers(-6, 7, x.shape)
    ref = structural_similarity(x.astype(float), y.astype(float), gaussian_weights=True, sigma=1.5,
                                use_sample_covariance=False, data_range=4095)
    got = quality.ssim(x, y, peak_used)[0]
    return dict(ours=got, skimage=ref, held=abs(got - ref) < 1e-9)


def ms_ssim_check(halve=None):
    """MS-SSIM is 1 on identical frames; with all weight on scale 5 it equals SSIM on the 16× box-reduced pair."""
    rng = np.random.default_rng(2)
    x = noisy(scene(True), 4, rng)
    y = x + rng.integers(-40, 41, x.shape)
    keep = quality.halve
    if halve:
        quality.halve = halve
    try:
        same = quality.ssim(x, x, 4095)[1]
        last = quality.ssim(x, y, 4095, weights=(0, 0, 0, 0, 1))[1]
    finally:
        quality.halve = keep
    xs, ys = x.astype(float), y.astype(float)
    for _ in range(4):
        xs, ys = keep(xs), keep(ys)
    ref = structural_similarity(xs, ys, gaussian_weights=True, sigma=1.5, use_sample_covariance=False, data_range=4095)
    return dict(identical=same, scale5=last, skimage_scale5=ref, held=same == 1.0 and abs(last - ref) < 1e-9)


def psnr_check(peak=4095):
    """A ±1 checkerboard error: MSE 1, PSNR 20·log10(4095) = 72.25 dB, max |Δ| 1."""
    x = np.full((64, 64), 2000)
    y = x + np.indices(x.shape).sum(0) % 2 * 2 - 1
    d = (y - x).astype(float)
    got = quality.psnr(float(np.mean(d * d)), peak)
    return dict(psnr=got, max_abs=int(np.abs(d).max()), held=abs(got - 72.2453) < 1e-3 and np.abs(d).max() == 1)


def display_check(everywhere=False):
    """Codes 0 | 100 | 255 in thirds, the lossy +1 code on the middle third and +3 on the ends: in-window only the
    middle counts, 1 code on each of its samples."""
    src = np.repeat(np.array([0, 100, 255], np.uint8), 10)[None].repeat(4, 0)
    lossy = src.astype(np.int16) + np.repeat(np.array([3, 1, -3]), 10)[None]
    if everywhere:
        src = src.copy()
        src[src == 0], src[src == 255] = 1, 254
    m = quality.display_moves(src, np.clip(lossy, 0, 255).astype(np.uint8))
    return dict(moves=m, held=m == dict(n=40, ge1=40, ge2=0, ge4=0, max=1))


def band_check(band=quality.band):
    """A neighbour step of a ±3 checkerboard plus 4 everywhere is 4 in the band and 5 at full resolution."""
    d = (np.indices((64, 64)).sum(0) % 2 * 6 - 3 + 4).astype(float)
    full, coarse = quality.rms(d), quality.rms(band(d))
    return dict(full=full, band=coarse, held=abs(full - 5) < 1e-9 and abs(coarse - 4) < 1e-9)


def ratio_check(bits=12):
    """ESR's ratio on bits stored: 12 bits × 100 samples in 150 bytes is 1.0."""
    got = quality.compression_ratio(bits, 100, 150)
    return dict(ratio=got, held=got == 1.0)


def gsdf_check(coefficient=None):
    """PS3.14: L(1) = 0.05 and L(1023) = 3 993.4 cd/m² to 0.3 %, and Equation 7-2 inverts 7-1 to 0.5 JND."""
    keep = dict(vdp.GSDF)
    if coefficient:
        vdp.GSDF[coefficient] = -vdp.GSDF[coefficient]
    try:
        lo, hi = float(vdp.luminance(1)), float(vdp.luminance(1023))
        back = vdp.jnd_index(vdp.luminance(np.arange(1, 1024, dtype=float)))
    finally:
        vdp.GSDF.update(keep)
    err = float(np.abs(back - np.arange(1, 1024)).max())
    return dict(L1=lo, L1023=hi, inverse_max_jnd=err,
                held=abs(lo - 0.05) / 0.05 < 0.003 and abs(hi - 3993.4) / 3993.4 < 0.003 and err < 0.5)


def knee_check(pick=max):
    """A curve that rises steeply to Q 8 and is flat after has its knee at Q 8, and the anchor run from Q 1 stops at
    the first failing rung (Q 4 here, though Q 16 passes again)."""
    pts = [dict(q=q, bytes=math.exp(10 - i), m=min(i, 3) * 10.0, ok=q != 8) for i, q in enumerate((1, 2, 4, 8, 16, 32))]
    k = collect.knee(pts, "m", pick)
    run = collect.highest(pts, lambda p: p["ok"])
    return dict(knee=k, anchor=run, held=k == 8 and run == 4)


def encode(build, work, s, form, q, g, cpu=6):
    y4m, ivf, dec = work / "c.y4m", work / f"c{cpu}.ivf", work / "c-dec.y4m"
    write_y4m(s, form, y4m)
    args = [a if not a.startswith("--cpu-used") else f"--cpu-used={cpu}" for a in aomenc_args(form, q, g, s.n)]
    subprocess.run([build / f"aom-{AOM}/bin/aomenc", "-o", ivf, f"--limit={s.n}", "--disable-warning-prompt", *args,
                    y4m], check=True, capture_output=True)
    subprocess.run([build / "dav1d/bin/dav1d", "-q", "-i", ivf, "-o", dec], check=True, capture_output=True)
    return ivf.read_bytes(), dec


def real_checks(build, work, path):
    """On the set's middle 4 frames, stored form: determinism, alignment, the exact frame read as exact."""
    s = Middle(Path(path), 4)
    meta = display_windows(cell.ROOT / "lab/av1/data.json", s.name, Path(path).parent)
    form = forms(s, meta["windows"])[0]
    first, dec = encode(build, work, s, form, 1, 16)
    again, _ = encode(build, work, s, form, 1, 16)
    other, _ = encode(build, work, s, form, 1, 16, cpu=5)
    out = dict(deterministic=dict(as_run=first == again, mutated_cpu5_equal=first == other,
                                  held=first == again and first != other))
    step = [quality.rms((s.frame(i + 1).astype(float) - s.frame(i))) for i in range(s.n - 1)]
    run = [np.sqrt(f["mse"]) for f in cell.measure(s, form, meta, y4m_frames(dec, s, form))]
    shifted = [np.sqrt(f["mse"]) for f in cell.measure(s, form, meta, y4m_frames(dec, s, form), shift=1)]
    out["aligned"] = dict(err=run, step=step, shifted=shifted, held=max(run[:-1]) < min(step) and
                          not max(shifted[:-1]) < min(step))
    exact = [[s.frame(i).astype(np.int32)[..., 0] + s.offset] for i in range(s.n)]
    flipped = [[p[0].copy()] for p in exact]
    flipped[1][0][5, 5] += 1
    ident = lambda: Form1()
    zero = cell.measure(s, ident(), meta, exact)
    one = cell.measure(s, ident(), meta, flipped)
    out["exact_reads_exact"] = dict(as_run=[f["max_abs"] for f in zero], mutated=[f["max_abs"] for f in one],
                                    held=all(f["mse"] == 0 and all(c["ge1"] == 0 for c in f["codes"]) for f in zero)
                                    and one[1]["max_abs"] == 1)
    return out


class Form1:
    def back(self, p):
        return p[0].astype(np.int32)[..., None]


def vdp_check(python, work):
    """ColorVideoVDP gives 10 JOD to a stack against itself, and less to one with ±2 codes of noise."""
    rng = np.random.default_rng(3)
    src = (rng.integers(40, 200, (4, 1, 1)) + np.zeros((4, 256, 256))).astype(np.uint8)
    noisy8 = np.clip(src + rng.integers(-2, 3, src.shape), 0, 255).astype(np.uint8)
    got = {}
    for name, lossy in (("identical", src), ("noise", noisy8)):
        np.save(work / "s.npy", src)
        np.save(work / "l.npy", lossy)
        r = subprocess.run([str(python), str(HERE / "vdp.py"), str(work / "s.npy"), str(work / "l.npy")],
                           capture_output=True, check=True)
        got[name] = json.loads(r.stdout)["jod"]
    return dict(**got, held=got["identical"] > 9.99 and got["noise"] < 9.99)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("work", type=Path)
    ap.add_argument("set")
    ap.add_argument("out", type=Path)
    ap.add_argument("--vdp", type=Path)
    a = ap.parse_args()
    a.work.mkdir(parents=True, exist_ok=True)
    pairs = {
        "sigma": (sigma_check(), sigma_check(sheppard=False), "rounding's 1/12 not taken out"),
        "sigma_median": (sigma_check(), sigma_check(centre=np.median), "the median in place of the mean"),
        "sigma_edges": (sigma_check(), sigma_check(edge_share=0), "no edge left out"),
        "ssim": (ssim_check(), ssim_check(peak_used=255), "L = 255"),
        "ms_ssim": (ms_ssim_check(), ms_ssim_check(halve=lambda a: a), "no downsampling between scales"),
        "psnr": (psnr_check(), psnr_check(peak=255), "peak 255"),
        "display": (display_check(), display_check(everywhere=True), "clipped codes counted"),
        "band": (band_check(), band_check(band=lambda d: d), "no band reduction"),
        "ratio": (ratio_check(), ratio_check(bits=16), "the 16-bit container in place of bits stored"),
        "gsdf": (gsdf_check(), gsdf_check(coefficient="c"), "coefficient c's sign flipped"),
        "knee": (knee_check(), knee_check(pick=min), "the rung nearest the chord in place of the farthest"),
    }
    out = {k: dict(as_run=r, mutated=m, mutation=why, sees_it=r["held"] and not m["held"])
           for k, (r, m, why) in pairs.items()}
    out["sigma_correlated"] = dict(as_run=correlated(), note="reported, no verdict")
    out.update(real_checks(a.build, a.work, a.set))
    if a.vdp:
        out["vdp"] = vdp_check(a.vdp, a.work)
    a.out.write_text(json.dumps(out, indent=1, default=str))
    for k, v in out.items():
        print(k, v.get("sees_it", v.get("held", "—")))


if __name__ == "__main__":
    main()
