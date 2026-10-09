#!/usr/bin/env python3
"""PREVIEW's frames: each set as served HTJ2K (exact) and as lossy AV1 previews over G and CRF.

A preview is 4:2:0 for colour (full-range BT.601, converted here) and 4:0:0 at 10 bits for grey
(v >> 2, so WebCodecs takes it). Its quality is measured against the encoder's input as PSNR and
max |Δ| after the client's reconstruction (preview_rgb / preview_grey). Each stream's native dav1d
output is hashed per frame: the browser decoders are checked against those hashes.

usage: encode.py BUILD OUT SETDIR ...   — lab/av1/delivery/preview/README.md
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
from size import AOM, OJPH, Set, exact, ivf_units, pnm, read_pnm, timed  # noqa: E402

GROUPS = (1, 8, 0)  # 0: the whole series, one keyframe
CRFS = (8, 20, 32, 44)
PRESET = 6


def to_yuv420(rgb):
    """Full-range BT.601, chroma averaged over 2×2 (edge pixels repeated)."""
    r, g, b = (rgb[..., k].astype(np.float64) for k in range(3))
    y = 0.299 * r + 0.587 * g + 0.114 * b
    u = (b - y) / 1.772 + 128
    v = (r - y) / 1.402 + 128
    h, w = y.shape
    pad = lambda p: np.pad(p, ((0, h % 2), (0, w % 2)), mode="edge")
    sub = lambda p: pad(p).reshape((h + 1) // 2, 2, (w + 1) // 2, 2).mean(axis=(1, 3))
    q = lambda p: np.clip(np.rint(p), 0, 255).astype("u1")
    return q(y), q(sub(u)), q(sub(v))


def preview_rgb(y, u, v):
    """The client's reconstruction: chroma repeated 2×2, BT.601 full range back to RGB."""
    h, w = y.shape
    up = lambda p: np.repeat(np.repeat(p.astype(np.float64), 2, 0), 2, 1)[:h, :w] - 128
    yf, uf, vf = y.astype(np.float64), up(u), up(v)
    r = yf + 1.402 * vf
    b = yf + 1.772 * uf
    g = (yf - 0.299 * r - 0.114 * b) / 0.587
    return np.clip(np.rint(np.stack([r, g, b], -1)), 0, 255).astype(np.int32)


def to_grey10(px):
    return np.minimum((px.astype(np.int32) + 2) >> 2, 1023).astype("<u2")


def preview_grey(y):
    return (y.astype(np.int32) << 2)[..., None]


