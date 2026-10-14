#!/usr/bin/env python3
"""breast.py's inter check must fail when the coding or the merge is wrong: each mutation is applied, a short
run is made, and the run must report a frame inexact. Exit non-zero when a mutation passes.

usage: mutate.py BUILD WORK SET_DIR ...   — README.md here
"""
import sys
from pathlib import Path

import numpy as np

import breast

MUTATIONS = {
    "low stream dropped from the merge": ("merge", lambda f: lambda h, p: f(dict(h, split=0), p[:1]) << h["split"]),
    "a group's frames out of order": ("decode_all", lambda f: lambda *a: f(*a)[::-1]),
    "RCT's floor halved": ("merge", lambda f: lambda h, p: f(h, p) if not h["flags"] & 2 else rct_half(p[0])),
    "one sample off by one": ("decode_all", lambda f: lambda *a: [bump(x) for x in f(*a)]),
}


def rct_half(top):
    y, cb, cr = top[..., 0], top[..., 1] - 256, top[..., 2] - 256
    g = y - ((cb + cr) >> 1)
    return np.stack([cr + g, g, cb + g], -1)


def bump(px):
    px = px.copy()
    px[0, 0, 0] ^= 1
    return px


def main():
    build, work, *sets = sys.argv[1:]
    caught = 0
    for name, (where, wrap) in MUTATIONS.items():
        owner = breast.ingest if where == "merge" else breast
        real = getattr(owner, where)
        setattr(owner, where, wrap(real))
        try:
            rows = [r for s in sets for g in (1, 8) for r in
                    breast.inter_job((Path(build).resolve(), s, Path(work), 8, "good:6", g))]
        finally:
            setattr(owner, where, real)
        hit = [r for r in rows if not r["exact"]]
        caught += bool(hit)
        print(f"{name}: {'caught' if hit else 'NOT CAUGHT'} ({len(hit)}/{len(rows)} runs inexact)")
    print(f"{caught}/{len(MUTATIONS)} mutations caught")
    sys.exit(caught != len(MUTATIONS))


if __name__ == "__main__":
    main()
