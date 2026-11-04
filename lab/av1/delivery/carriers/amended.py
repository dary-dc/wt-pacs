#!/usr/bin/env python3
"""Row CARRIERS, amended: the collector (docs/av1/profile-carriers.md §Profile carriers protocol, amended, *Rule*).
Pools the shards' rows, normalizes every time by its block's HTJ2K control in the same round, gates each block on
its own A/A and each arm on its order effect, decides each pair by the median's order-statistic interval, and
reads every role's frontier over k and G.

usage: amended.py WORK ROWS.jsonl ...   — prints the tables; amended_test.py checks the arithmetic
"""
import json
import math
import random
import statistics
import sys
from collections import defaultdict
from math import comb
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from roles import at_psnr  # noqa: E402

LEVEL = 0.95
ALPHA = 0.05
PERMUTATIONS = 2000
KS = (1, 4, 8, 16)
GS = (1, 4, 8, 16, 32)
ROLES = {"cheap view": ("cine-cheap frame", "cine-cheap total"),
         "high view": ("cine-high frame", "cine-high total", "jump"),
         "exact on request": ("exact cold", "dwell first", "dwell next")}


def interval_rank(n, level=LEVEL):
    """The largest r with P(r ≤ W ≤ n − r) ≥ level, W ~ Binomial(n, ½) (NIST Dataplot, MEDIAN CONFIDENCE
    LIMITS); the interval is the r-th to the (n − r + 1)-th order statistic. 0 when none exists."""
    best = 0
    for r in range(1, n // 2 + 1):
        if sum(comb(n, w) for w in range(r, n - r + 1)) / 2 ** n >= level:
            best = r
    return best


def median_interval(d):
    """(median, low, high) of d, the interval distribution-free at LEVEL; None ends when n is too small."""
    if not d:
        return None, None, None
    s, r = sorted(d), interval_rank(len(d))
    return statistics.median(s), (s[r - 1] if r else None), (s[len(s) - r] if r else None)


def decided(d):
    """d: per-round log(A ÷ B). 'A' or 'B' (the lower time) when the interval excludes 0, else 'not resolved'."""
    med, lo, hi = median_interval(d)
    if lo is None:
        return "not resolved", med, lo, hi
    return ("A" if hi < 0 else "B" if lo > 0 else "not resolved"), med, lo, hi


def spread(by_prev):
    """The largest |median of a predecessor's values − median of all| over predecessors with two or more."""
    allv = [v for vs in by_prev.values() for v in vs]
    m = statistics.median(allv)
    return max((abs(statistics.median(vs) - m) for vs in by_prev.values() if len(vs) > 1), default=0.0)


def order_p(by_prev, seed=0):
    """Permutation p of spread(): the predecessor labels shuffled over the same values."""
    labels = [p for p, vs in by_prev.items() for _ in vs]
    values = [v for vs in by_prev.values() for v in vs]
    seen, rng, hits = spread(by_prev), random.Random(seed), 0
    for _ in range(PERMUTATIONS):
        rng.shuffle(labels)
        g = defaultdict(list)
        for p, v in zip(labels, values):
            g[p].append(v)
        hits += spread(g) >= seen
    return (hits + 1) / (PERMUTATIONS + 1)


def dominates(x, y):
    """x dominates y on a role: bytes no more, no time decided against x, and fewer bytes or a time decided for x.
    x, y: {'bytes': B}; times: {metric: 'x' | 'y' | 'not resolved'}."""
    xb, yb, times = x["bytes"], y["bytes"], x["times"][y["name"]]
    if xb > yb or "y" in times.values():
        return False
    return xb < yb or "x" in times.values()


def frontier(configs):
    """The configurations no other dominates."""
    return [c["name"] for c in configs if not any(dominates(o, c) for o in configs if o is not c)]


def load(paths):
    rows = [json.loads(line) for p in paths for line in Path(p).open()]
    return [r for r in rows if not r.get("mutate") and not r.get("void")], sum(1 for r in rows if r.get("void"))


def metrics(rows):
    """{(set, block, round): {arm: {metric: ms}}} — an arm-round with any failed check has no metrics."""
    by = defaultdict(lambda: defaultdict(list))
    for r in rows:
        by[(r["set"], r["block"], r["round"])][r["arm"]].append(r)
    out = {}
    for cell, arms in by.items():
        m = {}
        for arm, rs in arms.items():
            if any(x.get("error") or x.get("exact") is False or x.get("lossy") is False
                   or ("frames" in x and (x.get("lossy", x.get("exact")) < x["frames"])) for x in rs):
                continue
            ops = defaultdict(list)
            for x in rs:
                ops[x["op"]].append(x)
            if arm.startswith("ctrl"):
                ms = ops["cine-exact"][0]["ms"]
                m[arm] = {"frame": statistics.median(ms), "per": ms, "total": sum(ms)}
                continue
            v = {}
            for c in ("cine-high", "cine-cheap"):
                v[f"{c} frame"] = statistics.median(ops[c][0]["ms"])
                v[f"{c} total"] = sum(ops[c][0]["ms"])
            v["jump"] = statistics.mean(x["ms"] for x in ops["jump"])
            v["dwell next"] = statistics.mean(x["ms"] for x in ops["next"])
            if arm.startswith("lay"):
                v["exact cold"] = v["dwell first"] = statistics.mean(x["ms"] for x in ops["exact"])
            else:
                res = {x["i"]: x["ms"] for x in ops["residual"]}
                v["exact cold"] = statistics.mean(x["ms"] + res[x["i"]] for x in ops["jump"])
                v["dwell first"] = statistics.mean(res.values())
            v["total"] = sum(sum(x["ms"]) if isinstance(x["ms"], list) else x["ms"] for x in rs)
            v["asked"] = [x["i"] for x in ops["jump"]]
            m[arm] = v
        out[cell] = m
    return out


def whole(m):
    """The whole HTJ2K frame as the separate exact carrier, from the block's control at the round's asked frames."""
    lay = next(v for a, v in m.items() if a.startswith("lay"))
    per = m["ctrl"]["per"]
    i = lay["asked"]
    first = statistics.mean(per[k] for k in i)
    return {"exact cold": first, "dwell first": first, "dwell next": statistics.mean(per[k + 1] for k in i)}


def normalized(cells):
    """{(set, arm): {round: {metric: value ÷ the block's control frame}}}, 'whole' once a round from block 8."""
    out = defaultdict(dict)
    for (s, b, r), m in cells.items():
        if "ctrl" not in m:
            continue
        ref = m["ctrl"]["frame"]
        for arm, v in m.items():
            if not arm.startswith("ctrl"):
                out[(s, arm)][r] = {k: x / ref for k, x in v.items() if isinstance(x, float)}
        if b == 8 and any(a.startswith("lay") for a in m):
            out[(s, "whole")][r] = {k: x / ref for k, x in whole(m).items()}
    return out


def aa(cells):
    """{(set, block): (median, low, high, n)} of log(ctrl-aa ÷ ctrl) over rounds."""
    d = defaultdict(list)
    for (s, b, _), m in cells.items():
        if "ctrl" in m and "ctrl-aa" in m:
            d[(s, b)].append(math.log(m["ctrl-aa"]["frame"] / m["ctrl"]["frame"]))
    return {c: (*median_interval(v), len(v)) for c, v in d.items()}


def order_effects(cells, rows):
    """{(set, block, arm): (spread, p, flagged)}: each arm's log total ÷ control by its predecessor."""
    prev = {(r["set"], r["block"], r["round"], r["arm"]): r["prev"] for r in rows}
    by = defaultdict(lambda: defaultdict(list))
    for (s, b, r), m in cells.items():
        if "ctrl" not in m or "ctrl-aa" not in m:
            continue
        for arm, v in m.items():
            other = "ctrl-aa" if arm == "ctrl" else "ctrl"
            by[(s, b, arm)][prev[(s, b, r, arm)] or "first"].append(math.log(v["total"] / m[other]["total"]))
    arms = defaultdict(int)
    for s, b, _ in by:
        arms[(s, b)] += 1
    out = {}
    for c, g in by.items():
        p = order_p(g, seed=hash(c) & 0xFFFF)
        out[c] = (spread(g), p, p < ALPHA / arms[c[:2]])
    return out


def main():
    work, (rows, voids) = Path(sys.argv[1]), load(sys.argv[2:])
    cells = metrics(rows)
    norm = normalized(cells)
    gate = aa(cells)
    effects = order_effects(cells, rows)
    print(f"rounds {len({r['round'] for r in rows})}; VOID blocks {voids}\n")
    print("| volume · block | A/A median log (interval), n | A/A | arms flagged by order (p) |\n| --- | --- | --- | --- |")
    for (s, b), (med, lo, hi, n) in sorted(gate.items()):
        flagged = [f"{a} ({p:.3g})" for (s2, b2, a), (_, p, f) in sorted(effects.items()) if (s2, b2) == (s, b) and f]
        ok = lo is not None and lo <= 0 <= hi
        print(f"| {s} · k {b} | {med:+.3f} ({lo}, {hi}), {n} | {'passes' if ok else 'fails: block not read'} | {', '.join(flagged) or '—'} |")
    unread = {(s, b) for (s, b), (_, lo, hi, _) in gate.items() if lo is None or not lo <= 0 <= hi}
    unread |= {(s, b, a) for (s, b, a), (_, _, f) in effects.items() if f}
    false = [decided([math.log(cells[c]["ctrl-aa"]["frame"] / cells[c]["ctrl"]["frame"])])[0] for c in []]
    del false
    for idx in sorted(work.glob("dbts_*.json")):
        e = json.loads(idx.read_text())
        s = e["name"]
        configs = config_bytes(e)
        print(f"\n## {s}\n")
        for role, ms in ROLES.items():
            names = [c for c in configs if role in configs[c]]
            table = []
            for n in names:
                c = {"name": n, "bytes": configs[n][role], "times": {}}
                for o in names:
                    if o != n:
                        c["times"][o] = {m: pair(norm, s, n, o, m, unread) for m in ms}
                table.append(c)
            print(f"### {role}\n\n| configuration | bytes | " + " | ".join(f"{m} ÷ HTJ2K frame" for m in ms) + " |")
            print("| --- | --: |" + " --: |" * len(ms))
            for c in table:
                vals = [median_of(norm, s, c["name"], m) for m in ms]
                print(f"| {c['name']} | {c['bytes']:.0f} | " + " | ".join("—" if v is None else f"{v:.3g}" for v in vals) + " |")
            front = frontier(table)
            print(f"\nfrontier: {', '.join(front)}; layered on it: {', '.join(n for n in front if n.startswith('lay')) or 'none'}\n")


def median_of(norm, s, arm, m):
    v = [x[m] for x in norm.get((s, arm), {}).values() if m in x]
    return statistics.median(v) if v else None


def block_of(arm):
    return 8 if arm == "whole" else 16 if arm == "sep-g32" else int(arm.split("-")[1][1:])


def pair(norm, s, x, y, m, unread):
    """'x', 'y' (the lower) or 'not resolved' for metric m, rounds paired, a gated block or arm never read."""
    for a in (x, y):
        b = block_of(a)
        if (s, b) in unread or (s, b, "ctrl" if a == "whole" else a) in unread or (s, b, "ctrl-aa") in unread:
            return "not resolved"
    X, Y = norm.get((s, x), {}), norm.get((s, y), {})
    d = [math.log(X[r][m] / Y[r][m]) for r in X if r in Y and m in X[r] and m in Y[r]]
    return {"A": "x", "B": "y"}.get(decided(d)[0], "not resolved")


def config_bytes(e):
    """Each configuration's bytes per role at the role's target PSNR (layered: base as coded; exact: the bytes an ask
    adds to what the high view holds, the mean over i = 0 … F − 2)."""
    out = {}
    F, low = e["frames"], e["low_bytes"]
    for k, c in e["layered"].items():
        u = c["units"]
        tops = [a - b for a, b in zip(u["top"], u["middle"])]
        ask = statistics.mean(sum(tops[i - i % int(k):i + 1]) + (low[i] if low else 0) for i in range(F - 1))
        high = at_psnr([tuple(v) for v in c["tried"].values()], e["target"]["high"]) or sum(u["middle"])
        out[f"lay-k{k}"] = {"cheap view": sum(u["base"]), "high view": high, "exact on request": ask}
    for g, roles in e["separate"].items():
        h, ch = roles["high"], roles["cheap"]
        out[f"sep-g{g}"] = {"cheap view": at_psnr([tuple(v) for v in ch["tried"].values()], e["target"]["cheap"]) or sum(ch["units"]),
                            "high view": at_psnr([tuple(v) for v in h["tried"].values()], e["target"]["high"]) or sum(h["units"]),
                            "exact on request": statistics.mean(h["residual_units"][:F - 1])}
    out["whole"] = {"exact on request": statistics.mean(e["htj2k_bytes"][:F - 1])}
    return out


if __name__ == "__main__":
    main()
