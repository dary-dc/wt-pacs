#!/usr/bin/env python3
"""A series as AV1 payloads (docs/av1/payload-format.md), plain or optimized, or as the served HTJ2K, and
nothing at all unless every frame decodes back, in-process, to the samples its checksum was written from.

Reads a set as lab/av1/fetch_data.py writes it (NNN.raw, NNN.sha256, metadata.json); writes
OUT/NNN.av1 or OUT/NNN.htj2k, OUT/NNN.sha256 and OUT/metadata.json ("codec": "av1" for AV1), which
pack-series bundles.

usage: ingest.py BUILD SET_DIR OUT [--codec av1|htj2k] [--representation plain|optimized] [--split K]
                 [--grey8 400|420] [--preset cpu0|good:N|allintra:N] [--frames N] [--jobs N]   — ingest/coded-frames/README.md
"""
import argparse
import ctypes
import functools
import hashlib
import json
import shutil
import struct
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import xxhash

ROOT = Path(__file__).resolve().parents[2]
AOM = "3.15.1"
OJPH = ROOT / "lab/.openjph-build/install"
DECODERS = "dav1d 1.5.4-0-g54706fc, openjph 0.31.0"
FLAG_SIGNED, FLAG_RCT = 1, 2
MAX_BITS, MAX_SPLIT = 16, 8
HTJ2K_ARGS = ["-num_decomps", "5", "-block_size", "{64,64}", "-prog_order", "RPCL", "-reversible", "true"]


def container(bits):
    for b in (8, 10, 12):
        if bits <= b:
            return b
    raise Refused(f"a top stream of {bits} bits, over 12")


class Refused(Exception):
    pass


def optimized_split(bits):
    """k by depth after the offset: docs/av1/payload-format.md §Representation at ingest."""
    return 0 if bits <= 9 else 3 if bits == 13 else 2


def plan(s, representation, split=None, grey8="400"):
    """The header and the streams: [(depth, layout, frame → int array h×w×c in coded planes)], layout "444",
    "400" or "420" (grey with mid-grey chroma, full range: docs/av1/payload-format.md). `split` forces grey's k; None takes
    the representation's."""
    v = functools.lru_cache(1)(lambda i: s.frame(i).astype(np.int32) + s.offset)
    bits = max(1, int(s.hi + s.offset).bit_length())
    if s.ch == 3:
        if bits > 8:
            raise Refused(f"RGB of {bits} bits: no modality needs it and aomenc 3.15.1 cannot")
        if representation == "plain":
            return dict(bits=8, depth=8, split=0, flags=0), [(8, "444", lambda i: v(i)[..., [1, 2, 0]])]

        def rct(i):
            r, g, b = (v(i)[..., c] for c in range(3))
            return np.stack([(r + 2 * g + b) >> 2, b - g + 256, r - g + 256], -1)
        return dict(bits=8, depth=10, split=0, flags=FLAG_RCT), [(10, "444", rct)]
    if bits > MAX_BITS:
        raise Refused(f"grey of {bits} bits after the offset, over {MAX_BITS}")
    if split is None and bits > 14:
        raise Refused(f"grey of {bits} bits after the offset: no default layout over 14 bits, serve HTJ2K or --split")
    if split is None:
        split = max(0, bits - 12) if representation == "plain" else optimized_split(bits)
    if not 0 <= split <= MAX_SPLIT:
        raise Refused(f"split {split}, not 0 to {MAX_SPLIT}: the low stream is 8-bit")
    depth = container(bits - split)
    streams = [(depth, grey8 if bits <= 8 else "400", lambda i: v(i) >> split)]
    if split:
        streams.append((8, "400", lambda i: v(i) & ((1 << split) - 1)))
    flags = FLAG_SIGNED if s.signed else 0
    return dict(bits=bits, depth=depth, split=split, flags=flags), streams


def ivf_units(path):
    raw, pos, units = path.read_bytes(), 32, []
    while pos < len(raw):
        n = int.from_bytes(raw[pos:pos + 4], "little")
        units.append(raw[pos + 12:pos + 12 + n])
        pos += 12 + n
    return units


def exact(s, i, samples):
    """samples: (h, w, ch) in coded values; back to stored order and compared with the truth."""
    stored = (samples.astype(np.int32) - s.offset).astype(s.dtype)
    return hashlib.sha256(np.ascontiguousarray(stored).tobytes()).hexdigest() == s.truth[i]


@functools.cache
def pinned(build):
    """The encoders and decoders as pinned, or Refused naming the one that is not."""
    aom = subprocess.run([build / f"aom-{AOM}/bin/aomenc", "--help"], capture_output=True, text=True).stdout
    if f"AV1 Encoder v{AOM}" not in aom:
        raise Refused(f"aomenc in {build} is not libaom {AOM}")
    if not (OJPH / "lib/libopenjph.so.0.31.0").exists():
        raise Refused(f"ojph_compress in {OJPH} is not OpenJPH 0.31.0")
    lib = native(build)
    lib.decoder_versions.restype = ctypes.c_char_p
    if (got := lib.decoder_versions().decode()) != DECODERS:
        raise Refused(f"the in-process decoders are {got}, not {DECODERS} (ingest/coded-frames/build.sh)")
    return True


