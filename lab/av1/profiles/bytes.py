#!/usr/bin/env python3
"""PROFILEBYTES (README.md §5): one series, one depth form, one quantizer, one group length per cell — the lossy
stream's bytes and quality against the source, and the residual that makes every frame exact, checked.

usage: bytes.py BUILD WORK OUT.jsonl SETDIR ... --rungs 8,32 [--groups 1,8,16,0] [--forms all|primary]
                [--jobs 4] [--middle 32] [--aomdec-rung 8]          (G 0 is the whole series)
"""
import argparse
import hashlib
import json
import os
import resource
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from skimage.metrics import structural_similarity

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "delivery/preview"))
sys.path.insert(0, str(ROOT / "ingest/coded-frames"))
sys.path.insert(0, str(ROOT / "ingest/from-dicom"))
import ingest  # noqa: E402
import obu  # noqa: E402
from encode import preview_rgb, to_yuv420  # noqa: E402
from size import Set  # noqa: E402
from voi import display_windows, window_codes  # noqa: E402

AOM = "3.15.1"
HTJ2K = ["-num_decomps", "5", "-block_size", "{64,64}", "-prog_order", "RPCL", "-reversible", "true"]


class Middle(Set):
    """A set cut to its middle n frames (the fallback of §5, Fitting a session)."""

    def __init__(self, path, n):
        super().__init__(path)
        self.b = max(1, int(self.hi + self.offset).bit_length())
        if n and n < self.n:
            self.first, self.truth, self.n = (self.n - n) // 2, self.truth[(self.n - n) // 2:][:n], n
        else:
            self.first = 0

    def frame(self, i):
        return super().frame(i + getattr(self, "first", 0))


class Form:
    """How a series reaches the encoder (fwd: coded samples → planes) and back (planes → coded samples)."""

    def __init__(self, name, depth, profile, mono, fwd, back):
        self.name, self.depth, self.profile, self.mono, self.fwd, self.back = name, depth, profile, mono, fwd, back


def forms(s, win):
    if s.ch == 3:
        return [Form("rgb420", 8, 0, False, lambda v: to_yuv420(v),
                     lambda p: preview_rgb(*p).astype(np.int32))]
    one = lambda p: p[0].astype(np.int32)[..., None]
    if s.b <= 10:
        depth = 8 if s.b <= 8 else 10
        return [Form(f"{s.b}bit", depth, 0, True, lambda v: [v[..., 0]], one)]
    k = s.b - 10
    out = [Form(f"{s.b}bit", 12, 2, True, lambda v: [v[..., 0]], one),
           Form("top10", 10, 0, True, lambda v: [np.minimum((v[..., 0] + (1 << (k - 1))) >> k, 1023)],
                lambda p: (p[0].astype(np.int32) << k)[..., None])]
    if win:
        fwd, inv = window_map(win[0]["center"], win[0]["width"], (1 << s.b) - 1)
        out.append(Form("window", 10, 0, True, lambda v: [fwd[v[..., 0]]], lambda p: inv[p[0]][..., None]))
    return out


def window_map(c, w, top):
    """The series' first window to 0 … 1023, clipped outside, and its inverse: two integer tables, shipped."""
    lo = c - w / 2
    fwd = np.clip(np.rint((np.arange(top + 1) - lo) * 1023 / w), 0, 1023).astype(np.int32)
    inv = np.clip(np.rint(lo + np.arange(1024) * w / 1023), 0, top).astype(np.int32)
    return fwd, inv


def aomenc_args(form, q, g, n, altref=False):
    group = ["--kf-max-dist=0"] if g == 1 else [f"--kf-min-dist={g or n}", f"--kf-max-dist={g or n}"]
    colour = ["--monochrome", f"--profile={form.profile}", f"--bit-depth={form.depth}",
              f"--input-bit-depth={form.depth}"] if form.mono else \
        ["--bit-depth=8", "--profile=0", "--color-primaries=bt601", "--transfer-characteristics=bt601",
         "--matrix-coefficients=bt601"]
    return ["--ivf", "--good", "--cpu-used=6", "--threads=1", "--passes=1", "--tune=psnr", "--end-usage=q",
            f"--cq-level={q}", f"--min-q={q}", f"--max-q={q}", "--deltaq-mode=0", "--aq-mode=0",
            "--denoise-noise-level=0", *(["--lag-in-frames=19", "--auto-alt-ref=1"] if altref else
                                        ["--lag-in-frames=0", "--auto-alt-ref=0"]), *group, *colour]


