"""Per-frame quality of a lossy frame against its exact source — README.md §Quality metrics protocol, pre-registered.

Every function takes integer frames at the series' depth b (peak 2^b − 1) and returns plain floats.
"""
import numpy as np
from scipy.ndimage import convolve, gaussian_filter, sobel

LAPLACIAN = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], np.float64)
MS_SSIM_WEIGHTS = (0.0448, 0.2856, 0.3001, 0.2363, 0.1333)
EDGE_SHARE = 0.10


def psnr(mse, peak):
    return float("inf") if mse == 0 else float(10 * np.log10(peak * peak / mse))


def _local(x, y):
    """Gaussian-window local means, variances and covariance as scikit-image's SSIM forms them (σ 1.5, 11 taps,
    population covariance)."""
    f = lambda a: gaussian_filter(a, 1.5, truncate=3.5, mode="reflect")
    mx, my = f(x), f(y)
    return mx, my, f(x * x) - mx * mx, f(y * y) - my * my, f(x * y) - mx * my


def ssim_terms(x, y, peak):
    """The luminance and the contrast-structure maps of Wang et al. 2004, eq. 13 split in two, borders cropped."""
    c1, c2 = (0.01 * peak) ** 2, (0.03 * peak) ** 2
    mx, my, vx, vy, cxy = _local(x, y)
    lum = (2 * mx * my + c1) / (mx * mx + my * my + c1)
    cs = (2 * cxy + c2) / (vx + vy + c2)
    return lum[5:-5, 5:-5], cs[5:-5, 5:-5]


def halve(a):
    h, w = a.shape[0] // 2 * 2, a.shape[1] // 2 * 2
    return (a[0:h:2, 0:w:2] + a[1:h:2, 0:w:2] + a[0:h:2, 1:w:2] + a[1:h:2, 1:w:2]) / 4


def ssim(x, y, peak, weights=MS_SSIM_WEIGHTS):
    """SSIM and MS-SSIM (Wang, Simoncelli and Bovik 2003, eq. 7: contrast-structure at every scale, luminance at
    the last), from one pass over the scales."""
    x, y = x.astype(np.float64), y.astype(np.float64)
    single, multi = None, 1.0
    for j, wj in enumerate(weights):
        lum, cs = ssim_terms(x, y, peak)
        if j == 0:
            single = float(np.mean(lum * cs))
        multi *= float(np.mean(lum * cs if j == len(weights) - 1 else cs)) ** wj
        x, y = halve(x), halve(y)
    return single, multi


def sigma(frame, inside=None, edge_share=EDGE_SHARE, sheppard=True, centre=np.mean):
    """Noise σ of one integer frame: Immerkær's Laplacian-difference estimator over the in-window samples, the
    steepest edge_share of them (Sobel) left out, less the variance 1/12 that rounding to integers adds."""
    x = frame.astype(np.float64)
    lap = np.abs(convolve(x, LAPLACIAN, mode="reflect"))[1:-1, 1:-1]
    keep = np.ones(lap.shape, bool) if inside is None else inside[1:-1, 1:-1]
    if edge_share:
        grad = (np.abs(sobel(x, 0)) + np.abs(sobel(x, 1)))[1:-1, 1:-1]
        keep &= grad <= np.quantile(grad[keep], 1 - edge_share) if keep.any() else keep
    if not keep.any():
        return float("nan")
    s = np.sqrt(np.pi / 2) * centre(lap[keep]) / 6
    return float(np.sqrt(max(0.0, s * s - 1 / 12)) if sheppard else s)


def band(d):
    """A difference image seen at MS-SSIM's heaviest scale (the third): 4 × 4 means."""
    return halve(halve(d))


def display_moves(src_codes, lossy_codes):
    """|Δ displayed level| over the samples the window shows (source code strictly inside 0 … 255)."""
    keep = (src_codes > 0) & (src_codes < 255)
    dc = np.abs(src_codes[keep].astype(np.int16) - lossy_codes[keep])
    return dict(n=int(keep.sum()), ge1=int((dc >= 1).sum()), ge2=int((dc >= 2).sum()), ge4=int((dc >= 4).sum()),
                max=int(dc.max()) if dc.size else 0)


def compression_ratio(bits_stored, samples, coded_bytes):
    """ESR 2011's ratio, on the bits stored setting: bits stored × samples ÷ coded bits."""
    return bits_stored * samples / (8 * coded_bytes)


def rms(a):
    return float(np.sqrt(np.mean(np.square(a, dtype=np.float64)))) if a.size else float("nan")
