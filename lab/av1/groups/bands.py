"""A frame's Laplacian pyramid by MS-SSIM's 2 × 2 mean, the noise's correlation between neighbouring frames per band
(ρ_ℓ), and the share of a band's noise a decode lost (κ_ℓ) — docs/av1/groups.md §6.4."""
import numpy as np

LEVELS, BLOCK, REACH = 4, 64, 8


def halve(a):
    h, w = a.shape[0] // 2 * 2, a.shape[1] // 2 * 2
    return (a[0:h:2, 0:w:2] + a[1:h:2, 0:w:2] + a[0:h:2, 1:w:2] + a[1:h:2, 1:w:2]) / 4


def pyramid(x, inside=None):
    """[(B_ℓ, in-window mask at ℓ)] for ℓ < LEVELS; a sample is in-window when all of its source samples are."""
    g = x.astype(np.float32)
    m = np.ones(x.shape, np.float32) if inside is None else inside.astype(np.float32)
    out = []
    for _ in range(LEVELS):
        nxt, mn = halve(g), halve(m)
        h, w = nxt.shape[0] * 2, nxt.shape[1] * 2
        out.append((g[:h, :w] - nxt.repeat(2, 0).repeat(2, 1), m[:h, :w] == 1))
        g, m = nxt, mn
    return out


def kappa(err, noise, inside):
    """Per band, Σ in-window B_ℓ(err)² ÷ Σ in-window B_ℓ(noise)²."""
    return [float(np.sum(be[m].astype(np.float64) ** 2) / max(np.sum(bn[m].astype(np.float64) ** 2), 1e-30))
            for (be, m), (bn, _) in zip(pyramid(err, inside), pyramid(noise, inside))]


def block_rho(a, b, inside, reach=REACH, block=BLOCK):
    """Per BLOCK × BLOCK block of `a` wholly in-window and REACH from the edge: Pearson's ρ with `b` at offset 0, and
    the largest over integer offsets within ±reach."""
    ny, nx = (a.shape[0] - 2 * reach) // block, (a.shape[1] - 2 * reach) // block
    if ny < 1 or nx < 1:
        return np.empty(0), np.empty(0)
    cut = lambda x, dy=0, dx=0: x[reach + dy:reach + dy + ny * block, reach + dx:reach + dx + nx * block] \
        .reshape(ny, block, nx, block).astype(np.float64)
    keep = cut(inside).all(axis=(1, 3))
    if not keep.any():
        return np.empty(0), np.empty(0)
    A = cut(a)
    A = A - A.mean(axis=(1, 3), keepdims=True)
    va = (A * A).sum(axis=(1, 3))
    best = np.full(keep.shape, -np.inf)
    zero = None
    for dy in range(-reach, reach + 1):
        for dx in range(-reach, reach + 1):
            B = cut(b, dy, dx)
            B = B - B.mean(axis=(1, 3), keepdims=True)
            r = (A * B).sum(axis=(1, 3)) / np.sqrt(np.maximum(va * (B * B).sum(axis=(1, 3)), 1e-30))
            best = np.maximum(best, r)
            if dy == dx == 0:
                zero = r
    return zero[keep], best[keep]


def rho(noise_frames, inside_frames, reach=REACH):
    """Per band, over every neighbouring pair: median and 90th percentile of ρ at offset 0 and at the best offset."""
    per = [[[], []] for _ in range(LEVELS)]
    prev = None
    for n, m in zip(noise_frames, inside_frames):
        cur = pyramid(n, m)
        if prev is not None:
            for lv, ((ba, ma), (bb, _)) in enumerate(zip(prev, cur)):
                z, b = block_rho(ba, bb, ma, reach)
                per[lv][0].append(z)
                per[lv][1].append(b)
        prev = cur
    out = []
    for z, b in per:
        z, b = np.concatenate(z) if z else np.empty(0), np.concatenate(b) if b else np.empty(0)
        q = lambda a, p: float(np.percentile(a, p)) if a.size else None
        out.append(dict(blocks=int(b.size), zero_med=q(z, 50), zero_p90=q(z, 90), med=q(b, 50), p90=q(b, 90)))
    return out
