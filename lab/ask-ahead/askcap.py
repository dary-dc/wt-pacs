#!/usr/bin/env python3
"""ASKFIRSTCAPMEASURE (row 211): cells.py's rows for asks first under a cap on bytes in flight, read by the
rule of docs/native/quic-compared.md §9.7, strict (no `VOID` visit in the round) and round-paired.

An arm's spread is its [min, max] over rounds; it beats `shared` when its median ask is at most 0.85 of
`shared`'s, and is worse beyond the spread when its median is above `shared`'s max (ask or fill). The cap
binds in a cell when asks first's median cwnd at the ask is at least 6 MiB. A cell where the fill had less
left at the ask than asks first's cwnd there is reported, not claimed.

usage: askcap.py ROWS.jsonl ...   — lab/ask-ahead/README.md
"""
import json
import statistics
import sys

CAP = 6 * 1024 * 1024
CUBIC = ("shared", "window", "af", "af6m", "afcw")
BBR = ("bbrshared", "bbraf", "bbraf6m")
med = statistics.median


def load(paths):
    rows = []
    for p in paths:
        rows += [json.loads(line) for line in open(p) if '"cell"' in line]
    return rows


def runs(rows, cell, arm, strict):
    rs = [r for r in rows if r["cell"] == cell and r["exact"] and not r["error"]]
    void = {r["round"] for r in rs if r["void"]}
    return [r for r in rs if r["arm"] == arm and not (strict and r["round"] in void)]


def span(xs):
    return f"{med(xs):7.0f} [{min(xs):.0f}–{max(xs):.0f}]" if xs else "      –"


def near(a, b, tol):
    return abs(a / b - 1) <= tol


def judge(by, arm, base="shared"):
    """The rule's test of one arm against `base` in one cell."""
    ask, fill = [r["ask_ms"] for r in by[arm]], [r["fill_ms"] for r in by[arm]]
    ask0, fill0 = [r["ask_ms"] for r in by[base]], [r["fill_ms"] for r in by[base]]
    return {"ratio": med(ask) / med(ask0), "beats": med(ask) <= 0.85 * med(ask0),
            "ask_worse": med(ask) > max(ask0), "fill_worse": med(fill) > max(fill0)}


def reading(rows, strict):
    name = "strict" if strict else "round-paired"
    cells = list(dict.fromkeys(r["cell"] for r in rows))
    print(f"\n== {name}\ncell                 arm        n  ask ms               fill ms              "
          "RSS MB  cwnd@ask KB  rtt@ask ms  left@ask KB")
    out = {}
    for cell in cells:
        arms = [a for a in CUBIC + BBR if any(r["arm"] == a and r["cell"] == cell for r in rows)]
        by = {a: runs(rows, cell, a, strict) for a in arms}
        for a in arms:
            rs = by[a]
            m = (lambda k: med([r[k] or 0 for r in rs]) if rs else 0)
            print(f"{cell:20} {a:9} {len(rs):2}  {span([r['ask_ms'] for r in rs]):19}  "
                  f"{span([r['fill_ms'] for r in rs]):19}  {m('rss_session_kb') / 1e3:6.1f}  "
                  f"{m('cwnd_at_ask') / 1e3:11.0f}  {m('rtt_at_ask_ms'):10.0f}  {m('fill_left_at_ask') / 1e3:11.0f}")
        if not all(by.get(a) for a in CUBIC) or not all(by.values()):
            out[cell] = None
            continue
        cw = med([r["cwnd_at_ask"] for r in by["af"]])
        v = {"binds": cw >= CAP, "claimed": med([r["fill_left_at_ask"] for r in by["af"]]) >= cw,
             "short": "/fifo20" in cell, "by": by,
             "af6m": judge(by, "af6m"), "afcw": judge(by, "afcw"), "af": judge(by, "af")}
        if "bbrshared" in by:
            v["bbraf"], v["bbraf6m"] = judge(by, "bbraf", "bbrshared"), judge(by, "bbraf6m", "bbrshared")
        out[cell] = v
    print(f"\n{name}: each arm's median ask ÷ shared's (BBR arms ÷ bbrshared); ! worse beyond the spread, "
          "f fill worse beyond shared's")
    for cell, v in out.items():
        if v is None:
            print(f"{cell:20} no rounds left")
            continue
        flags = " ".join(f"{a} ×{v[a]['ratio']:.2f}{'!' if v[a]['ask_worse'] else ''}{'f' if v[a]['fill_worse'] else ''}"
                         for a in ("af", "af6m", "afcw", "bbraf", "bbraf6m") if a in v)
        print(f"{cell:20} {'binds' if v['binds'] else 'free '} {'claimed' if v['claimed'] else 'REPORTED'}  {flags}")
    return out


