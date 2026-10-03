#!/usr/bin/env python3
"""Can LCEVC residuals at step width 1 land every sample exactly? A model of LCEVCdec 4.2.2; see README.md."""
import itertools
import random
import sys
from fractions import Fraction

H = [[1, 1, 1, 1], [1, -1, 1, -1], [1, 1, -1, -1], [1, -1, -1, 1]]
DD1D = [[1, 1, 1, 0], [1, -1, -1, 0], [0, 1, -1, 1], [0, -1, 1, 1]]
DDS1D_OUTER = [[1, 1, 0, 1], [1, -1, 0, -1], [0, 1, 1, -1], [0, -1, 1, 1]]
FRACTION_BITS = {8: 7, 10: 5, 12: 3, 14: 1}


def kron(a, b):
    n, m = len(a), len(b)
    return [[a[i // m][j // m] * b[i % m][j % m] for j in range(n * m)] for i in range(n * m)]


def inverse(m):
    n = len(m)
    a = [[Fraction(x) for x in row] + [Fraction(int(i == j)) for j in range(n)] for i, row in enumerate(m)]
    for col in range(n):
        piv = next(r for r in range(col, n) if a[r][col] != 0)
        a[col], a[piv] = a[piv], a[col]
        p = a[col][col]
        a[col] = [x / p for x in a[col]]
        for r in range(n):
            if r != col and a[r][col] != 0:
                k = a[r][col]
                a[r] = [x - k * y for x, y in zip(a[r], a[col])]
    return [row[n:] for row in a]


def normaliser(m):
    """Smallest N with N * M^-1 integral: the lattice M Z^n contains N Z^n."""
    inv = inverse(m)
    n = 1
    while any((n * x).denominator != 1 for row in inv for x in row):
        n += 1
    return n


def reachable(m, inv, f, d):
    half = 1 << (f - 1)
    ranges = [range((di << f) - half, (di << f) + half) for di in d]
    for r in itertools.product(*ranges):
        if all(sum(x * ri for x, ri in zip(row, r)).denominator == 1 for row in inv):
            return True
    return False


def unreachable_offsets(m, f):
    """Every sample-offset pattern mod N that no coefficients reach (exhaustive, 4 samples)."""
    inv, n = inverse(m), normaliser(m)
    return [d for d in itertools.product(range(n), repeat=len(m)) if not reachable(m, inv, f, d)]


def dds_reachable(f, d):
    """4x4 transform R = H C H: C integral iff H V = 0 mod 16 for V = R H, which forces V = 0 mod 4."""
    half = 1 << (f - 1)
    rows = []
    for drow in d:
        vs = set()
        for r in itertools.product(*[range((x << f) - half, (x << f) + half) for x in drow]):
            v = tuple(sum(r[j] * H[j][l] for j in range(4)) % 16 for l in range(4))
            if all(x % 4 == 0 for x in v):
                vs.add(v)
        rows.append(vs)

    def part(i, v):
        return [(H[k][i] * v[l]) % 16 for k in range(4) for l in range(4)]

    left = {tuple((a + b) % 16 for a, b in zip(part(0, v0), part(1, v1))) for v0 in rows[0] for v1 in rows[1]}
    return any(tuple(-(a + b) % 16 for a, b in zip(part(2, v2), part(3, v3))) in left
               for v2 in rows[2] for v3 in rows[3])


DDS_OFFSETS = {
    "none": [[0] * 4] * 4,
    "one sample +1": [[1, 0, 0, 0]] + [[0] * 4] * 3,
    "two samples +1": [[1, 1, 0, 0]] + [[0] * 4] * 3,
    "checkerboard": [[(i + j) % 2 for j in range(4)] for i in range(4)],
}


def main():
    results = {}
    for name, m in (("DD", H), ("DD1D", DD1D)):
        n = normaliser(m)
        for depth, f in FRACTION_BITS.items():
            if depth == 8 or depth == 10:
                print(f"{name} N={n} {depth}-bit f={f}: every offset reachable (2^f >= N)")
                continue
            bad = unreachable_offsets(m, f)
            results[name, depth] = len(bad)
            print(f"{name} N={n} {depth}-bit f={f}: {len(bad)}/{n ** len(m)} offset classes unreachable, e.g. {bad[:1]}")
    for name, m in (("DDS", kron(H, H)), ("DDS1D", kron(DDS1D_OUTER, H))):
        n = normaliser(m)
        print(f"{name} N={n}: every offset reachable at {[d for d, f in FRACTION_BITS.items() if (1 << f) >= n]} (2^f >= N)")
    for depth in (12, 14):
        for label, d in DDS_OFFSETS.items():
            results["DDS", depth, label] = dds_reachable(FRACTION_BITS[depth], d)
            print(f"DDS {depth}-bit {label}: {'reachable' if results['DDS', depth, label] else 'UNREACHABLE'}")
    rng = random.Random(1)
    sample = [[[rng.randrange(2) for _ in range(4)] for _ in range(4)] for _ in range(32)]
    results["DDS", 12, "random"] = sum(dds_reachable(FRACTION_BITS[12], d) for d in sample)
    print(f"DDS 12-bit: {results['DDS', 12, 'random']}/32 random offset patterns reachable")
    expected = {("DD", 12): 0, ("DD", 14): 128, ("DD1D", 12): 0, ("DD1D", 14): 128,
                ("DDS", 12, "one sample +1"): True, ("DDS", 14, "one sample +1"): False,
                ("DDS", 14, "none"): True, ("DDS", 12, "random"): 32}
    wrong = {k: results[k] for k, v in expected.items() if results[k] != v}
    print("check:", "ok" if not wrong else f"FAILED {wrong}")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
