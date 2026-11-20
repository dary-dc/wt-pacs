#!/usr/bin/env python3
"""run.py's rows as one markdown table a set and shape: bytes per layer against today's codestream, the share of
code-blocks split across the two layers, layer 1's picture, and OpenJPEG 2.5.4 on the layered bytes.

usage: summary.py WORK/<set>/rows.jsonl ...
"""
import json
import sys
from collections import defaultdict

import numpy as np


def span(xs, f="{:.1f}"):
    lo, hi = min(xs), max(xs)
    return f.format(lo) if f.format(lo) == f.format(hi) else f"{f.format(lo)}–{f.format(hi)}"


def main():
    rows = [json.loads(line) for path in sys.argv[1:] for line in open(path)]
    groups = defaultdict(list)
    for r in rows:
        groups[r["set"], r["shape"]].append(r)
    print("| set | shape | frames | layer 1 ÷ today, % (series; frames) | layer 2 ÷ today, % | whole ÷ today | "
          "blocks split, % | layer 1 PSNR, dB (series; worst) | layer 1 max abs error | OpenJPEG: layer 1 · whole |")
    print("| --- | --- | --: | --- | --- | --- | --- | --- | --: | --- |")
    for (name, shape), g in groups.items():
        today = sum(r["today"] for r in g)
        l1 = [100 * (r["header"] + r["layer1"]) / r["today"] for r in g]
        l2 = [100 * r["layer2"] / r["today"] for r in g]
        whole = sum(r["total"] for r in g) / today
        split = 100 * sum(r["split"] for r in g) / max(1, sum(r["blocks"] for r in g))
        psnr = [r["psnr1"] for r in g if r["psnr1"] is not None]
        mses = [10 ** (-r["psnr1"] / 10) for r in g if r["psnr1"] is not None]
        series = 10 * np.log10(len(g) / sum(mses)) if mses else float("inf")
        opj1 = sum(1 for r in g if r["opj_l1"])
        full = {"exact": sum(1 for r in g if r["opj_full"] is True), "wrong": sum(1 for r in g if r["opj_full"] is False),
                "refused": sum(1 for r in g if r["opj_full"] is None)}
        full_s = ", ".join(f"{v} {k}" for k, v in full.items() if v)
        print(f"| `{name}` | {shape} | {len(g)} | {100 * sum(r['header'] + r['layer1'] for r in g) / today:.1f}; "
              f"{span(l1)} | {span(l2)} | ×{whole:.3f} | {split:.0f} | "
              f"{'∞' if not psnr else f'{series:.1f}; {min(psnr):.1f}'} | {max(r['maxabs1'] for r in g)} | "
              f"{opj1}/{len(g)} equal · {full_s} |")


if __name__ == "__main__":
    main()
