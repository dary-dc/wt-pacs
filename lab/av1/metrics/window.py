#!/usr/bin/env python3
"""Row WINDOWQ (docs/av1/window-q.md): the quality study's rows read against window width — what each Q's coding
error becomes in display levels as the reader narrows the window, and where it stays under one level.

usage: window.py ROWS.jsonl ... [--tsv OUT.tsv]
"""
import argparse
import math
import statistics
from collections import defaultdict

import numpy as np

import collect
import systems

QS, GS = (1, 2, 4, 8, 12, 16, 24), (1, 16)
SWEEP_12BIT = (4096, 2048, 1024, 512, 256, 128, 64)
FAMILIES = ("system A", "system B", "system C", "content 2 DBT, 10-bit", "content 2 DBT, 12-bit", "TRUS")


def sweep(b):
    return [w >> (12 - b) for w in SWEEP_12BIT]


def slope(win):
    """Display levels per source unit at the window's centre: PS3.3 C.11.2.1.2.1 LINEAR, and SIGMOID's derivative."""
    return 255 / win["width"] if win["function"] == "SIGMOID" else 255 / (win["width"] - 1)


def residual(e, laplace=False):
    """The in-window residual modelled as a zero-mean integer variable of RMS e: |j| and its probability."""
    j = np.arange(0, int(12 * e) + 3)
    p = np.exp(-j * math.sqrt(2) / e) if laplace else np.exp(-j * j / (2 * e * e))
    p = p * np.where(j == 0, 1, 2)
    return j, p / p.sum()


def moves(e, k, laplace=False):
    """Share moving ≥ 1 and ≥ 2 levels and the mean square level move, a source move j landing on floor(k·j) or
    one more with the fractional part's probability (uniform rounding phase, derived)."""
    j, p = residual(e, laplace) if e > 0 else (np.zeros(1), np.ones(1))
    x = np.multiply.outer(np.atleast_1d(k), j)
    f, r = np.floor(x), x - np.floor(x)
    ge = [(p * np.clip(x - n + 1, 0, 1)).sum(-1) for n in (1, 2)]
    return ge[0], ge[1], (p * (f * f * (1 - r) + (f + 1) ** 2 * r)).sum(-1)


def frames(c):
    return [(math.sqrt(f["mse_in"]), f["err_noise_band"], f["max_abs"], f["codes"]) for f in c["frames"]]


def stored(series, cells):
    out = {}
    for name, s in series.items():
        form = f"{s['b']}bit"
        fam = systems.family(name)
        fam = f"{fam}, {s['b']}-bit" if fam == "content 2 DBT" else fam
        if fam in FAMILIES and all((name, form, q, g) in cells for q in QS for g in GS):
            out[name] = (fam, form)
    return out


def check(series, cells, chosen):
    """The model against the measured header windows, and the largest-move bound against every measured move."""
    err = defaultdict(lambda: defaultdict(list))
    over, over_floor, below = 0, 0, []
    for name, (fam, form) in chosen.items():
        wins = series[name]["windows"]
        for q in QS:
            for g in GS:
                for e, _, m, codes in frames(cells[(name, form, q, g)]):
                    for w, got in zip(wins, codes):
                        k = slope(w)
                        over += got["max"] > math.ceil(k * m)
                        over_floor += got["max"] > math.floor(k * m)
                        if not got["n"]:
                            continue
                        meas = (got["ge1"] / got["n"], got["ge2"] / got["n"])
                        if w["function"] == "SIGMOID":
                            below.append(meas[0] / moves(e, k)[0][0])
                            continue
                        for shape, lap in (("gaussian", False), ("laplacian", True)):
                            pred = moves(e, k, lap)
                            err[fam][shape].append(max(abs(pred[0][0] - meas[0]), abs(pred[1][0] - meas[1])))
                            err[fam][shape + f" Q{q}"].append(abs(pred[0][0] - meas[0]))
    return err, over, over_floor, below


