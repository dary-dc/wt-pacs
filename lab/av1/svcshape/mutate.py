#!/usr/bin/env python3
"""shape.py's checks, each broken on purpose: every line printed must show the check failing.

usage: mutate.py BUILD WORK SET_DIR SPLIT_SET_DIR   — after shape.py has run on both sets.
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import shape  # noqa: E402

build, work, plain, split = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4])

p = shape.Plane(shape.svc.load(plain))
cell = work / p.s.name
y4m = cell / "mutate.y4m"
shape.write_y4m(p, y4m, p.top, p.av1_bits, p.s.ch)
ivf = cell / "mutate.ivf"
shape.encode(build, y4m, ivf, p.av1_bits, p.s.ch, 5, 2, 1, None, "40,8", shape.WHOLE)
top = shape.dav1d(build, Path(f"{ivf}_1.av1"), cell / "dec.y4m")
print(f"top coded lossy (--layer-q=40,8): {shape.exact_frames(p, top, None)}/{p.s.n} exact")

top = shape.dav1d(build, cell / "half-q40.ivf_1.av1", cell / "dec.y4m")
p.s.truth[3] = "0" * 64
print(f"one truth checksum corrupted: {shape.exact_frames(p, top, None)}/{p.s.n} exact")

base = [[(p.source(i)[..., 0]).astype(np.uint16)] for i in range(p.s.n)]
print("base PSNR, the source itself: %s dB, max |Δ| %s" % shape.base_quality(p, base, 1, range(p.s.n)))
base = [[(p.source(i)[..., 0] + 1).astype(np.uint16)] for i in range(p.s.n)]
print("base PSNR, the source + 1: %s dB, max |Δ| %s" % shape.base_quality(p, base, 1, range(p.s.n)))
y4m.unlink()

q = shape.Plane(shape.svc.load(split))
cell = work / q.s.name
top = shape.dav1d(build, cell / "half-q40.ivf_1.av1", cell / "dec.y4m")
low = shape.dav1d(build, cell / "low.ivf_0.av1", cell / "dec2.y4m")
print(f"split, merged: {shape.exact_frames(q, top, low)}/{q.s.n} exact (unbroken)")
print(f"split, low bits dropped: {shape.exact_frames(q, top, None)}/{q.s.n} exact")
q.shift = 1
print(f"split, merged at the wrong shift: {shape.exact_frames(q, top, low)}/{q.s.n} exact")
