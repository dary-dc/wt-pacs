#!/usr/bin/env python3
"""Row SPLITPREVIEWB's tables and verdicts (split-preview-b.md §Statistics and decision rules), from the rows alone:
equal Q, equal PSNR with its tol, residual, SSIM and display, the decode cells and their A/A, S1–S8, the verdict.

usage: split_preview_report.py RESULTS_DIR [--checks]
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


def tol(c):
    """The largest |error| predicting each interior rung's ln bytes from its two neighbours."""
    errs = []
    for (p0, r0), (p1, r1), (p2, r2) in zip(c, c[1:], c[2:]):
        guess = ln_bytes(r0) + (p1 - p0) / (p2 - p0) * (ln_bytes(r2) - ln_bytes(r0))
        errs.append(abs(guess - ln_bytes(r1)))
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
    return out, tol(ref)


def classify(ratio, t):
    if ratio is None:
        return "—"
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
    pts, t = equal_psnr(by, "s", "top8", 1)
    assert all(abs(p["bytes"] - 1) < 1e-12 for p in pts) and math.isfinite(t)
    by = {**rows("10bit"), **{(s, "top8", q, g): r for (s, _, q, g), r in rows("10bit", 1.10).items()}}
    assert all(p["bytes"] is None or abs(p["bytes"] - 1.10) < 1e-4 for p in equal_psnr(by, "s", "top8", 1)[0])
    for dp, sign in ((0.3, -1), (-0.3, 1)):
        by = {**rows("10bit"), **{(s, "top8", q, g): r for (s, _, q, g), r in rows("10bit", 1.0, dp).items()}}
        got = [p["bytes"] for p in equal_psnr(by, "s", "top8", 1)[0] if p["bytes"]]
        assert got and all(math.copysign(1, math.log(x)) == sign for x in got), (dp, got)
    print("split_preview_report.py: every test passed")


if __name__ == "__main__":
    if "--test" in sys.argv:
        test()
        sys.exit()
