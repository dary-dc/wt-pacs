#!/usr/bin/env python3
"""Lossless bytes per set: HTJ2K (the served profile), JPEG XL (reference), AV1 intra and by group.

Every coding is decoded and compared with the checksum written when the frame was made; an inexact
cell is reported and its bytes are not used. AV1 groups are decoded one group at a time, each from
its own keyframe, which is what a group as the transport's unit must do.

usage: size.py BUILD WORK OUT.tsv SETDIR ...   — lab/av1/README.md §SIZE.
"""
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from order import order  # noqa: E402

GROUPS = (2, 4, 8, 16, 32)
AOM = "3.15.1"
AOM_PRESETS = (0, 6)
SVT_PRESETS = (0, 8)
OJPH = Path(__file__).resolve().parents[1] / ".openjph-build/install"


class Set:
    """A fetched set (NNN.raw, metadata.json) or a lab/av1 roundtrip one (NNN.pgm or NNN.ppm)."""

    def __init__(self, path):
        self.path, self.name = path, path.name
        self.pnms = sorted(path.glob("[0-9][0-9][0-9].p[gp]m"))
        m = json.loads((path / "metadata.json").read_text()) if not self.pnms else self.pnm_meta()
        self.n, self.w, self.h, self.ch = m["frameCount"], m["width"], m["height"], m["channels"]
        self.stored, self.signed, self.lo, self.hi = m["bitsStored"], m["signed"], m["min"], m["max"]
        self.dtype = ("i1" if self.signed else "u1") if self.stored <= 8 else ("<i2" if self.signed else "<u2")
        self.offset = -self.lo if self.lo < 0 else 0
        need = int(self.hi + self.offset).bit_length()
        self.av1_bits = next((b for b in (8, 10, 12) if need <= b), None)  # None: DEPTH's split
        self.truth = [Path(f"{p}.sha256").read_text().strip() for p in self.pnms] or \
            [(path / f"{i:03d}.sha256").read_text().strip() for i in range(self.n)]

    def pnm_meta(self):
        px = [read_pnm(p) for p in self.pnms]
        maxval = int(self.pnms[0].read_bytes().split(b"\n", 3)[2])
        return dict(frameCount=len(px), width=px[0].shape[1], height=px[0].shape[0],
                    channels=px[0].shape[2], bitsStored=maxval.bit_length(), signed=False,
                    min=int(min(p.min() for p in px)), max=int(max(p.max() for p in px)))

    def frame(self, i):
        if self.pnms:
            return read_pnm(self.pnms[i]).astype(self.dtype)
        return np.fromfile(self.path / f"{i:03d}.raw", self.dtype).reshape(self.h, self.w, self.ch)

    def raw_bytes(self):
        return self.n * self.w * self.h * self.ch * np.dtype(self.dtype).itemsize


def exact(s, i, samples):
    """samples: (h, w, ch) in coded values; back to stored order and compared with the truth."""
    stored = (samples.astype(np.int32) - s.offset).astype(s.dtype)
    return hashlib.sha256(np.ascontiguousarray(stored).tobytes()).hexdigest() == s.truth[i]


def timed(cmd, **kw):
    t0 = time.perf_counter()
    subprocess.run(cmd, check=True, capture_output=True, **kw)
    return time.perf_counter() - t0


def pnm(s, i, path, wide=False):
    """HTJ2K's and JPEG XL's input: as the project serves a signed series, shifted by 2^(B-1).
    wide declares 16 bits above 8: cjxl 0.7.0 is not lossless from a 12-bit PGM — lab/av1/README.md."""
    shift = 1 << (s.stored - 1) if s.signed else 0
    maxval = 65535 if wide and s.stored > 8 else (1 << s.stored) - 1
    px = s.frame(i).astype(np.int32) + shift
    with open(path, "wb") as fh:
        fh.write(b"%s\n%d %d\n%d\n" % (b"P5" if s.ch == 1 else b"P6", s.w, s.h, maxval))
        fh.write(px.astype(">u2" if maxval > 255 else "u1").tobytes())
    return shift


