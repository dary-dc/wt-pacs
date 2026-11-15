#!/usr/bin/env python3
"""Row PREVIEWDEPTH's measured section (preview-depth.md §Preview depth, measured): P1–P7 and §6's verdict per
group, window width and Q, read from the runner's rows and preview_depth_report.py's comparisons.

usage: preview_depth_verdict.py ROWS.jsonl [--pilot PILOT.jsonl]
"""
import argparse
import json
import math
from collections import defaultdict

import numpy as np

from preview_depth_report import compare

GROUPS = {"A": [f"dbts_a{i}" for i in range(1, 6)], "B": [f"dbts_b{i}" for i in range(1, 6)],
          "C": [f"dbts_c{i}" for i in range(1, 6)], "content 2, 12-bit": ["dbt12_ea1141", "dbt12_c"],
          "content 2, 10-bit": ["dbt10_ea1141", "dbt10_d"], "rf_fluoro": ["rf_fluoro"], "mr_ispy1": ["mr_ispy1"]}
SYSTEMS = ("A", "B", "C")
WIDTHS = (32, 64, 128, 256, 512, 1024)
CUT_MOVED = {32: 0.75, 64: 0.75, 128: 0.75, 256: 0.75, 512: 0.50, 1024: 0.25}
ERROR_MEASURES = ("ge1", "ge2", "ge4", "max", "ssim")
P5_MEASURES = ("ge1", "ge2", "ge4", "ssim")
P6_BAND = {"A": (0.9, 1.1), "C": (0.9, 1.1), "B": (1.0, 1.2)}


def group_of(name):
    return next(g for g, sets in GROUPS.items() if name in sets)


def load(path):
    series, cells = {}, defaultdict(list)
    for line in open(path):
        r = json.loads(line)
        if r["kind"] == "series":
            series[r["set"]] = r
        elif r["kind"] == "cell":
            cells[r["set"]].append(r)
    return series, cells


def width_key(r):
    return "presets" if r["source"] == "header" else int(r["width"])


def pct(x):
    return "–" if x is None else f"{100 * x:.0f} %"


def host(cells):
    flat = [c for cs in cells.values() for c in cs]
    enc, wall = sum(c["encode_cpu"] for c in flat), sum(c["cell_wall"] for c in flat)
    print(f"cells {len(flat)}; encode CPU {enc:.0f} s; cell wall summed {wall:.0f} s; "
          f"encode CPU ÷ cell wall {enc / wall:.2f}; Mpx·cells {sum(c['mpx'] for c in flat):.0f}")


def determinism(cells, pilot):
    _, ref = load(pilot)
    for name, rc in ref.items():
        mine = {(c["arm"], c["q"]): c["units"] for c in cells.get(name, [])}
        same = sum(mine.get((c["arm"], c["q"])) == c["units"] for c in rc)
        print(f"determinism {name}: {same} of {len(rc)} pilot cells byte-identical, unit for unit")