def write_y4m(s, form, path):
    tag = "420" + ("" if form.depth == 8 else f"p{form.depth}")
    dt = "u1" if form.depth == 8 else "<u2"
    neutral = np.full(((s.h + 1) // 2, (s.w + 1) // 2), 1 << (form.depth - 1), dt)
    with open(path, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{s.w} H{s.h} F25:1 Ip A1:1 C{tag}\n".encode())
        for i in range(s.n):
            planes = form.fwd(s.frame(i).astype(np.int32) + s.offset)
            if form.mono:
                planes = [planes[0], neutral, neutral]
            fh.write(b"FRAME\n" + b"".join(np.ascontiguousarray(p, dt).tobytes() for p in planes))


def child(cmd):
    """Wall and CPU seconds of one child process, from getrusage; stderr kept."""
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    t0 = time.perf_counter()
    r = subprocess.run([str(c) for c in cmd], capture_output=True)
    wall = time.perf_counter() - t0
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    if r.returncode:
        raise RuntimeError(f"{cmd[0]}: {r.stderr.decode()[-400:]}")
    return wall, after.ru_utime + after.ru_stime - before.ru_utime - before.ru_stime, r.stderr.decode()


def q_hist(stderr):
    """aomenc's --q-hist lines, ' lo[-hi] : ===  count (share%)': {lo: count}."""
    out = {}
    for line in stderr.split("Quantizer Selection:")[-1].splitlines():
        if ":" in line and "(" in line:
            left, right = line.split(":", 1)
            out[int(left.split("-")[0])] = int(right.split("(")[0].split()[-1])
    return out


def y4m_frames(path, s, form):
    """Each decoded picture's planes, read lazily from dav1d's output."""
    raw = np.memmap(path, "u1", "r")
    pos = bytes(raw[:256]).index(b"\n") + 1
    head = bytes(raw[:pos]).split()
    c = next(t[1:].decode() for t in head if t.startswith(b"C"))
    dt = np.dtype("u1" if form.depth == 8 else "<u2")
    dims = [(s.h, s.w)] + ([] if c.startswith("mono") else [((s.h + 1) // 2, (s.w + 1) // 2)] * 2)
    size = sum(a * b for a, b in dims) * dt.itemsize
    for _ in range(s.n):
        pos += 6
        planes, at = [], pos
        for a, b in dims:
            planes.append(np.frombuffer(raw, dt, a * b, at).reshape(a, b))
            at += a * b * dt.itemsize
        yield planes
        pos += size


def htj2k_residual(build, work, s, r, bits):
    src, cs = work / ("r.pgm" if s.ch == 1 else "r.ppm"), work / "r.j2c"
    ext = "P5" if s.ch == 1 else "P6"
    with open(src, "wb") as fh:
        fh.write(b"%s\n%d %d\n%d\n" % (ext.encode(), s.w, s.h, (1 << bits) - 1))
        fh.write(r.astype(">u2" if bits > 8 else "u1").tobytes())
    subprocess.run([build / "openjph/bin/ojph_compress", "-i", src, "-o", cs, *HTJ2K], check=True,
                   capture_output=True, env={"LD_LIBRARY_PATH": str(build / "openjph/lib")})
    data = cs.read_bytes()
    back, _ = ingest.decoded(build, "htj2k", data, s.h * s.w * s.ch)
    return len(data), back


def aomdec_matches(build, ivf, out, s, form, frames):
    """aomdec's luma against dav1d's, sample for sample, every frame."""
    child([build / f"aom-{AOM}/bin/aomdec", "--rawvideo", "-o", out, ivf])
    raw = np.fromfile(out, "u1")
    per = raw.size // s.n
    bps = 1 if form.depth == 8 else 2
    for i, planes in enumerate(frames):
        y = np.frombuffer(raw[i * per:i * per + s.h * s.w * bps].tobytes(), "u1" if bps == 1 else "<u2")
        if not np.array_equal(y.reshape(s.h, s.w), planes[0]):
            return False
    return True


def cell(job):
    build, work, path, middle, form_name, q, g, aomdec, mutate, altref = job
    t0 = time.perf_counter()
    s = Middle(Path(path), middle)
    meta = json.loads((Path(work) / f"{Path(path).name}.display.json").read_text())
    form = next(f for f in forms(s, meta["windows"]) if f.name == form_name)
    work = Path(work) / f"{s.name}-{form.name}-q{q}-g{g}{'-altref' if altref else ''}"
    work.mkdir(parents=True, exist_ok=True)
    y4m, ivf, dec = work / "in.y4m", work / "out.ivf", work / "dec.y4m"
    write_y4m(s, form, y4m)
    wall, cpu, err = child([build / f"aom-{AOM}/bin/aomenc", "-o", ivf, f"--limit={s.n}", "--q-hist=64", "--disable-warning-prompt",
                            *aomenc_args(form, q, g, s.n, altref), y4m])
    y4m.unlink()
    units = ingest.ivf_units(ivf)
    keys = [i for i, u in enumerate(units) if obu.sequence_header(u) is not None]
    seq = obu.film_grain_params_present(obu.sequence_header(units[0]))
    child([build / "dav1d/bin/dav1d", "-q", "--threads=1", "-i", ivf, "-o", dec])
    row = dict(set=s.name, altref=altref, frames=s.n, first=s.first, form=form.name, q=q, g=g or s.n, whole=g == 0,
               units=len(units), keyframes=keys, seq=seq, q_hist=q_hist(err), lossy=[len(u) for u in units],
               encode_wall=wall, encode_cpu=cpu, mpx=s.n * s.w * s.h / 1e6)
    row.update(measure(build, work, s, form, meta, lambda: y4m_frames(dec, s, form), mutate))
    if aomdec:
        row["aomdec_matches"] = aomdec_matches(build, ivf, work / "aomdec.yuv", s, form, y4m_frames(dec, s, form))
    for f in work.iterdir():
        f.unlink()
    work.rmdir()
    row["cell_wall"] = time.perf_counter() - t0
    return row


def measure(build, work, s, form, meta, frames, mutate=None):
    """Pass 1: quality and display against the source; pass 2: the residual coded, decoded, added back, hashed."""
    peak = (1 << s.b) - 1
    tables = [window_codes(w, meta["rescale"], peak) for w in meta["windows"]]
    sse = sse_in = n_in = worst = 0
    mse, ssim, ssim_in, lo, hi = [], [], [], 1 << 30, -(1 << 30)
    disp = [dict(n=0, differ=0, over1=0, max=0) for _ in tables]
    for i, planes in enumerate(frames()):
        v = s.frame(i).astype(np.int32) + s.offset
        b = form.back(planes)
        d = (b - v).astype(np.int64)
        mse.append(float(np.mean(d * d)))
        sse += float(np.sum(d * d))
        worst = max(worst, int(np.abs(d).max()))
        lo, hi = min(lo, int(d.min())), max(hi, int(d.max()))
        inside = in_window(tables[0], v - s.offset) if tables else np.ones(v.shape, bool)
        sse_in += float(np.sum(d[inside] ** 2))
        n_in += int(inside.sum())
        grey = s.ch == 1
        m, full = structural_similarity(v[..., 0] if grey else v, b[..., 0] if grey else b, gaussian_weights=True,
                                        sigma=1.5, use_sample_covariance=False, data_range=peak, full=True,
                                        channel_axis=None if grey else -1)
        ssim.append(float(m))
        ssim_in.append(float((full[..., None] if grey else full)[inside].mean()))
        for t, acc in zip(tables, disp):
            a, z = t[v - s.offset], t[np.clip(b - s.offset, 0, peak)]
            keep = (a > 0) & (a < 255)
            dc = np.abs(a[keep].astype(np.int16) - z[keep])
            acc["n"] += int(keep.sum())
            acc["differ"] += int((dc > 0).sum())
            acc["over1"] += int((dc > 1).sum())
            acc["max"] = max(acc["max"], int(dc.max()) if dc.size else 0)
    ro, bits = hi, max(1, (hi - lo).bit_length())
    res, exact = [], 0
    for i, planes in enumerate(frames()):
        v = s.frame(i).astype(np.int32) + s.offset
        b = form.back(planes)
        n, back = htj2k_residual(build, work, s, v - b + ro, bits)
        if mutate == "flip" and i == 0:
            back[0, 0, 0] ^= 1
        exact += ingest.exact(s, i, b + back - (ro + (mutate == "offset")))
        res.append(n)
    npx = s.n * s.w * s.h * s.ch
    return dict(psnr=psnr(sse / npx, peak), psnr_frame_min=min(psnr(m, peak) for m in mse),
                psnr_in=psnr(sse_in / max(n_in, 1), peak), rmse=float(np.sqrt(sse / npx)), max_abs=worst,
                ssim=float(np.mean(ssim)), ssim_min=min(ssim), ssim_in=float(np.mean(ssim_in)),
                display=[dict(window=w, **acc) for w, acc in zip(meta["windows"], disp)],
                residual=res, residual_offset=ro, residual_bits=bits, exact_frames=exact)


def in_window(table, v):
    a = table[v]
    return (a > 0) & (a < 255)


def psnr(m, peak):
    return float("inf") if m == 0 else float(10 * np.log10(peak * peak / m))


def jobs(a):
    out = []
    for path in a.sets:
        s = Middle(Path(path), a.middle)
        meta = display_windows(ROOT / "lab/av1/data.json", s.name, Path(path).parent)
        (a.work / f"{s.name}.display.json").write_text(json.dumps(meta))
        names = [f.name for f in forms(s, meta["windows"])]
        if a.forms == "primary" or s.name not in a.depth_sets and a.depth_sets != ["all"]:
            names = names[:1]
        for q in a.rungs:
            for name in names:
                for g in a.groups:
                    first = (q, g, name) == (a.aomdec_rung, 16, names[0])
                    out.append((a.build, str(a.work), path, a.middle, name, q, g, first and not a.altref, a.mutate, a.altref))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("work", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", nargs="+")
    ap.add_argument("--rungs", type=lambda v: [int(x) for x in v.split(",")], required=True)
    ap.add_argument("--groups", type=lambda v: [int(x) for x in v.split(",")], default=[1, 8, 16, 0])
    ap.add_argument("--forms", choices=["all", "primary"], default="all")
    ap.add_argument("--depth-sets", type=lambda v: v.split(","), default=["all"])
    ap.add_argument("--middle", type=int, default=0)
    ap.add_argument("--aomdec-rung", type=int, default=8)
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--mutate", choices=["flip", "offset"])
    ap.add_argument("--altref", action="store_true", help="the secondary arm: hidden alt-ref frames on")
    a = ap.parse_args()
    a.build, a.work = a.build.resolve(), a.work.resolve()
    a.work.mkdir(parents=True, exist_ok=True)
    done = set()
    if a.out.exists():
        done = {(r["set"], r["form"], r["q"], r["g"] if not r["whole"] else 0) for r in map(json.loads, a.out.open())}
    todo = [j for j in jobs(a) if (Path(j[2]).name, j[4], j[5], j[6]) not in done]
    print(f"{len(todo)} cells", flush=True)
    with open(a.out, "a") as fh, ProcessPoolExecutor(a.jobs) as pool:
        for row in pool.map(cell, todo):
            fh.write(json.dumps(row) + "\n")
            fh.flush()
            print(row["set"], row["form"], f"Q{row['q']}", f"G{row['g']}", f"{sum(row['lossy'])} B",
                  f"PSNR {row['psnr']:.2f}", f"res {sum(row['residual'])} B",
                  f"exact {row['exact_frames']}/{row['frames']}", f"enc {row['encode_cpu']:.0f} cpu-s", flush=True)


if __name__ == "__main__":
    main()
