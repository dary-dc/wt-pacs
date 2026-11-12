#!/usr/bin/env python3
"""Why the 12-bit series' top 10 bits cost more than its 12-bit stream (top10.md): one series, one form, one
quantizer, one group length and one encoder arm per cell — the lossy stream's bytes and its quality at 12 bits.

usage: top10.py BUILD WORK OUT.jsonl SETDIR ... --rungs 12,16,20 [--groups 1] [--forms 12bit,top10]
                [--arms base] [--ssim] [--residual] [--jobs 4]
       top10.py BUILD WORK OUT.jsonl SETDIR ... --rungs 0 --low-bits
"""
import argparse
import json
import subprocess
from concurrent.futures import ProcessPoolExecutor
from itertools import product
from pathlib import Path

import numpy as np
from skimage.metrics import structural_similarity

import bytes as campaign

ARMS = {
    "base": [],
    "nocdef": ["--enable-cdef=0"],
    "nolf": ["--loopfilter-control=0"],
    "nolr": ["--enable-restoration=0"],
    "notrellis": ["--disable-trellis-quant=1"],
    "nofilters": ["--enable-cdef=0", "--loopfilter-control=0", "--enable-restoration=0"],
    "lambda": [],
}
PATCHED = {"lambda": "aom-lambda"}  # built from aom-3.15.1 with top10-lambda.patch applied


def top10(v):
    return np.minimum((v + 2) >> 2, 1023)


FORMS = {
    "12bit": campaign.Form("12bit", 12, 2, True, lambda v: [v[..., 0]], lambda p: p[0].astype(np.int32)),
    "top10": campaign.Form("top10", 10, 0, True, lambda v: [top10(v[..., 0])], lambda p: p[0].astype(np.int32) << 2),
    "top10at12": campaign.Form("top10at12", 12, 2, True, lambda v: [top10(v[..., 0]) << 2],
                               lambda p: p[0].astype(np.int32)),
}


def cell(job):
    build, work, path, form_name, q, g, arm, ssim, residual = job
    s, form = campaign.Middle(Path(path), 0), FORMS[form_name]
    meta = campaign.display_windows(campaign.ROOT / "lab/av1/data.json", s.name, Path(path).parent)
    work = Path(work) / f"{s.name}-{form_name}-q{q}-g{g}-{arm}"
    work.mkdir(parents=True, exist_ok=True)
    y4m, ivf, dec = work / "in.y4m", work / "out.ivf", work / "dec.yuv"
    campaign.write_y4m(s, form, y4m)
    aom = build / PATCHED.get(arm, f"aom-{campaign.AOM}") / "bin"
    wall, cpu, err = campaign.child([aom / "aomenc", "-o", ivf, f"--limit={s.n}", "--q-hist=64",
                                     "--disable-warning-prompt", *campaign.aomenc_args(form, q, g, s.n), *ARMS[arm], y4m])
    y4m.unlink()
    units = campaign.ingest.ivf_units(ivf)
    campaign.child([aom / "aomdec", "--rawvideo", "-o", dec, ivf])
    raw = np.fromfile(dec, "<u2")
    per = raw.size // s.n
    window = campaign.window_codes(meta["windows"][0], meta["rescale"], (1 << s.b) - 1)
    sse = sse_in = n_in = 0
    ssims, res_bytes, res_sq = [], 0, []
    for i in range(s.n):
        v = s.frame(i)[..., 0].astype(np.int32) + s.offset
        b = form.back([raw[i * per:i * per + s.h * s.w].reshape(s.h, s.w)])
        d = (b - v).astype(np.int64)
        inside = campaign.in_window(window, v - s.offset)
        sse += float(np.sum(d * d))
        sse_in += float(np.sum(d[inside] ** 2))
        n_in += int(inside.sum())
        if ssim:
            ssims.append(float(structural_similarity(v, b, gaussian_weights=True, sigma=1.5,
                                                     use_sample_covariance=False, data_range=(1 << s.b) - 1)))
        if residual:
            res_sq.append(v - b)
    peak, npx = (1 << s.b) - 1, s.n * s.w * s.h
    row = dict(set=s.name, form=form_name, q=q, g=g, arm=arm, frames=s.n, lossy=sum(len(u) for u in units),
               q_hist=campaign.q_hist(err), encode_cpu=cpu, encode_wall=wall,
               psnr=campaign.psnr(sse / npx, peak), psnr_in=campaign.psnr(sse_in / n_in, peak),
               rmse=float(np.sqrt(sse / npx)))
    if ssim:
        row["ssim"] = float(np.mean(ssims))
    if residual:
        lo = min(int(r.min()) for r in res_sq)
        bits = max(1, (max(int(r.max()) for r in res_sq) - lo).bit_length())
        for r in res_sq:
            res_bytes += htj2k_bytes(build, work, s, r - lo, bits)
        row["residual"] = res_bytes
    for f in work.iterdir():
        f.unlink()
    work.rmdir()
    return row


