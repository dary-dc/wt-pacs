#!/usr/bin/env python3
"""A series as AV1 items (docs/av1/item-format.md), plain or optimized, and nothing at all unless
every item decodes back through native dav1d to the samples its frame's checksum was written from.

Reads a set as lab/av1/fetch_data.py writes it (NNN.raw, NNN.sha256, metadata.json); writes
OUT/NNN.av1, OUT/NNN.sha256 and OUT/metadata.json with "codec": "av1", which pack-study bundles.

usage: ingest.py BUILD SET_DIR OUT [--representation plain|optimized] [--preset cpu0|good:N|allintra:N]
                 [--frames N] [--jobs N]   — lab/av1/item/README.md
"""
import argparse
import hashlib
import json
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import size  # noqa: E402

FLAG_SIGNED, FLAG_RCT = 1, 2


def container(bits):
    return next(b for b in (8, 10, 12) if bits <= b)


class Refused(Exception):
    pass


def plan(s, representation):
    """The header and the streams: [(depth, channels, frame → int array h×w×c in coded planes)]."""
    v = lambda i: s.frame(i).astype(np.int32) + s.offset  # noqa: E731
    bits = max(1, int(s.hi + s.offset).bit_length())
    if s.ch == 3:
        if bits > 8:
            raise Refused(f"RGB of {bits} bits: no modality needs it and aomenc 3.15.1 cannot")
        if representation == "plain":
            return dict(bits=8, depth=8, split=0, flags=0), [(8, 3, lambda i: v(i)[..., [1, 2, 0]])]

        def rct(i):
            r, g, b = (v(i)[..., c] for c in range(3))
            return np.stack([(r + 2 * g + b) >> 2, b - g + 256, r - g + 256], -1)
        return dict(bits=8, depth=10, split=0, flags=FLAG_RCT), [(10, 3, rct)]
    if bits > 14:
        raise Refused(f"grey of {bits} bits after the offset, over 14")
    if representation == "plain":
        split = max(0, bits - 12)
    else:
        split = 2 if bits > 8 else 0
    depth = container(bits - split)
    streams = [(depth, 1, lambda i: v(i) >> split)]
    if split:
        streams.append((8, 1, lambda i: v(i) & ((1 << split) - 1)))
    flags = FLAG_SIGNED if s.signed else 0
    return dict(bits=bits, depth=depth, split=split, flags=flags), streams


def encoder_args(preset, representation, depth, ch):
    kind, _, n = preset.partition(":")
    speed = ["--cpu-used=0"] if kind == "cpu0" else (["--allintra"] if kind == "allintra" else []) + [f"--cpu-used={n}"]
    profile = 2 if depth == 12 else (1 if ch == 3 else 0)
    args = ["--ivf", "--lossless=1", f"--bit-depth={depth}", f"--input-bit-depth={depth}", "--kf-max-dist=0",
            "--threads=1", f"--profile={profile}", *speed]
    if representation == "optimized":
        args += ["--tune-content=screen", "--sb-size=64"]
    return args + (["--monochrome"] if ch == 1 else ["--matrix-coefficients=identity"])


