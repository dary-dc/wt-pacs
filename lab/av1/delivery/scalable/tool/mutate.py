#!/usr/bin/env python3
"""shapes.py's new checks, each broken on purpose: every line but the first must show the check failing.

usage: mutate.py BUILD SHIPPED WORK SET_DIR   — a 12-bit set, after shapes.py has run on it.
"""
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import shapes  # noqa: E402
from shapes import shape  # noqa: E402

build, shipped, work, d = (Path(p).resolve() for p in sys.argv[1:5])
s = shape.svc.load(d)
cell = work / s.name
split = dict(shapes.codings(s))["split"]
top = shape.dav1d(build, cell / "split-two-quarter-q40.ivf_1.av1", cell / "dec.y4m")
low, _ = shapes.shipped_low(build, s, shipped, cell)
print(f"split, merged with the shipped low bits: {shape.exact_frames(split, top, low)}/{s.n} exact (unbroken)")
print(f"split, low bits dropped: {shape.exact_frames(split, top, None)}/{s.n} exact")
print(f"split, the low bits of the frame after: {shape.exact_frames(split, top, low[1:] + low[:1])}/{s.n} exact")
split.shift = 1
print(f"split, merged at the wrong shift: {shape.exact_frames(split, top, low)}/{s.n} exact")

real = shapes.payload_parts
shapes.payload_parts = lambda p: (lambda raw: (raw[20:20 + struct.unpack_from("<I", raw, 16)[0]], raw[20:]))(p.read_bytes())
try:
    bad, _ = shapes.shipped_low(build, s, shipped, cell)
    print(f"payload read at the frame's length, not the top's: {shape.exact_frames(dict(shapes.codings(s))['split'], top, bad)}/{s.n} exact")
except Exception as e:  # dav1d refusing the misread low stream is the check failing too
    print(f"payload read at the frame's length, not the top's: refused ({type(e).__name__})")
shapes.payload_parts = real
shapes.shipped_low(build, s, shipped, cell)

whole = dict(shapes.codings(s))["whole"]
top = shape.dav1d(build, cell / "whole-two-quarter-q40.ivf_1.av1", cell / "dec.y4m")
s.truth[5] = "0" * 64
print(f"whole, one truth checksum corrupted: {shape.exact_frames(whole, top, None)}/{s.n} exact")
(cell / "dec.y4m").unlink()