def per_series(series, cells, controls, chosen):
    """Per (series, Q, G): the sweep, the header presets measured, and the narrowest widths."""
    rows = []
    for name, (fam, form) in chosen.items():
        s = series[name]
        sig = s["sigma"]
        for q in QS:
            for g in GS:
                c = cells[(name, form, q, g)]
                fr = frames(c)
                e = [f[0] for f in fr]
                r = dict(set=name, family=fam, form=form, b=s["b"], q=q, g=g,
                         en_sigma_max=max(f[1] / sg for f, sg in zip(fr, sig)),
                         w_rms=1 + 255 * max(e), w_max=1 + 255 * max(f[2] for f in fr),
                         w_sigma=1 + 255 * statistics.median(sig), presets=[], sweep=[],
                         of_htj2k=sum(c["units"]) / controls[name]["htj2k"], jod=(c["vdp"] or {}).get("jod"))
                for w in sweep(s["b"]):
                    k = 255 / (w - 1)
                    got = [moves(x, k) for x in e]
                    psnr = [10 * math.log10(255 ** 2 / ms[0]) if ms[0] > 0 else math.inf for _, _, ms in got]
                    r["sweep"].append(dict(
                        w=w, psnr_med=statistics.median(psnr), psnr_min=min(psnr),
                        psnr_formula_med=statistics.median(20 * math.log10((w - 1) / x) for x in e),
                        ge1_med=statistics.median(a[0] for a, _, _ in got), ge1_max=max(a[0] for a, _, _ in got),
                        ge2_med=statistics.median(b_[0] for _, b_, _ in got), ge2_max=max(b_[0] for _, b_, _ in got),
                        max_bound=max(math.ceil(k * f[2]) for f in fr),
                        sigma_levels=k * statistics.median(sig), en_levels=k * statistics.median(f[1] for f in fr)))
                for i, w in enumerate(s["windows"]):
                    got = [f[3][i] for f in fr if f[3][i]["n"]]
                    r["presets"].append(dict(
                        w=w["width"], function=w["function"],
                        ge1_med=statistics.median(c["ge1"] / c["n"] for c in got),
                        ge1_max=max(c["ge1"] / c["n"] for c in got),
                        ge2_med=statistics.median(c["ge2"] / c["n"] for c in got),
                        ge2_max=max(c["ge2"] / c["n"] for c in got), max=max(c["max"] for c in got),
                        rms_levels_max=slope(w) * max(e), sigma_levels=slope(w) * statistics.median(sig),
                        en_levels=slope(w) * statistics.median(f[1] for f in fr)))
                rows.append(r)
    return rows


def report_check(err, over, over_floor, below):
    print("### Check: the residual model against the measured header windows\n")
    print("| family (linear windows) | model | frames × windows | largest error, share ≥ 1 or ≥ 2 | median error |")
    print("| --- | --- | --: | --: | --: |")
    for fam in FAMILIES:
        for shape in ("gaussian", "laplacian"):
            v = err[fam].get(shape)
            if v:
                print(f"| {fam} | {shape} | {len(v)} | {max(v):.3f} | {statistics.median(v):.4f} |")
    print("\n| family | Q 1 | Q 2 | Q 4 | Q 8 | Q 12 | Q 16 | Q 24 |  (largest error, share ≥ 1, gaussian)")
    print("| --- | --: | --: | --: | --: | --: | --: | --: |")
    for fam in FAMILIES:
        if err[fam].get("gaussian"):
            print(f"| {fam} | " + " | ".join(f"{max(err[fam][f'gaussian Q{q}']):.3f}" for q in QS) + " |")
    print(f"\nSigmoid presets: measured share ≥ 1 ÷ the centre-slope prediction is at most 1 on "
          f"{sum(x <= 1 for x in below)} of {len(below)} frame × window readings; "
          f"{min(below):.2f}–{max(below):.2f}, median {statistics.median(below):.2f}.")
    print(f"Largest move above ⌈k · max|Δ|⌉: {over} readings; with ⌊k · max|Δ|⌋ (the mutation): {over_floor}.\n")


def fam_rows(rows, fam, g):
    return [r for r in rows if r["family"] == fam and r["g"] == g]


def report_sweep(rows):
    print("\n### The sweep: linear windows at the frame's median level, W in source units"
          " (12-bit; 10-bit ÷ 4, 8-bit ÷ 16)\n")
    for title, key in (("Display PSNR from the codes, dB", "psnr"), ("Share moving ≥ 1 level", "ge1"),
                       ("Share moving ≥ 2 levels", "ge2"), ("20 log10((W − 1) ÷ e), dB, median", "formula")):
        print(f"\n**{title}**: median series' median frame · worst series' worst frame\n")
        print("| family | G | Q | " + " | ".join(f"W {w}" for w in SWEEP_12BIT) + " |")
        print("| --- | --: | --: |" + " --- |" * len(SWEEP_12BIT))
        for fam in FAMILIES:
            for g in GS:
                for q in QS:
                    rq = [r for r in fam_rows(rows, fam, g) if r["q"] == q]
                    if rq:
                        print(f"| {fam} | {g} | {q} | " + " | ".join(
                            cell_text(key, [r["sweep"][i] for r in rq]) for i in range(len(SWEEP_12BIT))) + " |")


def cell_text(key, col):
    if key == "psnr":
        return f"{statistics.median(c['psnr_med'] for c in col):.1f} · {min(c['psnr_min'] for c in col):.1f}"
    if key == "formula":
        return f"{statistics.median(c['psnr_formula_med'] for c in col):.1f}"
    return f"{pc(statistics.median(c[key + '_med'] for c in col))} · {pc(max(c[key + '_max'] for c in col))}"


def pc(x):
    return f"{100 * x:.1f} %" if x >= 0.001 or x == 0 else "< 0.1 %"


