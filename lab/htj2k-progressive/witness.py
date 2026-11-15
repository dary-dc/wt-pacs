"""The ladder's independent witness: T.800 Annex F's reversible 5/3 (integer lifting, whole-sample symmetric
extension) and Annex G's reversible colour transform, written from the standard and sharing no code with OpenJPH.
A level-r picture is the LL band after r levels (reduced) or that band synthesised back to full size with every
finer subband zero (full), clamped to the samples' range. lab/htj2k-progressive/README.md
"""
import numpy as np

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "av1/decode/resolution-level"))
from ll import analyse  # noqa: E402


def synthesise(low, n):
    """One inverse 5/3 level along axis 0, the high band zero: n samples from the ceil(n/2) low ones."""
    if n == 1:
        return low.copy()
    out = np.empty((n,) + low.shape[1:], np.int64)
    out[0::2] = low
    even = np.concatenate([low, low[-1:]]) if n % 2 == 0 else low
    out[1::2] = (even[0:n // 2] + even[1:n // 2 + 1]) >> 1
    return out


def reduced(samples, level):
    """The LL band after `level` levels of 2D analysis, vertical then horizontal (F.4.2), unclamped."""
    ll = samples.astype(np.int64)
    for _ in range(level):
        ll = analyse(analyse(ll).T).T
    return ll


def full(samples, level):
    """`level` levels analysed, the finer subbands dropped, synthesised horizontal then vertical (F.3.2), unclamped."""
    shapes = [samples.shape]
    for _ in range(level):
        h, w = shapes[-1]
        shapes.append((-(-h // 2), -(-w // 2)))
    x = reduced(samples, level)
    for h, w in reversed(shapes[:-1]):
        x = synthesise(synthesise(x.T, w).T, h)
    return x


def rct(rgb):
    """G.2's forward reversible colour transform: Y, Cb, Cr as T.800 names them."""
    r, g, b = (rgb[..., c].astype(np.int64) for c in range(3))
    return [(r + 2 * g + b) >> 2, b - g, r - g]


def inverse_rct(y, cb, cr):
    g = y - ((cb + cr) >> 2)
    return np.stack([cr + g, g, cb + g], axis=-1)


def picture(frame, level, size, bits, signed, colour):
    """Frame (h, w, c) at `level`, `size` "reduced" or "full", as the decoder hands it on: clamped to B bits."""
    step = reduced if size == "reduced" else full
    if colour:
        out = inverse_rct(*(step(c, level) for c in rct(frame)))
    else:
        out = np.stack([step(frame[..., c], level) for c in range(frame.shape[2])], axis=-1)
    lo, hi = (-(1 << (bits - 1)), (1 << (bits - 1)) - 1) if signed else (0, (1 << bits) - 1)
    return np.clip(out, lo, hi)
