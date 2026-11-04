#!/usr/bin/env python3
"""Row PREVIEWDEPTH (preview-depth.md §Preview depth protocol, pre-registered): per series, a full-depth and a
reduced-depth lossy stream at each Q, each measured under every window a reader may set.

usage: preview_depth.py BUILD WORK OUT.jsonl SETDIR ... [--q 2,4,8,12,16,24,32,56] [--g 16] [--jobs 4]
                        [--vmaf VMAF]      (CAMBI on the probe windows; without it the banding columns are None)
"""
import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "profiles"))
sys.path.insert(0, str(HERE.parents[1] / "scripts"))
import quality  # noqa: E402
from bytes import AOM, ROOT, Form, Middle, aomenc_args, child, forms, write_y4m, y4m_frames  # noqa: E402
from order import order  # noqa: E402
from voi import display_windows, window_codes  # noqa: E402
sys.path.insert(0, str(ROOT / "ingest/coded-frames"))
import ingest  # noqa: E402

WIDTHS = (32, 64, 128, 256, 512, 1024)
PROBES = (2, 25, 50, 75, 98)
PROBE_FRAMES, SIDE = 4, 1024
SPAN = 1023
CAMBI_CONTRAST = (2, 5)


def arms(s, win):
    """The full-depth form and its reduced twin: the top 10 bits of a b > 10 series, the top 8 of a 10-bit one."""
    f = forms(s, win)
    if s.b > 10:
        return f[0], f[1]
    return f[0], Form("top8", 8, 0, True, lambda v: [np.minimum((v[..., 0] + 2) >> 2, 255)],
                      lambda p: (p[0].astype(np.int32) << 2)[..., None])


def body(s):
    """Sampled values of the series, a background value (≥ 5 % of samples at either end of the range) left out."""
    v = np.concatenate([s.frame(i)[..., 0].ravel()[::7] for i in range(0, s.n, 4)]).astype(np.int64)
    counts = np.bincount(v)
    for end in (v.min(), v.max()):
        if counts[end] >= 0.05 * v.size:
            v = v[v != end]
    return v


def windows(s, header):
    """The header's presets, then LINEAR windows of each width centred every half width across the body's 0.5–99.5th
    percentiles; probes (SSIM, CAMBI) are the presets and, per width, the windows centred at the body's PROBES."""
    v = body(s)
    lo, hi = np.percentile(v, [0.5, 99.5])
    out = [dict(w, source="header", probe=True) for w in header]
    for w in WIDTHS:
        for k in range(int(np.ceil((hi - lo) / (w / 2))) + 1):
            out.append(dict(center=float(round(lo + k * w / 2)), width=float(w), function="LINEAR", source="sweep",
                            probe=False))
        for p in PROBES:
            out.append(dict(center=float(round(np.percentile(v, p))), width=float(w), function="LINEAR",
                            source=f"p{p}", probe=True))
    return out, [float(lo), float(hi)]


def tables(s, meta, wins):
    peak = (1 << s.b) - 1
    ident = dict(slope=1.0, intercept=0.0)
    return np.stack([window_codes(w, meta["rescale"] if w["source"] == "header" else ident, peak) for w in wins])


def joint(u, x, peak):
    """Counts of (source value, lossy − source) pairs; differences beyond ±SPAN pile up at the ends."""
    d = np.clip(x.astype(np.int64) - u, -SPAN, SPAN) + SPAN
    return np.bincount((u.astype(np.int64) * (2 * SPAN + 1) + d).ravel(), minlength=(peak + 1) * (2 * SPAN + 1))


def window_stats(hist, tabs, peak):
    """Per window, over the samples it shows (source code strictly inside 0 … 255): displayed-level moves and the
    distinct levels the source and the lossy frames paint."""
    idx = np.nonzero(hist)[0]
    cnt = hist[idx]
    u, d = idx // (2 * SPAN + 1), idx % (2 * SPAN + 1) - SPAN
    x = np.clip(u + d, 0, peak)
    out = []
    for t in tabs:
        src, los = t[u].astype(np.int16), t[x].astype(np.int16)
        keep = (src > 0) & (src < 255)
        m, c = np.abs(los[keep] - src[keep]), cnt[keep]
        out.append(dict(n=int(c.sum()), ge1=int(c[m >= 1].sum()), ge2=int(c[m >= 2].sum()), ge4=int(c[m >= 4].sum()),
                        max=int(m.max()) if m.size else 0,
                        levels_source=int(np.count_nonzero(np.bincount(src[keep], minlength=256))),
                        levels_lossy=int(np.count_nonzero(np.bincount(los[keep], minlength=256)))))
    return out


