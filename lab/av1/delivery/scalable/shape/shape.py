#!/usr/bin/env python3
"""Scalable AV1 shapes with a lossless top: bytes, the base's quality, every exact frame checked.

libaom 3.15.1's svc_encoder_rtc (lab/av1/delivery/scalable/encoder, patched for --layer-q), one encode per shape: spatial
½ and ¼ bases, a quality-only base (same size, lossy), three spatial layers, temporal layers, and
the keyframe interval. The top operating point of every shape is decoded with dav1d and each frame
checked against the checksum written when the series was fetched. A series over 12 bits is split as
rows DEPTH and TAXO found best — the two low bits apart: the scalable payload carries v >> 2, an
8-bit lossless stream carries v & 3, and the exact frame is their merge.

usage: shape.py BUILD WORK OUT.tsv SET_DIR ...   — lab/av1/delivery/scalable/shape/README.md has the cells.
"""
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "encoder"))
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
import size  # noqa: E402
import svc  # noqa: E402

SPEED = 7
BASE_Q = (20, 40, 60)  # the example's quantizer scale, 0..63
WHOLE = 100_000  # keyframe interval longer than any series: one keyframe

# (shape, layering mode, spatial, temporal, scale factors, per-layer quantizers, keyframe interval)
def shapes():
    out = [("single", 0, 1, 1, None, "0", WHOLE)]
    for q in BASE_Q:
        out += [(f"half-q{q}", 5, 2, 1, None, f"{q},0", WHOLE),
                (f"quarter-q{q}", 5, 2, 1, "1/4,1/1", f"{q},0", WHOLE),
                (f"quality-q{q}", 5, 2, 1, "1/1,1/1", f"{q},0", WHOLE),
                (f"three-q{q}", 6, 3, 1, None, f"{q},{q // 2},0", WHOLE)]
    out += [("L1T2", 1, 1, 2, None, "0,0", WHOLE), ("L1T3", 2, 1, 3, None, "0,0,0", WHOLE),
            ("L2T3-half-q40", 7, 2, 3, None, "40,40,40,0,0,0", WHOLE)]
    for k in (8, 1):
        out += [(f"single-k{k}", 0, 1, 1, None, "0", k), (f"half-q40-k{k}", 5, 2, 1, None, "40,0", k)]
    return out


class Plane:
    """The picture the scalable payload codes: the series itself, or its top bits over 12."""

    def __init__(self, s):
        self.s = s
        self.bits = int(s.hi + s.offset).bit_length()
        self.shift = 2 if self.bits > 12 else 0
        self.av1_bits = s.av1_bits or 12

    def source(self, i):
        return self.s.frame(i).astype(np.int32) + self.s.offset

    def top(self, i):
        return self.source(i) >> self.shift


def htj2k_bytes(s, work):
    """HTJ2K's served profile (row SIZE's), every frame decoded and checked; None if one is not exact."""
    env = {"LD_LIBRARY_PATH": str(size.OJPH / "lib")}
    ext = "pgm" if s.ch == 1 else "ppm"
    src, out, back = work / f"in.{ext}", work / "f.j2c", work / f"back.{ext}"
    total = 0
    for i in range(s.n):
        shift = size.pnm(s, i, src)
        subprocess.run([size.OJPH / "bin/ojph_compress", "-i", src, "-o", out, "-num_decomps", "5",
                        "-block_size", "{64,64}", "-prog_order", "RPCL", "-reversible", "true"],
                       check=True, capture_output=True, env=env)
        subprocess.run([size.OJPH / "bin/ojph_expand", "-i", out, "-o", back], check=True, capture_output=True, env=env)
        if not size.exact(s, i, size.read_pnm(back).astype(np.int32) - shift + s.offset):
            return None
        total += out.stat().st_size
    return total


