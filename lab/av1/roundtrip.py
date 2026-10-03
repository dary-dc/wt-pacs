#!/usr/bin/env python3
"""Lossless AV1 round trip: synthetic frames → encoder → dav1d → compared with the input.

Ground truth is the checksum gen_frame_pnm.py writes beside each frame when it makes it, never
a decoder's output. A cell is exact when every frame's decoded samples hash to that checksum.
Each temporal unit is also decoded alone, which is what a frame of a group of one must do.

usage: roundtrip.py BUILD WORK OUT.tsv [encoder ...]   — lab/av1/README.md has the cells.
"""
import hashlib
import re
import struct
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
GEN = ROOT / "lab/scripts/gen_frame_pnm.py"
FRAMES = 16
GROUP = 8
# "inter" is each encoder's default group; "inter-noaltref" turns its alt-ref frames off.
MODES = ("intra", "inter", "inter-noaltref")

# (name, channels, bits, content mode, width, height)
SHAPES = [
    ("grey8", 1, 8, "ct", 512, 512),
    ("grey10", 1, 10, "ct", 512, 512),
    ("grey12", 1, 12, "ct", 512, 512),
    ("rgb8", 3, 8, "cine", 512, 512),
    ("rgb12", 3, 12, "cine", 512, 512),
    ("grey12-odd", 1, 12, "ct", 277, 333),
]


def frames_for(work, shape):
    name, ch, bits, mode, w, h = shape
    d = work / "frames" / name
    d.mkdir(parents=True, exist_ok=True)
    out = []
    for i in range(FRAMES):
        pnm = d / f"{i:03d}.{'pgm' if ch == 1 else 'ppm'}"
        if not pnm.exists():
            subprocess.run([sys.executable, GEN, pnm, str(w), str(h), str(ch),
                            str((1 << bits) - 1), str(i), str(FRAMES), mode], check=True)
        out.append(pnm)
    return out


def read_pnm(path, ch, bits):
    raw = path.read_bytes()
    parts = raw.split(b"\n", 3)
    w, h = (int(v) for v in parts[1].split())
    dtype = ">u2" if bits > 8 else "u1"
    return np.frombuffer(parts[3], dtype).reshape(h, w, ch).astype(np.uint16)