def read_pnm(path):
    raw = path.read_bytes()
    magic, dims, maxval, data = raw.split(b"\n", 3)
    w, h = (int(v) for v in dims.split())
    ch = 1 if magic == b"P5" else 3
    return np.frombuffer(data, ">u2" if int(maxval) > 255 else "u1").reshape(h, w, ch)


def still_codecs(s, work):
    """HTJ2K and JPEG XL, one frame per file; bytes per frame and whether every frame came back."""
    rows = []
    for codec in ("htj2k", "jxl-e7"):
        sizes, ok, secs = [], True, 0.0
        for i in range(s.n):
            src = work / f"in.{'pgm' if s.ch == 1 else 'ppm'}"
            shift = pnm(s, i, src, wide=codec != "htj2k")
            out, back = work / f"f.{codec}", work / f"back.{'pgm' if s.ch == 1 else 'ppm'}"
            if codec == "htj2k":
                env = {"LD_LIBRARY_PATH": str(OJPH / "lib")}
                secs += timed([OJPH / "bin/ojph_compress", "-i", src, "-o", out, "-num_decomps", "5",
                               "-block_size", "{64,64}", "-prog_order", "RPCL", "-reversible", "true"], env=env)
                timed([OJPH / "bin/ojph_expand", "-i", out, "-o", back], env=env)
            else:
                secs += timed(["cjxl", src, out, "-d", "0", "-e", "7", "--quiet"])
                timed(["djxl", out, back, "--quiet"])
            got = read_pnm(back).astype(np.int32) - shift + s.offset
            ok &= exact(s, i, got)
            sizes.append(out.stat().st_size)
        rows.append(dict(codec=codec, preset="-", group=1, sizes=sizes, exact=ok, encode_s=secs))
    return rows


