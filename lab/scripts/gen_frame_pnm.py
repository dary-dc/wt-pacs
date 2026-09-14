#!/usr/bin/env python3
"""One synthetic frame as binary PNM, plus a checksum of its samples in decoder order.

The profile is reversible, so a decode of the encoded frame must reproduce these samples
exactly. The checksum is the bench's ground truth: an oracle built by the decoder itself
cannot catch a systematic decode bug, because it shares the bug.

Content is structured rather than random: random pixels do not compress, and a flat field
compresses to nothing, so either would give a codestream no real study would produce. This
is a moving gradient with soft ellipses and a little grain — compressible like anatomy, at
roughly the ratios the profile gives on a real series.

usage: gen_frame_pnm.py OUT W H CHANNELS MAXVAL INDEX COUNT
"""
import hashlib
import sys

import numpy as np


def main() -> None:
    out, w, h, ch, maxval, index, count = (
        sys.argv[1], *(int(a) for a in sys.argv[2:8])
    )
    phase = 2.0 * np.pi * index / max(count, 1)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    ny, nx = y / h, x / w

    field = 0.45 + 0.25 * np.sin(6.0 * nx + phase) * np.cos(4.0 * ny - phase)
    for cy, cx, r, amp in ((0.35, 0.40, 0.22, 0.30), (0.62, 0.63, 0.15, -0.22)):
        cy = cy + 0.05 * np.sin(phase)
        d = np.hypot(ny - cy, nx - cx) / r
        field += amp * np.exp(-2.0 * d * d)
    rng = np.random.default_rng(index)
    field += rng.normal(0.0, 0.012, field.shape).astype(np.float32)

    field = np.clip(field, 0.0, 1.0)
    planes = [field] * ch if ch > 1 else [field]
    if ch == 3:
        planes = [field, np.roll(field, 3, axis=1), np.roll(field, 3, axis=0)]
    stacked = np.stack(planes, axis=-1) if ch > 1 else field[..., None]

    dtype = np.uint8 if maxval < 256 else np.uint16
    data = (stacked * maxval).astype(dtype)
    samples = data.tobytes()  # little-endian above 8 bits, which is what the decoder emits
    if dtype is np.uint16:
        data = data.byteswap()  # PNM is big-endian above 8 bits

    magic = b"P5" if ch == 1 else b"P6"
    with open(out, "wb") as fh:
        fh.write(b"%s\n%d %d\n%d\n" % (magic, w, h, maxval))
        fh.write(data.tobytes())
    with open(out + ".sha256", "w") as fh:
        fh.write(hashlib.sha256(samples).hexdigest())


if __name__ == "__main__":
    main()