def p1(series, cells):
    print("\n### P1 · inner levels, reduced arm, sweep windows: bound ⌊W ÷ 4⌋ + 1 (cap 254)\n")
    print("| set | " + " | ".join(f"W {w}: max · bound" for w in WIDTHS) + " | over bound | presets full · reduced |")
    print("| --- |" + " --: |" * len(WIDTHS) + " --: | --- |")
    for name, s in series.items():
        worst, over = defaultdict(int), 0
        presets = []
        for c in cells[name]:
            for w, st in zip(s["windows"], c["windows"]):
                if w["source"] == "header":
                    if c["arm"] == "reduced":
                        presets.append(st["levels_lossy"])
                    continue
                if c["arm"] != "reduced":
                    continue
                bound = min(int(w["width"]) // 4 + 1, 254)
                worst[int(w["width"])] = max(worst[int(w["width"])], st["levels_lossy"])
                over += st["levels_lossy"] > bound
        full_presets = [st["levels_lossy"] for c in cells[name] if c["arm"] == "full"
                        for w, st in zip(s["windows"], c["windows"]) if w["source"] == "header"]
        row = " | ".join(f"{worst[w]} · {min(w // 4 + 1, 254)}" for w in WIDTHS)
        rng = lambda v: f"{min(v)}–{max(v)}" if v else "–"
        print(f"| {name} | {row} | {over} | {rng(full_presets)} · {rng(presets)} |")


def p2(series):
    print("\n### P2 · the depth cut alone, share of shown samples moved ≥ 1 level: median (range) over the sweep windows"
          " showing ≥ 1 % of the samples, as §8 reads it; largest move against ⌈2 × 255 ÷ W⌉ + 1\n")
    print("| set | " + " | ".join(f"W {w} (pred {CUT_MOVED[w]:.2f})" for w in WIDTHS) + " | outside ± 0.03 |")
    print("| --- |" + " --: |" * len(WIDTHS) + " --- |")
    for name, s in series.items():
        total = max(d["n"] for d in s["depth_cut"]) or 1
        cells_, misses = [], []
        for w in WIDTHS:
            pairs = [d for win, d in zip(s["windows"], s["depth_cut"])
                     if win["source"] == "sweep" and int(win["width"]) == w and d["n"] >= 0.01 * total]
            if not pairs:
                cells_.append("–")
                continue
            shares = [d["ge1"] / d["n"] for d in pairs]
            share = float(np.median(shares))
            mx, pred = max(d["max"] for d in pairs), math.ceil(2 * 255 / w) + 1
            cells_.append(f"{share:.3f} ({min(shares):.2f}–{max(shares):.2f}), max {mx} {'≤' if mx <= pred else '>'} {pred}")
            if abs(share - CUT_MOVED[w]) > 0.03:
                misses.append(str(w))
        print(f"| {name} | " + " | ".join(cells_) + f" | {', '.join(misses) or 'none'} |")


def sigma_out(series, cells):
    qs = sorted({c["q"] for cs in cells.values() for c in cs})
    print("\n### σ_out, full · reduced, source units (read as a number from 4 up)\n")
    print("| set | σ | " + " | ".join(f"Q {q}" for q in qs) + " | first Q σ_out < 2, full · reduced |")
    print("| --- | --: |" + " --: |" * len(qs) + " --- |")
    for name, s in series.items():
        by = {(c["arm"], c["q"]): c["sigma_out"] for c in cells[name]}
        first = [next((q for q in qs if by.get((a, q), 99) < 2), "–") for a in ("full", "reduced")]
        print(f"| {name} | {s['sigma']:.1f} | " + " | ".join(
            f"{by.get(('full', q), math.nan):.1f} · {by.get(('reduced', q), math.nan):.1f}" for q in qs)
              + f" | {first[0]} · {first[1]} |")


def p5(rows):
    print("\n### P5 · share of windows 'same' at equal bytes, Q ≥ 8 (windows with a bracketed reading)\n")
    print("| set | " + " | ".join(P5_MEASURES) + " | not bracketed | under 90 % |")
    print("| --- |" + " --: |" * len(P5_MEASURES) + " --: | --- |")
    by = defaultdict(lambda: defaultdict(list))
    for r in rows:
        if r["q"] >= 8 and r["measure"] in P5_MEASURES:
            by[r["set"]][r["measure"]].append(r["equal_bytes"])
    for name, ms in by.items():
        shares = {m: (sum(v == "same" for v in vs if v) / max(1, sum(1 for v in vs if v))) for m, vs in ms.items()}
        na = sum(v is None for vs in ms.values() for v in vs)
        under = [m for m, x in shares.items() if x < 0.9]
        print(f"| {name} | " + " | ".join(pct(shares.get(m)) for m in P5_MEASURES)
              + f" | {na} | {', '.join(under) or 'none'} |")


def p6(rows):
    print("\n### P6 · bytes at equal in-window SSIM, reduced ÷ full: median over probe windows\n")
    qs = sorted({r["q"] for r in rows})
    print("| group | band | all Q | " + " | ".join(f"Q {q}" for q in qs) + " | n |")
    print("| --- | --- | --: |" + " --: |" * len(qs) + " --: |")
    for g in GROUPS:
        rs = [r for r in rows if r["measure"] == "ssim" and group_of(r["set"]) == g and r["bytes_ratio"]]
        med = lambda v: f"{np.median(v):.2f}" if v else "–"
        band = P6_BAND.get(g)
        print(f"| {g} | {'–' if not band else f'{band[0]}–{band[1]}'} | {med([r['bytes_ratio'] for r in rs])} | "
              + " | ".join(med([r["bytes_ratio"] for r in rs if r["q"] == q]) for q in qs) + f" | {len(rs)} |")


def p7(rows):
    print("\n### P7 · share of (window, Q) comparisons 'reduced worse' at equal bytes, by system\n")
    print("| measure | A | B | C | separates | B ≥ A and C |")
    print("| --- | --: | --: | --: | --- | --- |")
    for m in ("ge1", "ge2", "ge4", "max", "levels", "ssim"):
        share = {}
        for g in SYSTEMS:
            v = [r["equal_bytes"] for r in rows if r["measure"] == m and group_of(r["set"]) == g and r["equal_bytes"]]
            share[g] = sum(x == "reduced worse" for x in v) / len(v) if v else None
        sep = any(share[g] for g in SYSTEMS)
        ok = None if None in share.values() else share["B"] >= share["A"] and share["B"] >= share["C"]
        print(f"| {m} | " + " | ".join(pct(share[g]) for g in SYSTEMS) + f" | {'yes' if sep else 'no'} | "
              + ("–" if not sep or ok is None else "yes" if ok else "**no**") + " |")


def verdicts(rows):
    print("\n### §6 verdict per group × width × Q: share of windows that *show what the full-depth preview shows* "
          "(every measure but the level count 'same' at equal bytes) · *lose detail* (SSIM 'reduced worse' at equal "
          "bytes); banding not run\n")
    by = defaultdict(lambda: defaultdict(dict))
    for r in rows:
        if r["measure"] in ERROR_MEASURES:
            by[(group_of(r["set"]), width_key(r), r["q"])][(r["set"], r["window"])][r["measure"]] = r["equal_bytes"]
    qs = sorted({r["q"] for r in rows})
    for g in GROUPS:
        print(f"\n**{g}** — shows · loses detail · windows (n/a: no bracketed reading)\n")
        print("| width | " + " | ".join(f"Q {q}" for q in qs) + " |")
        print("| --- |" + " --- |" * len(qs))
        for w in (*WIDTHS, "presets"):
            out = []
            for q in qs:
                wins = by.get((g, w, q))
                if not wins:
                    out.append("–")
                    continue
                read = [v for v in wins.values() if None not in v.values()]
                shows = sum(all(x == "same" for x in v.values()) for v in read)
                loses = sum(v.get("ssim") == "reduced worse" for v in read)
                out.append(f"{pct(shows / len(read)) if read else 'n/a'} · {loses} · {len(read)}"
                           + (f" ({len(wins) - len(read)} n/a)" if len(wins) > len(read) else ""))
            print(f"| {w} | " + " | ".join(out) + " |")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("rows")
    ap.add_argument("--pilot")
    a = ap.parse_args()
    series, cells = load(a.rows)
    series = {n: s for n, s in series.items() if len(cells[n]) == 16}
    host(cells)
    if a.pilot:
        determinism(cells, a.pilot)
    rows = [x for name in series for x in compare(series[name], cells[name])]
    p1(series, cells)
    p2(series)
    sigma_out(series, cells)
    p5(rows)
    p6(rows)
    p7(rows)
    verdicts(rows)


if __name__ == "__main__":
    main()
