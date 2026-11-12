"""Stage 3's readings against §Improve's rule: per set and cell, each arm's times (median of rounds), the ratios the
rule names paired by round, s = p90 of |D′/D − 1| for the same quantity, and the decode-bound cells.
lab/htj2k-tiles/improve/README.md §Stage 3

    summary.py ROWS.jsonl [ROWS.jsonl ...]
"""
import json
import sys
from collections import defaultdict
from statistics import median

LINK_BOUND = {("r5000", "clean"), ("r20000", "clean"), ("lte-good", "clean"), ("wifi-home", "clean")}
# The rule's ratios: (name, numerator arm and quantity, denominator arm and quantity).
RATIOS = [
    ("J4/R3 D+T3 Lossless ÷ D", ("D+T3", "losslessMs"), ("D", "losslessMs")),
    ("J6 D+L★ level ÷ D Lossless", ("D+L★", "levelMs"), ("D", "losslessMs")),
    ("R4 D+L★ level ÷ D+T3 Lossless", ("D+L★", "levelMs"), ("D+T3", "losslessMs")),
    ("J7/R4 D+L★ Lossless ÷ D+T3", ("D+L★", "losslessMs"), ("D+T3", "losslessMs")),
    ("J8/R5 S★ first ÷ D", ("S★", "firstMs"), ("D", "firstMs")),
    ("J8/R5 S★ every slice ÷ D", ("S★", "allMs"), ("D", "allMs")),
]


def p90(xs):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(0.9 * len(xs)))] if xs else None


def main():
    rows = [json.loads(l) for f in sys.argv[1:] for l in open(f) if l.strip()]
    kept = [r for r in rows if not r.get("void") and not r.get("failed")]
    print(f"visits {len(rows)}, kept {len(kept)}, void {sum(bool(r.get('void')) for r in rows)}, failed {sum(bool(r.get('failed')) for r in rows)}")
    bad = [r for r in kept if r["exact"] != r["owed"] or not r["losslessExact"]]
    print(f"R0: pictures exact in every kept visit: {'yes' if not bad else f'NO, {len(bad)} visits'}")
    oq = defaultdict(set)
    for r in kept:
        if r.get("oqDigest"):
            oq[r["vol"]].add(r["oqDigest"])
    print("OQ pictures, one digest per volume across its D visits:", {v: len(d) for v, d in oq.items()})
    j10 = [r for r in kept if r["arm"] in ("S★", "D+L★")]
    miss = [r for r in j10 if not r.get("reopen") or r["reopen"]["wouldAsk"] or r["reopen"]["bandsAgain"] or r["reopen"]["decodes"] or r["reopen"]["same"] != r["N"]]
    print(f"J10/R6: reopens of S★ and D+L★ with 0 asks, 0 decodes, every slice the same: {len(j10) - len(miss)}/{len(j10)}")

    by = defaultdict(dict)
    for r in kept:
        by[(r["set"], r["link"], r["impairment"], r["throttle"])].setdefault(r["arm"], {})[r["round"]] = r
    decode_bound = set()
    for (s, link, imp, th), arms in by.items():
        one = by.get((s, link, imp, 1), {}).get("D", {})
        if th == 4 and one and arms.get("D"):
            if median(r["allMs"] for r in arms["D"].values()) > 1.05 * median(r["allMs"] for r in one.values()):
                decode_bound.add((s, link, imp))
    print("decode-bound cells (D's every-slice time at 4× over 1.05 × 1×):", sorted(decode_bound) or "none")

    print("\nper set and cell: each arm's first · every slice · Lossless (level) ms, medians of rounds; then the rule's ratios, median of rounds [s]")
    for key in sorted(by):
        s, link, imp, th = key
        arms = by[key]
        bound = "link-bound" if (link, imp) in LINK_BOUND and (s, link, imp) not in decode_bound else "not link-bound"
        cells = []
        for a in ("D", "D′", "D+T3", "D+L★", "S★"):
            rs = list(arms.get(a, {}).values())
            if not rs:
                continue
            lv = [r["levelMs"] for r in rs if r.get("levelMs")]
            cells.append(f"{a} {median(r['firstMs'] for r in rs):.0f} · {median(r['allMs'] for r in rs):.0f} · {median(r['losslessMs'] for r in rs if r.get('losslessMs') is not None):.0f}"
                         + (f" ({median(lv):.0f})" if lv else "") + f" n={len(rs)}")
        print(f"{s} {link} {imp} {th}× [{bound}]: " + " | ".join(cells))
        for name, (na, nq), (da, dq) in RATIOS:
            num, den, twin = arms.get(na, {}), arms.get(da, {}), arms.get("D′", {})
            rounds = [k for k in num if k in den and num[k].get(nq) and den[k].get(dq)]
            if not rounds:
                continue
            ratio = median(num[k][nq] / den[k][dq] for k in rounds)
            aa = [abs(twin[k][dq] / den[k][dq] - 1) for k in den if k in twin and twin[k].get(dq) and den[k].get(dq)]
            print(f"    {name}: ×{ratio:.3f} (n={len(rounds)}) [s {p90(aa):.3f}]" if aa else f"    {name}: ×{ratio:.3f} (n={len(rounds)})")
    verdicts(by, decode_bound)


