#!/usr/bin/env python3
"""Protocols B and A read from B's rows as amendment 1 fixes it (docs/av1/audit-protocols.md §B amendment 1): B1's
s_split, B2's b, δ, B3's Q_lo and Q_hi with bytes, B-5's G 16 ÷ G 1 at 1.00 with ε; A's ν against the rule's Q.

usage: GROUPS_DIR=<0e0e58c8>/lab/av1/groups summary.py rows/b.jsonl rows/b0.json quant_common.c OUT.json
"""
import json
import math
import os
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, os.environ["GROUPS_DIR"])
sys.path.insert(0, str(Path(__file__).resolve().parent))
import anchor  # noqa: E402
from b0 import ac_tables  # noqa: E402

BANDS_B5 = {12: (0.97, 1.01), 10: (0.88, 0.96)}
ALREADY = ("dbts_a1", "dbts_a2", "dbts_a5", "dbts_b1", "dbts_b2", "dbts_b3", "dbts_b4", "dbts_b5", "dbt10_d",
           "dbt10_ea1141")


def system(name):
    return name[5].upper() if name.startswith("dbts_") else "content 2"


def worst_frame(series, row):
    r = [f["err_noise_band"] / s for f, s in zip(row["frames"], series["sigma"])]
    return int(np.argmax(r)), max(r)


def split_ratio(series, split, row):
    i, w = worst_frame(series, row)
    halves = [e / s for e, s in zip(row["frames"][i]["err_noise_band_halves"], split["sigma_halves"][i])]
    return w, (halves[0] - halves[1]) / 2


def main():
    rows_path, b0_path, quant, out_path = map(Path, sys.argv[1:5])
    rows = [json.loads(r) for r in rows_path.open()]
    series = {r["set"]: r for r in rows if r["kind"] == "series"}
    splits = {r["set"]: r for r in rows if r["kind"] == "split"}
    cells = defaultdict(dict)
    for r in rows:
        if r["kind"] == "cell":
            cells[(r["set"], r["g"])][r["q"]] = r
    checks = [dict(set=r["set"], q=r["q"], tag=r.get("tag"), study_equal=r.get("study_equal")) for r in rows
              if "study_equal" in r]
    rules = {(r["volume"], r["g"]): r for r in json.load(b0_path.open())["rules"] if not r["form"] == "top10"}
    ac = ac_tables(quant)
    names = [n for n in series if any((n, g) in cells for g in (1, 16))]
    out = dict(checks=checks, volumes={})
    for n in names:
        s, b = series[n], series[n]["b"]
        pairs = [split_ratio(s, splits[n], c) for g in (1, 16) for c in cells.get((n, g), {}).values()]
        s_split = math.sqrt(np.mean([d * d for _, d in pairs])) / np.mean([w for w, _ in pairs])
        inj = splits[n]["injected"]
        bias = float(np.mean([x["b"] for x in inj]))
        delta = max(2 * s_split, abs(bias))
        v = dict(system=system(n), depth=b, frames=s["frames"], s_split=s_split, b=bias,
                 b_range=[min(x["b"] for x in inj), max(x["b"] for x in inj)], clipped=sum(x["clipped"] for x in inj),
                 delta=delta, g={})
        for g in (1, 16):
            cs = cells.get((n, g))
            if not cs:
                continue
            pts = [(q, anchor.worst(s, c), sum(c["units"]), anchor.nu(s, c)) for q, c in sorted(cs.items())]
            hi = lambda bar: (anchor.integer_point([p[:2] for p in pts], bar) or (None,))[0]
            size = {p[0]: p[2] for p in pts}
            q_lo, q_hi = hi(1 - delta), hi(1 + delta)
            xs = {q: ac[10 if b == 10 else 12][4 * q] / 8 / float(np.median(s["sigma"])) for q in cs}
            v["g"][g] = dict(
                cells=[dict(q=p[0], worst=p[1], bytes=p[2], nu=p[3], x=xs[p[0]]) for p in pts],
                bracketed=min(p[1] for p in pts) <= 1 - delta and max(p[1] for p in pts) > 1 + delta,
                q_lo=q_lo, q_hi=q_hi, bytes_lo=size.get(q_lo), bytes_hi=size.get(q_hi),
                unresolved=[p[0] for p in pts if 1 - delta <= p[1] <= 1 + delta],
                at_100=hi(1.00), at_103=hi(1.03), **anchor.read(pts), thinned=anchor.thinned(pts),
                q_nu=max((p[0] for p in pts if p[3] >= 0.5), default=None))
            for reading in ("pooled", "per depth"):
                r = rules.get((n, g))
                q = r and r[reading]["integer"]
                v["g"][g][f"rule {reading}"] = dict(q=q, nu=next((p[3] for p in pts if p[0] == q), None),
                                                    bytes=size.get(q))
        out["volumes"][n] = v
    parts = [math.log(b / v["g"][g]["b1"]) for v in out["volumes"].values() for g in v["g"]
             for _, b in v["g"][g]["thinned"] if b is not None and v["g"][g]["b1"] is not None]
    out["epsilon"] = max(map(abs, parts)) if parts else None
    out["predictions"] = predictions(out)
    out_path.write_text(json.dumps(out, indent=1) + "\n")
    print(report(out))


