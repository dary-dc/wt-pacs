#!/usr/bin/env python3
"""FIT's level and each frame's level picture from ll.py, the witness that shares no code with OpenJPH: the most
reduced level whose picture still covers the frame's size on the viewport (ADR resolution-fitting §8.2), and the
clamped 5/3 low band at it. docs/client/evidence/delivery-comparison.md A2.2, A2.8

    lab/delivery/fit_truth.py SETDIR OUT [--viewport 1080x2100]     writes OUT/level.json, OUT/NNN.rawl
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "av1"))
sys.path.insert(0, str(HERE.parent / "av1/decode/resolution-level"))
from ll import low_band  # noqa: E402
from size import Set  # noqa: E402

DECOMPOSITIONS = 5


def fit_level(w, h, vw, vh):
    """The largest r with 2^r no more than the frame's shrink onto the viewport: level r still covers what is on screen."""
    shrink = max(w / vw, h / vh)
    r = 0
    while r < DECOMPOSITIONS and 2 ** (r + 1) <= shrink:
        r += 1
    return r


def main():
    p = argparse.ArgumentParser()
    p.add_argument("set", type=Path)
    p.add_argument("out", type=Path)
    p.add_argument("--viewport", default="1080x2100")
    a = p.parse_args()
    vw, vh = map(int, a.viewport.split("x"))
    s = Set(a.set)
    if s.ch != 1 or s.signed:
        sys.exit(f"{s.name}: grey unsigned only")
    level = fit_level(s.w, s.h, vw, vh)
    a.out.mkdir(parents=True, exist_ok=True)
    top = (1 << s.stored) - 1
    for i in range(s.n if level else 0):
        band = np.clip(low_band(s.frame(i)[..., 0], level), 0, top)
        (a.out / f"{i:03d}.rawl").write_bytes(band.astype("<u2").tobytes())
    size = [-(-s.w // 2 ** level), -(-s.h // 2 ** level)]
    (a.out / "level.json").write_text(json.dumps({"set": s.name, "level": level, "viewport": [vw, vh], "frames": s.n, "size": size, "bits": s.stored}))
    print(f"{s.name}: {s.w}×{s.h} on {vw}×{vh}, level {level} ({size[0]}×{size[1]})")


if __name__ == "__main__":
    main()