def write_y4m(p, path, plane, bits, ch):
    tag = ("444" if ch == 3 else "420") + ("" if bits == 8 else f"p{bits}")
    dt = "u1" if bits == 8 else "<u2"
    s = p.s
    h, w = s.h + s.h % 2, s.w + s.w % 2
    neutral = np.full((h // 2, w // 2), 1 << (bits - 1), dt)
    with open(path, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{w} H{h} F25:1 Ip A1:1 C{tag}\n".encode())
        for i in range(s.n):
            px = np.pad(plane(i).astype(dt), ((0, h - s.h), (0, w - s.w), (0, 0)), mode="edge")
            planes = [px[..., 1], px[..., 2], px[..., 0]] if ch == 3 else [px[..., 0], neutral, neutral]
            fh.write(b"FRAME\n" + b"".join(np.ascontiguousarray(q).tobytes() for q in planes))


def encode(build, y4m, out, bits, ch, mode, sl, tl, scale, layer_q, key):
    cmd = [str(build / "aom-3.15.1-svc-b/svc_encoder_rtc"), "-o", str(out), "-lm", str(mode),
           "-sl", str(sl), "-tl", str(tl), "-b", str(svc.KBPS * sl),
           "-bl", ",".join([str(svc.KBPS)] * (sl * tl)), "--min-q=0", "--max-q=0", "-k", str(key),
           "-sp", str(SPEED), "-d", str(bits), f"--profile={2 if bits == 12 else ch // 3}",
           f"--layer-q={layer_q}"]
    cmd += ["--monochrome"] if ch == 1 else []
    cmd += ["-r", scale] if scale else []
    subprocess.run(cmd + [str(y4m)], check=True, capture_output=True)
    (out.parent / f"{out.name}.cmd").write_text(" ".join(cmd + [str(y4m)]) + "\n")


def dav1d(build, stream, dec):
    subprocess.run([str(build / "dav1d/bin/dav1d"), "-q", "-i", str(stream), "-o", str(dec), "--alllayers", "0"],
                   check=True, capture_output=True, env={"LD_LIBRARY_PATH": str(build / "dav1d/lib")})
    return svc.read_y4m(dec)


def samples(planes, ch, h, w):
    px = np.stack([planes[2], planes[0], planes[1]], -1) if ch == 3 else planes[0][..., None]
    return px[:h, :w].astype(np.int32)


def exact_frames(p, top, low):
    """Frames whose merge of top (and low, when split) hashes to the series' checksum."""
    s, n = p.s, 0
    for i, planes in enumerate(top):
        v = samples(planes, s.ch, s.h, s.w) << p.shift
        if low is not None:
            v |= samples(low[i], 1, s.h, s.w)
        n += size.exact(s, i, v)
    return n


def base_quality(p, base, factor, frames):
    """Mean PSNR (dB, peak 2^bits − 1 of the source) and max |Δ| in source units, against the source,
    or its factor × factor mean when the base is scaled; frames: the source frame of each base frame."""
    s = p.s
    peak, psnrs, max_d = (1 << p.bits) - 1, [], 0
    for planes, i in zip(base, frames):
        h, w = min(planes[0].shape[0], s.h // factor), min(planes[0].shape[1], s.w // factor)
        got = samples(planes, s.ch, h, w).astype(np.float64) * (1 << p.shift) + ((1 << p.shift) - 1) / 2
        ref = p.source(i)[:h * factor, :w * factor].astype(np.float64)
        ref = ref.reshape(h, factor, w, factor, s.ch).mean(axis=(1, 3))
        diff = np.abs(got - ref)
        mse = float((diff ** 2).mean())
        psnrs.append(99.0 if mse == 0 else 10 * np.log10(peak * peak / mse))
        max_d = max(max_d, int(np.ceil(diff.max())))
    return round(float(np.mean(psnrs)), 2), max_d


def run_set(build, work, path):
    s = svc.load(Path(path))
    p = Plane(s)
    cell = work / s.name
    cell.mkdir(parents=True, exist_ok=True)
    y4m = cell / "top.y4m"
    write_y4m(p, y4m, p.top, p.av1_bits, s.ch)
    low, low_bytes = None, 0
    if p.shift:
        low_y4m = cell / "low.y4m"
        write_y4m(p, low_y4m, lambda i: p.source(i) & ((1 << p.shift) - 1), 8, 1)
        encode(build, low_y4m, cell / "low.ivf", 8, 1, 0, 1, 1, None, "0", WHOLE)
        low_bytes = Path(f"{cell}/low.ivf_0.av1").stat().st_size
        low = dav1d(build, Path(f"{cell}/low.ivf_0.av1"), cell / "dec.y4m")
        low_y4m.unlink()
    htj2k = htj2k_bytes(s, cell)
    rows = []
    for name, mode, sl, tl, scale, layer_q, key in shapes():
        ivf = cell / f"{name}.ivf"
        encode(build, y4m, ivf, p.av1_bits, s.ch, mode, sl, tl, scale, layer_q, key)
        top_stream = Path(f"{ivf}_{sl * tl - 1}.av1")
        top = dav1d(build, top_stream, cell / "dec.y4m")
        row = dict(set=s.name, shape=name, frames=s.n, htj2k_bytes=htj2k, low_bytes=low_bytes,
                   total_bytes=top_stream.stat().st_size + low_bytes,
                   top_exact=exact_frames(p, top, low) if len(top) == s.n else f"{len(top)} frames")
        if sl > 1 or tl > 1:
            base_op = tl - 1 if sl > 1 else 0  # spatial 0 at every temporal layer, or temporal layer 0
            base_stream = Path(f"{ivf}_{base_op}.av1")
            base = dav1d(build, base_stream, cell / "dec.y4m")
            factor = 1 if sl == 1 or scale == "1/1,1/1" else 4 if (scale == "1/4,1/1" or sl == 3) else 2
            frames = range(0, s.n, 1 if sl > 1 else 1 << (tl - 1))
            psnr, max_d = base_quality(p, base, factor, frames)
            row.update(base_bytes=base_stream.stat().st_size, base_frames=len(base), base_factor=factor,
                       base_psnr_db=psnr, base_max_abs_diff=max_d)
        rows.append(row)
        print("\t".join(f"{k}={v}" for k, v in row.items()), flush=True)
    y4m.unlink()
    return rows


KEYS = ["set", "shape", "frames", "top_exact", "htj2k_bytes", "total_bytes", "low_bytes", "base_bytes", "base_frames",
        "base_factor", "base_psnr_db", "base_max_abs_diff"]


def main():
    build, work, out, *sets = sys.argv[1:]
    build, work = Path(build), Path(work)
    with ProcessPoolExecutor(4) as pool:
        results = list(pool.map(run_set, [build] * len(sets), [work] * len(sets), sets))
    with open(out, "w") as fh:
        fh.write("\t".join(KEYS) + "\n")
        for rows in results:
            for row in rows:
                fh.write("\t".join(str(row.get(k, "")) for k in KEYS) + "\n")


if __name__ == "__main__":
    main()
