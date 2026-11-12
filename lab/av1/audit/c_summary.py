#!/usr/bin/env python3
"""Protocol C's readings from rows/c.jsonl (docs/av1/audit-protocols.md §C amendment 1): each ratio per round from
the arms' 16-frame sums, then its mean over rounds with a t 95 % interval; a round with any hash miss is void.

usage: c_summary.py ROWS OUT.json      prints the tables, writes them as JSON
"""
import json
import statistics
import sys
from collections import defaultdict

VOLUMES = {"dbts_a1": 6, "dbts_b1": 11, "dbts_c1": 7}
THROTTLES = ["1x", "4x", "4x-cores2", "4x-cores1"]
# t(0.975, df) for df 1 … 30
T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131,
        2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042]


def interval(xs):
    m = statistics.fmean(xs)
    if len(xs) < 2:
        return {"mean": m, "lo": None, "hi": None, "n": len(xs)}
    h = T975[min(len(xs) - 1, 30) - 1] * statistics.stdev(xs) / len(xs) ** 0.5
    return {"mean": m, "lo": m - h, "hi": m + h, "n": len(xs)}


def main(rows_path, out_path):
    rows = [json.loads(line) for line in open(rows_path) if line.strip()]
    void = {r["round"] for r in rows if r.get("error") or not all(r["ok"])}
    t = {}
    passes = {}
    for r in rows:
        if r["round"] in void:
            continue
        t[(r["round"], r["throttle"], r["volume"], r["stream"], r["arm"])] = sum(r["ms"])
        if "pass" in r:
            passes[(r["round"], r["throttle"], r["volume"])] = sum(r["pass"])
    rounds = sorted({k[0] for k in t})
    out = {"rounds": len(rounds), "void": sorted(void), "chromium": sorted({r["chromium"] for r in rows}), "cells": []}

    def ratio(name, f, throttle, volume, stream=None):
        xs = []
        for n in rounds:
            try:
                xs.append(f(lambda arm, s="exact": t[(n, throttle, volume, s, arm)], n))
            except KeyError:
                pass
        if xs:
            out["cells"].append({"reading": name, "throttle": throttle, "volume": volume, "stream": stream, **interval(xs)})

    for th in THROTTLES:
        for v, rule in VOLUMES.items():
            ratio("Hp2/Hp", lambda a, n: a("Hp2") / a("Hp"), th, v)
            ratio("Hb/Hp", lambda a, n: a("Hb") / a("Hp"), th, v)
            ratio("Hk/Hp", lambda a, n: a("Hk") / a("Hp"), th, v)
            ratio("Hp/Hb", lambda a, n: a("Hp") / a("Hb"), th, v)
            ratio("Hk/Hb", lambda a, n: a("Hk") / a("Hb"), th, v)
            ratio("(Hm-Hb)/Hp", lambda a, n: (a("Hm") - a("Hb")) / a("Hp"), th, v)
            ratio("Hp ms/frame", lambda a, n: a("Hp") / 16, th, v)
            ratio("pass/Hp", lambda a, n, th=th, v=v: passes[(n, th, v)] / a("Hp"), th, v)
            for q in (8, rule):
                s = f"q{q}"
                for arm in ("W", "Wb", "D"):
                    ratio(f"{arm}/Hp", lambda a, n, arm=arm, s=s: a(arm, s) / a("Hp"), th, v, s)
                ratio("(Wb-W)/Hb", lambda a, n, s=s: (a("Wb", s) - a("W", s)) / a("Hb"), th, v, s)
                ratio("W ms/frame", lambda a, n, s=s: a("W", s) / 16, th, v, s)

    json.dump(out, open(out_path, "w"), indent=1)
    fmt = lambda c: f"{c['mean']:.3f} ({c['lo']:.3f} … {c['hi']:.3f})" if c["lo"] is not None else f"{c['mean']:.3f}"
    print(f"{len(rounds)} rounds, void {sorted(void)}, {out['chromium']}")
    for c in out["cells"]:
        print(f"{c['reading']:<12} {c['throttle']:<10} {c['volume']:<8} {c['stream'] or '':<4} {fmt(c)}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