def write_y4m(s, path):
    """Grey as 4:2:0 with neutral chroma the encoder drops; RGB as planes G, B, R (identity)."""
    tag = ("444" if s.ch == 3 else "420") + ("" if s.av1_bits == 8 else f"p{s.av1_bits}")
    dt = "u1" if s.av1_bits == 8 else "<u2"
    with open(path, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{s.w} H{s.h} F25:1 Ip A1:1 C{tag}\n".encode())
        neutral = np.full(((s.h + 1) // 2, (s.w + 1) // 2), 1 << (s.av1_bits - 1), dt)
        for i in range(s.n):
            px = (s.frame(i).astype(np.int32) + s.offset).astype(dt)
            planes = [px[..., 1], px[..., 2], px[..., 0]] if s.ch == 3 else [px[..., 0], neutral, neutral]
            fh.write(b"FRAME\n" + b"".join(np.ascontiguousarray(p).tobytes() for p in planes))


def ivf_units(path):
    raw, pos, units = path.read_bytes(), 32, []
    while pos < len(raw):
        size = int.from_bytes(raw[pos:pos + 4], "little")
        units.append(raw[pos + 12:pos + 12 + size])
        pos += 12 + size
    return units


def decode_y4m(build, src, out):
    subprocess.run([build / "dav1d/bin/dav1d", "-q", "-i", src, "-o", out, "--demuxer", "section5"],
                   check=True, capture_output=True, env={"LD_LIBRARY_PATH": str(build / "dav1d/lib")})
    return read_y4m(out)


def read_y4m(out):
    raw = out.read_bytes()
    head, rest = raw.split(b"\n", 1)
    c = next(t[1:].decode() for t in head.split() if t.startswith(b"C"))
    bpp = 1 if c in ("mono", "444", "420jpeg") else 2
    h, w = next(int(t[1:]) for t in head.split() if t.startswith(b"H")), \
        next(int(t[1:]) for t in head.split() if t.startswith(b"W"))
    planes = 1 if c.startswith("mono") else 3
    chroma = (h * w) if c.startswith("444") else ((h + 1) // 2) * ((w + 1) // 2)
    size = (h * w + (planes - 1) * chroma) * bpp
    frames, pos = [], 0
    while pos < len(rest):
        pos = rest.index(b"\n", pos) + 1
        buf = np.frombuffer(rest[pos:pos + size], "u1" if bpp == 1 else "<u2")
        y = buf[:h * w].reshape(h, w)
        if c.startswith("444"):
            u, v = buf[h * w:2 * h * w].reshape(h, w), buf[2 * h * w:].reshape(h, w)
            frames.append(np.stack([v, y, u], -1))
        else:
            frames.append(y[..., None])
        pos += size
    return frames


def av1_cell(build, s, work, y4m, codec, preset, group):
    out = work / "out.ivf"
    if codec == "aom":
        cmd = [build / f"aom-{AOM}/bin/aomenc", "-q", "--ivf", "-o", out, "--lossless=1",
               f"--cpu-used={preset}", f"--limit={s.n}", f"--bit-depth={s.av1_bits}",
               f"--input-bit-depth={s.av1_bits}", f"--profile={2 if s.av1_bits == 12 else (1 if s.ch == 3 else 0)}"]
        cmd += ["--monochrome"] if s.ch == 1 else ["--matrix-coefficients=identity"]
        cmd += ["--kf-max-dist=0"] if group == 1 else \
            [f"--kf-min-dist={group}", f"--kf-max-dist={group}", "--auto-alt-ref=0"]
    else:
        cmd = [build / "svt/bin/SvtAv1EncApp", "-i", y4m, "-b", out, "--lossless", "1", "--preset",
               str(preset), "--input-depth", str(s.av1_bits), "-n", str(s.n), "--keyint", str(group)]
    secs = timed(cmd + ([y4m] if codec == "aom" else []))
    units = ivf_units(out)
    ok = len(units) == s.n
    for g0 in range(0, s.n, group):
        (work / "g.obu").write_bytes(b"".join(units[g0:g0 + group]))
        try:
            decoded = decode_y4m(build, work / "g.obu", work / "g.y4m")
        except subprocess.CalledProcessError:
            decoded = []
        ok &= len(decoded) == len(units[g0:g0 + group])
        for k, px in enumerate(decoded):
            ok &= exact(s, g0 + k, px)
    return dict(codec=f"av1-{codec}", preset=preset, group=group, sizes=[len(u) for u in units],
                exact=ok, encode_s=secs)


def av1_codecs(build, s, work, rnd):
    if s.av1_bits is None:
        return []
    y4m = work / "in.y4m"
    write_y4m(s, y4m)
    groups = [1] + [g for g in GROUPS if g < s.n] + [s.n]
    cells = [("aom", p, g) for p in AOM_PRESETS for g in groups]
    if s.ch == 1 and s.av1_bits <= 10:  # SVT-AV1: exact on 8-bit grey, and intra at 10 (lab/av1)
        cells += [("svt", p, g) for p in SVT_PRESETS for g in (groups if s.av1_bits == 8 else [1])]
    return [av1_cell(build, s, work, y4m, *c) for c in order(cells, rnd)]


def main():
    build, work, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve(), Path(sys.argv[3])
    work.mkdir(parents=True, exist_ok=True)
    cols = ["set", "codec", "preset", "group", "exact", "bytes", "raw_ratio", "vs_htj2k",
            "key_mean", "other_mean", "encode_s"]
    with open(out, "w") as fh:
        fh.write("\t".join(cols) + "\n")
        for rnd, d in enumerate(sys.argv[4:]):
            s = Set(Path(d))
            rows = still_codecs(s, work) + av1_codecs(build, s, work, rnd)
            htj2k = sum(rows[0]["sizes"])
            for r in rows:
                total, g = sum(r["sizes"]), r["group"]
                keys = r["sizes"][::g]
                others = [b for i, b in enumerate(r["sizes"]) if i % g]
                line = [s.name, r["codec"], r["preset"], g, r["exact"], total,
                        round(total / s.raw_bytes(), 4), round(total / htj2k, 4),
                        round(np.mean(keys)), round(np.mean(others)) if others else "-",
                        round(r["encode_s"], 1)]
                fh.write("\t".join(str(v) for v in line) + "\n")
                fh.flush()
                print("\t".join(str(v) for v in line), flush=True)


if __name__ == "__main__":
    main()
