#!/usr/bin/env python3
"""Row SPLITPREVIEWB's tables and verdicts (split-preview-b.md §Statistics and decision rules), from the rows alone:
equal Q, equal PSNR with its tol, residual, SSIM and display, the decode cells and their A/A, S1–S8, the verdict.

usage: split_preview_report.py RESULTS_DIR [--partners | --decode FILE]   (FILE in RESULTS_DIR, default decode.json)
       split_preview_report.py --test
"""
import json
import math
import random
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from decode_pool import median_interval, order_effect  # noqa: E402

BYTES_RUN = HERE / "results/cells.jsonl"
SERIES = [f"dbts_b{k}" for k in range(1, 6)]
CROSSOVER = {"dbts_b2": 16}  # §Terms: Q 32 on the other four
CEILING_DB = 58.5  # S1's refutation edge
AA_LIMIT = math.log(1.05)
ORDER_LIMIT = 0.10
MIN_ROUNDS = 10
DB_SLOPE = 0.08  # §Statistics: decode time per dB of PSNR, from dbts_b1's shard medians
S8_BAND = (0.55, 0.90)


def jsonl(path):
    path = Path(path)
    return [json.loads(l) for l in path.open()] if path.exists() else []


def bytes_run(name, form, q, g):
    for r in jsonl(BYTES_RUN):
        if (r["set"], r["form"], r["q"], r["g"]) == (name, form, q, g) and not r.get("altref") and not r["whole"]:
            return r
    return None


def rows(out):
    """Every cell, this row's and the bytes run's 10bit cells of system B, one per (set, form, Q, G)."""
    by = {}
    for r in jsonl(BYTES_RUN):
        if r["set"].startswith("dbts_b") and not r.get("altref") and not r["whole"] and r["g"] in (1, 16):
            by[(r["set"], r["form"], r["q"], r["g"])] = dict(r, source="bytes run")
    for r in jsonl(Path(out) / "cells.jsonl"):
        by[(r["set"], r["form"], r["q"], r["g"])] = dict(r, source="this row")
    return by


def curve(by, s, form, g):
    """(PSNR, row) by rising PSNR."""
    return sorted(((r["psnr"], r) for (s2, f, _, g2), r in by.items() if (s2, f, g2) == (s, form, g)),
                  key=lambda x: x[0])


def partners(by, top="top8"):
    """Each (series, anchor Q): the `top` rung at G = 1 whose PSNR is nearest the 10bit anchor's, with its Δ PSNR."""
    out = {}
    for s in SERIES:
        for q in (16, 32):
            a = by.get((s, "10bit", q, 1))
            cands = [r for (s2, f, _, g), r in by.items() if (s2, f, g) == (s, top, 1) and (top == "10bit" or r.get("item") == 1)]
            if a and cands:
                p = min(cands, key=lambda r: abs(r["psnr"] - a["psnr"]))
                out[(s, q)] = dict(q=p["q"], delta=p["psnr"] - a["psnr"], anchor_psnr=a["psnr"])
    return out


def at_psnr(c, x, value):
    """value(row) at PSNR x along curve c, linear in PSNR between the bracketing rungs; None outside."""
    for (p0, r0), (p1, r1) in zip(c, c[1:]):
        if p0 <= x <= p1:
            t = 0 if p1 == p0 else (x - p0) / (p1 - p0)
            return value(r0) + t * (value(r1) - value(r0))
    return None


def ln_bytes(r):
    return math.log(sum(r["lossy"]))


def tol(c, value=ln_bytes):
    """The largest |error| predicting each interior rung's value from its two neighbours."""
    errs = []
    for (p0, r0), (p1, r1), (p2, r2) in zip(c, c[1:], c[2:]):
        guess = value(r0) + (p1 - p0) / (p2 - p0) * (value(r2) - value(r0))
        errs.append(abs(guess - value(r1)))
    return max(errs) if errs else float("nan")


