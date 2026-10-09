#!/usr/bin/env python3
"""Lossless AV1 bytes, AV1 alone: libaom's lossless controls, sample splits and reversible colour
transforms, and SVT-AV1 where it is exact — against HTJ2K on the same frames.

A coding is a representation (the planes the samples are coded as, and their merge back) and an
encoder variant, applied to every plane stream. Intra only, one keyframe a frame: the unit is one
frame (rows SIZE and TAXO found inter collecting nothing), but for the inter variants: one keyframe,
the rest predicted, --auto-alt-ref=0 (row TOOL: exact only without it). Every frame of every coding is decoded by
native dav1d, merged, and compared with the checksum written when the series was fetched; the last
frame of an intra coding is decoded alone as well. An inexact coding is reported and its bytes not used.

Stage 1 crosses every encoder variant with the set's plain representation (direct, gbr, or low2 over
12 bits) and every representation with libaom's defaults and SVT-AV1; CODINGS=rep.variant,... runs
those instead.

usage: llsize.py BUILD WORK OUT.tsv SET_DIR ...   [FRAMES=8 JOBS=4 CODINGS=a,b]  — README.md here
"""
import os
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import size  # noqa: E402

FRAMES = int(os.environ.get("FRAMES", 8))
PIXELS = 8_000_000  # per set, the frame count capped so a set's coding costs about the same

AOM = {
    "aom": [],
    "allintra": ["--allintra"],
    "screen": ["--tune-content=screen"],
    "sb64": ["--sb-size=64"],
    "sb128": ["--sb-size=128"],
    "screen-sb64": ["--tune-content=screen", "--sb-size=64"],
    "inter": ["--kf-min-dist=1000", "--kf-max-dist=1000", "--auto-alt-ref=0"],
    "inter-screen": ["--kf-min-dist=1000", "--kf-max-dist=1000", "--auto-alt-ref=0", "--tune-content=screen"],
    "lean": ["--enable-filter-intra=0", "--enable-intra-edge-filter=0", "--enable-smooth-intra=0",
             "--enable-paeth-intra=0", "--enable-cfl-intra=0", "--enable-palette=0", "--enable-intrabc=0",
             "--enable-angle-delta=0", "--enable-directional-intra=0"],
}


def container(bits):
    return next(b for b in (8, 10, 12) if bits <= b)


class Rep:
    """planes: [(bits used, channels, frame i → int array h×w×c)]; merge: decoded planes → samples."""

    def __init__(self, name, planes, merge):
        self.name, self.planes, self.merge = name, planes, merge


def representations(s):
    bits = int(s.hi + s.offset).bit_length()
    v = lambda i: s.frame(i).astype(np.int32) + s.offset  # noqa: E731
    reps = []
    if s.ch == 1:
        if bits <= 12:
            reps.append(Rep("direct", [(bits, 1, v)], lambda p: p[0]))
        for k in (1, 2, 3):
            if bits - k > 12 or bits - k < 6:
                continue
            reps.append(Rep(f"low{k}", [(bits - k, 1, lambda i, k=k: v(i) >> k),
                                        (k, 1, lambda i, k=k: v(i) & ((1 << k) - 1))],
                            lambda p, k=k: (p[0] << k) | p[1]))
        return reps
    rgb = lambda i: [v(i)[..., c] for c in range(3)]  # noqa: E731

    def rct(i):
        r, g, b = rgb(i)
        return np.stack([(r + 2 * g + b) >> 2, b - g + 256, r - g + 256], -1)

    def rct_back(p):
        y, cb, cr = p[0][..., 0], p[0][..., 1] - 256, p[0][..., 2] - 256
        g = y - ((cb + cr) >> 2)
        return np.stack([cr + g, g, cb + g], -1)

    def ycocg(i):
        r, g, b = rgb(i)
        co = r - b
        t = b + (co >> 1)
        cg = g - t
        return np.stack([t + (cg >> 1), co + 256, cg + 256], -1)

    def ycocg_back(p):
        y, co, cg = p[0][..., 0], p[0][..., 1] - 256, p[0][..., 2] - 256
        t = y - (cg >> 1)
        g = cg + t
        b = t - (co >> 1)
        return np.stack([b + co, g, b], -1)

    reps.append(Rep("gbr", [(bits, 3, lambda i: v(i)[..., [1, 2, 0]])], lambda p: p[0][..., [2, 0, 1]]))
    reps.append(Rep("rct", [(bits + 1, 3, rct)], rct_back))
    reps.append(Rep("ycocg-r", [(bits + 1, 3, ycocg)], ycocg_back))
    return reps


