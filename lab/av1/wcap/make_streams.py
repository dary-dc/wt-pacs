#!/usr/bin/env python3
"""Lossless AV1 streams for the WebCodecs probe, with the encoder input's checksums.

Every (depth x layout x mode) cell is a short IVF of FRAMES frames, coded by ffmpeg's libaom
in lossless mode from planes written here. The manifest holds a SHA-256 per frame per plane of
those planes — the ground truth — and whether native dav1d (ffmpeg's libdav1d) reproduces
them, so a stream the encoder got wrong is not blamed on WebCodecs.

usage: make_streams.py OUT_DIR
"""
import hashlib
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "..", "..", "scripts", "gen_frame_pnm.py")
W, H, FRAMES, GOP = 256, 192, 8, 8

# layout -> (channels the content needs, ffmpeg pix_fmt stem)
LAYOUTS = {
    "mono": (1, "gray"),
    "420": (3, "yuv420p"),
    "444": (3, "gbrp"),  # identity matrix: G, B, R planes, the lossless way to carry RGB
    "422": (3, "yuv422p"),  # profile 2 at 8 and 10 bits: tells profile from depth
}
PIX_FMT = {
    ("gray", 8): "gray", ("gray", 10): "gray10le", ("gray", 12): "gray12le",
    ("yuv420p", 8): "yuv420p", ("yuv420p", 10): "yuv420p10le", ("yuv420p", 12): "yuv420p12le",
    ("gbrp", 8): "gbrp", ("gbrp", 10): "gbrp10le", ("gbrp", 12): "gbrp12le",
    ("yuv422p", 8): "yuv422p", ("yuv422p", 10): "yuv422p10le", ("yuv422p", 12): "yuv422p12le",
}


def profile(layout, bits):
    if bits == 12 or layout == "422":
        return 2
    return 1 if layout == "444" else 0


def read_pnm(path, maxval):
    with open(path, "rb") as fh:
        data = fh.read()
    magic, dims, mv, body = data.split(b"\n", 3)
    w, h = map(int, dims.split())
    ch = 1 if magic == b"P5" else 3
    dtype = np.dtype(">u2") if maxval > 255 else np.uint8
    return np.frombuffer(body, dtype=dtype).reshape(h, w, ch).astype(np.uint16)


def planes_of(frame, layout):
    if layout == "mono":
        return [frame[..., 0]]
    if layout == "444":
        return [frame[..., 1], frame[..., 2], frame[..., 0]]  # G, B, R
    rows = 2 if layout == "420" else 1
    return [frame[..., 0], frame[::rows, ::2, 1], frame[::rows, ::2, 2]]


def encode(raw, ivf, pix_fmt, gop):
    common = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    subprocess.run(common + [
        "-f", "rawvideo", "-pix_fmt", pix_fmt, "-s", f"{W}x{H}", "-r", "25", "-i", raw,
        "-c:v", "libaom-av1", "-aom-params", "lossless=1", "-cpu-used", "6", "-row-mt", "0",
        "-g", str(gop), "-keyint_min", str(gop), "-pix_fmt", pix_fmt, "-f", "ivf", ivf,
    ], check=True)


def native_hashes(ivf, pix_fmt, sizes):
    out = subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-c:v", "libdav1d", "-i", ivf,
        "-f", "rawvideo", "-pix_fmt", pix_fmt, "-",
    ], check=True, capture_output=True).stdout
    frame_bytes = sum(sizes)
    frames = []
    for i in range(len(out) // frame_bytes):
        chunk, at, planes = out[i * frame_bytes:(i + 1) * frame_bytes], 0, []
        for size in sizes:
            planes.append(hashlib.sha256(chunk[at:at + size]).hexdigest())
            at += size
        frames.append(planes)
    return frames


def main():
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    cells = []
    for layout, (ch, stem) in LAYOUTS.items():
        for bits in (8, 10, 12):
            pix_fmt = PIX_FMT[(stem, bits)]
            maxval = (1 << bits) - 1
            dtype = np.uint8 if bits == 8 else np.dtype("<u2")
            raw = os.path.join(out_dir, f"{layout}_{bits}.raw")
            truth = []
            with open(raw, "wb") as fh:
                for i in range(FRAMES):
                    pnm = os.path.join(out_dir, "frame.pnm")
                    subprocess.run([sys.executable, GEN, pnm, str(W), str(H), str(ch),
                                    str(maxval), str(i), str(FRAMES)], check=True)
                    planes = [p.astype(dtype).tobytes()
                              for p in planes_of(read_pnm(pnm, maxval), layout)]
                    truth.append([hashlib.sha256(p).hexdigest() for p in planes])
                    fh.write(b"".join(planes))
            sizes = [len(p) for p in planes]
            for mode, gop in (("intra", 1), ("inter", GOP)):
                name = f"{layout}_{bits}_{mode}"
                ivf = os.path.join(out_dir, name + ".ivf")
                encode(raw, ivf, pix_fmt, gop)
                native = native_hashes(ivf, pix_fmt, sizes)
                cells.append({
                    "name": name, "layout": layout, "bits": bits, "mode": mode,
                    "profile": profile(layout, bits), "width": W, "height": H,
                    "planeBytes": sizes, "truth": truth,
                    "nativeExact": native == truth,
                })
                print(f"{name:16s} {os.path.getsize(ivf):8d} B  native dav1d "
                      f"{'exact' if native == truth else 'NOT EXACT'}")
    with open(os.path.join(out_dir, "manifest.json"), "w") as fh:
        json.dump(cells, fh, indent=1)


if __name__ == "__main__":
    main()