def square(frame):
    """The SIDE square (even sides) centred on the frame's non-background samples."""
    ys, xs = np.nonzero(frame > 0)
    cut = []
    for c, n in ((int(ys.mean()) if ys.size else frame.shape[0] // 2, frame.shape[0]),
                 (int(xs.mean()) if xs.size else frame.shape[1] // 2, frame.shape[1])):
        side = min(SIDE, n) // 2 * 2
        lo = min(max(0, c - side // 2), n - side)
        cut.append(slice(lo, lo + side))
    return tuple(cut)


def ssim_in_window(src, los):
    """Mean SSIM (8-bit codes, L = 255) over the positions whose source code the window shows."""
    lum, cs = quality.ssim_terms(src.astype(np.float32), los.astype(np.float32), 255)
    keep = ((src > 0) & (src < 255))[5:-5, 5:-5]
    return float(np.mean((lum * cs)[keep])) if keep.any() else None, int(keep.sum())


def cambi(vmaf, tmp, src, los, contrast):
    """libvmaf's CAMBI, full-reference mode, one score per frame of the stacked probe frames; None without vmaf."""
    if not vmaf:
        return None
    h, w = src.shape[1:]
    grey = np.full((src.shape[0], h * w // 2), 128, np.uint8)
    for name, a in (("ref", src), ("dis", los)):
        (tmp / f"{name}.yuv").write_bytes(np.concatenate([a.reshape(len(a), -1), grey], 1).tobytes())
    out = tmp / "cambi.json"
    subprocess.run([str(vmaf), "--reference", tmp / "ref.yuv", "--distorted", tmp / "dis.yuv", "--width", str(w),
                    "--height", str(h), "--pixel_format", "420", "--bitdepth", "8", "--no_prediction", "--feature",
                    f"cambi=full_ref=true:max_log_contrast={contrast}", "--json", "--output", out],
                   check=True, capture_output=True)
    return [{k: v for k, v in f["metrics"].items() if "cambi" in k} for f in json.loads(out.read_text())["frames"]]


def probes(s, tabs, wins, decoded_middle, source_middle, vmaf, tmp):
    """SSIM in each probe window and CAMBI over the probe windows' stacked frames, on the middle frames' square."""
    cut = square(source_middle[len(source_middle) // 2])
    src_v = np.stack([f[cut] for f in source_middle])
    los_v = np.stack([f[cut] for f in decoded_middle])
    out, srcs, loss = [], [], []
    for i, w in enumerate(wins):
        if not w["probe"]:
            continue
        a, b = tabs[i][src_v], tabs[i][los_v]
        per = [ssim_in_window(a[k], b[k]) for k in range(len(a))]
        n = sum(m for _, m in per)
        out.append(dict(window=i, ssim=sum(v * m for v, m in per if v is not None) / n if n else None, n=n))
        srcs.append(a)
        loss.append(b)
    if vmaf and out:
        frames = len(src_v)
        for c in CAMBI_CONTRAST:
            scores = cambi(vmaf, tmp, np.concatenate(srcs), np.concatenate(loss), c)
            for j, o in enumerate(out):
                o[f"cambi_{c}"] = scores[j * frames:(j + 1) * frames]
    return dict(rows=[cut[0].start, cut[0].stop], cols=[cut[1].start, cut[1].stop], windows=out)


def middle(s):
    return range(max(0, (s.n - PROBE_FRAMES) // 2), max(0, (s.n - PROBE_FRAMES) // 2) + min(PROBE_FRAMES, s.n))


def series_row(path, work):
    """What the coding does not change: the windows, the source's noise, and the depth cut alone (no codec)."""
    s = Middle(Path(path), 0)
    if s.offset or s.ch != 1:
        raise SystemExit(f"{s.name}: preview depth runs unsigned grey series only")
    meta = json.loads((Path(work) / f"{s.name}.display.json").read_text())
    wins, span = windows(s, meta["windows"])
    peak = (1 << s.b) - 1
    tabs = tables(s, meta, wins)
    full, reduced = arms(s, meta["windows"])
    hist = 0
    for i in range(s.n):
        v = s.frame(i).astype(np.int32)
        hist = hist + joint(v[..., 0], reduced.back(reduced.fwd(v))[..., 0], peak)
    mid = s.frame(s.n // 2)[..., 0].astype(np.int32)
    inside = (mid >= span[0]) & (mid <= span[1])
    return dict(kind="series", set=s.name, b=s.b, frames=s.n, width=s.w, height=s.h, full=full.name,
                reduced=reduced.name, body=span, windows=wins, sigma=quality.sigma(mid, inside),
                depth_cut=window_stats(hist, tabs, peak))


def cell(job):
    build, work, path, arm, q, g, vmaf = job
    t0 = time.perf_counter()
    s = Middle(Path(path), 0)
    meta = json.loads((Path(work) / f"{s.name}.display.json").read_text())
    wins, span = windows(s, meta["windows"])
    tabs = tables(s, meta, wins)
    form = arms(s, meta["windows"])[0 if arm == "full" else 1]
    peak = (1 << s.b) - 1
    tmp = Path(work) / f"{s.name}-{form.name}-q{q}-g{g}"
    tmp.mkdir(parents=True, exist_ok=True)
    y4m, ivf, dec = tmp / "in.y4m", tmp / "out.ivf", tmp / "dec.y4m"
    write_y4m(s, form, y4m)
    _, cpu, _ = child([build / f"aom-{AOM}/bin/aomenc", "-o", ivf, f"--limit={s.n}", "--disable-warning-prompt",
                       *aomenc_args(form, q, g, s.n), y4m])
    y4m.unlink()
    units = ingest.ivf_units(ivf)
    child([build / "dav1d/bin/dav1d", "-q", "--threads=1", "-i", ivf, "-o", dec])
    hist, frames, src_mid, los_mid = 0, [], [], []
    keep = middle(s)
    for i, p in enumerate(y4m_frames(dec, s, form)):
        v = s.frame(i).astype(np.int32)[..., 0]
        x = np.clip(form.back(p)[..., 0], 0, peak)
        hist = hist + joint(v, x, peak)
        d = (x - v).astype(np.float64)
        frames.append(dict(mse=float(np.mean(d * d)), max_abs=int(np.abs(d).max())))
        if i in keep:
            src_mid.append(v)
            los_mid.append(x)
        if i == s.n // 2:
            inside = (v >= span[0]) & (v <= span[1])
            sigma_out = quality.sigma(p[0].astype(np.int32), inside) * (1 << max(0, s.b - form.depth))
    probe = probes(s, tabs, wins, los_mid, src_mid, vmaf, tmp)
    for f in tmp.iterdir():
        f.unlink()
    tmp.rmdir()
    return dict(kind="cell", set=s.name, arm=arm, form=form.name, q=q, g=g, units=[len(u) for u in units],
                encode_cpu=cpu, cell_wall=time.perf_counter() - t0, mpx=s.n * s.w * s.h / 1e6, frames=frames,
                sigma_out=sigma_out, windows=window_stats(hist, tabs, peak), probe=probe)


def jobs(a):
    out = []
    for k, path in enumerate(a.sets):
        name = Path(path).name
        meta = display_windows(ROOT / "lab/av1/data.json", name, Path(path).parent)
        (a.work / f"{name}.display.json").write_text(json.dumps(meta))
        units = [(arm, q, g) for arm in ("full", "reduced") for q in a.q for g in a.g]
        out += [(a.build, str(a.work), path, arm, q, g, a.vmaf) for arm, q, g in order(units, k)]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("work", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", nargs="+")
    ap.add_argument("--q", type=lambda v: [int(x) for x in v.split(",")], default=[2, 4, 8, 12, 16, 24, 32, 56])
    ap.add_argument("--g", type=lambda v: [int(x) for x in v.split(",")], default=[16])
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--vmaf", type=Path)
    a = ap.parse_args()
    a.build, a.work = a.build.resolve(), a.work.resolve()
    a.work.mkdir(parents=True, exist_ok=True)
    rows = [json.loads(r) for r in a.out.open()] if a.out.exists() else []
    done = {(r["set"], r["arm"], r["q"], r["g"]) for r in rows if r["kind"] == "cell"}
    todo = [j for j in jobs(a) if (Path(j[2]).name, j[3], j[4], j[5]) not in done]
    measured = {r["set"] for r in rows if r["kind"] == "series"}
    series = [p for p in a.sets if Path(p).name not in measured]
    print(f"{len(series)} series, {len(todo)} cells", flush=True)
    with open(a.out, "a") as fh, ProcessPoolExecutor(a.jobs) as pool:
        for row in pool.map(series_row, series, [a.work] * len(series)):
            fh.write(json.dumps(row) + "\n")
            fh.flush()
            print(row["set"], f"{len(row['windows'])} windows, σ {row['sigma']:.2f}", flush=True)
        for row in pool.map(cell, todo):
            fh.write(json.dumps(row) + "\n")
            fh.flush()
            print(row["set"], row["arm"], f"Q{row['q']}", f"G{row['g']}", f"{sum(row['units'])} B",
                  f"enc {row['encode_cpu']:.0f} cpu-s", f"cell {row['cell_wall']:.0f} s", flush=True)


if __name__ == "__main__":
    main()
