#!/usr/bin/env python3
"""DEPTH8-MEASURE's report: every row of measure.py against docs/av1/depth-cut-8.md §7's predictions P1–P6.

usage: report.py ROWS_DIR QUANT_COMMON_C STAGE_A.jsonl [STAGE_B.jsonl]    (ROWS_DIR: the study's shards, as theory.py)
"""
import json
import math
import sys
from pathlib import Path

import theory

BARS = (1.00, 1.03)


def load(path):
    rows = [json.loads(r) for r in open(path)]
    series = {r["set"]: r for r in rows if r["kind"] == "series"}
    return series, [r for r in rows if r["kind"] != "series"]


def ratios(row, sigma):
    return [f["err_noise_band"] / s for f, s in zip(row["frames"], sigma)]


def today(b):
    return "top10" if b > 10 else f"{b}bit"


def highest(cells, form, sigma, bar):
    """The highest Q passing the bar, and whether a failing Q above it was measured."""
    got = {c["q"]: max(ratios(c, sigma)) for c in cells if c["form"] == form}
    q = max((q for q, w in got.items() if w <= bar), default=None)
    return q, any(w > bar for p, w in got.items() if q is None or p > q)


def p1(row, sigma):
    r = theory.Theory.rounding(row["k"])
    dev = max(abs(f["err_noise_band"] / r - 1) for f in row["frames"])
    mean = max(abs(f["mean_err"]) for f in row["frames"])
    ratio = [f["err_noise_band"] / s for f, s in zip(row["frames"], sigma)]
    return (f"| `{row['set']}` | {r:.2f} | {min(ratio):.3f}–{max(ratio):.3f} | {100 * dev:.1f} % | "
            f"{mean:.3f} | {'hit' if dev <= 0.03 and mean < 0.5 else 'miss'} |")


