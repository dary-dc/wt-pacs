#!/usr/bin/env python3
"""The frames SPLIT10 decodes: each set's first FRAMES frames as the served HTJ2K and as two AV1
splits, top10+low and top11+low, each frame's two temporal units in one file.

A split frame file is `[u32le len(top)][top unit][low unit]` — a lab framing, not a store format.
Every frame is decoded natively, unit by unit, merged and matched with its checksum before it is kept.

usage: make_frames.py BUILD OUT SETDIR ...   — lab/av1/split10/README.md
"""
import json
import os
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "speed"))
sys.path.insert(0, str(HERE.parents[1] / "scripts"))
import depth  # noqa: E402
from make_frames import htj2k  # noqa: E402
from size import Set, decode_y4m, exact, ivf_units  # noqa: E402

FRAMES = int(os.environ.get("FRAMES", 18))
PRESET = 0
# name: bits the top stream is coded at; the low stream is 8-bit. As depth.py's topN+low.
SPLITS = {"t10": 10, "t11": 12}


def split(build, s, work, name, top_bits):
    b = max(depth.coded_bits(s), 13)
    shift = b - (10 if name == "t10" else 11)
    v = [s.frame(i)[..., 0].astype(np.int32) + s.offset for i in range(s.n)]
    units = []
    for k, (bits, take) in enumerate(((top_bits, lambda x: x >> shift), (8, lambda x: x & ((1 << shift) - 1)))):
        y4m, ivf = work / f"{name}{k}.y4m", work / f"{name}{k}.ivf"
        depth.write_y4m([take(x) for x in v], bits, s.w, s.h, y4m)
        depth.encode(build, y4m, ivf, s.n, bits, PRESET)
        units.append(ivf_units(ivf))
    frames = []
    for i, (top, low) in enumerate(zip(*units)):
        merged = 0
        for unit, up in ((top, shift), (low, 0)):
            (work / "u.obu").write_bytes(unit)
            merged = merged + (decode_y4m(build, work / "u.obu", work / "u.y4m")[0].astype(np.int32) << up)
        if not exact(s, i, merged):
            sys.exit(f"{s.name} {i}: {name} not exact alone")
        frames.append(len(top).to_bytes(4, "little") + top + low)
    return frames, shift


def main():
    build, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    manifest = []
    for d in sys.argv[3:]:
        s = Set(Path(d))
        s.n = min(s.n, FRAMES)
        if s.ch != 1:
            sys.exit(f"{s.name}: a split is of grey samples")
        dst, work = out / s.name, out / f".{s.name}-work"
        dst.mkdir(parents=True, exist_ok=True)
        work.mkdir(exist_ok=True)
        entry = dict(name=s.name, width=s.w, height=s.h, signed=s.signed, offset=s.offset, splits={})
        sizes = {}
        for name, top_bits in SPLITS.items():
            frames, shift = split(build, s, work, name, top_bits)
            entry["splits"][name] = dict(shift=shift, top=top_bits)
            for i, f in enumerate(frames):
                (dst / f"{i:03d}.{name}").write_bytes(f)
            sizes[name] = [len(f) for f in frames]
        for i in range(s.n):
            htj2k(s, i, work, dst / f"{i:03d}.htj2k")
        sizes["htj2k"] = [(dst / f"{i:03d}.htj2k").stat().st_size for i in range(s.n)]
        entry["frames"] = [dict(truth=s.truth[i], **{k: v[i] for k, v in sizes.items()}) for i in range(s.n)]
        manifest.append(entry)
        print(s.name, s.n, "frames,", ", ".join(f"{k} {sum(v)} B" for k, v in sizes.items()), flush=True)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
