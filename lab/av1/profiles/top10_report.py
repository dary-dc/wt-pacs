#!/usr/bin/env python3
"""top10.md's tables from results/top10.jsonl: each form's bytes over the 12-bit stream's at equal Q and at equal
quality, and the comparison's own mutations.

usage: top10_report.py results/top10.jsonl
"""
import json
import math
import sys
from collections import defaultdict


def at_equal(curve, quality):
    """ln bytes linear in quality between the two rungs that bracket it; None outside the curve."""
    pts = sorted(curve)
    for (q0, b0), (q1, b1) in zip(pts, pts[1:]):
        if q0 <= quality <= q1:
            t = 0 if q1 == q0 else (quality - q0) / (q1 - q0)
            return math.exp(math.log(b0) + t * (math.log(b1) - math.log(b0)))
    return None


def ratios(rows, form, ref, metric, scale=1.0, shift=0.0):
    """{Q: (bytes(form) ÷ bytes(ref) at ref's Q's quality, at equal Q)} for one (set, G, arm)."""
    a = {r["q"]: r for r in rows if r["form"] == form}
    b = {r["q"]: r for r in rows if r["form"] == ref}
    curve = [(r[metric] + shift, r["lossy"] * scale) for r in a.values()]
    out = {}
    for q, r in sorted(b.items()):
        eq = at_equal(curve, r[metric])
        out[q] = (None if eq is None else eq / r["lossy"],
                  a[q]["lossy"] * scale / r["lossy"] if q in a else None,
                  a[q][metric] + shift - r[metric] if q in a else None)
    return out


def fmt(x, d=3):
    return "—" if x is None else f"{x:.{d}f}"


def main():
    rows = [json.loads(line) for line in open(sys.argv[1])]
    groups = defaultdict(list)
    for r in rows:
        groups[(r["set"], r["g"], r["arm"])].append(r)
    metrics = ["psnr", "psnr_in", "ssim"]
    print("| set | G | arm | form | Q | 12-bit PSNR | Δ PSNR at equal Q (dB) | ÷ 12-bit at equal Q | "
          "÷ 12-bit at equal PSNR · in-window PSNR · SSIM |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for (s, g, arm), rs in sorted(groups.items()):
        ref = {r["q"]: r for r in rs if r["form"] == "12bit"}
        for form in ("top10", "top10at12"):
            if not any(r["form"] == form for r in rs):
                continue
            per = {m: ratios(rs, form, "12bit", m) for m in metrics if all(m in r for r in rs)}
            for q in sorted(ref):
                eqq, dq = per["psnr"][q][1], per["psnr"][q][2]
                eqs = " · ".join(fmt(per[m][q][0]) for m in metrics if m in per)
                print(f"| `{s}` | {g} | {arm} | {form} | {q} | {ref[q]['psnr']:.2f} | {fmt(dq, 2)} | {fmt(eqq)} | {eqs} |")
    print()
    print("Every (arm, form) ÷ the stock 12-bit stream at equal PSNR, at the stock 12-bit stream's PSNR at each Q:")
    print()
    print("| set | G | arm, form | " + " | ".join(f"Q {q}" for q in (12, 16, 20, 24, 32)) + " |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for (s, g, arm), rs in sorted(groups.items()):
        base = groups.get((s, g, "base"), [])
        ref = {r["q"]: r for r in base if r["form"] == "12bit"}
        for form in sorted({r["form"] for r in rs}):
            curve = [(r["psnr"], r["lossy"]) for r in rs if r["form"] == form]
            cells = [fmt(at_equal(curve, ref[q]["psnr"]) / ref[q]["lossy"]) if q in ref and
                     at_equal(curve, ref[q]["psnr"]) else "—" for q in (12, 16, 20, 24, 32)]
            print(f"| `{s}` | {g} | {arm}, {form} | " + " | ".join(cells) + " |")
    print()
    print("Mutations of the comparison (dbts_a1, G 1, base arm, at the 12-bit stream's Q 16 PSNR):")
    rs = groups[("dbts_a1", 1, "base")]
    print("* 12-bit against itself:", fmt(ratios(rs, "12bit", "12bit", "psnr")[16][0], 4))
    print("* 12-bit with its bytes planted × 1.10, against itself:",
          fmt(ratios(rs, "12bit", "12bit", "psnr", scale=1.10)[16][0], 4))
    print("* top10 as measured:", fmt(ratios(rs, "top10", "12bit", "psnr")[16][0], 4))
    print("* top10 with its PSNR planted + 0.30 dB:", fmt(ratios(rs, "top10", "12bit", "psnr", shift=0.30)[16][0], 4))
    print("* top10 with its PSNR planted − 0.30 dB:", fmt(ratios(rs, "top10", "12bit", "psnr", shift=-0.30)[16][0], 4))


if __name__ == "__main__":
    main()
