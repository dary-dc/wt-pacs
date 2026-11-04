#!/usr/bin/env python3
"""PROFILEBYTES' tables and P1–P9 from what run.sh wrote: README.md §Profiles bytes, measured.

usage: report.py WORK > tables.md
"""
import json
import math
import re
import statistics as st
import sys
from pathlib import Path

GS = (1, 8, 16, 0)
LOSSY = ("usb_cine", "usb_cine_rgb", "us_liver")
ROW100_RHO = dict(a1=0.112, a2=0.116, a3=0.109, a4=0.111, a5=0.125, b1=0.181, b2=0.189, b3=0.266, b4=0.228,
                  b5=0.215, c1=0.117, c2=0.117, c3=0.116, c4=0.118, c5=0.113)


def load(work):
    w = Path(work)
    cells = [json.loads(x) for x in (w / "cells.jsonl").open()]
    alt = [json.loads(x) for x in (w / "altref.jsonl").open()] if (w / "altref.jsonl").exists() else []
    lossless = {}
    for x in (w / "lossless.jsonl").open():
        name, codec, sizes = json.loads(x)
        lossless[(name, codec)] = sum(sizes)
    noise = {r["set"]: r["sigma"] for r in map(json.loads, (w / "noise.jsonl").open())} \
        if (w / "noise.jsonl").exists() else {}
    rho = {r["set"]: r["top"]["best"]["median"] for r in map(json.loads, (w / "rho.jsonl").open())} \
        if (w / "rho.jsonl").exists() else {}
    ROW100_RHO.update({k: v for k, v in rho.items()})
    by = {(c["set"], c["form"], c["q"], 0 if c["whole"] else c["g"]): c for c in cells}
    return cells, alt, lossless, noise, by


def primary(by, name):
    return next(f for (n, f, _, _) in by if n == name and f not in ("top10", "window"))


def is_dbt15(name):
    return re.fullmatch(r"dbts_[abc][1-5]", name) is not None


class Series:
    """One (series, form): its cells by (Q, G) and what is derived from them."""

    def __init__(self, name, form, by, ladder, sigma, htj2k):
        self.name, self.form, self.ladder, self.sigma, self.h = name, form, ladder, sigma, htj2k
        self.c = {(q, g): by[(name, form, q, g)] for q in ladder for g in GS if (name, form, q, g) in by}

    def lossy(self, q, g):
        return sum(self.c[(q, g)]["lossy"])

    def res(self, q, g):
        return sum(self.c[(q, g)]["residual"])

    def gain(self, q, g):
        return 100 * (1 - self.lossy(q, g) / self.lossy(q, 1))

    def rmse(self, q):
        return self.c[(q, 1)]["rmse"]

    def crossover(self):
        """Index into the ladder of the first rung whose intra RMSE reaches σ; len(ladder) if none does."""
        return next((i for i, q in enumerate(self.ladder) if self.rmse(q) >= self.sigma), len(self.ladder))

    def first_over(self, k):
        return next((q for q in self.ladder if self.rmse(q) >= k * self.sigma), None)

    def equal_psnr_gain(self, q, g=16):
        """G against G = 1 at G = 1's PSNR at rung q: log bytes linear in PSNR between G's adjacent rungs."""
        p1, b1 = self.c[(q, 1)]["psnr"], self.lossy(q, 1)
        pts = sorted((self.c[(r, g)]["psnr"], math.log(self.lossy(r, g))) for r in self.ladder)
        for (pa, la), (pb, lb) in zip(pts, pts[1:]):
            if pa <= p1 <= pb and pb > pa:
                return 100 * (1 - math.exp(la + (lb - la) * (p1 - pa) / (pb - pa)) / b1)
        return None

    def bend(self):
        """The interior rung where the slope of log bytes (G = 1) against PSNR changes most."""
        pts = [(self.c[(q, 1)]["psnr"], math.log(self.lossy(q, 1))) for q in self.ladder]
        slope = [(lb - la) / (pb - pa) for (pa, la), (pb, lb) in zip(pts, pts[1:])]
        change = [abs(b - a) for a, b in zip(slope, slope[1:])]
        return 1 + max(range(len(change)), key=change.__getitem__)


def fmt(x, n=1, sign=False):
    if x is None:
        return "—"
    if isinstance(x, float) and math.isinf(x):
        return "∞"
    return f"{x:+.{n}f}" if sign else f"{x:.{n}f}"


