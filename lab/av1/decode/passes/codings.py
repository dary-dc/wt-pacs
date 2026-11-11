#!/usr/bin/env python3
"""The passes protocol's frames: each set's middle 16 slices at G = 1, coded as the breakdown's codings.py codes its
base (gop.py, libaom `good` 6, every group decoded alone through native dav1d and checked), as product payloads, with
manifest.json holding both checks' truths. A set with no split (the ultrasound's RCT payload) has no low stream.

usage: codings.py BUILD WORK OUT SET_DIR ...   — README.md here
"""
import argparse
import hashlib
import json
import struct
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import xxhash

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "breakdown"))
import codings as breakdown  # noqa: E402
from codings import gop, ingest, size  # noqa: E402

grey_exact = gop.exact_frames


def exact_frames(s, header, first, pictures):
    """gop.py's check, which reads one plane; an RCT frame's planes (read_y4m gives V, Y, U) merged and checked whole."""
    if not header["flags"] & ingest.FLAG_RCT:
        return grey_exact(s, header, first, pictures)
    count = len(pictures[0])
    return sum(size.exact(s, first + k, ingest.merge(header, [pictures[0][k][..., [1, 2, 0]].astype(np.int32)])[:s.h, :s.w])
               for k in range(count))


def coding(job):
    gop.exact_frames = exact_frames
    return breakdown.coding(job)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("work", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", nargs="+", type=Path)
    a = ap.parse_args()
    jobs = [(a.build.resolve(), str(p), a.work, False) for p in a.sets]
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
        cell = a.work / "ivf" / f"{s.name}.aom-good6.optimized.g1"
        units = [size.ivf_units(cell / f"{j}.ivf") for j in range(len(streams))]
        dst = a.out / s.name
        dst.mkdir(parents=True, exist_ok=True)
        frames, total = [], 0
        for i in range(a1 - a0):
            top, *low = (u[i] for u in units)
            data = ingest.payload(header, [struct.pack("<I", len(top)) + top + b"".join(low) if low else top])
            (dst / f"{i:03d}.av1").write_bytes(data)
            total += len(data)
            raw = (path / f"{a0 + i:03d}.raw").read_bytes()
            if hashlib.sha256(raw).hexdigest() != s.truth[a0 + i]:
                sys.exit(f"{s.name} frame {i}: the raw frame is not the fetch checksum's")
            frames.append(dict(truth=s.truth[a0 + i], xxh3=xxhash.xxh3_64_hexdigest(raw),
                               xxh3_flipped=xxhash.xxh3_64_hexdigest(breakdown.flipped(raw))))
        manifest.append(dict(name=s.name, first=a0, width=s.w, height=s.h, split=header["split"],
                             rct=bool(header["flags"] & ingest.FLAG_RCT), bytes=total, frames=frames))
        print(s.name, total, flush=True)
    (a.out / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")


if __name__ == "__main__":
    main()
