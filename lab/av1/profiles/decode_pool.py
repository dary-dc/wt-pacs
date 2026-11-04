#!/usr/bin/env python3
"""The amended decode protocol's analysis (README.md §Profiles decode protocol, amended): each block's checks and A/A,
its ratios paired by round, the blocks pooled, D1–D3 against their bands; with --size, n and the round time from a
pilot block. A block is one rows file of decode_block.mjs, one host; ms never leave their block.

usage: decode_pool.py ROWS.json [ROWS.json ...] [--size --hours 4.5 --setup-hours S --sessions 6] [--links]
       decode_pool.py --test
"""
import json
import math
import statistics as st
import sys
from collections import defaultdict

RESOLUTION = math.log(1.05)  # §6: n by power to see a 5 % ratio (RESIDAPART's sizing)
ORDER_LIMIT = 0.10  # docs/rig-limits.md §6
MIN_ROUNDS = 10  # §6's floor
RATES = (5e6, 50e6)
# §2: D1 from row PREVIEW, D2 derived ((G + 1) ÷ 2 lossy decodes), D3 from RESIDAPART's own prediction.
BANDS = {"D1": (0.0, 1.0), "D2": (5.0, 9.0), "D3": (0.9, 1.1)}


def t_quantile(p, df):
    """Student's t quantile: exact for df 1 and 2, Cornish–Fisher above (within 0.2 % of tables at df ≥ 3)."""
    if df == 1:
        return math.tan(math.pi * (p - 0.5))
    if df == 2:
        return (2 * p - 1) / math.sqrt(2 * p * (1 - p))
    z = st.NormalDist().inv_cdf(p)
    return (z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2)
            + (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3))


def interval(v):
    """Mean of v and its 95 % t interval; None when fewer than two values."""
    if len(v) < 2:
        return None
    m, h = st.mean(v), t_quantile(0.975, len(v) - 1) * st.stdev(v) / math.sqrt(len(v))
    return m, m - h, m + h


def figure(r):
    """A row's figure, ms: the median frame for H, R and in order; for a jump the mean over the middle 16 of
    written(k) − handed(the keyframe k's chain began at). None when an error cut the row."""
    if r.get("error") or not r.get("frames"):
        return None
    if r["pattern"] != "jump":
        return st.median(w - h for _, h, w, _ in r["frames"])
    seen = {i: (h, w) for i, h, w, _ in r["frames"]}
    mid = sorted(seen)[-16:] if len(seen) >= 16 else None
    g = r["g"]
    if mid is None or any(k - k % g not in seen for k in mid):
        return None
    return st.mean(seen[k][1] - seen[k - k % g][0] for k in mid)


def on_link(r, rate):
    """*Derived*: the row's figure on a link of `rate` bit/s, §6's pacer replayed over its measured decode times —
    unit j released bytes ÷ rate after unit j − 1, handed in at the later of that and the previous frame written.
    In order: the median interval between frames written; a jump: from its first byte to frame k written."""
    if figure(r) is None:
        return None
    chains = defaultdict(list)
    for i, h, w, b in r["frames"]:
        chains[i - i % r["g"] if r["pattern"] == "jump" else 0].append((i, w - h, b))
    out = {}
    for s, chain in chains.items():
        release = written = 0.0
        for i, d, b in chain:
            release += b * 8 * 1000 / rate
            written = max(release, written) + d
            out[i] = written
    ks = sorted(out)[-16:]
    if r["pattern"] == "jump":
        return st.mean(out[k] for k in ks)
    return st.median(b - a for a, b in zip([out[k] for k in ks], [out[k] for k in ks][1:]))


def failed(r):
    return bool(r.get("error")) or any(ok != n for ok, n in (r.get("checks") or {}).values())


def unit(r):
    return r.get("unit")


