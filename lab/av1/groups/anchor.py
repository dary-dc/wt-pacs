"""Bytes at the noise anchor (docs/av1/groups.md §S6): per stream, ln bytes and ν against worst-frame e_N/σ over its
integer-Q ladder, read at e_N/σ = 1.00 through a PCHIP interpolant; the integer points; ε by dropping rungs."""
import math

import numpy as np
from scipy.interpolate import PchipInterpolator

AT, PLATEAU = 1.00, 1.02


def worst(series, row):
    return max(f["err_noise_band"] / s for f, s in zip(row["frames"], series["sigma"]))


def nu(series, row):
    return float(np.median([o / s for o, s in zip(row["sigma_out"], series["sigma"])]))


def kept(points):
    """(q, x, …) by Q up to and including the first with x ≥ PLATEAU."""
    out = []
    for p in sorted(points):
        out.append(p)
        if p[1] >= PLATEAU:
            break
    return out


def read(points, at=AT):
    """B₁ and ν₁ from (q, x, bytes, ν) rungs: None for either when x is not strictly increasing ('not monotone')
    or does not bracket `at`."""
    k = kept(points)
    xs = np.array([p[1] for p in k])
    if len(k) < 2 or np.any(np.diff(xs) <= 0) or not xs[0] <= at <= xs[-1]:
        return dict(b1=None, nu1=None, monotone=len(k) >= 2 and bool(np.all(np.diff(xs) > 0)), rungs=[p[0] for p in k])
    b1 = math.exp(float(PchipInterpolator(xs, np.log([p[2] for p in k]))(at)))
    nu1 = float(PchipInterpolator(xs, [p[3] for p in k])(at)) if all(p[3] is not None for p in k) else None
    return dict(b1=b1, nu1=nu1, monotone=True, rungs=[p[0] for p in k])


def integer_point(points, bar=AT):
    ok = [p for p in points if p[1] <= bar]
    return max(ok) if ok else None


def outward(x, ladder):
    """The one rung §S4 allows past the ladder when its x does not bracket 1.00, or None."""
    if len(x) < len(ladder):
        return None
    if min(x.values()) > AT:
        return min(ladder) - 1
    if max(x.values()) < AT:
        return max(ladder) + 1
    return None


def thinned(points):
    """B₁ with each kept rung dropped in turn: [(dropped Q, B₁ or None)]."""
    return [(p[0], read([o for o in points if o[0] != p[0]])["b1"]) for p in kept(points)]


def synthetic(reverse=False):
    """The §S8 check: B₁ of a curve known in closed form, and of the same offset by ln 0.9, against it;
    `reverse` pairs the arm's x with its y backwards (the mutation)."""
    qs = list(range(4, 13))
    x = [0.6 + 0.0625 * (q - 4) for q in qs]
    y = [16 - 0.18 * (q - 4) for q in qs]
    ref = [(q, a, math.exp(b), None) for q, a, b in zip(qs, x, y)]
    ya = y[::-1] if reverse else y
    arm = [(q, a, math.exp(b + math.log(0.9)), None) for q, a, b in zip(qs, x, ya)]
    want = math.exp(16 - 0.18 * (AT - 0.6) / 0.0625)
    return read(ref)["b1"] / want - 1, read(arm)["b1"] / read(ref)["b1"] - 1 if read(arm)["b1"] else None