def write_y4m(s, path):
    with open(path, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{s.w} H{s.h} F25:1 Ip A1:1 C{'420' if s.ch == 3 else '420p10'}\n".encode())
        grey = np.full(((s.h + 1) // 2, (s.w + 1) // 2), 512, "<u2")
        for i in range(s.n):
            planes = to_yuv420(s.frame(i)) if s.ch == 3 else (to_grey10(s.frame(i)[..., 0]), grey, grey)
            fh.write(b"FRAME\n" + b"".join(np.ascontiguousarray(p).tobytes() for p in planes))


def read_y4m_planes(path):
    """Every frame's planes as dav1d wrote them: [y] for mono, [y, u, v] for 4:2:0."""
    raw = path.read_bytes()
    head, rest = raw.split(b"\n", 1)
    tok = {t[:1]: t[1:].decode() for t in head.split()[1:]}
    w, h, c = int(tok[b"W"]), int(tok[b"H"]), tok[b"C"]
    dt = np.dtype("<u2" if c.endswith(("10", "12")) else "u1")
    dims = [(h, w)] if c.startswith("mono") else [(h, w)] + [((h + 1) // 2, (w + 1) // 2)] * 2
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


def floor(s):
    """The preview's own input against the source: what the conversion loses before any coding."""
    q = [quality(s, i, to_yuv420(s.frame(i)) if s.ch == 3 else [to_grey10(s.frame(i)[..., 0])]) for i in range(s.n)]
    return dict(psnr_mean=round(float(np.mean([p for p, _ in q])), 2), max_abs=max(m for _, m in q))


def quality(s, i, planes):
    got = preview_rgb(*planes) if s.ch == 3 else preview_grey(planes[0])
    diff = got - s.frame(i).astype(np.int32)
    peak = (1 << s.stored) - 1
    mse = float(np.mean(diff.astype(np.float64) ** 2))
    return (99.0 if mse == 0 else 10 * np.log10(peak * peak / mse)), int(np.abs(diff).max())


def av1_cell(build, s, work, y4m, group, crf):
    ivf = work / "out.ivf"
    kf = ["--kf-max-dist=0"] if group == 1 else \
        [f"--kf-min-dist={group or s.n}", f"--kf-max-dist={group or s.n}"]
    colour = ["--monochrome", "--bit-depth=10", "--input-bit-depth=10", "--profile=0"] if s.ch == 1 else \
        ["--bit-depth=8", "--profile=0", "--color-primaries=bt601", "--transfer-characteristics=bt601",
         "--matrix-coefficients=bt601"]
    secs = timed([build / f"aom-{AOM}/bin/aomenc", "-q", "--ivf", "-o", ivf, "--end-usage=q",
                  f"--cq-level={crf}", f"--cpu-used={PRESET}", f"--limit={s.n}", *colour, *kf, y4m])
    units = ivf_units(ivf)
    timed([build / "dav1d/bin/dav1d", "-q", "-i", ivf, "-o", work / "dec.y4m"],
          env={"LD_LIBRARY_PATH": str(build / "dav1d/lib")})
    frames = read_y4m_planes(work / "dec.y4m")
    if len(frames) != s.n or len(units) != s.n:
        sys.exit(f"{s.name} G{group} crf{crf}: {len(units)} units, {len(frames)} pictures for {s.n} frames")
    q = [quality(s, i, p) for i, p in enumerate(frames)]
    hashes = [hashlib.sha256(b"".join(np.ascontiguousarray(p).tobytes() for p in f)).hexdigest() for f in frames]
    return units, hashes, q, secs


def htj2k(s, work, dst):
    sizes = []
    env = {"LD_LIBRARY_PATH": str(OJPH / "lib")}
    for i in range(s.n):
        ext = "pgm" if s.ch == 1 else "ppm"
        src, back, out = work / f"in.{ext}", work / f"back.{ext}", dst / f"{i:03d}.htj2k"
        shift = pnm(s, i, src)
        timed([OJPH / "bin/ojph_compress", "-i", src, "-o", out, "-num_decomps", "5", "-block_size", "{64,64}",
               "-prog_order", "RPCL", "-reversible", "true"], env=env)
        timed([OJPH / "bin/ojph_expand", "-i", out, "-o", back], env=env)
        if s.signed or not exact(s, i, read_pnm(back).astype("i4") - shift + s.offset):
            sys.exit(f"{s.name} {i}: HTJ2K not exact (or signed, which PREVIEW does not cover)")
        sizes.append(out.stat().st_size)
    return sizes


def main():
    build, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    manifest = []
    for d in sys.argv[3:]:
        s = Set(Path(d))
        dst, work = out / s.name, out / f".{s.name}-work"
        dst.mkdir(parents=True, exist_ok=True)
        work.mkdir(exist_ok=True)
        entry = dict(name=s.name, width=s.w, height=s.h, channels=s.ch, bits=s.stored, frames=s.n,
                     truth=s.truth, htj2k=htj2k(s, work, dst), floor=floor(s), previews=[])
        print(s.name, "the preview's input alone: PSNR", entry["floor"]["psnr_mean"], "max|Δ|", entry["floor"]["max_abs"])
        y4m = work / "in.y4m"
        write_y4m(s, y4m)
        for group in GROUPS:
            for crf in CRFS:
                units, hashes, q, secs = av1_cell(build, s, work, y4m, group, crf)
                cell = f"g{group or 'all'}-crf{crf}"
                (dst / cell).mkdir(exist_ok=True)
                for i, u in enumerate(units):
                    (dst / cell / f"{i:03d}.av1").write_bytes(u)
                psnr = [p for p, _ in q]
                entry["previews"].append(dict(
                    cell=cell, group=group or s.n, crf=crf, sizes=[len(u) for u in units], hashes=hashes,
                    psnr_mean=round(float(np.mean(psnr)), 2), psnr_min=round(min(psnr), 2),
                    max_abs=max(m for _, m in q), encode_s=round(secs, 1),
                    webcodecs="av01.0.00M.10" if s.ch == 1 else "av01.0.00M.08"))
                p = entry["previews"][-1]
                print(s.name, cell, sum(p["sizes"]), "B", f"{sum(p['sizes']) / sum(entry['htj2k']):.4f} of HTJ2K",
                      "PSNR", p["psnr_mean"], "min", p["psnr_min"], "max|Δ|", p["max_abs"], flush=True)
        manifest.append(entry)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
