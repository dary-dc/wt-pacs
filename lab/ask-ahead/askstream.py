#!/usr/bin/env python3
"""ASKSTREAM: cells.py's rows for docs/WIRE.md §Proposed: an ask during a fill, its pre-registered measurement. Arms T
(today, `?refill=head`), Tp (T again, the A/A arm), QW (#96: the one queue and the window), QS (design D: the one
queue and asks on a stream ranked above the fill's), QS0 (its check: the ask stream at the fill's rank). Each arm
against T, and QS against QW, read as refill.py reads its arm: rounds' first half flagged, the second the
confirmation, strict and round-paired; QS against QW takes T′/T as its A/A spread.

Rule, fixed before the data: QS is the candidate over QW if its asks are better than QW's in a loss or `dbts` cell
and no cell's ask or fill is worse than QW's; else QW. The candidate becomes the default if neither its asks nor
its fills are worse than T's in any cell; worse in any cell is a trade-off for the owner, those cells its cost.

usage: askstream.py ROWS.jsonl   — lab/ask-ahead/README.md
"""
import json
import statistics
import sys

from refill import verdict

MEASURES = ("ask_ms", "fill_ms")
med = statistics.median


def judged(cell):
    return cell.split(":")[0]


def apart(rows, x, y):
    """Rows of a synthetic arm `x/y`: T's value × x ÷ y a round, so aa_rule reads x against y with T′/T as A/A."""
    by = {(r["cell"], r["round"], r["arm"]): r for r in rows}
    out = []
    for r in rows:
        if r["arm"] != "T":
            continue
        a, b = by.get((r["cell"], r["round"], x)), by.get((r["cell"], r["round"], y))
        if not a or not b:
            continue
        row = {**r, "arm": f"{x}/{y}", "exact": r["exact"] and a["exact"] and b["exact"],
               "error": r["error"] or a["error"] or b["error"], "void": r["void"] or a["void"] or b["void"]}
        for k in MEASURES:
            row[k] = r[k] * a[k] / b[k] if None not in (r[k], a[k], b[k]) else None
        out.append(row)
    return out


def medians(rows, cell, arm, key):
    vs = [r[key] for r in rows if r["cell"] == cell and r["arm"] == arm and r["exact"] and not r["error"]
          and r[key] is not None]
    return med(vs) if vs else None


def paired(rows, cell, x, y, key, f):
    """Per round with both arms exact, `f(x's value, y's value)`; their median."""
    by = {(r["round"], r["arm"]): r for r in rows if r["cell"] == cell and r["exact"] and not r["error"]}
    vs = [f(by[(n, x)][key], by[(n, y)][key]) for n, a in by if a == x and (n, y) in by]
    return med(vs) if vs else None


def reading(rows, cells, split, strict):
    name = "strict" if strict else "round-paired"
    rows = rows + apart(rows, "QS", "QW") + apart(rows, "QS0", "QW")
    out = {}
    print(f"\n== {name}\ncell                          measure  n   T ms  Tp/T  MDL   QW/T            QS/T            "
          "QS/QW           QS0/T")
    for cell in cells:
        arms = [a for a in ("QW", "QS", "QS/QW", "QS0") if any(r["cell"] == cell and r["arm"] == a for r in rows)]
        for key in MEASURES:
            vs = {a: verdict(rows, cell, key, strict, a, split) for a in arms}
            out.update({(a, judged(cell), key): v for a, v in vs.items()})
            v = vs["QW"]
            if "arm" not in v:
                print(f"{judged(cell):29} {key[:-3]:7} {v['n']:2} complete rounds: {v['verdict']}")
                continue
            print(f"{judged(cell):29} {key[:-3]:7} {v['n']:2} {v['t_ms']:6.0f} ×{v['aa']:.3f} {v['mdl']:4.1%}  "
                  + "  ".join(f"×{vs[a].get('arm', float('nan')):.3f} {vs[a]['verdict'][:8]:8}" for a in arms))
    return out


def rule(out, cells):
    hard = [c for c in map(judged, cells) if "loss" in c or "~dbts" in c]
    gains = [c for c in hard if out.get(("QS/QW", c, "ask_ms"), {}).get("verdict") == "better"]
    losses = [f"{c} {k[:-3]}" for (a, c, k), v in out.items() if a == "QS/QW" and v["verdict"] == "worse"]
    cand = "QS" if gains and not losses else "QW"
    worse = [f"{c} {k[:-3]}" for (a, c, k), v in out.items() if a == cand and v["verdict"] == "worse"]
    unsure = [f"{c} {k[:-3]}" for (a, c, k), v in out.items() if a == cand and v["verdict"] not in ("worse", "better", "tie")]
    print(f"  QS/QW: asks better in {gains or 'no loss or dbts cell'}; worse in {losses or 'none'}")
    verdict = f"{cand} is the candidate; " + (f"a trade-off: worse than T in {', '.join(worse)}" if worse
                                               else f"{cand} becomes the default")
    print(f"  {verdict}; not conclusive in {unsure or 'none'}")
    return verdict


