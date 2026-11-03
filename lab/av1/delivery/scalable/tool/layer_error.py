#!/usr/bin/env python3
"""Metric 3 of docs/av1/README.md §The scalable preview as a tool, 10: the error of every lossy layer, every frame.

Each layer, decoded by native dav1d, against the source, at the layer's own size (the source's box mean, as stage 1)
and upscaled to the source's size by the viewer's resampling (client/paint: bilinear, pixel centres aligned, edges
clamped). A layer coding v >> 2 stands for v at 4·v + 1.5, as stage 1 reads it. Four measures: PSNR (peak 2^b − 1),
max |Δ| in stored values, SSIM (Gaussian window 11, σ 1.5, K1 0.01, K2 0.03, L = 2^b − 1, over the window's valid
positions), and the windowed error: both through the series' first VOI window to display codes, max |Δ| and the
share of pixels off by ≥ 1 and ≥ 2. Upscaled, the windowed layer is resampled as the painter does: windowed to codes
at its own size, then bilinear, then rounded half up.

usage: layer_error.py BUILD WORK OUT.jsonl SET_DIR ...   — lab/av1/delivery/scalable/tool/README.md §SVC metrics
"""
import json
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pydicom

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "encoder"))
import svc  # noqa: E402

# (variant, shape, layer, stream suffix, scale factor of the layer)
LAYERS = [("p2-q20", "two-quarter-q20", "base", 0, 4), ("p2-q40", "two-quarter-q40", "base", 0, 4)] + [
    (f"p3-m{m}", f"three-full-m{m}", layer, k, f) for m in (10, 20, 30) for layer, k, f in (("base", 0, 4), ("middle", 1, 1))]


def gauss(sigma=1.5, size=11):
    x = np.arange(size) - size // 2
    g = np.exp(-x * x / (2 * sigma * sigma))
    return g / g.sum()


def filt(a, g):
    """Separable correlation, valid positions only (Wang et al.'s `filter2(..., 'valid')`)."""
    a = np.apply_along_axis(lambda r: np.convolve(r, g, "valid"), 1, a)
    return np.apply_along_axis(lambda c: np.convolve(c, g, "valid"), 0, a)


def ssim(x, y, peak):
    g = gauss()
    c1, c2 = (0.01 * peak) ** 2, (0.03 * peak) ** 2
    mx, my = filt(x, g), filt(y, g)
    sxx, syy, sxy = filt(x * x, g) - mx * mx, filt(y * y, g) - my * my, filt(x * y, g) - mx * my
    return float((((2 * mx * my + c1) * (2 * sxy + c2)) / ((mx * mx + my * my + c1) * (sxx + syy + c2))).mean())


def bilinear(a, h, w, f):
    """`a`, f times smaller, drawn over an h × w box: each target pixel centre mapped back, four neighbours, edges clamped."""
    ah, aw = a.shape
    ys = (np.arange(h) + 0.5) / f - 0.5
    xs = (np.arange(w) + 0.5) / f - 0.5
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    fy, fx = (ys - y0)[:, None], (xs - x0)[None, :]
    y0c, y1c = np.clip(y0, 0, ah - 1), np.clip(y0 + 1, 0, ah - 1)
    x0c, x1c = np.clip(x0, 0, aw - 1), np.clip(x0 + 1, 0, aw - 1)
    top = a[y0c][:, x0c] * (1 - fx) + a[y0c][:, x1c] * fx
    bottom = a[y1c][:, x0c] * (1 - fx) + a[y1c][:, x1c] * fx
    return top * (1 - fy) + bottom * fy


def voi_window(set_dir):
    """The header's first window and its function (PS3.3 C.11.2.1.2.1, C.11.2.1.3.1), as client/paint/voi.js maps it."""
    meta = json.loads((set_dir / "metadata.json").read_text())
    dcm = next(p for p in (set_dir.parent / "dicom").rglob("*")
               if p.is_file() and pydicom.dcmread(p, stop_before_pixels=True).SeriesInstanceUID == meta["series"])
    ds = pydicom.dcmread(dcm, stop_before_pixels=True)
    voi = ds.get("WindowCenter") and ds
    if voi is None and "SharedFunctionalGroupsSequence" in ds:
        voi = ds.SharedFunctionalGroupsSequence[0].get("FrameVOILUTSequence", [None])[0]
    if voi is None:
        return {"center": (meta["min"] + meta["max"] + 1) / 2, "width": meta["max"] - meta["min"] + 1, "function": "LINEAR",
                "from": "the stored range"}
    first = lambda v: float(v[0] if isinstance(v, pydicom.multival.MultiValue) else v)  # noqa: E731
    return {"center": first(voi.WindowCenter), "width": first(voi.WindowWidth),
            "function": str(voi.get("VOILUTFunction", "LINEAR")) or "LINEAR", "from": "the header"}


