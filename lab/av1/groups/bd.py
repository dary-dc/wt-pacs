"""Bytes at equal quality between two rate curves (docs/av1/groups.md §7): ln bytes against quality through each
curve's rungs as a monotone piecewise-cubic (PCHIP) interpolant, the mean gap over their overlap inside an interval."""
import math

import numpy as np
from scipy.interpolate import PchipInterpolator

GRID_DB = 0.01
MIN_OVERLAP = 0.70


def curve(points):
    """(quality, bytes) pairs → (x, ln bytes) sorted by quality, ties and non-finite points dropped."""
    pts = sorted((q, math.log(b)) for q, b in points if math.isfinite(q) and b > 0)
    xs, ys = [], []
    for q, y in pts:
        if xs and q <= xs[-1]:
            continue
        xs.append(q)
        ys.append(y)
    return np.array(xs), np.array(ys)


def bd_rate(arm, ref, lo, hi, swapped=False):
    """exp(mean of ln bytes_arm − ln bytes_ref over the overlap in [lo, hi]) − 1, or None when the overlap is under
    MIN_OVERLAP of the interval. `swapped` integrates quality against ln bytes instead (the check's mutation)."""
    (xa, ya), (xr, yr) = curve(arm), curve(ref)
    if len(xa) < 2 or len(xr) < 2:
        return None
    if swapped:
        flip = lambda q, lnb: (lnb[np.argsort(lnb)], q[np.argsort(lnb)])
        (xa, ya), (xr, yr) = flip(xa, ya), flip(xr, yr)
        lo, hi = max(xa.min(), xr.min()), min(xa.max(), xr.max())
        grid = np.linspace(lo, hi, 2001)
        return float(np.mean(PchipInterpolator(xa, ya)(grid) - PchipInterpolator(xr, yr)(grid)))
    a, b = max(lo, xa.min(), xr.min()), min(hi, xa.max(), xr.max())
    if b <= a or (b - a) < MIN_OVERLAP * (hi - lo):
        return None
    grid = np.arange(a, b + GRID_DB / 2, GRID_DB)
    gap = PchipInterpolator(xa, ya)(grid) - PchipInterpolator(xr, yr)(grid)
    return float(math.exp(np.mean(gap)) - 1)
