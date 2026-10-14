#!/usr/bin/env python3
"""A grey PNM as a split series' source and its two planes: argv offset split out_prefix.

The source is the PNM's samples minus `offset` (signed when offset > 0); its checksum, written here,
is the truth. The coded value v = source + offset splits as top = v >> split (raw 10-bit LE) and
low = v & (2^split - 1) (raw 8-bit) — docs/av1/adr-unit.md §2."""
import hashlib
import sys

import numpy as np

pnm, offset, split, prefix = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
with open(pnm, "rb") as fh:
    magic, dims, maxval = fh.readline(), fh.readline(), int(fh.readline())
    w, h = map(int, dims.split())
    v = np.frombuffer(fh.read(), ">u2").reshape(h, w).astype(np.int32)
assert magic.strip() == b"P5" and maxval >> split < 1024, "grey, and a top that fits 10 bits"
source = (v - offset).astype("<i2" if offset else "<u2")
open(prefix + ".sha256", "w").write(hashlib.sha256(source.tobytes()).hexdigest())
(v >> split).astype("<u2").tofile(prefix + ".top")
(v & ((1 << split) - 1)).astype("u1").tofile(prefix + ".low")
