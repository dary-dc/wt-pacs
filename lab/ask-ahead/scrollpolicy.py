#!/usr/bin/env python3
"""SCROLLPOLICY: cells.py's rows for a scroll ahead of the fill under three policies, on today's server (E, its A/A
arm Ep, C `?scroll=cursor`, F `?scroll=aim`) and on QW's (the same with a Q), read by lab/scripts/aa_rule.py strict
(rounds a `VOID` visit touched dropped from the cell) and round-paired, and judged by the rule docs/WIRE.md
§What a scroll ahead asks fixed before the data.

usage: scrollpolicy.py ROWS.jsonl   — lab/ask-ahead/README.md
"""
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from aa_rule import judge  # noqa: E402

BAR = 0.05
VOID_SHARE = 0.20
AA_BAND = (0.90, 1.10)
REGIMES = {"below R ÷ S": ("18/46/fifo20@10#scroll500", "103/46/fifo20@10#scroll100"),
           "above R ÷ S": ("18/46/fifo20@10#scroll100", "103/46/fifo20@10#scroll20")}


def series(rows, cell, key, ref, aa, arm, strict):
    """{"ref", "aa", "arm"}, one value a round in round order, None where the round has no exact value."""
    rs = [r for r in rows if r["cell"] == cell]
    void = {r["round"] for r in rs if r["void"]} if strict else set()
    by = {(r["round"], r["arm"]): r for r in rs}
    rounds = sorted({r["round"] for r in rs})

    def value(rnd, a):
        r = by.get((rnd, a))
        return r[key] if r and r["exact"] and not r["error"] and rnd not in void else None

    return {k: [value(n, a) for n in rounds] for k, a in (("ref", ref), ("aa", aa), ("arm", arm))}


def median(rows, cell, arm, key):
    v = [r[key] for r in rows if r["cell"] == cell and r["arm"] == arm and r[key] is not None]
    return statistics.median(v) if v else None


def wins(stale, fill):
    if "better" in stale and fill["verdict"] != "worse":
        return "wins"
    if "better" in stale:
        return "trade-off"
    return "no"


def reading(rows, cells, strict):
    print(f"\n== {'strict' if strict else 'round-paired'}")
    print("cell                                   arm  measure  n   ref med   arm med    ×ref   A/A    MDL   verdict")
    out = {}
    for cell in cells:
        names = cell.partition(":")[2].split(",")
        ref, aa, arms = names[0], names[1], names[2:]
        for arm in arms:
            v = {}
            for key in ("ask_ms", "fill_ms"):
                s = series(rows, cell, key, ref, aa, arm, strict)
                v[key] = judge({cell: s}, None, BAR)[cell]
                print(f"{cell:38} {arm:4} {'stale' if key == 'ask_ms' else 'fill':6} {v[key]['n']:2} "
                      f"{median(rows, cell, ref, key):8.0f}  {median(rows, cell, arm, key):8.0f}  ×{v[key]['arm']:.3f} "
                      f"×{v[key]['aa']:.3f} {v[key]['mdl']:5.1%}  {v[key]['verdict']}")
            print(f"{'':38} {arm:4} rest      {median(rows, cell, ref, 'rest_ms'):8.0f}  {median(rows, cell, arm, 'rest_ms'):8.0f}")
            out[(cell, arm.removeprefix("Q"))] = (wins(v["ask_ms"]["verdict"], v["fill_ms"]), v["ask_ms"]["arm"], v)
    return out


def void(rows, cell):
    """Why a cell is VOID by the rule, or None: its share of `VOID` visits, or its A/A outside the band."""
    rs = [r for r in rows if r["cell"] == cell]
    share = sum(r["void"] for r in rs) / len(rs)
    names = cell.partition(":")[2].split(",")
    aa = [judge({cell: series(rows, cell, k, names[0], names[1], names[1], False)}, None, BAR)[cell]["aa"]
          for k in ("ask_ms", "fill_ms")]
    why = [f"{share:.0%} of visits VOID"] if share > VOID_SHARE else []
    why += [f"A/A ×{a:.3f}" for a in aa if not AA_BAND[0] <= a <= AA_BAND[1]]
    return ", ".join(why) or None, share, aa


def verdict(cells, voids, readings):
    print("\n== the rule")
    for server, prefix in (("today's server", ""), ("QW's server", "Q")):
        for regime, links in REGIMES.items():
            mine = [c for c in cells if c.partition(":")[0] in links and c.partition(":")[2].startswith(prefix + "E,")]
            if any(voids[c] for c in mine):
                print(f"{server}, {regime}: not resolved on this host (VOID: "
                      + "; ".join(f"{c.partition(':')[0]} {voids[c]}" for c in mine if voids[c]) + ")")
                continue
            calls = {}
            for name, rd in readings.items():
                winners = [a for a in ("C", "F") if all(rd[(c, a)][0] == "wins" for c in mine)]
                traded = [a for a in ("C", "F") if a not in winners and all(rd[(c, a)][0] != "no" for c in mine)]
                best = min(winners, key=lambda a: max(rd[(c, a)][1] for c in mine)) if winners else "E"
                calls[name] = best + "".join(f", {a} a trade-off" for a in traded)
            if len(set(calls.values())) > 1:
                print(f"{server}, {regime}: not resolved on this host (readings disagree: {calls})")
            else:
                print(f"{server}, {regime}: {calls['strict']}")


def main():
    rows = [json.loads(line) for line in open(sys.argv[1])]
    print(json.dumps(rows[0]))
    rows = [r for r in rows[1:] if "cell" in r]
    bad = [r for r in rows if not r["exact"] or r["error"]]
    print(f"runs {len(rows)}, rounds {len({r['round'] for r in rows})}, VOID {sum(r['void'] for r in rows)}, "
          f"not exact or failed {len(bad)}")
    for arm in dict.fromkeys(r["arm"] for r in rows):
        print(arm, next(r["settings"] for r in rows if r["arm"] == arm))
    cells = [c for c in dict.fromkeys(r["cell"] for r in rows) if "," in c]
    voids = {}
    for cell in cells:
        voids[cell], share, aa = void(rows, cell)
        print(f"{cell:38} VOID visits {share:4.0%}  A/A stale ×{aa[0]:.3f} fill ×{aa[1]:.3f}  {voids[cell] and 'VOID: ' + voids[cell] or ''}")
    if not any(len(c.partition(":")[2].split(",")) > 2 for c in cells):
        return
    readings = {"strict": reading(rows, cells, True), "round-paired": reading(rows, cells, False)}
    verdict(cells, voids, readings)


if __name__ == "__main__":
    main()
