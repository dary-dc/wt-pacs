#!/usr/bin/env python3
"""The share of samples and of levels each series uses above 12 (and 10) bits after its offset — row REMAP's
first question, lab/av1/bytes/remap/README.md.

usage: levels.py SET_DIR... [--out levels.json]
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import size  # noqa: E402


def census_counts(s):
    counts = np.zeros(1 << 16, np.int64)
    for i in range(s.n):
        counts += np.bincount((s.frame(i).astype(np.int32) + s.offset).ravel(), minlength=1 << 16)
    return counts


def census(s):
    counts = census_counts(s)
    used = np.flatnonzero(counts)
    total = int(counts.sum())
    out = dict(set=s.name, frames=s.n, samples=total, offset=s.offset, bits=int(used[-1]).bit_length(),
               levels=len(used), top=[[int(v), int(counts[v])] for v in used[np.argsort(-counts[used])][:3]])
    for t in (10, 12):
        over = used[used >= 1 << t]
        out[f"over{t}"] = dict(samples=int(counts[over].sum()), share=float(counts[over].sum() / total),
                               levels=len(over), values=[int(v) for v in over[:4]])
        span = window(counts, t)
        out[f"window{t}"] = dict(low=span[0], outside=span[1], share=span[1] / total)
    return out


def window(counts, t):
    """The 2^t-wide window of levels holding the most samples: its low end and how many fall outside."""
    inside = np.convolve(counts, np.ones(1 << t, np.int64))[(1 << t) - 1:]
    low = int(np.argmax(inside))
    return low, int(counts.sum() - inside[low])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sets", type=Path, nargs="+")
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()
    rows = [census(size.Set(p)) for p in a.sets]
    for r in rows:
        print(json.dumps(r))
    if a.out:
        a.out.write_text(json.dumps(rows, indent=1) + "\n")


if __name__ == "__main__":
    main()
