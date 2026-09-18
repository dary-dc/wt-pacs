#!/usr/bin/env python3
"""One synthetic frame as binary PNM, plus a checksum of its samples in decoder order.

The profile is reversible, so a decode of the encoded frame must reproduce these samples
exactly. The checksum is the bench's ground truth: an oracle built by the decoder itself
cannot catch a systematic decode bug, because it shares the bug.

Content is structured rather than random: random pixels do not compress, and a flat field
compresses to nothing, so either would give a codestream no real study would produce. This
is a moving gradient with soft ellipses and a little grain — compressible like anatomy, at
roughly the ratios the profile gives on a real series.

The default content saturates nowhere, so it never exercises a decoder's clamp. The "ramp"
mode exists for that: a full-range gradient that hits exactly 0 and exactly MAXVAL.

"field" compresses about 1.25:1, which no modality does. "cine" and "ct" exist because that
skews every decode number toward block decoding — docs/decode/README.md §Content, and F2.

usage: gen_frame_pnm.py OUT W H CHANNELS MAXVAL INDEX COUNT [MODE]
"""
import hashlib
import sys

import numpy as np

# Tuned so each set lands near the ratio its modality gives — F2, docs/decode/README.md.
SPECKLE = 6       # speckle correlation length, pixels
CINE_LEVELS = 3   # B-mode grey levels after scan conversion
CT_GRAIN = 0.035  # CT quantum noise, fraction of full scale
CT_BODY = (0.50, 0.49)  # body half-axes as a fraction of the frame; the rest is air
SECTOR = 0.42     # fan half-angle, radians; outside it the frame is black


def main() -> None:
    out, w, h, ch, maxval, index, count = (
        sys.argv[1], *(int(a) for a in sys.argv[2:8])
    )
    mode = sys.argv[8] if len(sys.argv) > 8 else "field"
    if mode == "ramp":
        field = np.tile(np.linspace(0.0, 1.0, w, dtype=np.float64), (h, 1))
        return write(out, field, w, h, ch, maxval)
    if mode == "cine":
        return write_cine(out, w, h, ch, maxval, index, count)
    if mode == "ct":
        return write(out, ct_field(w, h, index, count), w, h, ch, maxval)
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
    write(out, field, w, h, ch, maxval)


def sector(w, h):
    """The scan-converted fan: everything outside it is untouched background."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    dy, dx = y / h, (x / w) - 0.5
    r = np.hypot(dy, dx)
    return (np.abs(np.arctan2(dx, np.maximum(dy, 1e-6))) < SECTOR) & (r > 0.08) & (r < 0.95)


def write_cine(out, w, h, ch, maxval, index, count) -> None:
    """Ultrasound: a dark sector of speckle, grey but for a small Doppler patch."""
    phase = 2.0 * np.pi * index / max(count, 1)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    ny, nx = y / h, x / w
    rng = np.random.default_rng(index)

    inside = sector(w, h)
    envelope = 0.30 + 0.22 * np.sin(5.0 * nx + phase) * np.cos(3.0 * ny - phase)
    # Rayleigh speckle is the texture that makes ultrasound ultrasound. Real speckle has a
    # correlation length of several pixels — drawing it per pixel makes noise, not speckle,
    # and costs the encoder far more than a scanner's output does.
    small = rng.rayleigh(0.45, (h // SPECKLE + 1, w // SPECKLE + 1)).astype(np.float32)
    speckle = np.repeat(np.repeat(small, SPECKLE, 0), SPECKLE, 1)[:h, :w]
    grey = np.where(inside, np.clip(envelope * speckle, 0.0, 1.0), 0.0)
    grey = np.round(grey * CINE_LEVELS) / CINE_LEVELS

    planes = [grey, grey, grey] if ch == 3 else [grey]
    if ch == 3:
        d = np.hypot(ny - (0.55 + 0.04 * np.sin(phase)), nx - 0.47) / 0.085
        flow = inside & (d < 1.0)  # ~1 % of the frame
        planes = [np.where(flow, np.clip(grey + 0.45, 0, 1), grey), grey,
                  np.where(flow, np.clip(grey * 0.3, 0, 1), grey)]
    write(out, np.stack(planes, axis=-1) if ch == 3 else grey, w, h, ch, maxval)


def ct_field(w, h, index, count):
    """CT: an air background the encoder gets for free, and a textured body that it does not."""
    phase = 2.0 * np.pi * index / max(count, 1)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    ny, nx = y / h, x / w
    rng = np.random.default_rng(index)

    body = np.hypot((ny - 0.5) / CT_BODY[0], (nx - 0.5) / CT_BODY[1]) < 1.0
    tissue = 0.52 + 0.06 * np.sin(9.0 * nx + phase) * np.cos(7.0 * ny - phase)
    tissue = tissue + rng.normal(0.0, CT_GRAIN, (h, w)).astype(np.float32)
    for cy, cx, r, amp in ((0.42, 0.40, 0.11, 0.30), (0.60, 0.61, 0.08, -0.16)):
        d = np.hypot(ny - (cy + 0.02 * np.sin(phase)), nx - cx) / r
        tissue = tissue + amp * np.exp(-2.5 * d * d)
    return np.clip(np.where(body, tissue, 0.02), 0.0, 1.0)


def write(out, field, w, h, ch, maxval) -> None:
    if field.ndim == 3:
        stacked = field  # the caller built one plane per channel
    else:
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
