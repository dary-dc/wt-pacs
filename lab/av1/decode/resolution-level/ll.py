"""A third witness for a reduced level: the reversible 5/3 analysis (T.800 Annex F, integer lifting, whole-sample
symmetric extension, columns then rows) run `level` times on the source samples, the LL band kept. lab/av1/decode/resolution-level/README.md
"""
import numpy as np


def analyse(x):
    """One 5/3 level along axis 0; the low band, x[0] an even sample (the image origin is 0)."""
    n = x.shape[0]
    if n == 1:
        return x.copy()
    ext = np.concatenate([x, x[n - 2:n - 1]])
    odd = x[1::2] - ((ext[0:n - 1:2] + ext[2:n + 1:2]) >> 1)
    high = np.concatenate([odd[:1], odd, odd[-1:]])
    k = (n + 1) // 2
    return x[0::2] + ((high[0:k] + high[1:k + 1] + 2) >> 2)


def low_band(samples, level):
    """The LL band after `level` levels, unclamped: it can leave the samples' range."""
    ll = samples.astype(np.int64)
    for _ in range(level):
        ll = analyse(analyse(ll).T).T
    return ll
