#!/usr/bin/env python3
"""Claim 2 of docs/av1/preview-noise.md, corroboration in the profiles decode rows only: dav1d-WASM S_G in order at
1×, each rung against the next coarser of the same series, paired by round inside each block; bytes from the rows.

usage: claim2_profiles.py decode-shard-1.json ...
"""
import json
import math
import statistics as st
import sys
from collections import defaultdict

T975_DF5 = 2.5706


def main():
    ms, size = defaultdict(dict), defaultdict(list)
    for path in sys.argv[1:]:
        for r in json.load(open(path)):
            if r.get("arm") != "S" or r["dec"] != "dav1d" or r["pattern"] != "order" or str(r["throttle"]) != "1":
                continue
            if r.get("error") or not r.get("frames") or any(ok != n for ok, n in r["checks"].values()):
                continue
            key = (r["set"], int(r["g"]), int(r["q"]))
            ms[(r["block"], r["round"])][key] = st.median(w - h for _, h, w, _ in r["frames"])
            size[key] += [b for *_, b in r["frames"]]
    print("| volume | G | rung → finer rung | bytes ratio | time ratio, pooled [95 % t, 6 blocks] | β | blocks' range |")
    print("| --- | --: | --- | --: | --- | --: | --- |")
    for s, g in sorted({k[:2] for k in size}):
        qs = sorted({k[2] for k in size if k[:2] == (s, g)}, reverse=True)
        for coarse, fine in zip(qs, qs[1:]):
            bytes_ratio = st.median(size[(s, g, fine)]) / st.median(size[(s, g, coarse)])
            per_block = defaultdict(list)
            for (block, _), m in ms.items():
                if (s, g, fine) in m and (s, g, coarse) in m:
                    per_block[block].append(math.log(m[(s, g, fine)] / m[(s, g, coarse)]))
            meds = [st.median(v) for v in per_block.values()]
            mean, half = st.mean(meds), T975_DF5 * st.stdev(meds) / math.sqrt(len(meds))
            print(f"| `{s}` | {g} | Q {coarse} → Q {fine} | {bytes_ratio:.2f} | {math.exp(mean):.3f} "
                  f"[{math.exp(mean - half):.3f}–{math.exp(mean + half):.3f}] | {mean / math.log(bytes_ratio):.3f} | "
                  f"{math.exp(min(meds)):.3f}–{math.exp(max(meds)):.3f} (n {len(meds)}) |")


if __name__ == "__main__":
    main()