def write_y4m(frames, shape, path):
    """Grey goes in as 4:2:0 with neutral chroma the encoder drops (--monochrome); RGB as
    4:4:4 planes G, B, R — the order identity matrix_coefficients means."""
    name, ch, bits, _, w, h = shape
    tag = ("444" if ch == 3 else "420") + ("" if bits == 8 else f"p{bits}")
    dtype = "<u2" if bits > 8 else "u1"
    with open(path, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{w} H{h} F25:1 Ip A1:1 C{tag}\n".encode())
        for f in frames:
            px = read_pnm(f, ch, bits)
            planes = [px[..., 1], px[..., 2], px[..., 0]] if ch == 3 else [px[..., 0]]
            if ch == 1:
                cw, chh = (w + 1) // 2, (h + 1) // 2
                neutral = np.full((chh, cw), 1 << (bits - 1), np.uint16)
                planes += [neutral, neutral]
            fh.write(b"FRAME\n")
            for p in planes:
                fh.write(np.ascontiguousarray(p).astype(dtype).tobytes())


def read_y4m(path):
    """dav1d's Y4M: a list of frames, each a list of planes."""
    raw = path.read_bytes()
    head, rest = raw.split(b"\n", 1)
    fields = {t[:1]: t[1:].decode() for t in head.split()[1:]}
    w, h, c = int(fields[b"W"]), int(fields[b"H"]), fields.get(b"C", "420jpeg")
    depth = re.search(r"(?:p|mono)(\d+)$", c)
    bits = int(depth.group(1)) if depth else 8
    bpp = 2 if bits > 8 else 1
    if c.startswith("mono"):
        dims = [(h, w)]
    elif c.startswith("444"):
        dims = [(h, w)] * 3
    else:
        dims = [(h, w)] + [((h + 1) // 2, (w + 1) // 2)] * 2
    frames, pos = [], 0
    while pos < len(rest):
        pos = rest.index(b"\n", pos) + 1
        planes = []
        for ph, pw in dims:
            n = ph * pw * bpp
            planes.append(np.frombuffer(rest[pos:pos + n], "<u2" if bpp == 2 else "u1").reshape(ph, pw))
            pos += n
        frames.append(planes)
    return c, frames


def as_input_order(planes, ch, bits):
    """The decoder's planes back in gen_frame_pnm's sample order: interleaved, LE above 8 bits."""
    px = np.stack([planes[2], planes[0], planes[1]], -1) if ch == 3 else planes[0]
    return px.astype("<u2" if bits > 8 else "u1").tobytes()


def ivf_units(path):
    raw = path.read_bytes()
    pos, units = 32, []
    while pos < len(raw):
        size = struct.unpack_from("<I", raw, pos)[0]
        units.append(raw[pos + 12:pos + 12 + size])
        pos += 12 + size
    return units


def aom(version, cpu):
    def encode(build, y4m, ivf, shape, mode):
        _, ch, bits, *_ = shape
        profile = 2 if bits == 12 else (1 if ch == 3 else 0)
        cmd = [str(build / f"aom-{version}/bin/aomenc"), "--ivf", "-o", str(ivf), "--lossless=1",
               f"--cpu-used={cpu}", f"--limit={FRAMES}", f"--profile={profile}",
               f"--bit-depth={bits}", f"--input-bit-depth={bits}"]
        if ch == 3 and bits == 12 and version != "3.8.2":
            return None  # 3.15.1's aomenc fails to set 12-bit 4:4:4 — lab/av1/README.md
        cmd += ["--monochrome"] if ch == 1 else ["--matrix-coefficients=identity"]
        cmd += ["--kf-max-dist=0"] if mode == "intra" else [f"--kf-min-dist={GROUP}", f"--kf-max-dist={GROUP}"]
        cmd += ["--auto-alt-ref=0"] if mode == "inter-noaltref" else []
        return cmd + [str(y4m)]
    return f"aom-{version}-cpu{cpu}", encode


def svt(preset):
    def encode(build, y4m, ivf, shape, mode):
        _, ch, bits, *_ = shape
        if ch == 3 or bits > 10:
            return None  # SVT-AV1 codes 4:2:0 at 8 and 10 bits only
        cmd = [str(build / "svt/bin/SvtAv1EncApp"), "-i", str(y4m), "-b", str(ivf), "--lossless", "1",
               "--preset", str(preset), "--input-depth", str(bits), "-n", str(FRAMES)]
        cmd += ["--keyint", "1"] if mode == "intra" else ["--keyint", str(GROUP)]
        cmd += ["--enable-tf", "0"] if mode == "inter-noaltref" else []
        return cmd
    return f"svt-p{preset}", encode


ENCODERS = dict(e for e in (aom("3.8.2", 6), aom("3.15.1", 6), aom("3.8.2", 2), aom("3.15.1", 2),
                            svt(8), svt(4)))


def dav1d(build, src, out, extra=()):
    subprocess.run([str(build / "dav1d/bin/dav1d"), "-q", "-i", str(src), "-o", str(out), *extra],
                   check=True, env={"LD_LIBRARY_PATH": str(build / "dav1d/lib")})


def run_cell(build, work, enc_name, encode, shape, mode, frames):
    name, ch, bits, *_ = shape
    cell = work / "cells" / f"{enc_name}.{name}.{mode}"
    cell.mkdir(parents=True, exist_ok=True)
    y4m = work / "frames" / f"{name}.y4m"
    if not y4m.exists():
        write_y4m(frames, shape, y4m)
    ivf = cell / "out.ivf"
    cmd = encode(build, y4m, ivf, shape, mode)
    if cmd is None:
        return None
    t0 = time.perf_counter()
    subprocess.run(cmd, check=True, capture_output=True)
    enc_s = time.perf_counter() - t0
    (cell / "cmd").write_text(" ".join(cmd) + "\n")

    dav1d(build, ivf, cell / "dec.y4m")
    fmt, decoded = read_y4m(cell / "dec.y4m")
    truth = [Path(str(f) + ".sha256").read_text().strip() for f in frames]
    exact, wrong, max_d = 0, 0, 0
    for f, planes, want in zip(frames, decoded, truth):
        got = as_input_order(planes, ch, bits)
        if hashlib.sha256(got).hexdigest() == want:
            exact += 1
            continue
        ref = read_pnm(f, ch, bits)
        dec = np.frombuffer(got, "<u2" if bits > 8 else "u1").reshape(ref.shape).astype(np.int32)
        diff = np.abs(dec - ref.astype(np.int32))
        wrong, max_d = wrong + int((diff > 0).sum()), max(max_d, int(diff.max()))

    units = ivf_units(ivf)
    alone = None
    if mode == "intra":
        alone = 0
        for k, unit in enumerate(units):
            obu = cell / f"tu{k:03d}.obu"
            obu.write_bytes(unit)
            dav1d(build, obu, cell / "tu.y4m", ["--demuxer", "section5"])
            _, one = read_y4m(cell / "tu.y4m")
            alone += hashlib.sha256(as_input_order(one[0], ch, bits)).hexdigest() == truth[k]
    return dict(encoder=enc_name, shape=name, mode=mode, decoded=len(decoded), units=len(units),
                exact=exact, wrong_samples=wrong, max_abs_diff=max_d, alone_exact=alone,
                dav1d_format=fmt, bytes=ivf.stat().st_size, encode_s=round(enc_s, 2))


def main():
    build, work, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    names = sys.argv[4:] or list(ENCODERS)
    rows = []
    for shape in SHAPES:
        frames = frames_for(work, shape)
        for enc_name in names:
            for mode in MODES:
                r = run_cell(build, work, enc_name, ENCODERS[enc_name], shape, mode, frames)
                if r:
                    rows.append(r)
                    print("\t".join(str(v) for v in r.values()), flush=True)
    with open(out, "w") as fh:
        fh.write("\t".join(rows[0]) + "\n")
        for r in rows:
            fh.write("\t".join(str(v) for v in r.values()) + "\n")


if __name__ == "__main__":
    main()