def write_y4m(path, frames, depth, ch):
    """Grey as 4:2:0 with neutral chroma the encoder drops; three channels as 4:4:4, the first as luma."""
    h, w = frames[0].shape[:2]
    tag = ("444" if ch == 3 else "420") + ("" if depth == 8 else f"p{depth}")
    dt = "u1" if depth == 8 else "<u2"
    neutral = np.full(((h + 1) // 2, (w + 1) // 2), 1 << (depth - 1), dt)
    with open(path, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{w} H{h} F25:1 Ip A1:1 C{tag}\n".encode())
        for px in frames:
            px = px.astype(dt)
            planes = [px[..., c] for c in range(3)] if ch == 3 else [px[..., 0], neutral, neutral]
            fh.write(b"FRAME\n" + b"".join(np.ascontiguousarray(q).tobytes() for q in planes))


def decode(build, unit, work):
    """One unit alone through native dav1d: its coded planes (h×w×c) and the depth it decoded at."""
    src, out = work / "u.obu", work / "u.y4m"
    src.write_bytes(unit)
    subprocess.run([build / "dav1d/bin/dav1d", "-q", "-i", src, "-o", out, "--demuxer", "section5"],
                   check=True, capture_output=True, env={"LD_LIBRARY_PATH": str(build / "dav1d/lib")})
    raw = out.read_bytes()
    head, rest = raw.split(b"\n", 1)
    tags = {t[:1]: t[1:].decode() for t in head.split()[1:]}
    c, w, h = tags[b"C"], int(tags[b"W"]), int(tags[b"H"])
    m = re.fullmatch(r"(mono|444)p?(10|12)?", c)
    if not m:
        raise Refused(f"decoded as {c}, neither grey nor 4:4:4")
    depth, planes = int(m[2] or 8), 1 if m[1] == "mono" else 3
    dt = "u1" if depth == 8 else "<u2"
    body = rest[rest.index(b"\n") + 1:]
    px = np.frombuffer(body, dt, h * w * planes).reshape(planes, h, w)
    return np.moveaxis(px, 0, -1).astype(np.int32), depth


def item(header, frames):
    """header(16) · len[n] · frame[n]."""
    head = struct.pack("<BBBBB3xII", 1, header["bits"], header["depth"], header["split"], header["flags"],
                       header["offset"], len(frames))
    return head + b"".join(struct.pack("<I", len(f)) for f in frames) + b"".join(frames)


def merge(header, pictures):
    top = pictures[0]
    if header["flags"] & FLAG_RCT:
        y, cb, cr = top[..., 0], top[..., 1] - 256, top[..., 2] - 256
        g = y - ((cb + cr) >> 2)
        return np.stack([cr + g, g, cb + g], -1)
    if top.shape[2] == 3:
        return top[..., [2, 0, 1]]
    return (top << header["split"]) | pictures[1] if header["split"] else top


def chunk(job):
    """Frames [a, b) of every stream, coded and each frame checked alone; the items, or why not."""
    build, set_dir, representation, preset, a, b = job
    s = size.Set(Path(set_dir))
    header, streams = plan(s, representation)
    header["offset"] = s.offset
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        coded = []
        for j, (depth, ch, plane) in enumerate(streams):
            y4m, ivf = work / f"{j}.y4m", work / f"{j}.ivf"
            write_y4m(y4m, [plane(i) for i in range(a, b)], depth, ch)
            subprocess.run([build / f"aom-{size.AOM}/bin/aomenc", "-q", "-o", ivf, f"--limit={b - a}",
                            *encoder_args(preset, representation, depth, ch), y4m], check=True, capture_output=True)
            coded.append(size.ivf_units(ivf))
        out = []
        for k, i in enumerate(range(a, b)):
            units = [c[k] for c in coded]
            pictures = []
            for j, unit in enumerate(units):
                px, depth = decode(build, unit, work)
                if depth != streams[j][0]:
                    raise Refused(f"frame {i}: stream {j} decoded at {depth} bits, coded at {streams[j][0]}")
                pictures.append(px)
            if not size.exact(s, i, merge(header, pictures)[:s.h, :s.w]):
                raise Refused(f"frame {i} does not decode back to its source")
            frame = struct.pack("<I", len(units[0])) + units[0] + units[1] if len(units) == 2 else units[0]
            out.append((i, item(header, [frame])))
        return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("set_dir", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--representation", choices=["plain", "optimized"], default="optimized")
    ap.add_argument("--preset", default="cpu0")
    ap.add_argument("--frames", type=int)
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    s = size.Set(a.set_dir)
    n = min(a.frames or s.n, s.n)
    per = -(-n // a.jobs)
    jobs = [(a.build.resolve(), str(a.set_dir), a.representation, a.preset, i, min(i + per, n)) for i in range(0, n, per)]
    try:
        with ProcessPoolExecutor(a.jobs) as pool:
            items = [x for part in pool.map(chunk, jobs) for x in part]
    except Refused as e:
        sys.exit(f"{a.set_dir.name}: nothing written — {e}")
    a.out.mkdir(parents=True, exist_ok=True)
    for i, data in items:
        (a.out / f"{i:03d}.av1").write_bytes(data)
        shutil.copy(a.set_dir / f"{i:03d}.sha256", a.out / f"{i:03d}.sha256")
    meta = json.loads((a.set_dir / "metadata.json").read_text())
    meta.update(frameCount=n, codec="av1", representation=a.representation)
    (a.out / "metadata.json").write_text(json.dumps(meta, indent=1) + "\n")
    total = sum(len(d) for _, d in items)
    digest = hashlib.sha256(b"".join(d for _, d in items)).hexdigest()[:12]
    print(f"{a.set_dir.name}: {n} items, {total} B, {a.representation}, every one exact ({digest})")


if __name__ == "__main__":
    main()