def predictions(rows, out, cells):
    """The five of docs/WIRE.md, each held / contradicted / not resolved, on the round-paired reading."""
    names = list(map(judged, cells))
    loss = [c for c in names if "loss" in c and "#" not in c]
    dbts = [c for c in names if "~dbts" in c]
    full = dict(zip(names, cells))
    v = lambda a, c, k: out.get((a, c, k), {}).get("verdict", "absent")  # noqa: E731
    r = lambda c, x, k: paired(rows, full[c], x, "T", k, lambda a, b: a / b)  # noqa: E731

    def say(n, held, unresolved, text):
        print(f"  ({n}) {'not resolved' if unresolved else 'held' if held else 'contradicted'}: {text}")

    qs = medians(rows, full["18/46/fifo20@50"], "QS", "ask_ms")
    ratios = {c: r(c, "QS", "ask_ms") for c in loss}
    say(1, 314 * 0.7 <= qs <= 314 * 1.3 and all(x <= 0.35 for x in ratios.values()), False,
        f"QS's ask at 18/46 FIFO 20 @50 {qs:.0f} ms (314 ± 30 %); QS/T under 1 % loss "
        + ", ".join(f"{c} ×{x:.3f}" for c, x in ratios.items()))
    fills = {c: v("QS", c, "fill_ms") for c in names}
    bad = [c for c, x in fills.items() if x == "worse"]
    open_ = [c for c, x in fills.items() if x not in ("worse", "better", "tie")]
    say(2, not bad, not bad and open_, f"QS's fill worse than T in {bad or 'none'}; better in "
        f"{[c for c, x in fills.items() if x == 'better'] or 'none'}; not conclusive in {open_ or 'none'}")
    sent = {c: r(c, "QS", "sent") for c in names}
    off = {c: round(x, 3) for c, x in sent.items() if not 0.98 <= x <= 1.02}
    say(3, not off, False, f"QS/T packets ×{min(sent.values()):.3f}–{max(sent.values()):.3f}; outside ±2 % in {off or 'none'}")
    qw = {c: v("QW", c, "ask_ms") for c in dbts}
    qsr = {c: r(c, "QS", "ask_ms") for c in dbts}
    say(4, all(x == "tie" for x in qw.values()) and all(x <= 0.5 for x in qsr.values()),
        any(x not in ("worse", "better", "tie") for x in qw.values()),
        f"QW's ask against T {qw}; QS/T " + ", ".join(f"{c} ×{x:.3f}" for c, x in qsr.items()))
    u1 = [c for c in names if c.endswith("#u1")]
    lines, ok = [], True
    for c in u1:
        rtt = int(c.split("/")[1])
        asks = med(len(x["asks_ms"]) for x in rows if x["cell"] == full[c] and x["arm"] == "T")
        for arm in ("QW", "QS"):
            d = paired(rows, full[c], "T", arm, "fill_ms", lambda a, b: a - b)
            ok &= d >= asks * rtt
            lines.append(f"{c} T−{arm} {d:+.0f} ms against {asks:g} asks × {rtt} ms")
    say(5, ok, False, "; ".join(lines))
    check = {c: v("QS0", c, "ask_ms") for c in names if ("QS0", c, "ask_ms") in out}
    print(f"  check, QS0's ask against T (a tie expected): {check}")


def main():
    rows = [json.loads(line) for line in open(sys.argv[1])]
    print(json.dumps(rows[0]))
    rows = [r for r in rows if "cell" in r]
    rounds = sorted({r["round"] for r in rows})
    cells = list(dict.fromkeys(r["cell"] for r in rows))
    print(f"runs {len(rows)}, rounds {len(rounds)}, VOID {sum(r['void'] for r in rows)}, "
          f"not exact or failed {sum(not r['exact'] or bool(r['error']) for r in rows)}")
    verdicts = []
    for strict in (True, False):
        out = reading(rows, cells, len(rounds) // 2, strict)
        print(f"\n{'strict' if strict else 'round-paired'} rule:")
        verdicts.append(rule(out, cells))
    print("\npredictions, round-paired:")
    predictions(rows, out, cells)
    agree = verdicts[0] == verdicts[1]
    print(f"\nverdict: {verdicts[0] if agree else 'the readings disagree: ' + ' | '.join(verdicts)}")


if __name__ == "__main__":
    main()
