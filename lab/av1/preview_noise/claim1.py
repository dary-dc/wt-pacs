#!/usr/bin/env python3
"""Claim 1 of docs/av1/preview-noise.md from METRICS' committed rows: per series σ₁₀, bpp, bytes ÷ HTJ2K, e_N ÷ σ,
PSNR and MS-SSIM at each Q; then the slopes and rank correlations its rule reads.

usage: claim1.py ROWS.jsonl ... [--g 1]
"""
import argparse
import json
import math
from collections import defaultdict

import numpy as np

QS = (4, 8, 32, 40, 56)
PROVISIONAL = {"usb_cine", "usb_cine_rgb"}
STORED = ("12bit", "10bit", "11bit", "9bit", "8bit", "rgb420")


def family(name):
    if name in PROVISIONAL:
        return "cine, lossy-sourced"
    for prefix, fam in (("dbts_a", "A"), ("dbts_b", "B"), ("dbts_c", "C"), ("dbt", "content-2 DBT"),
                        ("ustrus", "TRUS"), ("mr", "breast MR")):
        if name.startswith(prefix):
            return fam
    raise ValueError(name)


def load(paths):
    series, cells, htj2k = {}, {}, {}
    for p in paths:
        for line in open(p):
            r = json.loads(line)
            if r["kind"] == "series":
                series[r["set"]] = r
            elif r["kind"] == "cell" and r["form"] in STORED:
                cells[(r["set"], r["q"], r["g"])] = r
            elif r["kind"] == "control" and r["codec"] == "htj2k":
                htj2k[r["set"]] = sum(r["bytes"])
    return series, cells, htj2k


def reading(s, r, htj2k):
    peak = (1 << s["b"]) - 1
    sig = np.asarray(s["sigma"], float)
    f = r["frames"]
    psnr = [10 * math.log10(peak * peak / x["mse"]) for x in f]
    ms = [-10 * math.log10(max(1 - x["ms_ssim"], 1e-12)) for x in f]
    nb = np.asarray([x["err_noise_band"] for x in f]) / sig
    return dict(bpp=8 * sum(r["units"]) / (s["frames"] * s["width"] * s["height"] * s["channels"]),
                ratio=sum(r["units"]) / htj2k, nb=float(np.median(nb)), psnr=float(np.median(psnr)),
                ms=float(np.median(ms)), jod=(r.get("vdp") or {}).get("jod"))


def ranks(a):
    order = np.argsort(a, kind="stable")
    out = np.empty(len(a))
    out[order] = np.arange(len(a))
    return out


def spearman(x, y):
    return float(np.corrcoef(ranks(np.asarray(x)), ranks(np.asarray(y)))[0, 1])


def slope(x, y):
    return float(np.polyfit(x, y, 1)[0])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("rows", nargs="+")
    ap.add_argument("--g", type=int, default=1)
    a = ap.parse_args()
    series, cells, htj2k = load(a.rows)
    names = sorted({k[0] for k in cells}, key=lambda n: (family(n), n))
    table = {}
    print(f"## G {a.g}, stored form\n")
    print("| series | family | b | σ₁₀ | HTJ2K bpp | " + " | ".join(
        f"Q {q}: bpp · ÷ HTJ2K · e_N÷σ · PSNR · MS-SSIM dB · JOD" for q in QS) + " |")
    print("| --- | --- | --: | --: | --: |" + " --- |" * len(QS))
    for n in names:
        s = series[n]
        sig10 = float(np.median(s["sigma"])) * 1023 / ((1 << s["b"]) - 1)
        px = s["frames"] * s["width"] * s["height"] * s["channels"]
        row = {q: reading(s, cells[(n, q, a.g)], htj2k[n]) for q in QS}
        table[n] = (sig10, row)
        cols = [f"{v['bpp']:.4f} · {v['ratio']:.4f} · {v['nb']:.3f} · {v['psnr']:.2f} · {v['ms']:.2f} · "
                + (f"{v['jod']:.2f}" if v["jod"] is not None else "—") for v in row.values()]
        print(f"| `{n}` | {family(n)} | {s['b']} | {sig10:.3f} | {8 * htj2k[n] / px:.3f} | " + " | ".join(cols) + " |")
    groups = {"DBT, all 14": lambda n: family(n) in ("A", "B", "C", "content-2 DBT"),
              "system C (5)": lambda n: family(n) == "C", "system B (4)": lambda n: family(n) == "B",
              "sound, all 18": lambda n: family(n) != "cine, lossy-sourced"}
    print("\n## Slope of bpp on log₂ σ₁₀ (bits a pixel per doubling), its ratio to Q 4's, and Spearman ρ(σ₁₀, ·)\n")
    print("| group | Q | slope bpp | ÷ Q 4's | ρ bpp | ρ bytes ÷ HTJ2K | ρ e_N÷σ | ρ PSNR | ρ MS-SSIM dB |")
    print("| --- | --: | --: | --: | --: | --: | --: | --: | --: |")
    for gname, keep in groups.items():
        ns = [n for n in names if keep(n)]
        x = np.log2([table[n][0] for n in ns])
        s4 = slope(x, [table[n][1][4]["bpp"] for n in ns])
        for q in QS:
            col = lambda k: [table[n][1][q][k] for n in ns]
            sq = slope(x, col("bpp"))
            sig = [table[n][0] for n in ns]
            print(f"| {gname} | {q} | {sq:+.4f} | {sq / s4:+.3f} | {spearman(sig, col('bpp')):+.2f} | "
                  f"{spearman(sig, col('ratio')):+.2f} | {spearman(sig, col('nb')):+.2f} | "
                  f"{spearman(sig, col('psnr')):+.2f} | {spearman(sig, col('ms')):+.2f} |")


if __name__ == "__main__":
    main()