def stage_a(t, series, rows, pred):
    out = ["### P1 · the cut alone", "",
           "| volume | r, source units | e_N ÷ σ, per frame | largest |e_N ÷ r − 1| | largest |mean error| | P1 |",
           "| --- | --: | --- | --: | --: | --- |"]
    out += [p1(r, series[r["set"]]["sigma"]) for r in rows if r["kind"] == "cut_only"]
    out += ["", "### P2 · the stacking (G 1, worst frame)", "",
            "| volume | Q | measured | removal | independent | in band ±0.03 | closer |", "| --- | --: | --: | --: | --: | --- | --- |"]
    closer = {}
    for s in series:
        b, sigma = series[s]["b"], series[s]["sigma"]
        for c in sorted((c for c in rows if c["kind"] == "cell" and c["set"] == s and c["form"] == "cut8"
                         and c["g"] == 1), key=lambda c: c["q"]):
            m = max(ratios(c, sigma))
            ind, rem = t.worst(s, b - 8, 8, c["q"], 1)
            near = "removal" if abs(m - rem) < abs(m - ind) else "independent"
            closer.setdefault(s, []).append(near)
            out.append(f"| `{s}` | {c['q']} | {m:.3f} | {rem:.3f} | {ind:.3f} | "
                       f"{'yes' if rem - 0.03 <= m <= ind + 0.03 else '**no**'} | {near} |")
    out += ["", "Closer model per volume (cells): " + "; ".join(
        f"`{s}` removal {v.count('removal')}, independent {v.count('independent')}" for s, v in closer.items()), ""]
    out += ["### P3 · the highest Q, and P4 · bytes (G 1)", "",
            "| volume | bar | cut8 measured | predicted (indep.–removal) | P3 | today measured | today predicted | "
            "cut8 ÷ today, bytes | predicted, widened | P4 |", "| --- | --: | --: | --- | --- | --: | --: | --: | --- | --- |"]
    for s in series:
        b, sigma = series[s]["b"], series[s]["sigma"]
        cells = [c for c in rows if c["kind"] == "cell" and c["set"] == s and c["g"] == 1]
        for bar in BARS:
            p = pred[s]["q"][f"g1_bar{bar:.2f}"]
            q8, shut8 = highest(cells, "cut8", sigma, bar)
            qt, shutt = highest(cells, today(b), sigma, bar)
            hit3 = q8 is not None and p["cut8_independent"] <= q8 <= p["cut8_removal"] and shut8
            size = {(c["form"], c["q"]): sum(c["units"]) for c in cells}
            ratio = size[("cut8", q8)] / size[(today(b), qt)] if q8 and qt else None
            band = None
            if p["bytes_today"] and all(p["bytes_cut8"]):
                lo, hi = sorted(x / p["bytes_today"] for x in p["bytes_cut8"])
                band = (0.9 * lo, hi)
            hit4 = "—" if bar != 1.00 or ratio is None or band is None else \
                ("hit" if band[0] <= ratio <= band[1] else "miss")
            out.append(f"| `{s}` | {bar:.2f} | {q8}{'' if shut8 else ' (no fail above)'} | "
                       f"{p['cut8_independent']}–{p['cut8_removal']} | {'hit' if hit3 else 'miss'} | "
                       f"{qt}{'' if shutt else ' (no fail above)'} | {p['today']} | "
                       f"{'—' if ratio is None else f'{ratio:.2f}'} | "
                       f"{'—' if band is None else f'{band[0]:.2f}–{band[1]:.2f}'} | {hit4} |")
    out += ["", "### P5 · the 4:2:0 cost (G 1)", "",
            "| volume | Q | largest |Δ e_N ÷ σ| | bytes 420 ÷ mono | chroma samples ≠ 128 | P5 |",
            "| --- | --: | --: | --: | --: | --- |"]
    for s in series:
        sigma = series[s]["sigma"]
        cells = {(c["form"], c["q"]): c for c in rows if c["kind"] == "cell" and c["set"] == s and c["g"] == 1}
        for (form, q), c in sorted(cells.items(), key=lambda kv: kv[0][1]):
            if form != "cut8-420" or ("cut8", q) not in cells:
                continue
            mono = cells[("cut8", q)]
            d = max(abs(a - m) for a, m in zip(ratios(c, sigma), ratios(mono, sigma)))
            r = sum(c["units"]) / sum(mono["units"])
            ok = d <= 0.01 and 1.001 <= r <= 1.02 and c["chroma_off"] == 0
            out.append(f"| `{s}` | {q} | {d:.4f} | {r:.4f} | {c['chroma_off']} | {'hit' if ok else 'miss'} |")
    out += ["", "### P6 · displayed levels, first window, each form at its highest Q under 1.00 (no verdict)", "",
            "| volume | form | Q | worst e_N ÷ σ | moved ≥ 1 | moved ≥ 2 | largest move | σ of its frame |",
            "| --- | --- | --: | --: | --: | --: | --: | --: |"]
    for s in series:
        b, sigma = series[s]["b"], series[s]["sigma"]
        cells = [c for c in rows if c["kind"] == "cell" and c["set"] == s and c["g"] == 1]
        for form in ("cut8", today(b)):
            q, _ = highest(cells, form, sigma, 1.00)
            c = next((c for c in cells if c["form"] == form and c["q"] == q), None)
            if c is None:
                continue
            first = [f["codes"][0] for f in c["frames"]]
            n = sum(m["n"] for m in first)
            top = max(range(len(first)), key=lambda i: first[i]["max"])
            out.append(f"| `{s}` | {form} | {q} | {max(ratios(c, sigma)):.3f} | {100 * sum(m['ge1'] for m in first) / n:.1f} % | "
                       f"{100 * sum(m['ge2'] for m in first) / n:.1f} % | {first[top]['max']} | {sigma[top]:.2f} |")
    return out


def stage_b(series, rows_a, rows_b):
    out = ["", "### Stage B · G 16", "",
           "| volume | form | Q | worst e_N ÷ σ | ≤ 1.00 | ≤ 1.03 | bytes | G 1 worst at the same Q |",
           "| --- | --- | --: | --: | --- | --- | --: | --: |"]
    for c in sorted((c for c in rows_b if c["kind"] == "cell"), key=lambda c: (c["set"], c["form"], c["q"])):
        sigma = series[c["set"]]["sigma"]
        w = max(ratios(c, sigma))
        g1 = next((max(ratios(a, sigma)) for a in rows_a if a["kind"] == "cell" and a["set"] == c["set"]
                   and a["form"] == c["form"] and a["q"] == c["q"] and a["g"] == 1), math.nan)
        out.append(f"| `{c['set']}` | {c['form']} | {c['q']} | {w:.3f} | {'yes' if w <= 1 else 'no'} | "
                   f"{'yes' if w <= 1.03 else 'no'} | {sum(c['units'])} | {g1:.3f} |")
    return out


def main(study_rows, quant_common, a_path, b_path=None):
    t = theory.Theory(*theory.load(study_rows), theory.ac_tables(Path(quant_common).read_text()))
    pred = {v["set"]: v for v in json.loads((Path(__file__).parent / "predictions.json").read_text())["volumes"]}
    series, rows_a = load(a_path)
    out = stage_a(t, series, rows_a, pred)
    if b_path:
        out += stage_b(series, rows_a, load(b_path)[1])
    print("\n".join(out))


if __name__ == "__main__":
    main(*sys.argv[1:])