# (question, numerator unit, denominator unit, band). Units: H, H′, R|<form>, S<G>|<decoder>|<pattern>.
def ratios(forms, decs=("dav1d", "webcodecs")):
    out = [("A/A", "H′", "H", None)]
    out += [("D1", f"S{g}|webcodecs|order", "H", "D1") for g in (1, 8, 16)]
    out += [("D2", f"S16|{d}|jump", f"S1|{d}|jump", "D2") for d in decs]
    out += [("D3", f"R|{f}", "H", "D3") for f in forms]
    out += [("jump G", f"S8|{d}|jump", f"S1|{d}|jump", None) for d in decs]
    out += [("in order G", f"S{g}|{d}|order", f"S1|{d}|order", None) for d in decs for g in (8, 16)]
    out += [("decoder", f"S{g}|dav1d|{p}", f"S{g}|webcodecs|{p}", None) for g in (1, 8, 16) for p in ("order", "jump")]
    out += [("÷ H", f"S{g}|{d}|{p}", "H", None) for g in (1, 8, 16) for d in decs for p in ("order", "jump")]
    return out


def paired(rows, num, den, fig=figure):
    """ln(num ÷ den) by round, with num's predecessor: [(round, ln, prev)]."""
    by = {(r["round"], unit(r)): r for r in rows}
    out = []
    for (rnd, u), r in sorted(by.items(), key=lambda x: str(x[0])):
        if u != num or (rnd, den) not in by:
            continue
        a, b = fig(r), fig(by[(rnd, den)])
        if a and b:
            out.append((rnd, math.log(a / b), r["prev"]))
    return out


def order_effect(p):
    """The largest |median by predecessor ÷ median − 1| of the ratio (docs/rig-limits.md §6)."""
    if len(p) < 2:
        return None
    m = st.median(math.exp(x) for _, x, _ in p)
    groups = defaultdict(list)
    for _, x, prev in p:
        groups[prev].append(math.exp(x))
    return max(abs(st.median(g) / m - 1) for g in groups.values())


def analyse(rows, links=False):
    """Every block's cells, its A/A, and the pooled verdicts. Returns (lines, verdicts)."""
    blocks = defaultdict(lambda: defaultdict(list))
    for r in rows:
        blocks[r["block"]][(r["set"], r["q"], r["throttle"])].append(r)
    lines, void = [], set()
    for b, cells in sorted(blocks.items()):
        rounds = {r["round"] for rs in cells.values() for r in rs}
        lines.append(f"block {b}: {len(rounds)} rounds, {sum(map(len, cells.values()))} rows")
        for c, rs in sorted(cells.items(), key=str):
            if any(failed(r) for r in rs):
                void.add((b, *c))
                lines.append(f"  void cell {c}: " + "; ".join(f"r{r['round']} {unit(r)} {r.get('checks')} {r.get('error') or ''}"[:200] for r in rs if failed(r))[:600])
        for t in sorted({c[2] for c in cells}):
            aa = [x for c, rs in cells.items() if c[2] == t and (b, *c) not in void for _, x, _ in paired(rs, "H′", "H")]
            ci = interval(aa)
            ok = ci is not None and -RESOLUTION <= ci[1] and ci[2] <= RESOLUTION
            lines.append(f"  A/A {t}x: H′ ÷ H {fmt(ci)} over {len(aa)} pairs — " + ("kept" if ok else "VOID: its 95 % interval leaves ±5 %"))
            if not ok:
                void |= {(b, *c) for c in cells if c[2] == t}

    pooled = defaultdict(dict)
    keys = sorted({c for cells in blocks.values() for c in cells}, key=str)
    for c in keys:
        forms = sorted({r["form"] for cells in blocks.values() for r in cells.get(c, []) if r["arm"] == "R"})
        for q, num, den, band in ratios(forms):
            per, effects, aa_effects = {}, [], []
            for b, cells in blocks.items():
                rs = cells.get(c, [])
                p = paired(rs, num, den)
                if p and (b, *c) not in void:
                    per[b] = p
            if not per:
                continue
            allp = [x for p in per.values() for x in p]
            aap = [x for b in per for x in paired(blocks[b][c], "H′", "H")]
            eff, aa_eff = order_effect(allp), order_effect(aap)
            m = [st.mean(x for _, x, _ in p) for p in per.values()]
            n = [len(p) for p in per.values()]
            ci = interval(m) if len(m) > 1 else interval([x for _, x, _ in allp])
            why = []
            if len(m) < 2:
                why.append("one block")
            if min(n) < MIN_ROUNDS:
                why.append(f"a block under {MIN_ROUNDS} rounds")
            if eff is not None and eff > ORDER_LIMIT and (aa_eff is None or eff > aa_eff):
                why.append(f"order {eff:.0%} over 10 % and over the A/A's {aa_eff or 0:.0%}")
            state = "read" if not why else "not read: " + ", ".join(why)
            verdict = None
            if band and ci and not why:
                lo, hi = BANDS[band]
                e = [math.exp(x) for x in ci]
                verdict = "held" if lo <= e[1] and e[2] <= hi else "refuted" if e[2] < lo or e[1] > hi else "not decided"
            pooled[c][(q, num, den)] = dict(ci=ci, blocks=len(m), n=n, effect=eff, state=state, band=band, verdict=verdict)
            line = f"  {c[0]} Q{c[1]} {c[2]}x  {q:<10} {num} ÷ {den}: {fmt(ci)}  blocks {len(m)} n {n}  order {pct(eff)} (A/A {pct(aa_eff)})  {state}"
            if verdict:
                line += f"  {band} {BANDS[band]}: {verdict}"
            if links:
                for rate in RATES:
                    lp = [x for b in per for x in paired(blocks[b][c], num, den, lambda r: on_link(r, rate))]
                    line += f"\n      derived at {rate / 1e6:g} Mbit/s: {fmt(interval([x for _, x, _ in lp]))}"
            lines.append(line)
    verdicts = {}
    for d in BANDS:
        v = [x["verdict"] for cell in pooled.values() for x in cell.values() if x["band"] == d]
        verdicts[d] = ("refuted" if "refuted" in v else "held" if v and all(x == "held" for x in v)
                       else f"not decided ({sum(x is None for x in v)} of {len(v)} cells not read, "
                            f"{v.count('not decided')} undecided)")
    return lines, verdicts, pooled