def htj2k_bytes(build, work, s, r, bits):
    src, cs = work / "r.pgm", work / "r.j2c"
    with open(src, "wb") as fh:
        fh.write(b"P5\n%d %d\n%d\n" % (s.w, s.h, (1 << bits) - 1))
        fh.write(r.astype(">u2").tobytes())
    subprocess.run([build / "openjph/bin/ojph_compress", "-i", src, "-o", cs, *campaign.HTJ2K], check=True,
                   capture_output=True, env={"LD_LIBRARY_PATH": str(build / "openjph/lib")})
    return cs.stat().st_size


def low_bits(build, work, path):
    """The two bits the top 10 drop, as their own lossless HTJ2K stream, and their zeroth-order entropy."""
    s = campaign.Middle(Path(path), 0)
    work = Path(work) / f"{s.name}-low"
    work.mkdir(parents=True, exist_ok=True)
    total, counts = 0, np.zeros(4, np.int64)
    for i in range(s.n):
        low = (s.frame(i)[..., 0].astype(np.int32) + s.offset) & 3
        counts += np.bincount(low.ravel(), minlength=4)
        total += htj2k_bytes(build, work, s, low, 2)
    p = counts / counts.sum()
    return dict(set=s.name, form="low2", bytes=total, entropy_bits=float(-(p * np.log2(p)).sum()),
                mpx=s.n * s.w * s.h / 1e6)


def interleaved(a):
    """Forms and arms alternate inside each (set, G, Q), so no arm runs as a block before another."""
    out = []
    for path, g, q in product(a.sets, a.groups, a.rungs):
        for arm, form in product(a.arms, a.forms):
            out.append((a.build, str(a.work), path, form, q, g, arm, a.ssim, a.residual))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("work", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", nargs="+")
    ints = lambda v: [int(x) for x in v.split(",")]
    ap.add_argument("--rungs", type=ints, required=True)
    ap.add_argument("--groups", type=ints, default=[1])
    ap.add_argument("--forms", type=lambda v: v.split(","), default=["12bit", "top10"])
    ap.add_argument("--arms", type=lambda v: v.split(","), default=["base"])
    ap.add_argument("--ssim", action="store_true")
    ap.add_argument("--residual", action="store_true")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--low-bits", action="store_true", help="only the dropped two bits' own lossless stream")
    a = ap.parse_args()
    a.build, a.work = a.build.resolve(), a.work.resolve()
    a.work.mkdir(parents=True, exist_ok=True)
    if a.low_bits:
        with open(a.out, "a") as fh:
            for path in a.sets:
                fh.write(json.dumps(low_bits(a.build, a.work, path)) + "\n")
        return
    key = lambda r: (Path(r[2]).name, r[3], r[4], r[5], r[6])
    done = {(r["set"], r["form"], r["q"], r["g"], r["arm"]) for r in map(json.loads, a.out.open())} \
        if a.out.exists() else set()
    todo = [j for j in interleaved(a) if key(j) not in done]
    print(f"{len(todo)} cells", flush=True)
    with open(a.out, "a") as fh, ProcessPoolExecutor(a.jobs) as pool:
        for row in pool.map(cell, todo):
            fh.write(json.dumps(row) + "\n")
            fh.flush()
            print(row["set"], row["form"], row["arm"], f"Q{row['q']}", f"G{row['g']}", f"{row['lossy']} B",
                  f"PSNR {row['psnr']:.3f}", flush=True)


if __name__ == "__main__":
    main()