def table(head, rows):
    out = ["| " + " | ".join(head) + " |", "| " + " | ".join("---" for _ in head) + " |"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def gcol(s, q, f):
    return " · ".join(f(q, g) if (q, g) in s.c else "—" for g in GS)


def bytes_table(series):
    rows = []
    for s in series:
        for q in s.ladder:
            rows.append([f"`{s.name}` {s.form}", q,
                         gcol(s, q, lambda q, g: f"{s.lossy(q, g) / s.h:.4f}"),
                         gcol(s, q, lambda q, g: fmt(s.gain(q, g), 1, True) if g != 1 else "0"),
                         gcol(s, q, lambda q, g: f"{s.res(q, g) / s.h:.3f}"),
                         gcol(s, q, lambda q, g: f"{(s.lossy(q, g) + s.res(q, g)) / s.h:.3f}")])
    return table(["series, form", "Q", "lossy ÷ HTJ2K", "gain %", "residual ÷ HTJ2K", "lossy + residual ÷ HTJ2K"], rows)


def quality_table(series):
    rows = []
    for s in series:
        for q in s.ladder:
            c = lambda g: s.c[(q, g)]
            d = lambda g: c(g)["display"][0] if c(g)["display"] else None
            rows.append([f"`{s.name}` {s.form}", q,
                         gcol(s, q, lambda q, g: f"{fmt(c(g)['psnr'], 2)}/{fmt(c(g)['psnr_in'], 2)}"),
                         gcol(s, q, lambda q, g: f"{c(g)['ssim']:.4f}"),
                         gcol(s, q, lambda q, g: f"{c(g)['ssim_min']:.4f}"),
                         gcol(s, q, lambda q, g: str(c(g)["max_abs"])),
                         gcol(s, q, lambda q, g: f"{100 * d(g)['differ'] / d(g)['n']:.1f}/"
                              f"{100 * d(g)['over1'] / d(g)['n']:.1f}/{d(g)['max']}" if d(g) else "—")])
    return table(["series, form", "Q", "PSNR / in-window PSNR, dB", "SSIM mean", "SSIM min frame", "max \\|Δ\\|",
                  "1st window: % differ / % > 1 / max Δcode"], rows)


def median(xs):
    xs = [x for x in xs if x is not None]
    return st.median(xs) if xs else None


def verdicts(dbt, by_sys, twelve, ladder):
    out = []
    lad = lambda i: ladder[i] if i < len(ladder) else f"> {ladder[-1]}"

    # P1
    low_bad = [(s.name, q, round(s.gain(q, 16), 1)) for s in dbt for q in ladder
               if s.rmse(q) < s.sigma / 2 and s.gain(q, 16) > 5]
    upper = lambda s: [q for i, q in enumerate(ladder) if i >= s.crossover() + 1]
    miss_up = [s.name for s in dbt if upper(s) and any(s.gain(q, 16) < 10 for q in upper(s))]
    all_under = [s.name for s in dbt if all(s.gain(q, 16) < 10 for q in ladder[s.crossover():])]
    v = "refuted" if low_bad or len(all_under) >= 3 else "did not hold" if miss_up else "held"
    out.append(("P1", v, f"gain > +5 % under σ ÷ 2: {low_bad or 'none'}; under +10 % at some rung from one above "
                         f"the crossover: {miss_up or 'none'}; under +10 % on every rung from the crossover up: "
                         f"{len(all_under)} of {len(dbt)} ({', '.join(all_under) or '—'})"))
    # P2
    p2, cells = [], []
    for sysname, ss in by_sys.items():
        g = [s.gain(s.first_over(2), 16) for s in ss if s.first_over(2)]
        e = [s.equal_psnr_gain(s.first_over(2)) for s in ss if s.first_over(2)]
        mg, me = median(g), median(e)
        p2.append((sysname, mg, me, len(g), len(ss)))
        cells.append(mg is None or not 15 <= mg <= 50 or me is None or not 10 <= me <= 40)
    out.append(("P2", "refuted" if any(cells) else "held",
                "; ".join(f"{k}: G16 gain {fmt(a, 1, True)} %, at equal PSNR {fmt(b, 1, True)} % "
                          f"({n} of {m} series reach 2σ)" for k, a, b, n, m in p2)))
    # P3
    bad3 = []
    for s in dbt:
        g = [s.gain(q, 16) for q in ladder[s.crossover():]]
        drops = [a - b for a, b in zip(g, g[1:]) if b < a]
        if any(d > 2 for d in drops) or len(drops) >= 2:
            bad3.append((s.name, [round(x, 1) for x in g]))
    out.append(("P3", "refuted" if len(bad3) >= 3 else "did not hold" if bad3 else "held",
                f"{len(bad3)} of {len(dbt)} series fall > 2 points or dip twice: {bad3 or 'none'}"))
    # P4
    bad4, n4 = [], 0
    for s in dbt:
        for q in ladder:
            g16 = s.gain(q, 16)
            if g16 >= 10:
                n4 += 1
                r8, rw = s.gain(q, 8) / g16, s.gain(q, 0) / g16
                if r8 < 0.8 or rw > 1.15:
                    bad4.append((s.name, q, round(r8, 2), round(rw, 2)))
    series4 = sorted({b[0] for b in bad4})
    out.append(("P4", "refuted" if len(series4) >= 3 else "did not hold" if bad4 else "held" if n4 else "not tested",
                f"{n4} (series, rung) cells with G16 ≥ +10 %; broken (G8 ÷ G16 < 0.8 or whole ÷ G16 > 1.15) on "
                f"{len(series4)} series: {bad4 or 'none'}"))
    # P5
    xo = ladder[min(int(median([s.crossover() for s in dbt])), len(ladder) - 1)]
    rungs = [q for q in ladder if q >= xo]
    med = {q: {k: median([s.gain(q, 16) for s in ss]) for k, ss in by_sys.items()} for q in rungs}
    b_top = sum(max(m, key=m.get) == "B" for m in med.values())
    ac = all(abs(m["A"] - m["C"]) <= 5 for m in med.values())
    out.append(("P5", "held" if b_top * 2 > len(rungs) and ac else "refuted" if b_top * 2 <= len(rungs) else
                "did not hold", f"rungs from the median crossover ({xo}) up: " + "; ".join(
                    f"Q {q}: " + ", ".join(f"{k} {fmt(v, 1, True)}" for k, v in m.items()) for q, m in med.items())
                + f"; B highest at {b_top} of {len(rungs)}; A–C within 5 points at all: {ac}"))
    # P6
    far = [(s.name, ladder[s.bend()], lad(s.crossover())) for s in dbt if abs(s.bend() - s.crossover()) > 1]
    out.append(("P6", "refuted" if len(far) >= 5 else "did not hold" if far else "held",
                f"bend > 1 rung from the crossover on {len(far)} of {len(dbt)}: {far or 'none'}"))
    # P7
    best = [(s.name, min(ladder, key=lambda q: s.lossy(q, 1) + s.res(q, 1))) for s in dbt]
    ratio = {n: (lambda s: (s.lossy(q, 1) + s.res(q, 1)) / s.h)(next(x for x in dbt if x.name == n)) for n, q in best}
    out_band = [(n, round(r, 3)) for n, r in ratio.items() if not 0.93 <= r <= 1.03]
    inter = [(s.name, q, round(100 * ((s.lossy(q, 1) + s.res(q, 1)) - (s.lossy(q, 16) + s.res(q, 16))) / s.h, 2))
             for s in dbt for q in ladder]
    over3 = [x for x in inter if x[2] > 3]
    over5 = [x for x in inter if x[2] > 5]
    falls = sorted({s.name for s in dbt for g in GS for a, b in zip(ladder, ladder[1:]) if s.res(b, g) < s.res(a, g)})
    v = "refuted" if out_band or over5 or len(falls) >= 3 else "did not hold" if over3 or falls else "held"
    out.append(("P7", v, f"best-rung sum ÷ HTJ2K at G1: {', '.join(f'{n} {ratio[n]:.3f} (Q {q})' for n, q in best)};"
                         f" outside 0.93–1.03: {out_band or 'none'}; G16 under G1 by > 3 points: {over3 or 'none'};"
                         f" residual falling between adjacent rungs at some G: {len(falls)} series {falls or ''}"))
    # P8
    n8 = miss8 = 0
    for s in dbt:
        for q in ladder:
            c = s.c[(q, 1)]
            if s.rmse(q) < s.sigma / 2:
                continue
            e = c["rmse"] if not c["display"] else math.sqrt(((1 << (12 if s.form == "12bit" else 10)) - 1) ** 2
                                                             / 10 ** (c["psnr_in"] / 10))
            for d in c["display"]:
                want = min(1, 0.8 * e * 255 / d["window"]["width"])
                got = d["differ"] / d["n"]
                n8 += 1
                miss8 += not (want / 2 <= got <= want * 2)
    out.append(("P8", "refuted" if miss8 * 3 > n8 else "held",
                f"outside ×2 on {miss8} of {n8} (series, rung, window) cells at G1 with RMSE ≥ σ ÷ 2 "
                f"(e is the in-window RMSE)"))
    # P9
    bad9 = []
    for s12, top, win in twelve:
        for i, q in enumerate(ladder):
            for g in GS:
                for other in (top, win):
                    if other is None:
                        continue
                    r = other.lossy(q, g) / s12.lossy(q, g)
                    dp = other.c[(q, g)]["psnr"] - s12.c[(q, g)]["psnr"]
                    if i >= s12.crossover() and (abs(r - 1) > 0.10 or abs(dp) > 0.5):
                        bad9.append((s12.name, other.form, q, g or "W", round(r, 3), round(dp, 2)))
                if i < s12.crossover() and s12.lossy(q, g) <= top.lossy(q, g):
                    bad9.append((s12.name, "12bit not larger", q, g or "W"))
        if win and any(win.res(q, g) < top.res(q, g) for q in ladder for g in GS):
            bad9.append((s12.name, "window residual < top-10's"))
    names9 = sorted({b[0] for b in bad9})
    out.append(("P9", "refuted" if names9 else "held",
                f"{len(names9)} of {len(twelve)} 12-bit series break it; {len(bad9)} breaking cells, first: "
                f"{bad9[:6] or 'none'}"))
    return out


def p10(cine, dbt_sys, ladder):
    """Provisional, never a verdict: each lossy-sourced cine's G16 gain against every DBT system's median."""
    out = []
    for s in cine:
        top = [q for q in ladder if all(s.gain(q, 16) > m[q] for m in dbt_sys.values())]
        xo = ladder[s.crossover()] if s.crossover() < len(ladder) else None
        out.append(f"{s.name}: G16 gain " + ", ".join(f"Q {q} {s.gain(q, 16):+.1f}" for q in ladder)
                   + f"; above every DBT system at {len(top)} of {len(ladder)} rungs; at its crossover rung "
                   f"({xo or 'none'}) {fmt(s.gain(xo, 16), 1, True) if xo else '—'} %")
    return "; ".join(out)


def main():
    work = sys.argv[1]
    cells, alt, lossless, noise, by = load(work)
    ladder = sorted({c["q"] for c in cells})
    names = sorted({c["set"] for c in cells})
    complete = lambda n, f: all((n, f, q, g) in by for q in ladder for g in GS)
    mk = lambda n, f: Series(n, f, by, ladder, noise.get(n, float("nan")), lossless[(n, "htj2k")])
    all_series = [mk(n, primary(by, n)) for n in names if complete(n, primary(by, n))]
    dbt = [s for s in all_series if is_dbt15(s.name)]
    others = [s for s in all_series if not is_dbt15(s.name)]
    by_sys = {k: [s for s in dbt if s.name[5] == k.lower()] for k in "ABC"}
    twelve = [(s, mk(s.name, "top10"), mk(s.name, "window") if complete(s.name, "window") else None)
              for s in all_series if complete(s.name, "top10")]
    print(f"Ladder that ran: {ladder}. Cells: {len(cells)}; frames exact {sum(c['exact_frames'] for c in cells)} of "
          f"{sum(c['frames'] for c in cells)}.\n")
    print("### σ, ρ, crossover, bend\n")
    rows = []
    for s in all_series:
        av1 = lossless.get((s.name, "av1"))
        f = [x for t in twelve if t[0].name == s.name for x in t if x] or [s]
        rows.append([f"`{s.name}`", fmt(s.sigma, 2), ROW100_RHO.get(s.name[5:] if is_dbt15(s.name) else s.name, "not measured"),
                     lossless[(s.name, "htj2k")], f"{av1 / s.h:.4f}" if av1 else "not run",
                     " · ".join(f"{x.form} {ladder[x.crossover()] if x.crossover() < len(ladder) else '> ' + str(ladder[-1])}"
                                for x in f), ladder[s.bend()]])
    print(table(["series", "σ", "ρ (top, best offset, median)", "HTJ2K B", "lossless AV1 ÷ HTJ2K", "crossover rung, by form",
                 "bend (G1)"], rows))
    in12 = lambda ss: [x for t in twelve if t[0] in ss for x in t if x]
    groups = (("DBT-10 (system B)", by_sys["B"]), ("DBT-12 (systems A, C)", in12(by_sys["A"] + by_sys["C"])),
              ("other sound sets", [x for s in others if s.name not in LOSSY for x in (in12([s]) or [s])]),
              ("lossy-sourced, provisional", [s for s in others if s.name in LOSSY]))
    for title, ss in groups:
        if not ss:
            continue
        print(f"\n### Bytes, {title}\n\nEach cell: G = 1 · 8 · 16 · whole.\n")
        print(bytes_table(ss))
        print(f"\n### Quality, {title}\n\nEach cell: G = 1 · 8 · 16 · whole; against the source at its depth b.\n")
        print(quality_table(ss))
    print("\n### Every window\n")
    rows = []
    for c in sorted(cells, key=lambda c: (c["set"], c["form"], c["q"])):
        if c["g"] == 1 and c["form"] == primary(by, c["set"]) and not c["whole"]:
            for d in c["display"]:
                w = d["window"]
                rows.append([f"`{c['set']}`", c["q"], f"{w['center']:g}/{w['width']:g} {w['function']}",
                             f"{100 * d['differ'] / d['n']:.2f}", f"{100 * d['over1'] / d['n']:.2f}", d["max"]])
    print(table(["series", "Q", "window c/w", "% differ", "% > 1 code", "max Δcode"], rows))
    print("\n### Encode time\n\nMedian over the 15 DBT volumes and every form, CPU seconds a megapixel; wall ÷ CPU "
          "with 4 encodes in flight.\n")
    rows = []
    for q in ladder:
        for g in GS:
            xs = [c for c in cells if is_dbt15(c["set"]) and c["q"] == q
                  and (c["whole"] if g == 0 else c["g"] == g and not c["whole"])]
            rows.append([q, g or "whole", fmt(median([c["encode_cpu"] / c["mpx"] for c in xs]), 3),
                         fmt(median([c["encode_wall"] / c["encode_cpu"] for c in xs]), 3),
                         fmt(median([c["encode_cpu"] / c["frames"] for c in xs]), 2)])
    print(table(["Q", "G", "CPU s / Mpx", "wall ÷ CPU", "CPU s / frame"], rows))
    if alt:
        print("\n### Secondary arm: hidden alt-ref frames on, G = 16\n")
        rows = []
        for c in alt:
            base = by[(c["set"], c["form"], c["q"], 16)]
            rows.append([f"`{c['set']}`", c["q"], sum(c["lossy"]), sum(base["lossy"]),
                         fmt(100 * (1 - sum(c["lossy"]) / sum(base["lossy"])), 1, True), fmt(c["psnr"], 2),
                         fmt(base["psnr"], 2), f"{c['exact_frames']}/{c['frames']}"])
        print(table(["series", "Q", "alt-ref B", "alt-ref off B", "alt-ref saves %", "PSNR on", "PSNR off",
                     "exact"], rows))
    print("\n### Checks on every cell\n")
    off_q = [(c["set"], c["form"], c["q"], c["g"]) for c in cells + alt if set(map(int, c["q_hist"])) != {c["q"]}]
    grain = [c for c in cells + alt if c["seq"]["film_grain"]]
    keys = [(c["set"], c["q"], c["g"]) for c in cells if c["keyframes"] != list(range(0, c["frames"], c["g"]))]
    units = [c for c in cells + alt if c["units"] != c["frames"]]
    dec = [c for c in cells if "aomdec_matches" in c]
    print(f"* frames exact (lossy + residual against the fetch checksum): "
          f"{sum(c['exact_frames'] for c in cells + alt)} of {sum(c['frames'] for c in cells + alt)}")
    print(f"* `--q-hist` off Q: {off_q or 'no cell'}; film_grain_params_present = 1: {len(grain)} streams; "
          f"keyframes not at multiples of G: {keys or 'none'}; units ≠ frames: {len(units)}")
    print(f"* aomdec = dav1d sample for sample: {sum(c['aomdec_matches'] for c in dec)} of {len(dec)} streams")
    print("\n### Predictions\n")
    rows = verdicts(dbt, by_sys, [t for t in twelve if is_dbt15(t[0].name)], ladder)
    sysmed = {k: {q: median([s.gain(q, 16) for s in ss]) for q in ladder} for k, ss in by_sys.items()}
    cine = [s for s in others if s.name in ("usb_cine", "us_liver")]
    rows.append(("P10", "recorded, no verdict", p10(cine, sysmed, ladder) if cine else "not run"))
    print(table(["#", "verdict", "deciding numbers"], rows))


if __name__ == "__main__":
    main()
