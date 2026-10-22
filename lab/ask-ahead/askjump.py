#!/usr/bin/env python3
"""ASKJUMP: cells.py's rows for arms A (today), Ap (today again, the A/A arm) and B (`?askJump`), decoding on,
read by lab/scripts/aa_rule.py, strict (rounds a `VOID` visit touched dropped from the cell) and round-paired.

Per cell and measure — the ask's decoder wait (`decodeEnd − lastByte`), the ask's total, the fill — B/A and A′/A
at the median, the A/A spread, the loss the rule catches, and its verdict; and A's and B's decoder wait,
median / p90. The rule is docs/decode/README.md §An ask behind the decoders.

usage: askjump.py ROWS.jsonl   — lab/ask-ahead/README.md
"""
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from aa_rule import judge  # noqa: E402

BAR = 0.05
KEYS = ("ask_decoder_ms", "ask_ms", "fill_ms")


def series(rows, cell, key, strict):
    """{"ref", "aa", "arm"}, one value a round in round order, None where the round has no exact value."""
    rs = [r for r in rows if r["cell"] == cell]
    void = {r["round"] for r in rs if r["void"]} if strict else set()
    by = {(r["round"], r["arm"]): r for r in rs}
    rounds = sorted({r["round"] for r in rs})

    def value(rnd, arm):
        r = by.get((rnd, arm))
        return r[key] if r and r["exact"] and not r["error"] and rnd not in void else None

    return {k: [value(n, a) for n in rounds] for k, a in (("ref", "A"), ("aa", "Ap"), ("arm", "B"))}


def p(values, q):
    v = sorted(x for x in values if x is not None)
    return v[min(len(v) - 1, int(q * len(v)))] if v else None


def reading(rows, cells, strict):
    print(f"\n== {'strict' if strict else 'round-paired'}")
    print("cell                       measure   n   A med / p90    B med / p90     B/A     A'/A   A/A sd   MDL   verdict")
    for cell in cells:
        for key in KEYS:
            s = series(rows, cell, key, strict)
            v = judge({cell: s}, None, BAR)[cell]
            a, b = s["ref"], s["arm"]
            print(f"{cell:26} {key[:-3]:12} {v['n']:2} {p(a, .5):6.0f} / {p(a, .9):5.0f}  {p(b, .5):6.0f} / {p(b, .9):5.0f}"
                  f"  ×{v['arm']:.3f}  ×{v['aa']:.3f}  {v['sd']:6.1%}  {v['mdl']:5.1%}  {v['verdict']}")


def main():
    rows = [json.loads(line) for line in open(sys.argv[1])]
    print(json.dumps(rows[0]))
    rows = [r for r in rows[1:] if "cell" in r]
    bad = [r for r in rows if not r["exact"] or r["error"]]
    print(f"runs {len(rows)}, rounds {len({r['round'] for r in rows})}, VOID {sum(r['void'] for r in rows)}, "
          f"not exact or failed {len(bad)}")
    for arm in ("A", "Ap", "B"):
        print(arm, next((r["page"] for r in rows if r["arm"] == arm), None))
    cells = list(dict.fromkeys(r["cell"] for r in rows))
    reading(rows, cells, True)
    reading(rows, cells, False)


if __name__ == "__main__":
    main()
