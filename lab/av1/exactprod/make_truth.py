#!/usr/bin/env python3
"""Every hash the bench checks, from the encoder's input: the fetched NNN.raw, its SHA-256 first
held to the checksum written when it was fetched. Adds `blake3`, `xxh3`, `crc32` to each frame of
FRAMES/manifest.json, and hash-only buffers (`raw` sets, no codestream) at the sizes no series has.

usage: make_truth.py FRAMES SETDIR ...   — lab/av1/exactprod/README.md
"""
import hashlib
import json
import sys
import zlib
from pathlib import Path

import blake3
import numpy as np
import xxhash

# name, width, height, bytes a sample: a phone's smallest and a mammogram's largest frame, 8 and 16 bits
SYNTHETIC = [("raw512x8", 512, 512, 1), ("raw4096x8", 4096, 3328, 1), ("raw4096x16", 4096, 3328, 2)]


def hashes(b):
    return dict(truth=hashlib.sha256(b).hexdigest(), blake3=blake3.blake3(b).hexdigest(),
                xxh3=xxhash.xxh3_64_hexdigest(b), crc32=f"{zlib.crc32(b):08x}")


def main():
    out = Path(sys.argv[1])
    manifest = json.loads((out / "manifest.json").read_text())
    sets = {Path(d).name: Path(d) for d in sys.argv[2:]}
    for s in manifest:
        for i, f in enumerate(s["frames"]):
            h = hashes((sets[s["name"]] / f"{i:03d}.raw").read_bytes())
            if h["truth"] != f["truth"]:
                sys.exit(f"{s['name']} {i}: the raw frame is not the one fetched")
            f.update(h)
    rng = np.random.default_rng(73)
    manifest = [s for s in manifest if not s.get("raw")]
    for name, w, h, b in SYNTHETIC:
        (out / name).mkdir(exist_ok=True)
        data = rng.integers(0, 256, w * h * b, dtype=np.uint8).tobytes()
        (out / name / "000.raw").write_bytes(data)
        manifest.append(dict(name=name, width=w, height=h, channels=1, bits=8 * b, raw=True,
                             frames=[dict(raw=len(data), **hashes(data))]))
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
