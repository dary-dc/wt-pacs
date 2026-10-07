#!/usr/bin/env python3
"""remap.py's check must refuse a series when a map's inverse is wrong: each mutation is applied, the series
remapped, and remap.py must write nothing. Exit non-zero when a mutation passes.

usage: mutate.py WORK SET_DIR ...   — README.md here
"""
import sys
import tempfile
from pathlib import Path

import numpy as np

import remap

MUTATIONS = {
    "a run's gap not accumulated": ("map", "decode_map", lambda f: lambda p, low, d: gap_reset(p, low, d)),
    "the window's low end off by one": ("map", "decode_map", lambda f: lambda p, low, d: f(p, low + 1, d)),
    "the last outlier dropped": ("map", "decode_map", lambda f: lambda p, low, d: last_clamped(f, p, low, d)),
    "a palette rank off by one": ("palette", "decode_palette", lambda f: lambda p, b, h: f(p, b, np.roll(h, 1))),
    "the palette's low bits one fewer": ("palette", "decode_palette", lambda f: lambda p, b, h: f(p, b - 1, h)),
}


def gap_reset(plane, low, data):
    real = remap.read_varints
    remap.read_varints = lambda d, n, pos=0: (lambda xs, q: ([x if j % 2 else 0 for j, x in enumerate(xs)], q))(
        *real(d, n, pos))
    try:
        return real_decode_map(plane, low, data)
    finally:
        remap.read_varints = real


def last_clamped(f, plane, low, data):
    v = f(plane, low, data)
    out = np.flatnonzero(v.ravel() != plane.ravel() + low)
    if len(out):
        v.ravel()[out[-1]] = plane.ravel()[out[-1]] + low
    return v


real_decode_map = remap.decode_map


def main():
    work, *sets = sys.argv[1:]
    caught = 0
    for name, (mode, where, wrap) in MUTATIONS.items():
        real = getattr(remap, where)
        setattr(remap, where, wrap(real))
        refused = []
        try:
            for s in sets:
                with tempfile.TemporaryDirectory(dir=work) as out:
                    sys.argv = ["remap.py", s, out, "--mode", mode]
                    try:
                        remap.main()
                    except SystemExit as e:
                        refused.append(bool(e.code))
                    except IndexError:
                        refused.append(not any(Path(out).iterdir()))
        finally:
            setattr(remap, where, real)
        hit = len(refused) == len(sets) and all(refused)
        caught += hit
        print(f"{name}: {'caught' if hit else 'NOT CAUGHT'} ({sum(refused)}/{len(sets)} series refused)")
    print(f"{caught}/{len(MUTATIONS)} mutations caught")
    sys.exit(caught != len(MUTATIONS))


if __name__ == "__main__":
    main()