VALUES = {
    "bytes": ln_bytes,
    "residual": lambda r: math.log(sum(r["residual"])),
    "ssim": lambda r: r["ssim"],
    "differ": lambda r: 100 * r["display"][0]["differ"] / max(r["display"][0]["n"], 1),
    "over1": lambda r: 100 * r["display"][0]["over1"] / max(r["display"][0]["n"], 1),
}


def equal_psnr(by, s, form, g):
    """Each `form` point against the 10bit curve at its PSNR: ratios for bytes and residual, differences otherwise."""
    ref = curve(by, s, "10bit", g)
    out = []
    for p, r in curve(by, s, form, g):
        row = dict(q=r["q"], psnr=p)
        for k, f in VALUES.items():
            other = at_psnr(ref, p, f)
            if other is None:
                row[k] = None
            elif k in ("bytes", "residual"):
                row[k] = math.exp(f(r) - other)
            else:
                row[k] = f(r) - other
        out.append(row)
    return out, tol(ref), tol(ref, VALUES["residual"])


def classify(ratio, t):
    if ratio is None:
        return "—"
    if math.isnan(t):
        return "no tol"
    x = math.log(ratio)
    return "smaller" if x < -t else "larger" if x > t else "tie"


# Decode ------------------------------------------------------------------------------------------------------------

def figure(r):
    """A unit's figure: the median over its 16 slices, ms, from handed in to written; None if cut or a check failed."""
    if r.get("error") or not r.get("frames") or any(ok != n for ok, n in r["checks"].values()):
        return None
    return st.median(w - h for _, h, w in r["frames"])


def paired(rs, num, den, across=False):
    """ln(num ÷ den) paired by round, with num's predecessor; `across` pairs round k with round k + 1 (C7's mutation)."""
    by = {(r["round"], r["unit"]): r for r in rs}
    out = []
    for (k, u), r in sorted(by.items()):
        other = by.get((k + 1 if across else k, den))
        if u == num and other and figure(r) and figure(other):
            out.append((k, math.log(figure(r) / figure(other)), r["prev"]))
    return out


def cell_stat(p, mutate=None):
    """The median of ln ratios and its distribution-free 95 % interval; `mean` puts a mean in the median's place."""
    xs = [x for _, x, _ in p]
    ci = median_interval(xs)
    if ci and mutate == "mean":
        ci = (st.mean(xs), ci[1], ci[2])
    return ci


def order_flag(p, mutate=None):
    """§7's order rule: (effect, share of 400 shuffles reaching it, flagged)."""
    eff, chance = order_effect(p)
    if eff is None:
        return None, None, False
    if mutate == "noshuffle":
        return eff, 0.0, eff > ORDER_LIMIT
    return eff, chance, eff > ORDER_LIMIT and chance < 0.05


def decode(rs, mutate=None):
    """Every cell of one block: the A/A per throttle, then top8 ÷ 10bit per (series, anchor, throttle, G)."""
    groups = defaultdict(list)
    for r in rs:
        groups[(r["set"], r["q"], r["throttle"])].append(r)
    aa, void = {}, set()
    for t in sorted({k[2] for k in groups}):
        xs = [x for k, g in groups.items() if k[2] == t for _, x, _ in paired(g, "10bit S1′", "10bit S1", mutate == "across")]
        ci = median_interval(xs)
        ok = ci is not None and ci[1] <= AA_LIMIT and ci[2] >= -AA_LIMIT
        aa[t] = dict(ci=ci, n=len(xs), kept=ok or mutate == "aa_off")
        if not aa[t]["kept"]:
            void.add(t)
    cells = {}
    for (s, q, t), g in sorted(groups.items()):
        for G in (1, 16):
            p = paired(g, f"top8 S{G}", f"10bit S{G}", mutate == "across")
            if not p:
                continue
            ci = cell_stat(p, mutate)
            eff, chance, flagged = order_flag(p, mutate)
            med = lambda u: st.median(f for f in (figure(r) for r in g if r["unit"] == u) if f)
            c = dict(n=len(p), ci=ci, effect=eff, chance=chance, ms_top8=med(f"top8 S{G}"), ms_10bit=med(f"10bit S{G}"))
            if t in void:
                c["state"] = "void: A/A"
            elif len(p) < MIN_ROUNDS:
                c["state"] = f"not read: {len(p)} rounds"
            elif flagged:
                c["state"] = "not read: order"
            elif ci is None:
                c["state"] = "not read: no interval"
            else:
                c["state"] = "read"
            if ci:
                e = [math.exp(x) for x in ci]
                c["speed"] = "faster" if e[2] < 1 else "slower" if e[1] > 1 else "not decided"
                c["s8"] = "held" if S8_BAND[0] <= e[1] and e[2] <= S8_BAND[1] else \
                    "refuted" if e[2] < S8_BAND[0] or e[1] > S8_BAND[1] else "not decided"
            cells[(s, q, t, G)] = c
    return aa, cells


