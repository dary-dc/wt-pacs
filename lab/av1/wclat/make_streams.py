#!/usr/bin/env python3
"""Lossless AV1 streams for WCLAT, with a SHA-256 per frame per plane of the encoder's input.

The matrix: every depth and layout WebCodecs returns exactly (8 and 10 bits; 4:0:0, 4:2:0, 4:2:2,
4:4:4 identity), synthetic 256x192, intra and G = 8. The real streams: the ultrasound cine (RGB 8)
and the fluoroscopy's top 10 bits (v >> 2, grey), at 1, 2 and 4 tile columns, intra and G = 8.
libaom 3.15.1; every stream decoded by native dav1d against the truth, and a stream that is not
exact stops the run. The real series' raw frames are checked against their fetch checksums first.

usage: make_streams.py BUILD OUT DATA    [JOBS=4]  — README.md here
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
GEN = HERE.parents[1] / "scripts/gen_frame_pnm.py"
AOM = "3.15.1"
W, H, N, G = 256, 192, 16, 8
SUB = {"mono": (2, 2), "420": (2, 2), "422": (2, 1), "444": (1, 1)}


def profile(layout):
    return {"444": 1, "422": 2}.get(layout, 0)


def synthetic(work, layout, bits):
    """Frames as planes in the order WebCodecs returns them: Y U V, or G B R for identity 4:4:4."""
    frames = []
    for i in range(N):
        pnm = work / "f.pnm"
        subprocess.run([sys.executable, GEN, pnm, str(W), str(H), "1" if layout == "mono" else "3",
                        str((1 << bits) - 1), str(i), str(N)], check=True, capture_output=True)
        magic, dims, maxval, data = pnm.read_bytes().split(b"\n", 3)
        px = np.frombuffer(data, ">u2" if bits > 8 else "u1").reshape(H, W, -1).astype(np.uint16)
        if layout == "mono":
            frames.append([px[..., 0]])
        elif layout == "444":
            frames.append([px[..., 1], px[..., 2], px[..., 0]])
        else:
            sx, sy = SUB[layout]
            frames.append([px[..., 0], px[::sy, ::sx, 1], px[::sy, ::sx, 2]])
    return frames


def real(data, name):
    d = data / name
    meta = json.loads((d / "metadata.json").read_text())
    frames = []
    for i in range(meta["frameCount"]):
        raw = (d / f"{i:03d}.raw").read_bytes()
        if hashlib.sha256(raw).hexdigest() != (d / f"{i:03d}.sha256").read_text().strip():
            sys.exit(f"{name} {i}: raw frame does not match its fetch checksum")
        px = np.frombuffer(raw, "u1" if meta["bitsStored"] <= 8 else "<u2")
        px = px.reshape(meta["height"], meta["width"], meta["channels"]).astype(np.uint16)
        frames.append([px[..., 1], px[..., 2], px[..., 0]] if meta["channels"] == 3 else [px[..., 0] >> 2])
    return frames


def write_y4m(path, frames, layout, bits):
    """Grey goes in as 4:2:0 with neutral chroma, which --monochrome drops."""
    dt = "u1" if bits == 8 else "<u2"
    h, w = frames[0][0].shape
    tag = ("420" if layout == "mono" else layout) + ("" if bits == 8 else f"p{bits}")
    neutral = np.full(((h + 1) // 2, (w + 1) // 2), 1 << (bits - 1), dt)
    with open(path, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{w} H{h} F25:1 Ip A1:1 C{tag}\n".encode())
        for planes in frames:
            planes = planes if layout != "mono" else [planes[0], neutral, neutral]
            fh.write(b"FRAME\n" + b"".join(np.ascontiguousarray(p.astype(dt)).tobytes() for p in planes))


def ivf_units(path):
    raw, pos, units = path.read_bytes(), 32, []
    while pos < len(raw):
        size = int.from_bytes(raw[pos:pos + 4], "little")
        units.append(raw[pos + 12:pos + 12 + size])
        pos += 12 + size
    return units


def native(build, ivf, out, frames, bits):
    """Native dav1d's planes, in the truth's order, hashed per frame."""
    subprocess.run([build / "dav1d/bin/dav1d", "-q", "-i", ivf, "-o", out], check=True, capture_output=True,
                   env={"LD_LIBRARY_PATH": str(build / "dav1d/lib")})
    rest = out.read_bytes().split(b"\n", 1)[1]
    sizes = [p.size * (1 if bits == 8 else 2) for p in frames[0]]
    got, pos = [], 0
    while pos < len(rest):
        pos = rest.index(b"\n", pos) + 1
        planes = []
        for s in sizes:
            planes.append(hashlib.sha256(rest[pos:pos + s]).hexdigest())
            pos += s
        got.append(planes)
    return got


def encode(build, out, name, frames, layout, bits, gop, tiles):
    work = out / f".{name}"
    work.mkdir(parents=True, exist_ok=True)
    write_y4m(work / "in.y4m", frames, layout, bits)
    ivf = out / f"{name}.ivf"
    subprocess.run([build / f"aom-{AOM}/bin/aomenc", "-q", "--ivf", "-o", ivf, "--lossless=1", "--cpu-used=0",
                    f"--limit={len(frames)}", f"--bit-depth={bits}", f"--input-bit-depth={bits}",
                    f"--profile={profile(layout)}", f"--tile-columns={tiles.bit_length() - 1}",
                    *(["--monochrome"] if layout == "mono" else
                      ["--matrix-coefficients=identity"] if layout == "444" else []),
                    *(["--kf-max-dist=0"] if gop == 1 else
                      [f"--kf-min-dist={gop}", f"--kf-max-dist={gop}", "--auto-alt-ref=0"]),
                    work / "in.y4m"], check=True, capture_output=True)
    dt = "u1" if bits == 8 else "<u2"
    truth = [[hashlib.sha256(np.ascontiguousarray(p.astype(dt)).tobytes()).hexdigest() for p in f] for f in frames]
    if native(build, ivf, work / "out.y4m", frames, bits) != truth:
        sys.exit(f"{name}: native dav1d not exact")
    units = ivf_units(ivf)
    shutil.rmtree(work)
    h, w = frames[0][0].shape
    print(f"{name:24s} {sum(map(len, units)):9d} B  exact", flush=True)
    return dict(name=name, layout=layout, bits=bits, gop=gop, tiles=tiles, width=w, height=h,
                codec=f"av01.{profile(layout)}.00M.{bits:02d}", bytes=sum(map(len, units)),
                frames=len(frames), truth=truth)


def job(build, out, data, spec):
    kind, layout, bits, gop, tiles = spec
    if kind == "syn":
        work = out / f".gen-{layout}-{bits}-{gop}"
        work.mkdir(parents=True, exist_ok=True)
        frames = synthetic(work, layout, bits)
        shutil.rmtree(work)
        name = f"{layout}_{bits}_{'intra' if gop == 1 else f'g{gop}'}"
    else:
        frames = real(data, kind)
        name = f"{kind}_{'intra' if gop == 1 else f'g{gop}'}_t{tiles}"
    return encode(build, out, name, frames, layout, bits, gop, tiles)


def main():
    build, out, data = (Path(a).resolve() for a in sys.argv[1:4])
    out.mkdir(parents=True, exist_ok=True)
    specs = [("syn", layout, bits, gop, 1) for layout in SUB for bits in (8, 10) for gop in (1, G)]
    specs += [(kind, layout, bits, gop, tiles) for kind, layout, bits in (("us_liver", "444", 8), ("rf_fluoro", "mono", 10))
              for gop in (1, G) for tiles in (1, 2, 4)]
    with ProcessPoolExecutor(int(os.environ.get("JOBS", os.cpu_count()))) as pool:
        cells = list(pool.map(job, *zip(*[(build, out, data, s) for s in specs])))
    (out / "manifest.json").write_text(json.dumps(cells, indent=1))


if __name__ == "__main__":
    main()