def frame_digest(px, wide):
    """XXH3-64 of a frame as decodeFrame hands it on: docs/FIXTURES.md §Frame digests."""
    signed = px.dtype.kind == "i"
    dt = ("<i2" if signed else "<u2") if wide else ("i1" if signed else "u1")
    return xxhash.xxh3_64_hexdigest(np.ascontiguousarray(px, dt).tobytes())


def encoder_args(preset, representation, depth, layout):
    kind, _, n = preset.partition(":")
    speed = ["--cpu-used=0"] if kind == "cpu0" else (["--allintra"] if kind == "allintra" else []) + [f"--cpu-used={n}"]
    profile = 2 if depth == 12 else (1 if layout == "444" else 0)
    args = ["--ivf", "--lossless=1", f"--bit-depth={depth}", f"--input-bit-depth={depth}", "--kf-max-dist=0",
            "--threads=1", f"--profile={profile}", *speed]
    if representation == "optimized":
        args += ["--tune-content=screen", "--sb-size=64"]
    # Identity under BT.709 primaries and the sRGB transfer is AV1's RGB signal: WebCodecs reports no matrix.
    rgb = ["--color-primaries=bt709", "--transfer-characteristics=srgb", "--matrix-coefficients=identity"]
    return args + {"400": ["--monochrome"], "420": [], "444": rgb}[layout]


