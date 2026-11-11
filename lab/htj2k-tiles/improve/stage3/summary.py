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


if __name__ == "__main__":
    main()