def quality_gate(c, delta):
    """§Statistics: not decided at equal quality when |Δ| · 8 % exceeds the interval's distance from 1."""
    if not c.get("ci"):
        return False
    e = [math.exp(x) for x in c["ci"]]
    distance = 1 - e[2] if e[2] < 1 else e[1] - 1 if e[1] > 1 else 0
    return abs(delta) * DB_SLOPE <= distance


def test():
    """C7: made-up rounds with a known top8 ÷ 10bit of 0.75 and an A/A of 1.00 are recovered; each mutation fails."""
    def block(ratio=0.75, aa=1.0, drift=0.0, rounds=14, spread=0.03, seed=0, prev_effect=None, outlier=False):
        rnd, rs = random.Random(seed), []
        units = ["10bit S1", "10bit S1′", "10bit S16", "top8 S1", "top8 S16"]
        base = {"10bit S1": 80.0, "10bit S1′": 80.0 * aa, "10bit S16": 70.0, "top8 S1": 80.0 * ratio,
                "top8 S16": 70.0 * ratio}
        for k in range(rounds):
            prev = None
            order = units[k % 5:] + units[:k % 5]
            for u in order:
                ms = base[u] * math.exp(drift * k + rnd.gauss(0, spread))
                if prev_effect and u.startswith("top8") and prev == prev_effect:
                    ms *= 1.3
                if outlier and u == "top8 S1" and k < 6:
                    ms *= 3
                frames = [[i, 0.0, ms * math.exp(rnd.gauss(0, 0.01))] for i in range(16)]
                rs.append(dict(round=k, throttle=1, set="s", q=32, unit=u, prev=prev, frames=frames, checks={"x": [1, 1]}))
                prev = u
        return rs

    def ok(rs, mutate=None, want=0.75):
        aa, cells = decode(rs, mutate)
        c = cells[("s", 32, 1, 1)]
        lo, hi = (math.exp(x) for x in c["ci"][1:])
        return aa[1]["kept"] and c["state"] == "read" and lo <= want <= hi and abs(math.exp(c["ci"][0]) - want) < 0.03

    assert ok(block()), "the plain block"
    assert ok(block(drift=0.05)), "drift is paired out"
    assert not ok(block(drift=0.05), "across"), "pairs taken across rounds must fail"
    assert ok(block(outlier=True, rounds=20)), "a few slow rounds move the median little"
    assert not ok(block(outlier=True, rounds=20), "mean"), "a mean in place of the median must fail"
    aa, _ = decode(block(aa=1.2))
    assert not aa[1]["kept"], "an A/A 20 % off voids the throttle"
    aa, _ = decode(block(aa=1.2), "aa_off")
    assert aa[1]["kept"], "with the A/A rule off it is kept, which the line above refuses"
    _, cells = decode(block(prev_effect="10bit S16", rounds=30, seed=3))
    assert cells[("s", 32, 1, 1)]["state"] == "not read: order", cells[("s", 32, 1, 1)]
    noisy = block(spread=0.15, rounds=12, seed=4)
    _, cells = decode(noisy)
    _, cut = decode(noisy, "noshuffle")
    c, m = cells[("s", 32, 1, 1)], cut[("s", 32, 1, 1)]
    assert c["effect"] > ORDER_LIMIT and c["state"] == "read" and m["state"] == "not read: order", (c, m)
    # Equal PSNR: a curve against itself is 1, a curve planted ×1.10 reads 1.10, ±0.3 dB moves it below and above 1.
    rows = lambda f, k=1.0, dp=0.0: {("s", f, q, 1): dict(set="s", form=f, q=q, g=1, psnr=60 - q / 2 + dp,
                                     lossy=[int(1e6 * k * math.exp(-q / 10))], residual=[1], ssim=0.9,
                                     display=[dict(n=1, differ=0, over1=0)]) for q in (8, 16, 24, 32, 40)}
    by = {**rows("10bit"), **{(s, "top8", q, g): r for (s, _, q, g), r in rows("10bit").items()}}
    pts, t, _ = equal_psnr(by, "s", "top8", 1)
    assert all(abs(p["bytes"] - 1) < 1e-12 for p in pts) and math.isfinite(t)
    by = {**rows("10bit"), **{(s, "top8", q, g): r for (s, _, q, g), r in rows("10bit", 1.10).items()}}
    assert all(p["bytes"] is None or abs(p["bytes"] - 1.10) < 1e-4 for p in equal_psnr(by, "s", "top8", 1)[0])
    for dp, sign in ((0.3, -1), (-0.3, 1)):
        by = {**rows("10bit"), **{(s, "top8", q, g): r for (s, _, q, g), r in rows("10bit", 1.0, dp).items()}}
        got = [p["bytes"] for p in equal_psnr(by, "s", "top8", 1)[0] if p["bytes"]]
        assert got and all(math.copysign(1, math.log(x)) == sign for x in got), (dp, got)
    print("split_preview_report.py: every test passed")