def fmt(ci):
    if not ci:
        return "—"
    m, lo, hi = (math.exp(x) for x in ci)
    return f"{m:.3f} [{lo:.3f}–{hi:.3f}]"


def pct(x):
    return "—" if x is None else f"{x:.0%}"


def size(rows, hours, setup_hours, sessions):
    """From one pilot block: σ of ln(ratio) over its rounds, per (cell, ratio); the blocks' rounds that see 5 % with
    80 % power on a t over `sessions` blocks; and the rounds that fit `hours` less setup, from the pilot's round time."""
    cells = defaultdict(list)
    for r in rows:
        cells[(r["set"], r["q"], r["throttle"])].append(r)
    need = []
    k = t_quantile(0.975, sessions - 1) + t_quantile(0.80, sessions - 1)
    for c, rs in cells.items():
        forms = sorted({r["form"] for r in rs if r["arm"] == "R"})
        for q, num, den, band in ratios(forms):
            p = [x for _, x, _ in paired(rs, num, den)]
            if len(p) > 2:
                s = st.stdev(p)
                total = math.ceil((k * s / RESOLUTION) ** 2)
                need.append((max(MIN_ROUNDS, math.ceil(total / sessions)), s, c, q, num, den))
    need.sort(reverse=True, key=lambda x: x[0])
    walls = defaultdict(float)
    for r in {(r["round"], r["throttle"], r["set"], r["q"]): r for r in rows}.values():
        walls[r["round"]] += r["wall"]
    per = st.median(walls.values())
    fit = int((hours - setup_hours) * 3600 // per)
    print(f"a round: {per / 60:.1f} min (median of {len(walls)}); {fit} rounds fit {hours:g} h less {setup_hours:g} h of setup")
    print(f"rounds a block needs (t over {sessions} blocks, 5 %, 80 % power), largest first:")
    for n, s, c, q, num, den in need[:25]:
        print(f"  {n:5d}  σ {s:.4f}  {c[0]} Q{c[1]} {c[2]}x  {q}: {num} ÷ {den}" + ("" if n <= fit else "  DOES NOT FIT"))
    by_q = defaultdict(int)
    for n, *_rest in need:
        by_q[_rest[2]] = max(by_q[_rest[2]], n)
    print("largest by question: " + ", ".join(f"{q} {n}" for q, n in by_q.items()))


def test():
    """The pooling and the rule on made-up blocks whose answers are known."""
    import random

    def block(name, ratio, aa=1.0, rounds=12, spread=0.01, seed=0):
        rnd, rows = random.Random(seed), []
        for k in range(rounds):
            for u, base in (("H", 10.0), ("H′", 10.0 * aa), ("S16|dav1d|jump", 70.0 * ratio), ("S1|dav1d|jump", 10.0)):
                ms = base * math.exp(rnd.gauss(0, spread))
                pattern = "jump" if "jump" in u else None
                step = ms / 8.5 if u.startswith("S16") else None
                frames = ([[i, (i - 16) * step, (i - 15) * step, 1000] for i in range(16, 32)] if step
                          else [[i, 0.0, ms, 1000] for i in range(16, 32)])
                rows.append(dict(block=name, round=k, throttle=1, set="s", q=16, unit=u, prev=None, arm=u[0], form=None,
                                 dec="dav1d", g=16 if u.startswith("S16") else 1, pattern=pattern, wall=1.0,
                                 frames=frames, error=None, checks={"x": [1, 1]}))
        return rows

    def d2(rows):
        _, v, pooled = analyse(rows)
        return v["D2"], pooled[("s", 16, 1)][("D2", "S16|dav1d|jump", "S1|dav1d|jump")]

    # S16's chain decodes a frame every 70 ÷ 8.5 ms, so its mean jump, (1 + … + 16) ÷ 16 frames, is 70 ms; ÷ S1's 10 ms = 7.
    v, x = d2(block("a", 1.0) + block("b", 1.0, seed=1) + block("c", 1.0, seed=2))
    assert v == "held" and abs(math.exp(x["ci"][0]) - 7.0) < 0.1, (v, x)
    v, _ = d2(block("a", 1.5) + block("b", 1.5, seed=1) + block("c", 1.5, seed=2))
    assert v == "refuted", v
    v, _ = d2(block("a", 1.0) + block("b", 1.3, seed=1) + block("c", 0.7, seed=2))
    assert v.startswith("not decided"), v
    v, x = d2(block("a", 1.0))
    assert v.startswith("not decided") and "one block" in x["state"], (v, x)
    # A block whose A/A is 20 % off is void: the refuting block drops out and the other two hold.
    v, x = d2(block("a", 1.0) + block("b", 1.0, seed=1) + block("c", 1.5, aa=1.2, seed=2))
    assert v == "held" and x["blocks"] == 2, (v, x)
    # A failed check voids its block's cell.
    rows = block("a", 1.0) + block("b", 1.0, seed=1) + block("c", 1.5, seed=2)
    rows[-1]["checks"] = {"x": [0, 1]}
    v, x = d2(rows)
    assert v == "held" and x["blocks"] == 2, (v, x)
    # The link replay. In order: 1 000 B at 5 Mbit/s is 1.6 ms, under each 10 ms decode, so frames come every 10 ms;
    # 100 000 B is 160 ms, so every 160. A jump to the k-th frame of a chain: 1.6 ms for its keyframe, then 10 ms a frame.
    row = lambda pattern, b: dict(pattern=pattern, g=16, error=None, frames=[[i, 0.0, 10.0, b] for i in range(16, 32)])
    assert abs(on_link(row("order", 1000), 5e6) - 10) < 1e-9
    assert abs(on_link(row("order", 100000), 5e6) - 160) < 1e-9
    assert abs(on_link(row("jump", 1000), 5e6) - (1.6 + 85)) < 1e-9
    print("decode_pool.py: every test passed")


if __name__ == "__main__":
    if "--test" in sys.argv:
        test()
        sys.exit()
    paths = [a for a in sys.argv[1:] if a.endswith(".json")]
    rows = [r for p in paths for r in json.load(open(p)) if r.get("unit")]
    opt = lambda k, d: float(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
    if "--size" in sys.argv:
        size(rows, opt("--hours", 4.5), opt("--setup-hours", 0.0), int(opt("--sessions", 6)))
        sys.exit()
    lines, verdicts, _ = analyse(rows, "--links" in sys.argv)
    print("\n".join(lines))
    print("\nD1–D3, pooled over the kept blocks (held: the 95 % interval inside the band in every cell; refuted: outside it in one)")
    for d, v in verdicts.items():
        print(f"  {d} band {BANDS[d]}: {v}")
