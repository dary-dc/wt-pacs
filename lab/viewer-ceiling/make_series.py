#!/usr/bin/env python3
"""Row 273's series: synthetic 16-bit grey, N frames cycling 64 distinct smooth fields, with digests.

usage: make_series.py OJPH_DIR PACK_SERIES CACHE_DIR OUT.sbnd W H N   (docs/merge-readiness.md §273 VIEWERCEILING)
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import xxhash

DISTINCT = 64


def field(w, h, i):
    """gen_frame_pnm.py's field without its grain, so a codestream is ~11:1 and the disk holds the large cells."""
    phase = 2.0 * np.pi * i / DISTINCT
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    ny, nx = y / h, x / w
    f = 0.45 + 0.25 * np.sin(6.0 * nx + phase) * np.cos(4.0 * ny - phase)
    for cy, cx, r, amp in ((0.35, 0.40, 0.22, 0.30), (0.62, 0.63, 0.15, -0.22)):
        d = np.hypot(ny - (cy + 0.05 * np.sin(phase)), nx - cx) / r
        f += amp * np.exp(-2.0 * d * d)
    return np.round(np.clip(f, 0.0, 1.0) * 65535).astype(np.uint16)


def codestreams(ojph, cache, w, h):
    """The 64 distinct frames, encoded once per size in the served profile (lab/scripts/gen_htj2k_fixtures.sh)."""
    cache.mkdir(parents=True, exist_ok=True)
    digests = cache / "digests.json"
    if digests.exists():
        return json.loads(digests.read_text())
    env = {**os.environ, "LD_LIBRARY_PATH": str(ojph / "lib")}
    out = []
    for i in range(DISTINCT):
        px = field(w, h, i)
        pgm = cache / "f.pgm"
        pgm.write_bytes(b"P5\n%d %d\n65535\n" % (w, h) + px.astype(">u2").tobytes())
        subprocess.run([ojph / "bin/ojph_compress", "-i", pgm, "-o", cache / f"{i}.j2c", "-num_decomps", "5",
                        "-block_size", "{64,64}", "-prog_order", "RPCL", "-reversible", "true"],
                       env=env, check=True, stdout=subprocess.DEVNULL)
        out.append(xxhash.xxh3_64_hexdigest(px.astype("<u2").tobytes()))
    pgm.unlink()
    digests.write_text(json.dumps(out))
    return out


def main():
    ojph, pack, cache, out = (Path(a) for a in sys.argv[1:5])
    w, h, n = (int(a) for a in sys.argv[5:8])
    distinct = codestreams(ojph, cache, w, h)
    with tempfile.TemporaryDirectory(dir=out.parent) as t:
        frames = Path(t)
        for i in range(n):
            (frames / f"{i:03}.htj2k").symlink_to((cache / f"{i % DISTINCT}.j2c").resolve())
        meta = {"frameCount": n, "width": w, "height": h, "channels": 1, "bitsAllocated": 16, "bitsStored": 16,
                "highBit": 15, "signed": False, "photometric": "MONOCHROME2", "modality": "OT", "codec": "htj2k",
                "window": {"center": [32768], "width": [65536], "function": "LINEAR"},
                "digests": {"algorithm": "xxh3-64", "frames": [distinct[i % DISTINCT] for i in range(n)]}}
        (frames / "metadata.json").write_text(json.dumps(meta))
        subprocess.run([pack, "--metadata", frames / "metadata.json", "--frames", frames, "--output", out],
                       check=True, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