def rule(out, arm):
    if any(v is None for v in out.values()):
        return "not conclusive: a cell has no rounds left"
    claimed = {c: v for c, v in out.items() if v["claimed"]}
    worse = {c: v for c, v in claimed.items() if v[arm]["ask_worse"] or v[arm]["fill_worse"]}
    if not worse and all(v[arm]["beats"] for v in claimed.values() if v["short"]):
        return "net: proposed as the default stream mode with that send window"
    if any(v["binds"] for v in worse.values()):
        return f"refutes the model: worse beyond the spread where the cap binds ({', '.join(c for c, v in worse.items() if v['binds'])})"
    if worse:
        return f"a trade-off for the owner, its cost {', '.join(worse)}"
    return "not net: never worse beyond the spread, but does not beat shared in every 20 ms and loss cell " \
           f"({', '.join(c for c, v in claimed.items() if v['short'] and not v[arm]['beats'])})"


def predictions(out):
    ok = {c: v for c, v in out.items() if v and v["claimed"]}
    medf = lambda by, a, k: med([r[k] for r in by[a]])
    p1 = {c: (near(medf(v["by"], "af6m", "ask_ms"), medf(v["by"], "shared", "ask_ms"), 0.05) if v["binds"]
              else near(medf(v["by"], "af6m", "ask_ms"), medf(v["by"], "af", "ask_ms"), 0.15)) for c, v in ok.items()}
    p2 = {c: near(medf(v["by"], "afcw", "ask_ms"), medf(v["by"], "af", "ask_ms"), 0.15) for c, v in ok.items()}
    p3 = {}
    for c, v in ok.items():
        ref = "shared" if v["binds"] else "af"
        fills = [r["fill_ms"] for r in v["by"][ref]]
        p3[c] = min(fills) <= medf(v["by"], "af6m", "fill_ms") <= max(fills)
    p4 = {c: medf(v["by"], "af6m", "rss_session_kb") <= 1.10 * medf(v["by"], "shared", "rss_session_kb") for c, v in ok.items()}
    p5 = {c: near(medf(v["by"], "bbraf6m", "ask_ms"), medf(v["by"], "bbraf", "ask_ms"), 0.15)
          and v["bbraf"]["beats"] and v["bbraf6m"]["beats"] for c, v in ok.items() if "bbraf" in v}
    for n, p in enumerate((p1, p2, p3, p4, p5), 1):
        miss = [c for c, held in p.items() if not held]
        print(f"  ({n}) {'held' if not miss else 'did not hold in ' + ', '.join(miss)} ({len(p) - len(miss)}/{len(p)})")
    for c, v in ok.items():
        by = v["by"]
        w, a = medf(by, "window", "ask_ms"), medf(by, "af", "ask_ms")
        cw_w, cw_a = medf(by, "window", "cwnd_at_ask"), medf(by, "af", "cwnd_at_ask")
        if w <= 0.85 * a and near(cw_w, cw_a, 0.15):
            print(f"  window beats asks first by ≥ 15 % at {c} with equal cwnd ({cw_w / 1e3:.0f} vs {cw_a / 1e3:.0f} KB):"
                  f" RTT at the ask {medf(by, 'window', 'rtt_at_ask_ms'):.0f} vs {medf(by, 'af', 'rtt_at_ask_ms'):.0f} ms")


if __name__ == "__main__":
    rows = load(sys.argv[1:])
    print(f"runs {len(rows)}, VOID {sum(r['void'] for r in rows)}, "
          f"not exact or failed {sum(1 for r in rows if not r['exact'] or r['error'])}")
    verdicts = []
    for strict in (True, False):
        out = reading(rows, strict)
        v = (rule(out, "af6m"), rule(out, "afcw"))
        print(f"\n{'strict' if strict else 'round-paired'} rule — asks first + 6 MiB: {v[0]}\n"
              f"{'strict' if strict else 'round-paired'} rule — asks first + cwnd + M: {v[1]}\npredictions:")
        predictions(out)
        verdicts.append(v)
    print(f"\nreadings agree: {verdicts[0] == verdicts[1]}")
