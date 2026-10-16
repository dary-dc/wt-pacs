#!/usr/bin/env python3
"""ONEQUEUEMEASURE (row 253): cells.py's rows for candidate 1 of docs/WIRE.md §Proposed: one queue (Q, and QW with
`--send-window-follows-cwnd`) and candidate 3 with the window (TW), each against today (T) with T again (Tp) as the
A/A arm, read per cell and measure as refill.py reads its arm: rounds' first half confirmed by the second, strict and
round-paired.

Rule: the better of Q and QW (fewer cells worse, then more better, then the lower geometric mean of its ratios)
becomes the default if none of its asks or fills is worse; worse in any cell is a trade-off, those cells its cost.

usage: onequeue.py ROWS.jsonl   — lab/ask-ahead/README.md
"""
import json
import math
import statistics
import sys

from refill import verdict

ARMS = ("Q", "QW", "TW")
MEASURES = ("ask_ms", "fill_ms")


def reading(rows, cells, split, strict):
    name = "strict" if strict else "round-paired"
    print(f"\n== {name}\ncell                 measure  n   T ms   Tp/T  A/A sd   MDL  " + "  ".join(f"{a + '/T':>6} verdict       " for a in ARMS))
    out = {}
    for cell in cells:
        for key in MEASURES:
            vs = {a: verdict(rows, cell, key, strict, a, split) for a in ARMS}
            out.update({(a, cell, key): v for a, v in vs.items()})
            v = vs["Q"]
            if "arm" not in v:
                print(f"{cell:20} {key[:-3]:7} {v['n']:2} complete rounds: {v['verdict']}")
                continue
            print(f"{cell:20} {key[:-3]:7} {v['n']:2} {v['t_ms']:6.0f}  ×{v['aa']:.3f} {v['sd']:6.1%} {v['mdl']:5.1%}  "
                  + "  ".join(f"×{vs[a].get('arm', math.nan):.3f} {vs[a]['verdict']:14}" for a in ARMS))
    for a in ARMS:
        worse = [f"{c} {k[:-3]}" for (b, c, k), v in out.items() if b == a and v["verdict"] == "worse"]
        unsure = [f"{c} {k[:-3]}" for (b, c, k), v in out.items()
                  if b == a and v["verdict"] not in ("worse", "better", "tie")]
        print(f"{a}: worse in {worse or 'none'}; not conclusive in {unsure or 'none'}")
    best = min(("Q", "QW"), key=lambda a: score(out, a))
    worse = [f"{c} {k[:-3]}" for (b, c, k), v in out.items() if b == best and v["verdict"] == "worse"]
    rule = f"{best} becomes the default" if not worse else f"{best} is a trade-off: worse in " + ", ".join(worse)
    print(f"{name} rule: {rule}")
    return rule


def score(out, arm):
    vs = [v for (a, _, _), v in out.items() if a == arm and "arm" in v]
    return (sum(v["verdict"] == "worse" for v in vs), -sum(v["verdict"] == "better" for v in vs),
            statistics.geometric_mean(v["arm"] for v in vs))


def main():
    rows = [json.loads(line) for line in open(sys.argv[1])]
    print(json.dumps(rows[0]))
    rows = [r for r in rows if "cell" in r]
    rounds = sorted({r["round"] for r in rows})
    cells = list(dict.fromkeys(r["cell"] for r in rows))
    print(f"runs {len(rows)}, rounds {len(rounds)}, VOID {sum(r['void'] for r in rows)}, "
          f"not exact or failed {sum(not r['exact'] or bool(r['error']) for r in rows)}")
    s, p = (reading(rows, cells, len(rounds) // 2, strict) for strict in (True, False))
    agree = s.split(":")[0] == p.split(":")[0]
    print(f"\nverdict: {s.split(':')[0] if agree else 'the readings disagree'} (strict: {s} | round-paired: {p})")


if __name__ == "__main__":
    main()
