#!/usr/bin/env python3
"""Part 5's rule per cell, and the owner's table, from every sitting's rows; the clauses are svc_tables.rule()'s."""
import argparse
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import svc_tables as T  # noqa: E402

LINK_ORDER = ["r5000", "r20000", "r50000", "r20000-l2", "r20000-j20"]
SCROLL = 15


def median(v):
    return statistics.median(v) if v else None


def t_layer(r, layer):
    return T.t_all(T.at_or_better(r, layer))


def reached(r, layer):
    return sum(t is not None and t <= 1000 * i / SCROLL for i, t in enumerate(T.at_or_better(r, layer)))


def clause_values(C, cell, shape):
    vs, hx, res, k2 = C.by_round(cell, shape), C.htj2k_tx(cell), C.by_round(cell, "res"), C.by_round(cell, "k2")
    paired = {k: r for k, r in vs.items() if k in k2}
    return dict(
        n=len(vs),
        exact=all(r.get("exact", 0) == C.owed(r) for r in C.visits(cell, shape, keep=False)),
        tp=median([t_layer(r, "base") / hx[k] for k, r in vs.items() if hx.get(k) and t_layer(r, "base")]),
        scroll=median([reached(r, "base") for r in vs.values()]),
        prefix=median([reached(r, "prefix") for r in res.values()]),
        tx=median([t_layer(r, "exact") / t_layer(k2[k], "exact") for k, r in paired.items()
                   if t_layer(r, "exact") and t_layer(k2[k], "exact")]),
        bytes=median([r["wireBytes"] / k2[k]["wireBytes"] for k, r in paired.items() if r.get("wireBytes")]),
        resolution=T.aa(C, cell)[1],
    )


def rule_table(C):
    def f3(x):
        return "—" if x is None else f"{x:.3f}"

    def mark(ok):
        return "" if ok else " **FAIL**"

    print("| shape | series | link, CPU | n | frames exact | t_P ÷ HTJ2K's t_X (≤ 0.2; 5 and 20 Mbit/s) "
          f"| slices pictured at {SCROLL} slices/s: base · prefix | t_X ÷ `k2` (≤ 1.10) · A/A resolution | bytes ÷ `k2` (≤ 1.02) |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for shape in T.SHAPES:
        for cell in (c for c in C.cells if c[1] in T.RULE_LINKS):
            x = clause_values(C, cell, shape)
            tp_clause = cell[1] in ("r5000", "r20000")
            tp = f3(x["tp"]) + mark(x["tp"] is None or x["tp"] <= 0.2) if tp_clause else "not a clause here"
            res = "unknown" if x["resolution"] is None else f"±{100 * x['resolution']:.1f} %"
            print(f"| `{shape}` | `{cell[0]}` | {cell[1]} {cell[2]}× | {x['n']} | {'yes' if x['exact'] else '**no**'} | {tp} "
                  f"| {x['scroll']:g} · {x['prefix']:g} of {C.frames[cell[0]]}{mark(x['scroll'] > x['prefix'])} "
                  f"| {f3(x['tx'])} · {res}{mark(x['tx'] is not None and x['tx'] <= 1.10)} "
                  f"| {f3(x['bytes'])}{mark(x['bytes'] is not None and x['bytes'] <= 1.02)} |")


def span(values, fmt):
    v = [x for x in values if x is not None]
    if not v:
        return "—"
    lo, hi = fmt(min(v)), fmt(max(v))
    return lo if lo == hi else f"{lo}–{hi}"


def seconds(ms):
    return f"{ms / 1000:.2f}" if ms < 10_000 else f"{ms / 1000:.1f}"


def owner_table(C):
    links = sorted({c[1:] for c in C.cells if c[1] in LINK_ORDER}, key=lambda c: (LINK_ORDER.index(c[0]), c[1]))
    print("| link, CPU | variant | first picture, s | every slice with a base, s | time to exact, s | bytes ÷ `k2` |")
    print("| --- | --- | --- | --- | --- | --- |")
    for link in links:
        for v in (v for v in T.VARIANTS if v != "htj2k-aa"):
            first, base, exact, ratio = [], [], [], []
            preview = "prefix" if v == "res" else "base" if "base" in T.layers_of(v) else None
            for cell in (c for c in C.cells if c[1:] == link):
                vs, k2 = C.by_round(cell, v), C.by_round(cell, "k2")
                first.append(median([r["firstMs"] for r in vs.values()]))
                if preview:
                    base.append(median([t for t in (t_layer(r, preview) for r in vs.values()) if t]))
                if v not in T.LOSSY:
                    exact.append(median([t for t in (t_layer(r, "exact") for r in vs.values()) if t]))
                ratio.append(median([r["wireBytes"] / k2[k]["wireBytes"] for k, r in vs.items() if k in k2 and r.get("wireBytes")]))
            pictured = (span(base, seconds) + (" (its half-size prefix)" if v == "res" else "")) if preview else "no base"
            to_exact = "never exact" if v in T.LOSSY else span(exact, seconds)
            print(f"| {link[0]} {link[1]}× | `{v}` | {span(first, seconds)} | {pictured} | {to_exact} "
                  f"| {span(ratio, lambda x: f'{x:.3f}')} |")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("rows", help="every sitting's rows, one JSON visit a line")
    ap.add_argument("table", choices=["rule", "owner"])
    a = ap.parse_args()
    C = T.Cells(T.load(a.rows))
    rule_table(C) if a.table == "rule" else owner_table(C)


if __name__ == "__main__":
    main()