def report_widths(rows):
    print("\n### The narrowest widths, per family: median (largest) over its series, source units\n")
    print("| family | G | Q | e_N ÷ σ ≤ 1, every frame | W where the RMS error = 1 level | W bound, no move ≥ 2 |"
          " W where σ = 1 level | presets with the RMS error under 1 level | bytes ÷ HTJ2K | JOD |")
    print("| --- | --: | --: | --- | --- | --- | --- | --- | --- | --- |")
    for fam in FAMILIES:
        for g in GS:
            rs = fam_rows(rows, fam, g)
            for q in QS:
                rq = [r for r in rs if r["q"] == q]
                if not rq:
                    continue
                held = sum(r["en_sigma_max"] <= 1 for r in rq)
                inside = sum(p["rms_levels_max"] < 1 for r in rq for p in r["presets"])
                total = sum(len(r["presets"]) for r in rq)
                print(f"| {fam} | {g} | {q} | {held} of {len(rq)} | {span(r['w_rms'] for r in rq)} | "
                      f"{span(r['w_max'] for r in rq)} | {span(r['w_sigma'] for r in rq)} | {inside} of {total} | "
                      f"{statistics.median(r['of_htj2k'] for r in rq):.3f} | {jods(rq)} |")


def jods(rq):
    j = [r["jod"] for r in rq if r["jod"] is not None]
    return f"{min(j):.2f}–{max(j):.2f}" if j else "—"


def span(v):
    v = list(v)
    return f"{statistics.median(v):.0f} ({max(v):.0f})"


def report_presets(rows):
    print("\n### The header presets, measured (the rows' own window counts), per family, G 1 and 16\n")
    print("| family | G | Q | presets, W | ≥ 1 level, med · worst | ≥ 2 levels, med · worst | largest move |"
          " RMS error in levels, worst frame | σ · e_N in levels, median |")
    print("| --- | --: | --: | --- | --- | --- | --: | --- | --- |")
    for fam in FAMILIES:
        for g in GS:
            for q in QS:
                rq = [r for r in fam_rows(rows, fam, g) if r["q"] == q]
                ps = [p for r in rq for p in r["presets"]]
                if not ps:
                    continue
                ws = sorted({int(p["w"]) for p in ps})
                fn = "/".join(sorted({p["function"].lower() for p in ps}))
                print(f"| {fam} | {g} | {q} | {ws[0]}–{ws[-1]} {fn} | "
                      f"{pc(statistics.median(p['ge1_med'] for p in ps))} · {pc(max(p['ge1_max'] for p in ps))} | "
                      f"{pc(statistics.median(p['ge2_med'] for p in ps))} · {pc(max(p['ge2_max'] for p in ps))} | "
                      f"{max(p['max'] for p in ps)} | "
                      f"{min(p['rms_levels_max'] for p in ps):.2f}–{max(p['rms_levels_max'] for p in ps):.2f} | "
                      f"{statistics.median(p['sigma_levels'] for p in ps):.1f} · "
                      f"{statistics.median(p['en_levels'] for p in ps):.1f} |")


def report_exact(rows, q=8, levels=(1, 2, 4, 8)):
    """Per family, the window width below which Q's worst-frame RMS error exceeds X display levels."""
    print(f"\n### Q {q}: the width below which the RMS error exceeds X levels (largest over the family's series)\n")
    print("| family | G | " + " | ".join(f"X = {x}" for x in levels) + " | header presets past X, at X = 1 · 2 · 4 · 8 |")
    print("| --- | --: |" + " --: |" * len(levels) + " --- |")
    for fam in FAMILIES:
        for g in GS:
            rq = [r for r in fam_rows(rows, fam, g) if r["q"] == q]
            if not rq:
                continue
            widths = [1 + (max(r["w_rms"] for r in rq) - 1) / x for x in levels]
            ps = [p for r in rq for p in r["presets"]]
            fires = [sum(p["rms_levels_max"] > x for p in ps) for x in levels]
            print(f"| {fam} | {g} | " + " | ".join(f"{w:.0f}" for w in widths) + " | "
                  + " · ".join(f"{n} of {len(ps)}" for n in fires) + " |")


def tsv(rows, path):
    keys = ("w", "psnr_med", "psnr_min", "psnr_formula_med", "ge1_med", "ge1_max", "ge2_med", "ge2_max", "max_bound",
            "sigma_levels", "en_levels")
    with open(path, "w") as fh:
        print("set\tfamily\tform\tg\tq\t" + "\t".join(keys) + "\ten_sigma_max\tw_rms\tw_max", file=fh)
        for r in rows:
            for sw in r["sweep"]:
                vals = "\t".join(f"{sw[k]:.4g}" for k in keys)
                print(f"{r['set']}\t{r['family']}\t{r['form']}\t{r['g']}\t{r['q']}\t{vals}\t"
                      f"{r['en_sigma_max']:.4g}\t{r['w_rms']:.0f}\t{r['w_max']:.0f}", file=fh)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("rows", nargs="+")
    ap.add_argument("--tsv")
    a = ap.parse_args()
    series, cells, controls = collect.load(a.rows)
    chosen = stored(series, cells)
    report_check(*check(series, cells, chosen))
    rows = per_series(series, cells, controls, chosen)
    report_widths(rows)
    report_presets(rows)
    report_exact(rows)
    report_sweep(rows)
    if a.tsv:
        tsv(rows, a.tsv)


if __name__ == "__main__":
    main()