def pct(x):
    return "—" if x is None else f"{x:.3f}"


def ci_text(ci):
    if not ci:
        return "—"
    m, lo, hi = (math.exp(x) for x in ci)
    return f"{m:.3f} [{lo:.3f}–{hi:.3f}]"


def table(head, body):
    return "\n".join(["| " + " | ".join(head) + " |", "|" + " --- |" * len(head)] + ["| " + " | ".join(map(str, r)) + " |" for r in body])


def report(out, decode_file="decode.json"):
    by = rows(out)
    lines = []
    say = lines.append
    sets = [s for s in SERIES + ["dbts_b_max"] if any(k[0] == s for k in by)]

    say("**Equal Q, G = 1** (bytes over the series; PSNR dB; top8 ÷ 10bit bytes; Δ PSNR top8 − 10bit)\n")
    body = []
    for s in sets:
        for q in (8, 12, 16, 24, 32, 56):
            a, b = by.get((s, "10bit", q, 1)), by.get((s, "top8", q, 1))
            if a and b:
                body.append([s, q, sum(a["lossy"]), f"{a['psnr']:.3f}", sum(b["lossy"]), f"{b['psnr']:.3f}",
                             f"{sum(b['lossy']) / sum(a['lossy']):.3f}", f"{b['psnr'] - a['psnr']:+.3f}"])
    say(table(["series", "Q", "10bit B", "10bit dB", "top8 B", "top8 dB", "bytes ratio", "Δ dB"], body))
    body = []
    for s in sets:
        for q in (16, 32):
            a, b, c = by.get((s, "10bit", q, 1)), by.get((s, "top8", q, 1)), by.get((s, "top8at10", q, 1))
            if a and b and c:
                body.append([s, q, sum(c["lossy"]), f"{c['psnr']:.3f}", f"{sum(c['lossy']) / sum(a['lossy']):.3f}",
                             f"{sum(b['lossy']) / sum(c['lossy']):.3f}", f"{b['psnr'] - c['psnr']:+.3f}"])
    if body:
        say("\n**The control at equal Q** (top8at10; G = 1)\n")
        say(table(["series", "Q", "top8at10 B", "top8at10 dB", "top8at10 ÷ 10bit", "top8 ÷ top8at10", "Δ dB top8 − top8at10"], body))

    say("\n**Equal PSNR** (each point against the 10bit curve at its PSNR; ratios top8 ÷ 10bit for bytes and residual, "
        "differences for SSIM and the displayed-level change in points; — outside the 10bit curve)\n")
    body, eq = [], {}
    for s in sets:
        for form in ("top8", "top8at10"):
            for g in (1, 16):
                pts, t, tr = equal_psnr(by, s, form, g)
                for p in pts:
                    eq[(s, form, g, p["q"])] = dict(p, tol=t, tol_res=tr)
                    body.append([s, form, g, p["q"], f"{p['psnr']:.3f}", pct(p["bytes"]), classify(p["bytes"], t),
                                 f"{t:.3f}", pct(p["residual"]), classify(p["residual"], tr),
                                 "—" if p["ssim"] is None else f"{p['ssim']:+.4f}",
                                 "—" if p["differ"] is None else f"{p['differ']:+.2f}",
                                 "—" if p["over1"] is None else f"{p['over1']:+.2f}"])
    say(table(["series", "form", "G", "Q", "dB", "bytes ratio", "class", "tol (ln)", "residual ratio", "class",
               "Δ SSIM", "Δ differ pts", "Δ >1 pts"], body))

    pairs = partners(by)
    say("\n**Partners** (top8 G = 1 rung nearest the 10bit anchor's PSNR)\n")
    say(table(["series", "anchor Q", "anchor dB", "partner Q", "Δ dB"],
              [[s, q, f"{p['anchor_psnr']:.3f}", p["q"], f"{p['delta']:+.3f}"] for (s, q), p in sorted(pairs.items())]))

    verdicts = {}
    say("\n**S1–S7**, on `dbts_b1` … `dbts_b5` (stage 4's `dbts_b_max` is in the tables, not in the predictions)\n")
    tops = [r["psnr"] for k, r in by.items() if k[1] == "top8" and k[0] in SERIES]
    c2 = [c for c in jsonl(Path(out) / "checks.jsonl") if c.get("check") == "C2" and not c.get("mutated") and "series" in c]
    s1 = "refuted" if any(p > CEILING_DB for p in tops) else "held"
    say(f"* S1 {s1} by its clause: highest top8 PSNR {max(tops):.3f} dB over {len(tops)} cells (edge {CEILING_DB})")
    if c2:
        u = c2[-1]["series"]
        off = [n for n, x in u.items() if abs(x["psnr"] - 58.4) > 0.1]
        say("  its second part, uncoded top8 at 58.4 ± 0.1 dB: " + ", ".join(f"{n} {x['psnr']:.2f} dB (mean square {x['mean_square']:.3f})"
            for n, x in u.items()) + (f" — outside on {off}" if off else " — inside on every series"))
    verdicts["S1"] = s1

    def band(name, pts, lo, hi):
        vals = [(k, p["bytes"]) for k, p in pts if p["bytes"] is not None]
        out_ = [(k, v) for k, v in vals if not lo <= v <= hi]
        v = "refuted" if out_ else "held" if vals else "not decided"
        rng = f"{min(x for _, x in vals):.3f}–{max(x for _, x in vals):.3f}" if vals else "—"
        say(f"* {name} {v}: {len(vals)} matched points, range {rng}" +
            (f"; outside {lo}–{hi}: " + ", ".join(f"{k[0]} G{k[2]} Q{k[3]} {x:.3f}" for k, x in out_) if out_ else ""))
        return v, vals

    lo10 = lambda s, q, g: by.get((s, "10bit", q, g), {}).get("psnr")
    s2pts = [(k, p) for k, p in eq.items() if k[1] == "top8" and k[0] in SERIES and lo10(k[0], 56, k[2]) is not None
             and lo10(k[0], 56, k[2]) <= p["psnr"] <= lo10(k[0], CROSSOVER.get(k[0], 32), k[2])]
    verdicts["S2"], s2v = band("S2 (from the noise up, 1.00–1.12)", s2pts, 1.00, 1.12)
    s3pts = [(k, p) for k, p in eq.items() if k[1] == "top8" and k[0] in SERIES and lo10(k[0], 12, k[2]) is not None
             and p["psnr"] > lo10(k[0], 12, k[2])]
    verdicts["S3"], s3v = band("S3 (Q 8's quality: above the 10bit Q 12 rung's PSNR, 1.05–1.35)", s3pts, 1.05, 1.35)
    below = [k[0] for k, v in s3v if any(k2[0] == k[0] and v <= v2 for k2, v2 in s2v)]
    if below:
        verdicts["S3"] = "refuted"
        lines[-1] = lines[-1].replace("held", "refuted", 1) + f"; inside the band, but not above S2's range on {sorted(set(below))}"

    wrong = defaultdict(set)
    for s in SERIES:
        for q, sign in ((8, -1), (12, -1), (32, 1), (56, 1)):
            a, b = by.get((s, "10bit", q, 1)), by.get((s, "top8", q, 1))
            if a and b:
                if math.copysign(1, sum(b["lossy"]) - sum(a["lossy"])) != sign or math.copysign(1, b["psnr"] - a["psnr"]) != sign:
                    wrong[q].add(s)
    verdicts["S4"] = "refuted" if any(len(v) >= 3 for v in wrong.values()) else "held"
    say(f"* S4 {verdicts['S4']}: series with a wrong sign, by Q: " + (", ".join(f"Q {q}: {sorted(v)}" for q, v in sorted(wrong.items())) or "none"))

    s5 = [(k, p["bytes"]) for k, p in eq.items() if k[1] == "top8at10" and k[2] == 1 and k[3] in (16, 32)]
    s5out = [(k, v) for k, v in s5 if v is None or abs(v - 1) > 0.03]
    verdicts["S5"] = "not decided" if not s5 else "refuted" if any(v is not None for _, v in s5out) else \
        "not decided" if s5out else "held"
    say(f"* S5 {verdicts['S5']}: top8at10 ÷ 10bit at equal PSNR: " + ", ".join(f"{k[0]} Q{k[3]} {pct(v)}" for k, v in s5))

    bad6 = set()
    for k, p in eq.items():
        if k[1] == "top8" and k[0] in SERIES and p["ssim"] is not None and (abs(p["ssim"]) > 0.002 or abs(p["differ"]) > 2 or abs(p["over1"]) > 2):
            bad6.add(k[0])
    verdicts["S6"] = "refuted" if len(bad6) >= 3 else "held"
    say(f"* S6 {verdicts['S6']}: series with a matched point outside ±0.002 SSIM or ±2 points: {sorted(bad6) or 'none'}")
    s7 = [(k, p["residual"]) for k, p in eq.items() if k[1] == "top8" and k[0] in SERIES and p["residual"] is not None]
    s7out = [(k, v) for k, v in s7 if not 0.98 <= v <= 1.02]
    verdicts["S7"] = "refuted" if s7out else "held" if s7 else "not decided"
    say(f"* S7 {verdicts['S7']}: {len(s7)} matched points, residual ratio "
        f"{min(v for _, v in s7):.4f}–{max(v for _, v in s7):.4f}" if s7 else "* S7: no matched point")

    dec = Path(out) / decode_file
    if dec.exists():
        drows = [r for r in json.loads(dec.read_text()) if r.get("unit")]
        aa, cells = decode(drows)
        rounds = sorted({r["round"] for r in drows})
        say(f"\n**Decode** ({len(rounds)} rounds; top8 ÷ 10bit, median over rounds of the per-round ratio of "
            "per-unit medians, distribution-free 95 % interval)\n")
        for t, a in sorted(aa.items()):
            say(f"* A/A {t}×: 10bit S1′ ÷ 10bit S1 {ci_text(a['ci'])} over {a['n']} pairs — {'kept' if a['kept'] else 'VOID'}")
        body, s8 = [], []
        for (s, q, t, G), c in sorted(cells.items()):
            p = pairs.get((s, q))
            top, ten = by.get((s, "top8", p["q"], G)) if p else None, by.get((s, "10bit", q, G))
            delta = top["psnr"] - ten["psnr"] if top and ten else None
            gate = delta is not None and quality_gate(c, delta)
            if c["state"] == "read" and c.get("speed") in ("faster", "slower") and not gate:
                c["state"] = "not decided at equal quality"
            body.append([s, q, f"{t}×", G, c["n"], f"{c['ms_10bit']:.1f}", f"{c['ms_top8']:.1f}", ci_text(c["ci"]),
                         c.get("speed", "—"), "—" if delta is None else f"{delta:+.3f}",
                         "—" if delta is None else f"{abs(delta) * DB_SLOPE:.1%}",
                         "—" if c["effect"] is None else f"{c['effect']:.0%} (p {c['chance']:.3f})", c["state"],
                         c.get("s8", "—") if c["state"] == "read" else "—"])
            if c["state"] == "read":
                s8.append(c["s8"])
            c["delta"] = delta
        say(table(["series", "anchor Q", "throttle", "G", "n", "10bit ms", "top8 ms", "top8 ÷ 10bit [95 %]", "speed",
                   "Δ dB", "|Δ|·8 %", "order effect", "state", "S8"], body))
        verdicts["S8"] = "refuted" if "refuted" in s8 else "held" if s8 and all(x == "held" for x in s8) else \
            f"not decided ({s8.count('held')} held, {s8.count('not decided')} not decided, {len(cells) - len(s8)} not read)"
        say(f"\n* S8 {verdicts['S8']}")

        say("\n**Verdict per series and quality** (dominance, §Statistics)\n")
        body = []
        for (s, q), p in sorted(pairs.items()):
            e = eq.get((s, "top8", 1, p["q"]))
            bc = classify(e["bytes"], e["tol"]) if e else "—"
            rc = classify(e["residual"], e["tol_res"]) if e else "—"
            mine = [c for (s2, q2, _, _), c in cells.items() if (s2, q2) == (s, q)]
            read = [c for c in mine if c["state"] == "read"]
            faster = bool(read) and len(read) == len(mine) and all(c["speed"] == "faster" for c in read)
            if bc in ("smaller", "tie") and rc in ("smaller", "tie") and faster:
                v = "top8 better"
            elif bc == "larger" and not faster:
                v = "top8 worse"
            elif bc == "—":
                v = "not decided (no matched point)"
            elif not read:
                v = "not decided (no decode cell read)"
            else:
                times = [math.exp(c["ci"][0]) for c in read]
                v = (f"a trade: {(e['bytes'] - 1):+.1%} bytes (a {bc}) for "
                     + ", ".join(f"{1 - x:.0%}" for x in times) + " less decode time a frame in the read cells")
            body.append([s, q, p["q"], pct(e["bytes"]) if e else "—", bc, pct(e["residual"]) if e else "—", rc,
                         f"{len(read)} of {len(mine)} read, " + ("all faster" if faster else "not all faster"), v])
        say(table(["series", "anchor Q", "partner Q", "bytes ratio", "bytes", "residual ratio", "residual", "decode", "verdict"], body))
    say("\n**Summary:** " + ", ".join(f"{k} {v}" for k, v in verdicts.items()))
    return "\n".join(lines)


if __name__ == "__main__":
    if "--test" in sys.argv:
        test()
        sys.exit()
    if "--partners" in sys.argv:
        by = rows(sys.argv[1])
        print(json.dumps([dict(set=s, anchor=q, partner=p["q"], delta=p["delta"], middle=(by[(s, "10bit", q, 1)]["frames"] - 16) // 2)
                          for (s, q), p in sorted(partners(by).items())]))
        sys.exit()
    print(report(sys.argv[1], sys.argv[sys.argv.index("--decode") + 1] if "--decode" in sys.argv else "decode.json"))
