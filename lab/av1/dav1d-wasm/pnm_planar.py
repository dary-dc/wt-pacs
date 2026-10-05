#!/usr/bin/env python3
"""A binary PNM to stdout as planar samples, little-endian above 8 bits: G, B, R planes for colour,
the order an identity-matrix AV1 stream codes as Y, U, V."""
import sys

import numpy as np

with open(sys.argv[1], "rb") as fh:
    magic, dims, maxval = fh.readline(), fh.readline(), int(fh.readline())
    w, h = map(int, dims.split())
    ch = 3 if magic.strip() == b"P6" else 1
    dtype = np.dtype(">u2") if maxval > 255 else np.dtype("u1")
    data = np.frombuffer(fh.read(), dtype).reshape(h, w, ch).astype(dtype.newbyteorder("<"))
planes = [data[..., 1], data[..., 2], data[..., 0]] if ch == 3 else [data[..., 0]]
sys.stdout.buffer.write(b"".join(np.ascontiguousarray(p).tobytes() for p in planes))
