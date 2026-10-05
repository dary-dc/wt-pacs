#!/usr/bin/env python3
"""RESID's frames: each set as served HTJ2K, as lossy AV1 previews, and as the residual that makes
each preview exact — source minus preview, offset per series — coded losslessly in HTJ2K and in AV1.

The preview's reconstruction is integer arithmetic so that the browser repeats it bit for bit:
grey above 10 bits is coded as (v + half) >> s and shown as p << s; colour is BT.601 full range,
4:2:0, back to RGB in 16-bit fixed point (preview_rgb). Every residual is decoded, added to the
native dav1d preview and compared with the checksum written when the frame was fetched.

usage: encode.py BUILD OUT SETDIR ...   — lab/av1/resid/README.md
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "preview"))
from encode import to_yuv420  # noqa: E402
from size import AOM, OJPH, Set, exact, ivf_units, pnm, read_pnm, timed  # noqa: E402

GROUP = 8
CRFS = (8, 20, 32, 44)
PRESET = 6
DAV1D_ENV = None


def coded_bits(s):
    return int(s.hi + s.offset).bit_length()


def grey_shift(s):
    return max(0, coded_bits(s) - 10)


def to_preview_grey(s, v):
    k = grey_shift(s)
    return np.minimum((v + ((1 << k) >> 1)) >> k, 1023).astype("<u2")


def preview_rgb(y, u, v):
    """Chroma repeated 2×2; R, G, B from Y′CbCr in 16-bit fixed point, rounded, clamped."""
    h, w = y.shape
    up = lambda p: np.repeat(np.repeat(p.astype(np.int32), 2, 0), 2, 1)[:h, :w] - 128
    yi, cb, cr = y.astype(np.int32), up(u), up(v)
    r = yi + ((91881 * cr + 32768) >> 16)
    g = yi + ((-22554 * cb - 46802 * cr + 32768) >> 16)
    b = yi + ((116130 * cb + 32768) >> 16)
    return np.clip(np.stack([r, g, b], -1), 0, 255)


def prediction(s, planes):
    """The preview as the client shows it, in coded values (source + offset): (h, w, ch) int32."""
    if s.ch == 3:
        return preview_rgb(*planes)
    return (planes[0].astype(np.int32) << grey_shift(s))[..., None]


def coded(s, i):
    return s.frame(i).astype(np.int32) + s.offset


def read_y4m(path):
    """Every picture's planes as dav1d wrote them; 4:0:0, 4:2:0 or 4:4:4, 8 or 16-bit samples."""
    raw = path.read_bytes()
    head, rest = raw.split(b"\n", 1)
    tok = {t[:1]: t[1:].decode() for t in head.split()[1:]}
    w, h, c = int(tok[b"W"]), int(tok[b"H"]), tok[b"C"]
    dt = np.dtype("<u2" if "p1" in c or c in ("mono10", "mono12") else "u1")
    sub = [] if c.startswith("mono") else [(h, w)] * 2 if c.startswith("444") else [((h + 1) // 2, (w + 1) // 2)] * 2
    dims = [(h, w)] + sub
    size = sum(a * b for a, b in dims) * dt.itemsize
    frames, pos = [], 0
    while pos < len(rest):
        pos = rest.index(b"\n", pos) + 1
        buf, at, planes = np.frombuffer(rest[pos:pos + size], dt), 0, []
        for a, b in dims:
            planes.append(buf[at:at + a * b].reshape(a, b))
            at += a * b
        frames.append(planes)
        pos += size
    return frames


def dav1d(build, ivf, out):
    timed([build / "dav1d/bin/dav1d", "-q", "-i", ivf, "-o", out], env={"LD_LIBRARY_PATH": str(build / "dav1d/lib")})
    return read_y4m(out)


def preview_cell(build, s, work, crf):
    y4m, ivf = work / "in.y4m", work / "preview.ivf"
    with open(y4m, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{s.w} H{s.h} F25:1 Ip A1:1 C{'420' if s.ch == 3 else '420p10'}\n".encode())
        grey = np.full(((s.h + 1) // 2, (s.w + 1) // 2), 512, "<u2")
        for i in range(s.n):
            planes = to_yuv420(s.frame(i)) if s.ch == 3 else (to_preview_grey(s, coded(s, i)[..., 0]), grey, grey)
            fh.write(b"FRAME\n" + b"".join(np.ascontiguousarray(p).tobytes() for p in planes))
    colour = ["--monochrome", "--bit-depth=10", "--input-bit-depth=10", "--profile=0"] if s.ch == 1 else \
        ["--bit-depth=8", "--profile=0", "--color-primaries=bt601", "--transfer-characteristics=bt601",
         "--matrix-coefficients=bt601"]
    timed([build / f"aom-{AOM}/bin/aomenc", "-q", "--ivf", "-o", ivf, "--end-usage=q", f"--cq-level={crf}",
           f"--cpu-used={PRESET}", f"--limit={s.n}", *colour, f"--kf-min-dist={GROUP}", f"--kf-max-dist={GROUP}", y4m])
    units, frames = ivf_units(ivf), dav1d(build, ivf, work / "dec.y4m")
    if len(units) != s.n or len(frames) != s.n:
        sys.exit(f"{s.name} crf{crf}: {len(units)} units, {len(frames)} pictures for {s.n} frames")
    return units, frames


def psnr(s, pred):
    peak = (1 << coded_bits(s)) - 1
    worst, mse = 0, []
    for i, p in enumerate(pred):
        d = p - coded(s, i)
        worst = max(worst, int(np.abs(d).max()))
        mse.append(float(np.mean(d.astype(np.float64) ** 2)))
    return round(float(np.mean([10 * np.log10(peak * peak / m) for m in mse])), 2), worst


def resid_htj2k(s, work, dst, pred, res, ro, bits):
    env = {"LD_LIBRARY_PATH": str(OJPH / "lib")}
    ext = "pgm" if s.ch == 1 else "ppm"
    src, back, sizes = work / f"r.{ext}", work / f"rb.{ext}", []
    for i, r in enumerate(res):
        with open(src, "wb") as fh:
            fh.write(b"%s\n%d %d\n%d\n" % (b"P5" if s.ch == 1 else b"P6", s.w, s.h, (1 << bits) - 1))
            fh.write((r + ro).astype(">u2" if bits > 8 else "u1").tobytes())
        out = dst / f"{i:03d}.htj2k"
        timed([OJPH / "bin/ojph_compress", "-i", src, "-o", out, "-num_decomps", "5", "-block_size", "{64,64}",
               "-prog_order", "RPCL", "-reversible", "true"], env=env)
        timed([OJPH / "bin/ojph_expand", "-i", out, "-o", back], env=env)
        if not exact(s, i, pred[i] + read_pnm(back).astype(np.int32) - ro):
            sys.exit(f"{s.name} {dst.name} {i}: preview + HTJ2K residual not exact")
        sizes.append(out.stat().st_size)
    return sizes


def resid_av1(build, s, work, dst, pred, res, ro, bits):
    """Intra lossless at the next depth AV1 has; grey as 4:0:0, colour as G, B, R 4:4:4 (identity)."""
    depth = next((b for b in (8, 10, 12) if bits <= b), None)
    if depth is None:
        return None
    y4m, ivf, dt = work / "r.y4m", work / "r.ivf", "u1" if depth == 8 else "<u2"
    tag = ("444" if s.ch == 3 else "420") + ("" if depth == 8 else f"p{depth}")
    neutral = np.full(((s.h + 1) // 2, (s.w + 1) // 2), 1 << (depth - 1), dt)
    with open(y4m, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{s.w} H{s.h} F25:1 Ip A1:1 C{tag}\n".encode())
        for r in res:
            px = (r + ro).astype(dt)
            planes = [px[..., 1], px[..., 2], px[..., 0]] if s.ch == 3 else [px[..., 0], neutral, neutral]
            fh.write(b"FRAME\n" + b"".join(np.ascontiguousarray(p).tobytes() for p in planes))
    profile = 2 if depth == 12 else (1 if s.ch == 3 else 0)
    timed([build / f"aom-{AOM}/bin/aomenc", "-q", "--ivf", "-o", ivf, "--lossless=1", f"--cpu-used={PRESET}",
           f"--limit={s.n}", f"--bit-depth={depth}", f"--input-bit-depth={depth}", f"--profile={profile}",
           *(["--monochrome"] if s.ch == 1 else ["--matrix-coefficients=identity"]), "--kf-max-dist=0", y4m])
    units, frames = ivf_units(ivf), dav1d(build, ivf, work / "rdec.y4m")
    if len(units) != s.n or len(frames) != s.n:
        sys.exit(f"{s.name} {dst.name}: AV1 residual {len(units)} units, {len(frames)} pictures")
    for i, (u, f) in enumerate(zip(units, frames)):
        got = np.stack([f[2], f[0], f[1]], -1) if s.ch == 3 else f[0][..., None]
        if not exact(s, i, pred[i] + got.astype(np.int32) - ro):
            sys.exit(f"{s.name} {dst.name} {i}: preview + AV1 residual not exact")
        (dst / f"{i:03d}.av1").write_bytes(u)
    return dict(depth=depth, sizes=[len(u) for u in units])


def htj2k(s, work, dst):
    env = {"LD_LIBRARY_PATH": str(OJPH / "lib")}
    ext = "pgm" if s.ch == 1 else "ppm"
    src, back, sizes = work / f"in.{ext}", work / f"back.{ext}", []
    for i in range(s.n):
        shift = pnm(s, i, src)
        out = dst / f"{i:03d}.htj2k"
        timed([OJPH / "bin/ojph_compress", "-i", src, "-o", out, "-num_decomps", "5", "-block_size", "{64,64}",
               "-prog_order", "RPCL", "-reversible", "true"], env=env)
        timed([OJPH / "bin/ojph_expand", "-i", out, "-o", back], env=env)
        if not exact(s, i, read_pnm(back).astype(np.int32) - shift + s.offset):
            sys.exit(f"{s.name} {i}: HTJ2K not exact")
        sizes.append(out.stat().st_size)
    return shift, sizes


def sha(planes):
    return hashlib.sha256(b"".join(np.ascontiguousarray(p).tobytes() for p in planes)).hexdigest()


def main():
    build, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    manifest = []
    for d in sys.argv[3:]:
        s = Set(Path(d))
        dst, work = out / s.name, out / f".{s.name}-work"
        dst.mkdir(parents=True, exist_ok=True)
        work.mkdir(exist_ok=True)
        shift, sizes = htj2k(s, work, dst)
        entry = dict(name=s.name, width=s.w, height=s.h, channels=s.ch, bits=s.stored, signed=s.signed,
                     offset=s.offset, htj2k_shift=shift, grey_shift=grey_shift(s) if s.ch == 1 else None,
                     frames=s.n, truth=s.truth, htj2k=sizes, cells=[])
        print(s.name, "HTJ2K", sum(sizes), "B", flush=True)
        for crf in CRFS:
            cell = f"crf{crf}"
            (dst / cell).mkdir(exist_ok=True)
            units, frames = preview_cell(build, s, work, crf)
            for i, u in enumerate(units):
                (dst / cell / f"{i:03d}.av1").write_bytes(u)
            pred = [prediction(s, f) for f in frames]
            res = [coded(s, i) - p for i, p in enumerate(pred)]
            lo, hi = min(int(r.min()) for r in res), max(int(r.max()) for r in res)
            ro, bits = -lo, max(1, (hi - lo).bit_length())
            (dst / cell / "r-htj2k").mkdir(exist_ok=True)
            (dst / cell / "r-av1").mkdir(exist_ok=True)
            rh = resid_htj2k(s, work, dst / cell / "r-htj2k", pred, res, ro, bits)
            ra = resid_av1(build, s, work, dst / cell / "r-av1", pred, res, ro, bits)
            p, worst = psnr(s, pred)
            c = dict(cell=cell, crf=crf, group=GROUP, preview=[len(u) for u in units],
                     preview_hashes=[sha(f) for f in frames], psnr_mean=p, max_abs=worst,
                     resid_offset=ro, resid_bits=bits, resid_htj2k=rh, resid_av1=ra,
                     webcodecs="av01.0.00M.10" if s.ch == 1 else "av01.0.00M.08")
            entry["cells"].append(c)
            h, pv = sum(sizes), sum(c["preview"])
            print(s.name, cell, f"preview {pv / h:.4f} PSNR {p} max|Δ| {worst} resid {lo}..{hi} ({bits} b)",
                  f"preview+rHTJ2K {(pv + sum(rh)) / h:.4f}",
                  f"preview+rAV1 {(pv + sum(ra['sizes'])) / h:.4f}" if ra else "rAV1 -", flush=True)
        manifest.append(entry)
        (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