def to_codes(x, win):
    c, w = win["center"], win["width"]
    if win["function"] == "SIGMOID":
        y = 255 / (1 + np.exp(-4 * (x - c) / w))
    elif win["function"] == "LINEAR":
        lo, hi = c - 0.5 - (w - 1) / 2, c - 0.5 + (w - 1) / 2
        y = np.where(x <= lo, 0, np.where(x > hi, 255, ((x - (c - 0.5)) / (w - 1) + 0.5) * 255))
    else:
        raise ValueError(win["function"])
    return np.clip(np.floor(y + 0.5), 0, 255)


def measures(ref, got, peak, ref_codes, got_codes):
    d = np.abs(got - ref)
    mse = float((d * d).mean())
    dc = np.abs(got_codes - ref_codes)
    return {"psnr": 99.0 if mse == 0 else 10 * np.log10(peak * peak / mse), "max": float(d.max()), "ssim": ssim(ref, got, peak),
            "win_max": int(dc.max()), "win_ge1": float((dc >= 1).mean()), "win_ge2": float((dc >= 2).mean())}


def decode(build, stream, tmp):
    subprocess.run([build / "dav1d/bin/dav1d", "-q", "-i", stream, "-o", tmp, "--alllayers", "0"], check=True,
                   capture_output=True, env={"LD_LIBRARY_PATH": str(build / "dav1d/lib")})
    return [p[0][..., 0] if p[0].ndim == 3 else p[0] for p in svc.read_y4m(tmp)]


def run_set(build, work, set_dir):
    s = svc.load(Path(set_dir))
    bits = s.stored
    peak = (1 << bits) - 1
    win = voi_window(Path(set_dir))
    coding = "split" if bits == 12 else "whole"
    shift = 2 if coding == "split" else 0
    hp, wp = s.h + s.h % 2, s.w + s.w % 2
    rows = []
    for variant, shape, layer, k, f in LAYERS:
        pics = decode(build, work / s.name / f"{coding}-{shape}.ivf_{k}.av1", work / s.name / f".err-{variant}-{layer}.y4m")
        for i, pic in enumerate(pics):
            src = np.pad(s.frame(i)[..., 0].astype(np.float64), ((0, hp - s.h), (0, wp - s.w)), mode="edge")
            got = pic.astype(np.float64) * (1 << shift) + ((1 << shift) - 1) / 2
            lh, lw = min(got.shape[0], hp // f), min(got.shape[1], wp // f)
            box = src[:lh * f, :lw * f].reshape(lh, f, lw, f).mean(axis=(1, 3))
            own = measures(box, got[:lh, :lw], peak, to_codes(box, win), to_codes(got[:lh, :lw], win))
            up = bilinear(got, hp, wp, f)[:s.h, :s.w]
            up_codes = np.clip(np.floor(bilinear(to_codes(got, win), hp, wp, f)[:s.h, :s.w] + 0.5), 0, 255)
            full = measures(src[:s.h, :s.w], up, peak, to_codes(src[:s.h, :s.w], win), up_codes)
            rows.append({"set": s.name, "variant": variant, "layer": layer, "frame": i, "size": f"{got.shape[1]}x{got.shape[0]}", "factor": f,
                         "window": win, "own": own, "full": full})
        (work / s.name / f".err-{variant}-{layer}.y4m").unlink()
        print(s.name, variant, layer, len(pics), "frames", flush=True)
    return rows


def main():
    build, work, out, *sets = sys.argv[1:]
    build, work = Path(build).resolve(), Path(work).resolve()
    with ProcessPoolExecutor(len(sets)) as pool:
        results = list(pool.map(run_set, [build] * len(sets), [work] * len(sets), sets))
    with open(out, "w") as fh:
        for rows in results:
            for row in rows:
                fh.write(json.dumps(row) + "\n")


if __name__ == "__main__":
    main()
