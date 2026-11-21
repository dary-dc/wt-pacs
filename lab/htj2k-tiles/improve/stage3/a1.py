"""A1's readings against its rule (docs/htj2k-tiles.md §Verdict, A1): per set and cell, D+T3 ÷ D+T1, D+T1 ÷ D and
D+T3 ÷ D on the Lossless request, by summary.py's method (median of round-paired ratios; s = p90 of |D′/D − 1|).

    a1.py ROWS.jsonl [ROWS.jsonl ...]
"""
import json
import sys
from collections import defaultdict

from summary import ratio

RATIOS = [
    ("strips D+T3 ÷ D+T1", ("D+T3", "losslessMs"), ("D+T1", "losslessMs")),
    ("path D+T1 ÷ D", ("D+T1", "losslessMs"), ("D", "losslessMs")),
    ("D+T3 ÷ D", ("D+T3", "losslessMs"), ("D", "losslessMs")),
]


def main():
    rows = [json.loads(l) for f in sys.argv[1:] for l in open(f) if l.strip()]
    kept = [r for r in rows if not r.get("void") and not r.get("failed")]
    print(f"visits {len(rows)}, kept {len(kept)}, void {sum(bool(r.get('void')) for r in rows)}, "
          f"failed {sum(bool(r.get('failed')) for r in rows)}")
    bad = [r for r in kept if r["exact"] != r["owed"] or not r["losslessExact"]]
    print(f"R0: every picture exact in every kept visit: {'yes' if not bad else f'NO, {len(bad)} visits'}")
    by = defaultdict(dict)
    for r in kept:
        by[(r["set"], r["link"], r["throttle"])].setdefault(r["arm"], {})[r["round"]] = r
    for key in sorted(by):
        arms = by[key]
        n = " ".join(f"{a} n={len(arms.get(a, {}))}" for a in ("D", "D′", "D+T1", "D+T3"))
        paired = any(k in arms.get("D′", {}) for k in arms.get("D", {}))
        parts = []
        for name, num, den in RATIOS:
            x, s = ratio(arms, num, den)
            if x is None:
                parts.append(f"{name} —")
            else:
                parts.append(f"{name} ×{x:.3f} [{f's {s:.3f}' if paired else 'no D/D′ pair'}]")
        print(f"{key[0]} {key[1]} {key[2]}×  ({n}): " + "; ".join(parts))
    arms = by.get(("dbts_b1/phone", "r5000", 4), {})
    x, s = ratio(arms, RATIOS[0][1], RATIOS[0][2])
    if x is not None:
        keep = x <= 0.95 * (1 + s)
        print(f"\nrule, dbts_b1 r5000 4×: strips ×{x:.3f}, bound ×0.95 × (1 + {s:.3f}) = ×{0.95 * (1 + s):.3f}: "
              f"{'Layout 1 stays proposed for D+T3' if keep else 'D+T3 withdrawn; D+L★ alone carries Layout 1'}; "
              f"predicted ×0.96–0.99: {'inside' if 0.96 <= x <= 0.99 else 'outside'}")
        p, _ = ratio(arms, RATIOS[1][1], RATIOS[1][2])
        print(f"rule, D+T1 ÷ D ≤ ×0.95 (the product's exact path has an overhead): ×{p:.3f}: {'yes' if p <= 0.95 else 'no'}")


if __name__ == "__main__":
    main()
