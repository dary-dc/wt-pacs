#!/usr/bin/env python3
"""REFILLMEASURE (row 229): cells.py's rows for arms T, Tp (T again, the A/A arm) and TB (`?refill=head`), read
by lab/scripts/aa_rule.py, strict (rounds a `VOID` visit touched dropped from the cell) and round-paired.

Per cell, reading and measure (ask, fill): rounds 0–11 are the run and 12–23 its confirmation, so worse or better
is a flag in both; a half too short to flag at all leaves the cell undecided; any other cell is a tie when the loss
the rule catches at the pooled rounds' A/A spread is ≤ 5 %, else not conclusive. B becomes the default when, in
both readings, every cell is a tie or better and a 10 % cell's fill is better — docs/transport/link-conditions.md
§Re-measured, *ASKTHENFILL*.

usage: refill.py ROWS.jsonl   — lab/ask-ahead/README.md
"""
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from aa_rule import can_flag, judge  # noqa: E402

BAR = 0.05
SPLIT = 12
med = statistics.median


def series(rows, cell, key, strict, arm="TB"):
    """{"ref", "aa", "arm"}, one value a round in round order, None where the round has no exact value."""
    rs = [r for r in rows if r["cell"] == cell]
    void = {r["round"] for r in rs if r["void"]} if strict else set()
    by = {(r["round"], r["arm"]): r for r in rs}
    rounds = sorted({r["round"] for r in rs})

    def value(rnd, arm):
        r = by.get((rnd, arm))
        ok = r and r["exact"] and not r["error"] and rnd not in void
        return r[key] if ok else None

    return rounds, {k: [value(n, a) for n in rounds] for k, a in (("ref", "T"), ("aa", "Tp"), ("arm", arm))}


def cut(s, keep):
    return {k: [v for v, n in zip(vs, s["rounds"]) if keep(n)] for k, vs in s.items() if k != "rounds"}


def complete(s):
    return sum(None not in r for r in zip(s["ref"], s["aa"], s["arm"]))


def verdict(rows, cell, key, strict, arm="TB", split=SPLIT):
    rounds, s = series(rows, cell, key, strict, arm)
    s["rounds"] = rounds
    first, again, both = cut(s, lambda n: n < split), cut(s, lambda n: n >= split), cut(s, lambda n: True)
    halves = complete(first), complete(again)
    if not can_flag(min(halves)):
        return {"n": sum(halves), "verdict": "undecided at n = %d + %d" % halves}
    flagged = judge({cell: first}, {cell: again}, BAR)[cell]
    pooled = judge({cell: both}, None, BAR)[cell]
    v = flagged["verdict"] if flagged["verdict"] in ("worse", "better") else (
        "tie" if pooled["mdl"] <= BAR else "not conclusive")
    t = [x for x in both["ref"] if x is not None]
    return {**pooled, "verdict": v, "t_ms": med(t) if t else None}


def reading(rows, cells, strict):
    name = "strict" if strict else "round-paired"
    print(f"\n== {name}\ncell                     measure  n   T ms    TB/T    Tp/T    Δ ms   A/A sd   MDL    verdict")
    out = {}
    for cell in cells:
        for key in ("ask_ms", "fill_ms"):
            v = verdict(rows, cell, key, strict)
            out[(cell, key)] = v
            if "arm" not in v:
                print(f"{cell.split(':')[0]:24} {key[:-3]:7} {v['n']:2} complete rounds: {v['verdict']}")
                continue
            print(f"{cell.split(':')[0]:24} {key[:-3]:7} {v['n']:2} {v['t_ms']:7.0f}  ×{v['arm']:.3f}  ×{v['aa']:.3f} "
                  f"{(v['arm'] - 1) * v['t_ms']:+6.0f}  {v['sd']:6.1%}  {v['mdl']:5.1%}  {v['verdict']}")
    worse = [f"{c.split(':')[0]} {k[:-3]}" for (c, k), v in out.items() if v["verdict"] == "worse"]
    unsure = [f"{c.split(':')[0]} {k[:-3]}" for (c, k), v in out.items()
              if v["verdict"] not in ("worse", "better", "tie")]
    gain = [c.split(":")[0] for (c, k), v in out.items() if k == "fill_ms" and "@10" in c and v["verdict"] == "better"]
    rule = ("B becomes the default" if not worse and not unsure and gain else
            "B not adopted: worse in " + ", ".join(worse) if worse else
            "B not conclusive: " + ", ".join(unsure) if unsure else "B not adopted: no 10 % fill better")
    print(f"\n{name} rule: {rule}\n  10 % fills better: {gain or 'none'}")
    return rule.split(":")[0]


def main():
    rows = [json.loads(line) for line in open(sys.argv[1])]
    print(json.dumps(rows[0]))
    rows = [r for r in rows[1:] if "cell" in r]
    bad = [r for r in rows if not r["exact"] or r["error"]]
    print(f"runs {len(rows)}, rounds {len({r['round'] for r in rows})}, VOID {sum(r['void'] for r in rows)}, "
          f"not exact or failed {len(bad)}")
    cells = list(dict.fromkeys(r["cell"] for r in rows))
    s, p = reading(rows, cells, True), reading(rows, cells, False)
    final = s if s == p else "B not conclusive: the readings disagree"
    print(f"\nverdict: {final} ({s} | {p})")


if __name__ == "__main__":
    main()
