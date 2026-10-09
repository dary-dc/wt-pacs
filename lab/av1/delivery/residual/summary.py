#!/usr/bin/env python3
"""RESID's bytes per set and CRF, over the exact HTJ2K series': the preview alone, preview + HTJ2K
(row PREVIEW's variant: the exact frames sent whole after the preview), and preview + residual in HTJ2K
and in AV1 — the preview's net cost is the last two minus 1.

usage: summary.py OUT/manifest.json   — lab/av1/delivery/residual/README.md
"""
import json
import sys


def main():
    print("set\tCRF\tPSNR\tmax|Δ|\tresid bits\tpreview\t+HTJ2K\t+rHTJ2K\t+rAV1")
    for s in json.load(open(sys.argv[1])):
        h = sum(s["htj2k"])
        for c in s["cells"]:
            p = sum(c["preview"])
            ra = f"{(p + sum(c['resid_av1']['sizes'])) / h:.4f}" if c["resid_av1"] else "-"
            print(f"{s['name']}\t{c['crf']}\t{c['psnr_mean']}\t{c['max_abs']}\t{c['resid_bits']}\t{p / h:.4f}"
                  f"\t{(p + h) / h:.4f}\t{(p + sum(c['resid_htj2k'])) / h:.4f}\t{ra}")


if __name__ == "__main__":
    main()
