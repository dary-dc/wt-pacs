#!/usr/bin/env python3
"""STREAMSMEASURE (row 180): cells.py's rows for the four stream arms, read by the rule of
docs/native/quic-compared.md §9.5, strict (no `VOID` visit) and round-paired (`VOID` included).

An arm's spread in a cell is its [min, max] over rounds. Arm 4 (`asksfirst`) beats the better of
`shared` and `window` when its median ask is at most 0.85 of the lower of their medians; it is worse
beyond the spread when its median ask is above that arm's max. A fill is worse beyond its spread
when its median is above `shared`'s max fill in that cell. Short-queue cells are the fifo20 ones.

usage: streams.py ROWS.jsonl   — lab/ask-ahead/README.md
"""
import collections
import json
import statistics
import sys

ARMS = ("shared", "window", "perframe", "asksfirst")
rows = [json.loads(line) for line in open(sys.argv[1])]
head, rows = rows[0], [r for r in rows[1:] if "cell" in r]
print(json.dumps(head))
bad = [r for r in rows if not r["exact"] or r["error"]]
print(f"runs {len(rows)}, VOID {sum(r['void'] for r in rows)}, not exact or failed {len(bad)}")
cells = list(dict.fromkeys(r["cell"] for r in rows))
med = statistics.median


def runs(cell, arm, strict):
    """Strict keeps the rounds in which no arm of the cell was `VOID`, so every arm keeps the same rounds."""
    rs = [r for r in rows if r["cell"] == cell and not (r["error"] or not r["exact"])]
    void = {r["round"] for r in rs if r["void"]}
    return [r for r in rs if r["arm"] == arm and not (strict and r["round"] in void)]


def span(xs):
    return f"{med(xs):7.0f} [{min(xs):.0f}–{max(xs):.0f}]" if xs else "      –"


def reading(strict):
    name = "strict" if strict else "round-paired"
    print(f"\n== {name}\ncell                  arm        n  ask ms               fill ms              gap ms"
          "              RSS MB  cwnd@ask KB")
    verdicts = {}
    for cell in cells:
        by = {a: runs(cell, a, strict) for a in ARMS}
        for a in ARMS:
            rs = by[a]
            print(f"{cell:21} {a:9} {len(rs):2}  {span([r['ask_ms'] for r in rs]):19}  "
                  f"{span([r['fill_ms'] for r in rs]):19}  {span([r['gap_ms'] for r in rs]):18}  "
                  f"{med([r['rss_session_kb'] for r in rs]) / 1e3 if rs else 0:6.1f}  "
                  f"{med([r['cwnd_at_ask'] or 0 for r in rs]) / 1e3 if rs else 0:8.0f}")
        if not all(by.values()):
            verdicts[cell] = None
            continue
        ask = {a: [r["ask_ms"] for r in by[a]] for a in ARMS}
        best = min(("shared", "window"), key=lambda a: med(ask[a]))
        fill0 = max(r["fill_ms"] for r in by["shared"])
        verdicts[cell] = {
            "ratio": med(ask["asksfirst"]) / med(ask[best]), "best": best,
            "beats": med(ask["asksfirst"]) <= 0.85 * med(ask[best]),
            "worse": med(ask["asksfirst"]) > max(ask[best]),
            "fill_worse": [a for a in ARMS[1:] if med([r["fill_ms"] for r in by[a]]) > fill0],
            "arm3_vs_1": med(ask["perframe"]) / med(ask["shared"]),
            "fastest": min(ARMS, key=lambda a: med(ask[a])),
            "gap": {a: med([r["gap_ms"] for r in by[a]]) for a in ARMS},
            "rss": {a: med([r["rss_session_kb"] for r in by[a]]) for a in ARMS},
        }
    print(f"\n{name}: asksfirst against the better of shared and window, per cell")
    for cell, v in verdicts.items():
        if v is None:
            print(f"{cell:21} no rounds left")
            continue
        print(f"{cell:21} ×{v['ratio']:.3f} of {v['best']:6} beats≥15% {v['beats']!s:5} worse-beyond {v['worse']!s:5}"
              f" fastest {v['fastest']:9} perframe/shared ×{v['arm3_vs_1']:.3f} fill-worse {v['fill_worse']}")
    short = [v for c, v in verdicts.items() if "/fifo20" in c]
    if any(v is None for v in verdicts.values()):
        rule = "not conclusive: a cell has no rounds left"
    elif all(v["beats"] for v in short) and not any(v["worse"] for v in verdicts.values()):
        rule = "per-frame with ask-first becomes the default"
    elif any(v["beats"] for v in verdicts.values()):
        rule = "a trade-off for the owner"
    else:
        rule = "shared stays; the flag is not built further"
    fill = sorted({a for v in verdicts.values() if v for a in v["fill_worse"]})
    print(f"{name} rule: {rule}; arms with a fill worse beyond shared's spread somewhere: {fill or 'none'}")
    return rule


if __name__ == "__main__":
    print(f"\nreadings agree: {reading(True) == reading(False)}")