def write_y4m(path, n, bits, ch, h, w, plane):
    """Grey as 4:2:0 with neutral chroma; three channels as 4:4:4, the first as luma."""
    tag = ("444" if ch == 3 else "420") + ("" if bits == 8 else f"p{bits}")
    dt = "u1" if bits == 8 else "<u2"
    neutral = np.full(((h + 1) // 2, (w + 1) // 2), 1 << (bits - 1), dt)
    with open(path, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{w} H{h} F25:1 Ip A1:1 C{tag}\n".encode())
        for i in range(n):
            px = plane(i).astype(dt)
            planes = [px[..., c] for c in range(3)] if ch == 3 else [px[..., 0], neutral, neutral]
            fh.write(b"FRAME\n" + b"".join(np.ascontiguousarray(q).tobytes() for q in planes))


def encode(build, variant, y4m, out, n, bits, ch):
    if variant.startswith("svt"):
        cmd = [build / "svt/bin/SvtAv1EncApp", "-i", y4m, "-b", out, "--lossless", "1", "--preset",
               variant[3:], "--input-depth", str(bits), "-n", str(n), "--keyint", "1"]
    else:
        cmd = [build / f"aom-{size.AOM}/bin/aomenc", "-q", "--ivf", "-o", out, "--lossless=1", "--cpu-used=0",
               "--threads=1", f"--limit={n}", f"--bit-depth={bits}", f"--input-bit-depth={bits}",
               f"--profile={2 if bits == 12 else (1 if ch == 3 else 0)}", "--kf-max-dist=0", *AOM[variant]]
        cmd += ["--monochrome"] if ch == 1 else ["--matrix-coefficients=identity"]
        cmd += [y4m]
    t0 = time.perf_counter()
    subprocess.run(cmd, check=True, capture_output=True)
    return time.perf_counter() - t0


def decoded(build, src, out):
    """dav1d's frames as (h, w, c) int arrays, planes in the order coded (Y, U, V)."""
    return [np.stack([f[..., 1], f[..., 2], f[..., 0]], -1) if f.shape[2] == 3 else f
            for f in size.decode_y4m(build, src, out)]


def run_coding(build, work, s, rep, variant):
    cell = work / f"{s.name}.{rep.name}.{variant}"
    cell.mkdir(parents=True, exist_ok=True)
    n = frames(s)
    inter = variant.startswith("inter")
    streams, secs = [], 0.0
    for j, (used, ch, plane) in enumerate(rep.planes):
        bits = container(used)
        if variant.startswith("svt") and (ch != 1 or bits > 10):
            return dict(set=s.name, rep=rep.name, variant=variant, verdict="not applicable")
        y4m, ivf = cell / f"{j}.y4m", cell / f"{j}.ivf"
        write_y4m(y4m, n, bits, ch, s.h, s.w, plane)
        try:
            secs += encode(build, variant, y4m, ivf, n, bits, ch)
        except subprocess.CalledProcessError as e:
            return dict(set=s.name, rep=rep.name, variant=variant, verdict="not encodable: " + e.stderr.decode()[-80:].strip())
        y4m.unlink()
        units = size.ivf_units(ivf)
        (cell / "all.obu").write_bytes(b"".join(units))
        (cell / "last.obu").write_bytes(units[-1])
        got = decoded(build, cell / "all.obu", cell / "dec.y4m")
        last = None if inter else decoded(build, cell / "last.obu", cell / "dec.y4m")
        streams.append(dict(units=units, frames=got, last=last))
    exact = 0
    for i in range(n):
        if all(len(st["frames"]) == n for st in streams):
            got = rep.merge([st["frames"][i][:s.h, :s.w].astype(np.int32) for st in streams])
            exact += size.exact(s, i, got.reshape(s.h, s.w, s.ch))
    exact_alone = None
    if not inter:
        alone = rep.merge([st["last"][0][:s.h, :s.w].astype(np.int32) for st in streams])
        exact_alone = size.exact(s, n - 1, alone.reshape(s.h, s.w, s.ch))
    total = sum(len(u) for st in streams for u in st["units"])
    return dict(set=s.name, rep=rep.name, variant=variant, frames=n, exact=exact, last_alone=exact_alone,
                bytes=total, encode_s=round(secs, 2),
                verdict="exact" if exact == n and (exact_alone or inter) else "INEXACT")


def frames(s):
    return min(FRAMES, s.n, max(2, PIXELS // (s.w * s.h)))


def htj2k(s, work):
    env = {"LD_LIBRARY_PATH": str(size.OJPH / "lib")}
    ext = "pgm" if s.ch == 1 else "ppm"
    src, out, back = work / f"{s.name}.in.{ext}", work / f"{s.name}.j2c", work / f"{s.name}.back.{ext}"
    total, exact = 0, 0
    for i in range(frames(s)):
        shift = size.pnm(s, i, src)
        subprocess.run([size.OJPH / "bin/ojph_compress", "-i", src, "-o", out, "-num_decomps", "5",
                        "-block_size", "{64,64}", "-prog_order", "RPCL", "-reversible", "true"],
                       check=True, capture_output=True, env=env)
        subprocess.run([size.OJPH / "bin/ojph_expand", "-i", out, "-o", back], check=True, capture_output=True, env=env)
        exact += size.exact(s, i, size.read_pnm(back).astype(np.int32) - shift + s.offset)
        total += out.stat().st_size
    return dict(set=s.name, rep="htj2k", variant="-", frames=frames(s), exact=exact, bytes=total,
                verdict="exact" if exact == frames(s) else "INEXACT")


def job(build, work, path, rep_name, variant):
    s = size.Set(Path(path))
    if rep_name == "htj2k":
        return htj2k(s, work)
    rep = next(r for r in representations(s) if r.name == rep_name)
    return run_coding(build, work, s, rep, variant)


KEYS = ["set", "rep", "variant", "frames", "exact", "last_alone", "bytes", "encode_s", "verdict"]


def main():
    build, work, out, *sets = sys.argv[1:]
    build, work = Path(build), Path(work)
    work.mkdir(parents=True, exist_ok=True)
    chosen = os.environ.get("CODINGS")
    jobs = []
    for path in sets:
        s = size.Set(Path(path))
        jobs.append((path, "htj2k", "-"))
        reps = [r.name for r in representations(s)]
        plain = next(r for r in ("direct", "gbr", "low2") if r in reps)
        stage1 = {(plain, v) for v in AOM} | {(r, v) for r in reps for v in ("aom", "svt0")}
        for rep in reps:
            for variant in [*AOM, "svt0"]:
                if f"{rep}.{variant}" in chosen.split(",") if chosen else (rep, variant) in stage1:
                    jobs.append((path, rep, variant))
    jobs.sort(key=lambda j: -size.Set(Path(j[0])).w * size.Set(Path(j[0])).h)
    with open(out, "w") as fh, ProcessPoolExecutor(int(os.environ.get("JOBS", 4))) as pool:
        fh.write("\t".join(KEYS) + "\n")
        futures = [pool.submit(job, build, work, *j) for j in jobs]
        for f in futures:
            row = f.result()
            line = "\t".join(str(row.get(k, "")) for k in KEYS)
            fh.write(line + "\n")
            fh.flush()
            print(line, flush=True)


if __name__ == "__main__":
    main()
