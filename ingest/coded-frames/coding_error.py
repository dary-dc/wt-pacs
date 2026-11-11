"""An optimal-quality frame's coding error against its source, measured where both are in hand:
docs/av1/payload-format.md §Coding error. The noise estimate is the quality study's (claude/av1-vl-metrics,
lab/av1/metrics/quality.py `sigma`, `noise_band`) without scipy.
"""
import numpy as np

LAPLACIAN = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], np.float64)
SOBEL = np.outer([-1, 0, 1], [1, 2, 1]).astype(np.float64)
EDGE_SHARE = 0.10


def interior(x, k):
    """x convolved with the 3 × 3 kernel k, at the samples with all eight neighbours (k symmetric up to sign)."""
    h, w = x.shape
    return sum(k[a, b] * x[a:a + h - 2, b:b + w - 2] for a in range(3) for b in range(3))


def sigma(frame):
    """Immerkær's Laplacian-difference noise σ, the steepest EDGE_SHARE of samples (Sobel) left out, less rounding's 1/12."""
    x = frame.astype(np.float64)
    lap = np.abs(interior(x, LAPLACIAN))
    grad = np.abs(interior(x, SOBEL)) + np.abs(interior(x, SOBEL.T))
    keep = lap[grad <= np.quantile(grad, 1 - EDGE_SHARE)]
    s = np.sqrt(np.pi / 2) * keep.mean() / 6
    return float(np.sqrt(max(0.0, s * s - 1 / 12)))


def coding_error(source, reconstruction, shift=0):
    """rms and max |Δ| in source units, a depth cut's code c standing for c · 2^shift; noiseBandRatio, the difference's
    RMS in the estimator's band over the source's σ, None for a frame without noise."""
    d = (reconstruction.astype(np.int64) << shift) - source
    band = float(np.sqrt(np.mean(np.square(interior(d.astype(np.float64), LAPLACIAN) / 6))))
    s = sigma(source)
    return {"rms": round(float(np.sqrt(np.mean(np.square(d, dtype=np.float64)))), 4), "max": int(np.abs(d).max()),
            "noiseBandRatio": round(band / s, 4) if s > 0 else None}
