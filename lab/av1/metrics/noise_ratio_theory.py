"""The derived numbers of docs/av1/noise-ratio.md §2–§4: arithmetic only, no fixture read."""
import numpy as np
from scipy.ndimage import convolve
from scipy.stats import norm

N = 512
LAPLACIAN = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]]) / 6
OMEGA = np.fft.fftfreq(N) * 2 * np.pi
U, V = np.meshgrid(OMEGA, OMEGA)
BAND = ((2 - 2 * np.cos(U)) * (2 - 2 * np.cos(V))) ** 2 / 36
RADIUS = np.hypot(U, V) / (2 * np.pi)


def band_gain(power):
    return float(np.sqrt((BAND * power).sum() / power.sum()))


def laplacian_band():
    print("§3 band: mean gain on white", round(float(BAND.mean()), 4))
    for f in (0.125, 0.25):
        print(f"  share of the band's power below {f} cy/px:", round(float(BAND[RADIUS < f].sum() / BAND.sum()), 4))
    corner = (abs(U) > np.pi / 2) & (abs(V) > np.pi / 2)
    print("  share with both |fx|, |fy| > 0.25 cy/px:", round(float(BAND[corner].sum() / BAND.sum()), 4))


def blind_spots(rng):
    print("§3 e_N ÷ e for error that is not white:")
    for s in (0.5, 1, 2, 4):
        print(f"  white blurred by a Gaussian of {s} px:", round(band_gain(np.exp(-(U**2 + V**2) * s * s)), 4))
    for b in (4, 8):
        blocks = np.kron(rng.standard_normal((N // b, N // b)), np.ones((b, b)))
        print(f"  constant {b} × {b} blocks:", round(float(convolve(blocks, LAPLACIAN, mode="wrap").std() / blocks.std()), 4))
    stripes = np.repeat(rng.standard_normal(N)[:, None], N, 1)
    print("  rows each constant (stripes):", round(float(convolve(stripes, LAPLACIAN, mode="wrap").std()), 6))


def quantizer():
    print("§2.3 mid-tread uniform quantizer on Gaussian noise of σ 1: x, r, κ = (var out − 1) ÷ r²")
    s = np.linspace(-14, 14, 560001)
    p = norm.pdf(s) * (s[1] - s[0])
    for x in (0.5, 1, 2, 3, 3.5, 4, 4.93, 6):
        q = x * np.round(s / x)
        r2 = float((np.square(q - s) * p).sum())
        print(f"  {x:5}  {np.sqrt(r2):.3f}  {(float((q * q * p).sum()) - 1) / r2:+.3f}")


def deadzone_signal():
    print("§2.4 a signal spread over K coefficients of a σ each, d′ = a √K, each under the step's half at x 4.93:")
    for a, k in ((1, 9), (0.7, 25), (1.5, 4)):
        print(f"  a {a}, K {k}: d′ {a * np.sqrt(k):.2f}; P(|a + n| < 2.465) {norm.cdf(2.465 - a) - norm.cdf(-2.465 - a):.3f}")


def signal_shares():
    print("§2.5 share of a Gaussian signal's white-noise SNR² inside the band (weighted by the band's gain):")
    for s in (0.5, 1, 2, 5, 25):
        spectrum = np.exp(-(U**2 + V**2) * s * s)
        print(f"  σ_signal {s} px:", round(float((BAND * spectrum).sum() / spectrum.sum()), 4))


def ratios():
    print("§2.2 independent white error at noise ratio r: d′ factor 1 ÷ √(1 + r²), dose factor 1 ÷ (1 + r²)")
    for r in (0.3, 0.5, 0.7, 1.0):
        print(f"  r {r}: {1 / np.sqrt(1 + r * r):.3f}  {1 / (1 + r * r):.3f}")
    print("§4.6 slab of m slices, noise independent, error identical in z: r grows by √m")
    for m in (1, 3, 5, 10):
        print(f"  m {m}: {np.sqrt(m):.2f}")


if __name__ == "__main__":
    laplacian_band()
    blind_spots(np.random.default_rng(1))
    quantizer()
    deadzone_signal()
    signal_shares()
    ratios()
