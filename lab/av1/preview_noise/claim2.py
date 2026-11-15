#!/usr/bin/env python3
"""Claim 2 of docs/av1/preview-noise.md from SNR's committed rows: in arm `two` of each block, the per-frame decode of
the preview stream (Q 24) against the VL stream (Q 4 or 8) of the same frames, paired by round; bytes from the pin.

usage: claim2.py PIN.json ROWS.jsonl ...
"""
import json
import math
import statistics
import sys
from collections import defaultdict

PREVIEW_Q = 24


def interval(xs):
    """The median's distribution-free 95 % interval by order statistics, as SNR's rule.py; None below n = 6."""
    xs, n = sorted(xs), len(xs)
    if n < 6:
        return None
    k = max(i for i in range(n // 2 + 1) if sum(math.comb(n, j) for j in range(i)) / 2 ** n <= 0.025)
    return xs[k - 1], xs[n - k]


def main():
    pin = json.load(open(sys.argv[1]))
    ms = defaultdict(dict)
    for path in sys.argv[2:]:
        for line in open(path):
            r = json.loads(line)
            if not r.get("mutate") and not r.get("void") and r.get("arm") in ("two", "ctrl") and r["op"] in ("preview", "vl", "cine-exact"):
                ms[(r["set"], r["g"], r["v"], r["round"])][(r["arm"], r["op"])] = statistics.median(r["ms"])
    blocks = defaultdict(list)
    for (s, g, v, rnd), m in ms.items():
        if len(m) == 3:
            blocks[(s, g, v)].append(m)
    print("| volume | G | VL Q | n | bytes, VL ÷ preview | time, VL ÷ preview [95 %] | β [95 %] | preview, HTJ2K frames | "
          "VL, HTJ2K frames | pixel share at preview · at VL |")
    print("| --- | --: | --: | --: | --: | --- | --- | --: | --: | --- |")
    for (s, g, v) in sorted(blocks):
        units = pin[s]["g"][str(g)]["aomenc"]
        bp, bv = (statistics.median(units[str(q)]["units"]) for q in (PREVIEW_Q, v))
        rounds = blocks[(s, g, v)]
        tr = [m[("two", "vl")] / m[("two", "preview")] for m in rounds]
        lo, hi = interval(tr)
        beta = lambda t: math.log(t) / math.log(bv / bp)
        tp = statistics.median(m[("two", "preview")] / m[("ctrl", "cine-exact")] for m in rounds)
        tv = statistics.median(m[("two", "vl")] / m[("ctrl", "cine-exact")] for m in rounds)
        rt = statistics.median(tr)
        per_byte = tp * (rt - 1) / (bv - bp)
        print(f"| `{s}` | {g} | {v} | {len(rounds)} | {bv / bp:.1f} | {rt:.3f} [{lo:.3f}–{hi:.3f}] | "
              f"{beta(rt):.3f} [{beta(lo):.3f}–{beta(hi):.3f}] | {tp:.2f} | {tv:.2f} | "
              f"{1 - per_byte * bp / tp:.2f} · {1 - per_byte * bv / (tp * rt):.2f} |")


if __name__ == "__main__":
    main()