def ratio(arms, num, den):
    """Median over rounds of num ÷ den, paired by round, and s: the p90 of |D′/D − 1| on den's quantity."""
    (na, nq), (da, dq) = num, den
    n, d, twin, dd = arms.get(na, {}), arms.get(da, {}), arms.get("D′", {}), arms.get("D", {})
    rounds = [k for k in n if k in d and n[k].get(nq) and d[k].get(dq)]
    if not rounds:
        return None, None
    aa = [abs(twin[k][dq] / dd[k][dq] - 1) for k in dd if k in twin and twin[k].get(dq) and dd[k].get(dq)]
    return median(n[k][nq] / d[k][dq] for k in rounds), (p90(aa) if aa else 0.0)


def verdicts(by, decode_bound):
    """§Improve's rule: a bound b is missed only past b × (1 + s); strict readings beside."""
    def cells(vol, th, link_bound=True):
        out = []
        for (s, link, imp, t), arms in sorted(by.items()):
            if s != vol or t != th:
                continue
            if link_bound and ((link, imp) not in LINK_BOUND or (s, link, imp) in decode_bound):
                continue
            out.append(((link, imp), arms))
        return out

    def tally(rows, num, den, bound):
        got = [(c, *ratio(a, num, den)) for c, a in rows]
        got = [(c, r, sv) for c, r, sv in got if r is not None]
        ok = sum(r <= bound * (1 + sv) for _, r, sv in got)
        strict = sum(r <= bound for _, r, _ in got)
        return ok, strict, len(got), [(c, round(r, 3), round(sv, 3)) for c, r, sv in got]

    print("\nverdicts (cells link-bound unless said; ok with s / strict / of)")
    lb = cells("dbts_b1/phone", 4)
    ok, st, n, got = tally(lb, ("D+T3", "losslessMs"), ("D", "losslessMs"), 0.92)
    every = [tally(cells(v, th, False), ("D+T3", "losslessMs"), ("D", "losslessMs"), 1.02) for v in ("dbts_a1/phone", "dbts_b1/phone", "dbts_c1/phone", "dbts_c1/sideways") for th in (1, 4)]
    print(f"R3 D+T3 ≤ ×0.92 of D, dbts_b1 4×: {ok}/{st}/{n} {got}; ≤ ×1.02 in every cell: {sum(e[0] for e in every)}/{sum(e[1] for e in every)}/{sum(e[2] for e in every)}")
    for e in every:
        bad = [g for g in e[3] if g[1] > 1.02 * (1 + g[2])]
        if bad:
            print("    over ×1.02 with s:", bad)
    for th in (1, 4):
        a = tally(cells("dbts_b1/phone", th), ("D+L★", "levelMs"), ("D+T3", "losslessMs"), 0.40)
        b = tally(cells("dbts_b1/phone", th), ("D+L★", "losslessMs"), ("D+T3", "losslessMs"), 1.08)
        print(f"R4 dbts_b1 {th}×: level ≤ ×0.40 of D+T3 {a[0]}/{a[1]}/{a[2]} {a[3]}; Lossless ≤ ×1.08 {b[0]}/{b[1]}/{b[2]} {b[3]}")
    for th in (1, 4):
        for v in ("dbts_a1/phone", "dbts_b1/phone", "dbts_c1/phone", "dbts_c1/sideways"):
            f = tally(cells(v, th, False), ("S★", "firstMs"), ("D", "firstMs"), 1.5)
            e = tally(cells(v, th, False), ("S★", "allMs"), ("D", "allMs"), 1.25)
            print(f"R5 {v} {th}×, every cell: first ≤ ×1.5 {f[0]}/{f[1]}/{f[2]}; every slice ≤ ×1.25 {e[0]}/{e[1]}/{e[2]}")
    print("J11, r20000 l1 ÷ clean r20000 of each ratio:")
    for (s, link, imp, th), arms in sorted(by.items()):
        if (link, imp) != ("r20000", "l1"):
            continue
        clean = by.get((s, "r20000", "clean", th), {})
        parts = []
        for name, num, den in RATIOS:
            lossy, _ = ratio(arms, num, den)
            base, _ = ratio(clean, num, den)
            if lossy and base:
                parts.append(f"{name.split()[0]} ×{lossy / base:.2f}")
        print(f"    {s} {th}×: " + ", ".join(parts))


if __name__ == "__main__":
    main()