def predictions(out):
    V, eps = out["volumes"], out["epsilon"] or 0.0
    p = {}
    p["B-1"] = dict(holds=all(v["s_split"] <= 0.005 for v in V.values()),
                    refuted=any(v["s_split"] > 0.01 for v in V.values()))
    ac = [v for v in V.values() if v["system"] in "AC"]
    p["B-2"] = dict(holds=all(abs(v["b"]) <= 0.03 for v in V.values()) and all(v["b"] < 0 for v in ac),
                    refuted=any(abs(v["b"]) > 0.05 for v in V.values()) or sum(v["b"] > 0 for v in ac) >= 2)
    unres = {n: bool(v["g"][1]["q_lo"] != v["g"][1]["q_hi"]) for n, v in V.items() if 1 in v["g"]}
    wrong = [n for n, u in unres.items() if u != (n in ALREADY)]
    p["B-3"] = dict(delta_in_1_3=all(0.01 <= v["delta"] <= 0.03 for v in V.values()), unresolved=unres,
                    other_side=wrong, refuted=len(wrong) >= 2)
    gaps = {(n, g): v["g"][g]["q_hi"] - v["g"][g]["q_lo"] for n, v in V.items() for g in v["g"]
            if None not in (v["g"][g]["q_hi"], v["g"][g]["q_lo"])}
    p["B-4"] = dict(gaps={f"{n} G{g}": d for (n, g), d in gaps.items()},
                    holds=all(d <= (2 if V[n]["depth"] == 12 else 4) for (n, g), d in gaps.items()))
    ratios = {}
    for n, v in V.items():
        if 1 in v["g"] and 16 in v["g"] and v["g"][1]["b1"] and v["g"][16]["b1"]:
            r, (lo, hi) = v["g"][16]["b1"] / v["g"][1]["b1"], BANDS_B5[v["depth"]]
            ratios[n] = dict(ratio=r, band=[lo, hi], outside_by_more_than_eps=r < lo * math.exp(-eps) or
                             r > hi * math.exp(eps))
    p["B-5"] = dict(ratios=ratios, refuted=any(x["outside_by_more_than_eps"] for x in ratios.values()))
    a1 = {n: [(a["q"], b["q"], b["nu"] - a["nu"]) for a, b in zip(v["g"][1]["cells"], v["g"][1]["cells"][1:])
              if b["nu"] - a["nu"] > 0.02] for n, v in V.items() if 1 in v["g"]}
    p["A1"] = dict(rises=a1, refuted=any(a1.values()))
    for reading in ("pooled", "per depth"):
        nus = {n: v["g"][1][f"rule {reading}"]["nu"] for n, v in V.items() if 1 in v["g"]}
        p[f"A2 {reading}"] = dict(nu=nus, refuted=any(x is not None and not 0.15 <= x <= 0.45 for x in nus.values()),
                                  not_coded=[n for n, x in nus.items() if x is None])
    bins = defaultdict(lambda: defaultdict(list))
    for n, v in V.items():
        for g in v["g"]:
            for r in v["g"][g]["cells"]:
                bins[math.floor(r["x"] / 0.25) * 0.25][v["system"]].append(r["nu"])
    spread = {}
    for k, by in sorted(bins.items()):
        if len(by) >= 3:
            means = [float(np.mean(x)) for x in by.values()]
            spread[f"{k:.2f}"] = max(means) - min(means)
    p["A3"] = dict(spread=spread, refuted=any(s > 0.08 for s in spread.values()))
    a4 = {}
    for n, v in V.items():
        if 1 not in v["g"]:
            continue
        g1 = v["g"][1]
        size = {r["q"]: r["bytes"] for r in g1["cells"]}
        rq = g1["rule pooled"]["q"]
        if g1["q_nu"] is not None and rq in size:
            a4[n] = dict(q_nu=g1["q_nu"], rule_q=rq, ratio=size[g1["q_nu"]] / size[rq])
    p["A4"] = dict(ratios=a4, holds=all(1.3 <= x["ratio"] <= 3 for x in a4.values()))
    return p


def report(out):
    lines = ["| volume | s_split | b (range) | δ | G 1: Q_lo · Q_hi (bytes) | at 1.00 · 1.03 | G 16: Q_lo · Q_hi |"
             " ν at rule Q (pooled · per depth) |", "| --- | --: | --- | --: | --- | --- | --- | --- |"]
    for n, v in out["volumes"].items():
        g1, g16 = v["g"].get(1, {}), v["g"].get(16, {})
        cut = lambda g: "—" if not g else f"{g['q_lo']} · {g['q_hi']}"
        nu = lambda r: "—" if r["nu"] is None else f"{r['nu']:.3f} (Q {r['q']})"
        lines.append(f"| `{n}` | {100 * v['s_split']:.2f} % | {100 * v['b']:+.1f} % ({100 * v['b_range'][0]:+.1f} … "
                     f"{100 * v['b_range'][1]:+.1f}) | {100 * v['delta']:.1f} % | {cut(g1)} "
                     f"({g1.get('bytes_lo')} · {g1.get('bytes_hi')}) | {g1.get('at_100')} · {g1.get('at_103')} | "
                     f"{cut(g16)} | {nu(g1['rule pooled']) if g1 else '—'} · {nu(g1['rule per depth']) if g1 else '—'} |")
    return "\n".join(lines) + "\n\n" + json.dumps(out["predictions"], indent=1, default=str)


if __name__ == "__main__":
    main()
