#!/usr/bin/env python3
"""Turn an unsigned HTJ2K codestream into a signed one, and write its ground truth.

The encoder cannot make a signed frame that its own decoder survives (`ojph_compress -signed`),
so the fixture is made the other way round: encode unsigned, then set the sign bit of every
component's Ssiz in the SIZ marker. JPEG 2000 level-shifts an unsigned component by 2^(B-1)
before coding and a signed one not at all, so the same coded bits read as signed decode to
`v - 2^(B-1)`. OpenJPEG's opj_decompress, an independent decoder, confirmed that on 16- and 12-bit
frames before this was trusted: docs/decode/README.md §Ground truth.

The `.sha256` is of the samples the decoder must emit, little-endian int16, sign-extended —
from the encoder's input, never from a decoder under test.

usage: sign_htj2k.py CODESTREAM PNM BITS  (rewrites CODESTREAM in place, writes CODESTREAM's .sha256)
"""
import hashlib
import struct
import sys

import numpy as np


def main() -> None:
    codestream, pnm, bits = sys.argv[1], sys.argv[2], int(sys.argv[3])
    b = bytearray(open(codestream, "rb").read())
    if b[0:4] != b"\xff\x4f\xff\x51":
        sys.exit(f"{codestream}: expected SOC then SIZ")
    csiz = struct.unpack(">H", b[40:42])[0]
    for c in range(csiz):
        at = 42 + 3 * c
        if (b[at] & 0x7F) + 1 != bits:
            sys.exit(f"{codestream}: component {c} is {(b[at] & 0x7F) + 1}-bit, not {bits}")
        b[at] |= 0x80
    open(codestream, "wb").write(b)

    raw = open(pnm, "rb").read().split(b"\n", 3)[3]
    unsigned = np.frombuffer(raw, dtype=">u2").astype(np.int32)
    signed = (unsigned - (1 << (bits - 1))).astype("<i2")
    stem = codestream.rsplit(".", 1)[0]
    open(f"{stem}.sha256", "w").write(hashlib.sha256(signed.tobytes()).hexdigest() + "\n")


if __name__ == "__main__":
    main()
