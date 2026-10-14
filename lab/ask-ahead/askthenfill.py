#!/usr/bin/env python3
"""ASKTHENFILLMEASURE (row 210): cells.py's rows for arms T, TB, W, WB (and WA, Wc, WBc, the no-ask cells), read by the
rule of docs/transport/link-conditions.md §Re-measured, *ASKTHENFILL*, strict (rounds with no `VOID` visit in the
cell) and round-paired (`VOID` included).

An arm's spread in a cell is its [min, max] over rounds: worse beyond it is a median above T's max, better a median
below T's min. Short-queue cells are the fifo20 ones, as row 180 read them. `gap` is the first fill frame landing after
the asked one, less that frame's time on the wire at the link's rate: the idle wire between them.

usage: askthenfill.py ROWS.jsonl   — lab/ask-ahead/README.md
"""
import json
import statistics
import sys

rows = [json.loads(line) for line in open(sys.argv[1])]
head = rows[0]
rows = [r for r in rows[1:] if "cell" in r]
med = statistics.median
S = head["ask_bytes"]
print(json.dumps(head))
bad = [r for r in rows if not r["exact"] or r["error"]]
print(f"runs {len(rows)}, rounds {len({r['round'] for r in rows})}, VOID {sum(r['void'] for r in rows)}, "
      f"not exact or failed {len(bad)}")
cells = list(dict.fromkeys(r["cell"] for r in rows))


def link(cell):
    rate, rtt, queue = cell.split("@")[0].split("/")[:3]
    return float(rate), float(rtt), queue


def gap(r):
    if r["next_ms"] is None:
        return None
    return r["next_ms"] - r["next_bytes"] * 8 / (link(r["cell"])[0] * 1e3)


def runs(cell, arm, strict):
    rs = [r for r in rows if r["cell"] == cell and r["exact"] and not r["error"]]
    void = {r["round"] for r in rs if r["void"]}
    return [r for r in rs if r["arm"] == arm and not (strict and r["round"] in void)]


def span(xs):
    xs = [x for x in xs if x is not None]
    return f"{med(xs):7.0f} [{min(xs):.0f}–{max(xs):.0f}]" if xs else "      –"


def stat(rs, key):
    xs = [gap(r) if key == "gap" else r[key] for r in rs]
    xs = [x for x in xs if x is not None]
    return (med(xs), min(xs), max(xs)) if xs else None


def against(cell, arm, base, strict):
    """(ask, fill): 'worse', 'better' or 'tie' against `base` beyond its spread, with the median ratio."""
    a, b = runs(cell, arm, strict), runs(cell, base, strict)
    if not a or not b:
        return None
    out = {}
    for key in ("ask_ms", "fill_ms"):
        x, y = stat(a, key), stat(b, key)
        if x is None or y is None:
            continue
        out[key] = ("worse" if x[0] > y[2] else "better" if x[0] < y[1] else "tie", x[0] / y[0], x[0] - y[0])
    return out


def reading(strict):
    name = "strict" if strict else "round-paired"
    print(f"\n== {name}\ncell                          arm   n  ask ms               fill ms              "
          "gap ms            RSS MB  sent")
    for cell in cells:
        for arm in dict.fromkeys(r["arm"] for r in rows if r["cell"] == cell):
            rs = runs(cell, arm, strict)
            print(f"{cell.split(':')[0]:29} {arm:4} {len(rs):2}  {span([r['ask_ms'] for r in rs]):19}  "
                  f"{span([r['fill_ms'] for r in rs]):19}  {span([gap(r) for r in rs]):16}  "
                  f"{med([r['rss_session_kb'] for r in rs]) / 1e3 if rs else 0:6.1f}  "
                  f"{med([r['sent'] or 0 for r in rs]) if rs else 0:6.0f}")

    def table(arm, base, cs):
        print(f"\n{name}: {arm} against {base} (median ratio, Δ ms, beyond {base}'s spread)")
        res = {}
        for cell in cs:
            v = against(cell, arm, base, strict)
            if v is None or "fill_ms" not in v:
                continue
            res[cell] = v
            ask = v.get("ask_ms")
            ask_s = f"ask ×{ask[1]:.3f} {ask[2]:+7.0f} {ask[0]:6}" if ask else "ask –"
            fill = v["fill_ms"]
            print(f"{cell.split(':')[0]:29} {ask_s:28} fill ×{fill[1]:.3f} {fill[2]:+7.0f} {fill[0]}")
        return res

    tb = table("TB", "T", cells)
    wb = table("WB", "T", cells)
    table("W", "T", cells)
    table("WB", "W", cells)
    table("WA", "W", cells)
    table("Wc", "W", cells)
    table("WBc", "WB", cells)

    worse_tb = [c for c, v in tb.items() if "worse" in (v["fill_ms"][0], v.get("ask_ms", ("",))[0])]
    gain_tb = [c for c, v in tb.items() if "@10" in c and v["fill_ms"][0] == "better"]
    b_rule = ("B becomes the default" if not worse_tb and gain_tb else
              "B not adopted: worse in " + ", ".join(worse_tb) if worse_tb else "B not adopted: no gain beyond spread")
    print(f"\n{name} rule, B: {b_rule} (10 % cells with a fill better beyond spread: {gain_tb or 'none'})")

    short = [c for c in wb if "/fifo20" in c]
    fast = [c for c in short if wb[c].get("ask_ms") and wb[c]["ask_ms"][1] <= 0.8]
    worse_wb = {c: v for c, v in wb.items() if "worse" in (v["fill_ms"][0], v.get("ask_ms", ("",))[0])}
    fill_only = all(v["fill_ms"][0] == "worse" and v.get("ask_ms", ("",))[0] != "worse" for v in worse_wb.values())
    priced = {c: (link(c)[1] - S * 8 / (link(c)[0] * 1e3), v["fill_ms"][2]) for c, v in worse_wb.items()}
    where = all(rtt_gap > 0 for rtt_gap, _ in priced.values())
    if len(fast) == len(short) and not worse_wb:
        w_rule = "the window (with B) becomes the default"
    elif len(fast) == len(short) and fill_only and where:
        w_rule = "a trade-off for the owner: the fill worse only where RTT > S ÷ rate"
    else:
        w_rule = "the window not adopted"
    print(f"{name} rule, window: {w_rule}; short-queue cells ≥ 20 % faster ask {len(fast)}/{len(short)}; "
          f"worse beyond spread: " + (", ".join(f"{c.split(':')[0]} (fill {d:+.0f} ms, RTT − S÷rate {g:+.0f})"
                                              for c, (g, d) in priced.items()) or "none"))
    return b_rule.split(":")[0], w_rule.split(":")[0]


if __name__ == "__main__":
    s, p = reading(True), reading(False)
    print(f"\nreadings agree: {s == p} ({s} | {p})")
