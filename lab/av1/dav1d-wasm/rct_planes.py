#!/usr/bin/env python3
"""An 8-bit RGB PNM to stdout as JPEG 2000's reversible colour transform, planar 10-bit LE: Y, B − G
+ 256, R − G + 256 — lab/av1/llsize's rct, which an identity-matrix stream codes as Y, U, V."""
import sys

import numpy as np

with open(sys.argv[1], "rb") as fh:
    magic, dims, maxval = fh.readline(), fh.readline(), int(fh.readline())
    w, h = map(int, dims.split())
    assert magic.strip() == b"P6" and maxval == 255, "8-bit RGB"
    r, g, b = np.frombuffer(fh.read(), "u1").reshape(h, w, 3).astype(np.int32).transpose(2, 0, 1)
planes = [(r + 2 * g + b) >> 2, b - g + 256, r - g + 256]
sys.stdout.buffer.write(b"".join(p.astype("<u2").tobytes() for p in planes))
