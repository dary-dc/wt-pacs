#!/usr/bin/env python3
"""Row GOPMEASURE's tables from gop.py's, rho.py's and arc.py's rows: ρ per series, bytes and gain by G per
encoder and preset, exact counts, and the predictions' deciding numbers. Gain is 1 − bytes(G) ÷ bytes(G = 1).

usage: report.py WORK   — README.md here
"""
import json
import sys
from pathlib import Path

import numpy as np


def rows(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []


def spearman(x, y):
    rx, ry = (np.argsort(np.argsort(v)).astype(float) for v in (x, y))
    return float(np.corrcoef(rx, ry)[0, 1])


def ask(ms, g):
    """An ask at frame k of a group decodes the group's frames 0 … k: the mean over k and the run's groups (time.mjs)."""
    costs = []
    for a in range(0, len(ms), g):
        costs += list(np.cumsum(ms[a:a + g]))
    return float(np.mean(costs))


def timing(work, cells, htj2k):
    """Rule §5.1's third test at 4×: the mean ask against one HTJ2K frame plus the wire time its saved bytes buy."""
    path = work / "time.json"
    if not path.exists():
        return
    runs = json.loads(path.read_text())
    print("\n## mean ask, ms: median over rounds [range], n; and the rule's bound at 20 Mbit/s")
    for throttle in sorted({r["throttle"] for r in runs}):
        for s in sorted({r["set"] for r in runs}):
            per = {}
            for r in runs:
                if r["throttle"] == throttle and r["set"] == s and len(r["ms"]) == r["frames"] == r["exact"]:
                    per.setdefault(r["variant"], []).append(ask(r["ms"], r["g"]))
            ref = float(np.median(per["htj2k"]))
            parts = []
            for variant, v in sorted(per.items(), key=lambda kv: (kv[0].split("-")[0], int(kv[0].split("g")[-1]) if "-g" in kv[0] else 0)):
                part = f"{variant} {np.median(v):.1f} [{min(v):.1f}–{max(v):.1f}] n={len(v)}"
                g = int(variant.split("-g")[1]) if "-g" in variant else 0
                if g:
                    base = cells[(s, "aom", "good:6", "optimized", False, 1)]
                    top = cells[(s, "aom", "good:6", "optimized", False, g)]["streams"][0]
                    saved = (htj2k[s]["bytes"] - top - sum(base["streams"][1:])) / base["frames"]
                    bound = ref + saved * 8 / 20e6 * 1e3
                    part += f" (bound {bound:.1f}: {'within' if np.median(v) <= bound else 'over'})"
                parts.append(part)
            print(f"{throttle}x {s}: " + " · ".join(parts))


def main():
    work = Path(sys.argv[1])
    rho = {r["set"]: r for r in rows(work / "rho.jsonl")}
    arc = {}
    for r in rows(work / "arc.jsonl"):
        arc[r["set"]] = {k.rsplit(".", 1)[-1]: v for k, v in r.items()}
    coded = rows(work / "bytes.jsonl")
    htj2k = {r["set"]: r for r in coded if r["encoder"] == "htj2k" and r["exact"]}
    cells = {}
    for r in coded:
        if r["encoder"] != "htj2k":
            cells[(r["set"], r["encoder"], r["preset"], r["representation"], r["altref"], r["group"])] = r

    print("## ρ, top stream: best offset median [p10–p90] · offset 0 median; low stream: best · offset 0; scan arc")
    for s in sorted(rho):
        r, a = rho[s], arc.get(s, {})
        t, lo = r["top"], r["low"]
        print(f"{s} pairs {r['pairs']} blocks {t['blocks']}: top {t['best']['median']:.3f} [{t['best']['p10']:.3f}–{t['best']['p90']:.3f}]"
              f" · {t['zero']['median']:.3f} [{t['zero']['p10']:.3f}–{t['zero']['p90']:.3f}]; low {lo['best']['median']:.3f}"
              f" [{lo['best']['p10']:.3f}–{lo['best']['p90']:.3f}] · {lo['zero']['median']:.3f}; arc {a.get('scanArc', 'not recorded')}")
    for system in "abc":
        med = [rho[s]["top"]["best"]["median"] for s in rho if s.startswith(f"dbts_{system}")]
        if med:
            print(f"system {system.upper()}: median of series medians {np.median(med):.3f}, range {min(med):.3f}–{max(med):.3f}, n {len(med)}")

    gains = {}
    for (s, enc, preset, rep, altref, g), r in sorted(cells.items()):
        base = cells.get((s, enc, preset, rep, False, 1))
        if g == 1 or not base or not base["exact"]:
            continue
        if not r["exact"]:
            gains[(s, enc, preset, rep, altref, g)] = None
            continue
        gains[(s, enc, preset, rep, altref, g)] = dict(
            sum=1 - r["bytes"] / base["bytes"],
            top=1 - r["streams"][0] / base["streams"][0],
            low=1 - r["streams"][1] / base["streams"][1] if len(r["streams"]) > 1 else None,
            product=1 - (r["streams"][0] + sum(base["streams"][1:])) / base["bytes"])

    print("\n## bytes by G: gain of the sum (both streams at G) · top · low · product shape (top at G, low intra); x = inexact")
    configs = sorted({k[1:5] for k in gains})
    for enc, preset, rep, altref in configs:
        print(f"\n### {enc} {preset} {rep}{' alt-ref on' if altref else ''}")
        for s in sorted({k[0] for k in gains if k[1:5] == (enc, preset, rep, altref)}):
            base = cells[(s, enc, preset, rep, False, 1)]
            parts = []
            for g in sorted(k[5] for k in gains if k[0] == s and k[1:5] == (enc, preset, rep, altref)):
                x = gains[(s, enc, preset, rep, altref, g)]
                r = cells[(s, enc, preset, rep, altref, g)]
                if x is None:
                    parts.append(f"G{g} x({r.get('exact_n', 0)}/{r['frames']})")
                else:
                    low = f"{x['low']:+.2%}" if x["low"] is not None else "-"
                    parts.append(f"G{g} {x['sum']:+.2%} · {x['top']:+.2%} · {low} · {x['product']:+.2%}")
            h = htj2k.get(s)
            ratio = f", G1/HTJ2K {base['bytes'] / h['bytes']:.3f}" if h else ""
            print(f"{s}: G1 {base['bytes']} B (top {base['streams'][0]}, low {sum(base['streams'][1:])}){ratio}; " + "; ".join(parts))

    print("\n## the rule and the predictions, libaom optimized, alt-ref off; best G is over G ≤ 16 with G = 1 (gain 0) in")
    for preset in ("good:6", "cpu0"):
        best, best_inter = {}, {}
        for s in sorted({k[0] for k in gains if k[1:5] == ("aom", preset, "optimized", False)}):
            gs = {g: gains[(s, "aom", preset, "optimized", False, g)] for g in range(2, 17)
                  if gains.get((s, "aom", preset, "optimized", False, g))}
            if not gs:
                continue
            g, x = max(gs.items(), key=lambda kv: kv[1]["sum"])
            gp, xp = max(gs.items(), key=lambda kv: kv[1]["product"])
            best[s], best_inter[s] = max(0.0, x["sum"]), x["sum"]
            line = [f"{preset} {s}: gain {best[s]:+.2%} (best G > 1: G {g} {x['sum']:+.2%}; top alone {max(v['top'] for v in gs.values()):+.2%};"
                    f" top at G with low intra: G {gp} {xp['product']:+.2%})"]
            h = htj2k.get(s)
            if h:
                g1 = cells[(s, "aom", preset, "optimized", False, 1)]["bytes"]
                line.append(f"G1 / HTJ2K {g1 / h['bytes']:.3f}, best G > 1 / HTJ2K {cells[(s, 'aom', preset, 'optimized', False, g)]['bytes'] / h['bytes']:.3f}")
            later = [gs[k]["sum"] for k in gs if k >= 8]
            if 4 in gs and later:
                line.append(f"G2 {gs[2]['sum']:+.2%}, G4 {gs[4]['sum']:+.2%}, best G ≥ 8 − G4 {100 * (max(later) - gs[4]['sum']):+.2f} points")
            lows = [gs[k]["low"] for k in gs if gs[k]["low"] is not None]
            if lows:
                line.append(f"low stream's best inter vs intra {max(lows):+.2%}")
            print("; ".join(line))
        sets = [s for s in best if s in rho]
        if len(sets) >= 4:
            r = [rho[s]["top"]["best"]["median"] for s in sets]
            print(f"{preset}: Spearman(gain, ρ) over {len(sets)} series {spearman([best[s] for s in sets], r):+.3f};"
                  f" with the best G > 1's gain {spearman([best_inter[s] for s in sets], r):+.3f}")
    timing(work, cells, htj2k)
    arcs = {s: float(a["scanArc"]) for s, a in arc.items() if float(a.get("scanArc", 0)) > 0 and s in rho}
    if len(arcs) >= 4:
        print(f"Spearman(scan arc, ρ) over the {len(arcs)} series that record an arc:"
              f" {spearman(list(arcs.values()), [rho[s]['top']['best']['median'] for s in arcs]):+.3f}")
    for (s, enc, preset, rep, altref, g), x in sorted(gains.items()):
        if altref and x is not None:
            off = gains.get((s, enc, preset, rep, False, g))
            print(f"alt-ref on − off, {s} {preset} G{g}: {100 * (x['sum'] - off['sum']):+.2f} points")

if __name__ == "__main__":
    main()