def write_y4m(path, frames, depth, layout):
    """Grey as 4:2:0 with neutral chroma, which --monochrome drops; three channels as 4:4:4, the first as luma."""
    h, w = frames[0].shape[:2]
    tag = ("444" if layout == "444" else "420") + ("" if depth == 8 else f"p{depth}")
    # Firefox expands limited-range grey on its way to RGB; at full range Y comes back as R = G = B. lab/av1/exact/engine-readback
    full = " XCOLORRANGE=FULL" if layout == "420" else ""
    dt = "u1" if depth == 8 else "<u2"
    neutral = np.full(((h + 1) // 2, (w + 1) // 2), 1 << (depth - 1), dt)
    with open(path, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{w} H{h} F25:1 Ip A1:1 C{tag}{full}\n".encode())
        for px in frames:
            px = px.astype(dt)
            planes = [px[..., c] for c in range(3)] if layout == "444" else [px[..., 0], neutral, neutral]
            fh.write(b"FRAME\n" + b"".join(np.ascontiguousarray(q).tobytes() for q in planes))


class Shape(ctypes.Structure):
    _fields_ = [(f, ctypes.c_int32) for f in ("w", "h", "planes", "bits", "signed")]


@functools.cache
def native(build):
    lib = ctypes.CDLL(str(build / "payload/libdecode.so"))
    for f in (lib.av1_decode, lib.htj2k_decode):
        f.argtypes = [ctypes.c_char_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(Shape)]
    return lib


def decoded(build, codec, data, cap):
    """One AV1 unit or HTJ2K codestream decoded alone, in-process: its samples h×w×c and their shape."""
    out, shape = np.empty(cap, np.int32), Shape()
    r = getattr(native(build), f"{codec}_decode")(data, len(data), out.ctypes.data, cap, ctypes.byref(shape))
    if r:
        raise Refused(f"{codec} decode failed ({r})")
    return out[:shape.h * shape.w * shape.planes].reshape(shape.h, shape.w, shape.planes), shape


def decode(build, unit, work=None):
    """One unit alone through dav1d: its coded planes (h×w×c) and the depth it decoded at."""
    px, shape = decoded(build, "av1", unit, 1 << 20)
    return px, shape.bits


def payload(header, frames):
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


def encode(build, work, px, depth, layout, preset, representation):
    """One frame's stream as one unit, in an encoder run of its own: libaom carries state across keyframes,
    so a run of several would make a frame's bytes depend on --jobs (lab/av1/exact/coded-frame/README.md §One pipeline)."""
    y4m, ivf = work / "in.y4m", work / "out.ivf"
    write_y4m(y4m, [px], depth, layout)
    subprocess.run([build / f"aom-{AOM}/bin/aomenc", "-q", "-o", ivf, "--limit=1",
                    *encoder_args(preset, representation, depth, layout), y4m], check=True, capture_output=True)
    (unit,) = ivf_units(ivf)
    return unit


def av1(build, s, work, a, b, representation, split, preset, grey8):
    """Frames [a, b) as payloads, every frame checked alone."""
    header, streams = plan(s, representation, split, grey8)
    header["offset"] = s.offset
    out = []
    for i in range(a, b):
        units = [encode(build, work, plane(i), depth, layout, preset, representation) for depth, layout, plane in streams]
        pictures = []
        for j, unit in enumerate(units):
            px, shape = decoded(build, "av1", unit, s.h * s.w * s.ch)
            if shape.bits != streams[j][0]:
                raise Refused(f"frame {i}: stream {j} decoded at {shape.bits} bits, coded at {streams[j][0]}")
            pictures.append(px)
        if not exact(s, i, merge(header, pictures)[:s.h, :s.w]):
            raise Refused(f"frame {i} does not decode back to its source")
        frame = struct.pack("<I", len(units[0])) + units[0] + units[1] if len(units) == 2 else units[0]
        out.append((i, payload(header, [frame])))
    return out


def htj2k(build, s, work, a, b, *_):
    """Frames [a, b) as the served codestream: a signed series coded shifted by 2^(B-1), then its SIZ
    marked signed (lab/scripts/sign_htj2k.py says why), and the codestream as written checked."""
    shift = 1 << (s.stored - 1) if s.signed else 0
    src, cs = work / ("in.pgm" if s.ch == 1 else "in.ppm"), work / "out.j2c"
    out = []
    for i in range(a, b):
        maxval = (1 << s.stored) - 1
        with open(src, "wb") as fh:
            fh.write(b"%s\n%d %d\n%d\n" % (b"P5" if s.ch == 1 else b"P6", s.w, s.h, maxval))
            fh.write((s.frame(i).astype(np.int32) + shift).astype(">u2" if maxval > 255 else "u1").tobytes())
        subprocess.run([OJPH / "bin/ojph_compress", "-i", src, "-o", cs, *HTJ2K_ARGS], check=True,
                       capture_output=True, env={"LD_LIBRARY_PATH": str(OJPH / "lib")})
        data = bytearray(cs.read_bytes())
        if s.signed:
            for c in range(struct.unpack(">H", data[40:42])[0]):
                data[42 + 3 * c] |= 0x80
        px, shape = decoded(build, "htj2k", bytes(data), s.h * s.w * s.ch)
        if (shape.bits, shape.signed) != (s.stored, s.signed) or not exact(s, i, px + s.offset):
            raise Refused(f"frame {i} does not decode back to its source")
        out.append((i, bytes(data)))
    return out


CODECS = {"av1": av1, "htj2k": htj2k}


def chunk(job):
    """Frames [a, b) through the codec; the coded frames, or why not."""
    build, s, codec, *rest = job
    pinned(build)
    with tempfile.TemporaryDirectory() as tmp:
        return CODECS[codec](build, s, Path(tmp), *rest)


def coded(build, s, n, codec, jobs, representation="optimized", split=None, preset="cpu0", grey8="400"):
    """Frames [0, n) of a series coded, every one checked, in frame order; Refused if any is not exact."""
    per = -(-n // jobs)
    piece = s.part if hasattr(s, "part") else lambda a, b: s
    work = [(build.resolve(), piece(i, min(i + per, n)), codec, i, min(i + per, n), representation, split, preset, grey8)
            for i in range(0, n, per)]
    pinned(build.resolve())
    if codec == "av1":
        plan(s, representation, split, grey8)
    with ProcessPoolExecutor(jobs) as pool:
        return [x for part in pool.map(chunk, work) for x in part]


def digests(s, n, codec, representation="optimized", split=None, grey8="400"):
    """`metadata.json`'s `digests`; decodeFrame hands on two bytes a sample over 8 bits, for AV1 the payload's bits."""
    wide = plan(s, representation, split, grey8)[0]["bits"] > 8 if codec == "av1" else s.stored > 8
    return dict(algorithm="xxh3-64", frames=[frame_digest(s.frame(i), wide) for i in range(n)])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("set_dir", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--codec", choices=list(CODECS), default="av1")
    ap.add_argument("--representation", choices=["plain", "optimized"], default="optimized")
    ap.add_argument("--split", type=int)
    ap.add_argument("--grey8", choices=["400", "420"], default="400")
    ap.add_argument("--preset", default="cpu0")
    ap.add_argument("--frames", type=int)
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    sys.path.insert(0, str(ROOT / "lab/av1"))
    import size  # a fetched set is the lab's: ingest/from-dicom reads DICOM
    s = size.Set(a.set_dir)
    n = min(a.frames or s.n, s.n)
    try:
        payloads = coded(a.build, s, n, a.codec, a.jobs, a.representation, a.split, a.preset, a.grey8)
    except Refused as e:
        sys.exit(f"{a.set_dir.name}: nothing written — {e}")
    a.out.mkdir(parents=True, exist_ok=True)
    for i, data in payloads:
        (a.out / f"{i:03d}.{a.codec}").write_bytes(data)
        shutil.copy(a.set_dir / f"{i:03d}.sha256", a.out / f"{i:03d}.sha256")
    meta = json.loads((a.set_dir / "metadata.json").read_text())
    meta.update(frameCount=n, digests=digests(s, n, a.codec, a.representation, a.split, a.grey8))
    if a.codec == "av1":
        meta.update(codec="av1", representation=a.representation)
    if a.codec == "av1" and a.split is not None:
        meta["split"] = a.split
    (a.out / "metadata.json").write_text(json.dumps(meta, indent=1) + "\n")
    total = sum(len(d) for _, d in payloads)
    digest = hashlib.sha256(b"".join(d for _, d in payloads)).hexdigest()[:12]
    kind = a.representation if a.codec == "av1" else "htj2k"
    print(f"{a.set_dir.name}: {n} payloads, {total} B, {kind}, every one exact ({digest})")


if __name__ == "__main__":
    main()
