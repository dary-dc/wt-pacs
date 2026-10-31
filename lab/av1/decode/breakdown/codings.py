#!/usr/bin/env python3
"""The breakdown's frames: each set's middle 16 slices at G = 1, coded as gop.py codes them (libaom `good` 6, every
group decoded alone through native dav1d and checked), once as is and once with 4 tile columns; as product payloads,
the low stream also deflated as ENCX codes it; HTJ2K as the served profile; manifest.json with both checks' truths.

usage: codings.py BUILD WORK OUT SET_DIR ...   — README.md here
"""
import argparse
import hashlib
import json
import struct
import sys
import tempfile
import zlib
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import xxhash

HERE = Path(__file__).resolve().parent
LAB = HERE.parents[1]
sys.path.insert(0, str(LAB))
sys.path.insert(0, str(LAB / "bytes/frame-groups"))
sys.path.insert(0, str(LAB / "bytes/low-stream"))
sys.path.insert(0, str(LAB.parents[1] / "ingest/coded-frames"))
import encx  # noqa: E402
import gop  # noqa: E402
import ingest  # noqa: E402
import size  # noqa: E402

TILES = ["--tile-columns=2"]
plain_args = gop.aom_args


def coding(job):
    build, path, work, tiles = job
    gop.aom_args = (lambda *a: plain_args(*a) + TILES) if tiles else plain_args
    return gop.av1_job((build, path, work, 16, "aom", "good:6", "optimized", 1, False, True))


def flipped(raw):
    """The frame with one sample's low bit flipped, as page.js's --mutate flips it."""
    b = bytearray(raw)
    b[len(b) >> 1] ^= 1
    return bytes(b)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("work", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", nargs="+", type=Path)
    a = ap.parse_args()
    build = a.build.resolve()
    jobs = [(build, str(p), a.work / ("t4" if t else "base"), t) for p in a.sets for t in (False, True)]
    with ProcessPoolExecutor(4) as pool:
        rows = list(pool.map(coding, jobs))
    for r in rows:
        print(json.dumps({k: v for k, v in r.items() if k != "frame_bytes"}), flush=True)
        if not r["exact"]:
            sys.exit(f"{r['set']}: {r.get('exact_n')} of {r['frames']} exact natively")
    manifest = []
    for path in a.sets:
        s = size.Set(path)
        a0, a1 = gop.run_of(s, 16)
        header, streams = ingest.plan(s, "optimized")
        header["offset"] = s.offset
        k = header["split"]
        dst = a.out / s.name
        dst.mkdir(parents=True, exist_ok=True)
        cell = lambda w: [size.ivf_units(a.work / w / "ivf" / f"{s.name}.aom-good6.optimized.g1" / f"{j}.ivf") for j in (0, 1)]
        (top, low), (ttop, tlow) = cell("base"), cell("t4")
        frames, sizes = [], {"av1": 0, "t4": 0, "z": 0, "htj2k": 0}
        for i in range(a1 - a0):
            plane = streams[1][2](a0 + i)
            z = encx.deflate(encx.pack(plane, k))
            if not np.array_equal(encx.unpack(zlib.decompress(z, -15), k, plane.shape), plane):
                sys.exit(f"{s.name} frame {i}: the deflated low does not inflate to its plane")
            for ext, t, lo in (("av1", top[i], low[i]), ("t4", ttop[i], tlow[i]), ("z", top[i], z)):
                data = ingest.payload(header, [struct.pack("<I", len(t)) + t + lo])
                (dst / f"{i:03d}.{ext}").write_bytes(data)
                sizes[ext] += len(data)
            raw = (path / f"{a0 + i:03d}.raw").read_bytes()
            if hashlib.sha256(raw).hexdigest() != s.truth[a0 + i]:
                sys.exit(f"{s.name} frame {i}: the raw frame is not the fetch checksum's")
            frames.append(dict(truth=s.truth[a0 + i], xxh3=xxhash.xxh3_64_hexdigest(raw),
                               xxh3_flipped=xxhash.xxh3_64_hexdigest(flipped(raw))))
        with tempfile.TemporaryDirectory() as tmp:
            for i, data in ingest.htj2k(build, s, Path(tmp), a0, a1):
                (dst / f"{i - a0:03d}.htj2k").write_bytes(data)
                sizes["htj2k"] += len(data)
        manifest.append(dict(name=s.name, first=a0, width=s.w, height=s.h, split=k, bytes=sizes, frames=frames))
        print(s.name, sizes, flush=True)
    (a.out / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")


if __name__ == "__main__":
    main()
