#!/usr/bin/env python3
"""Stage 3's metrics and the protocol's rule, from run.mjs --per-frame rows.

Per visit: the first picture; every frame pictured; every frame at display scale exact at its level (the ladder at its
fit level from its previews, every other arm from its exact frames); every frame at the proxy at display scale (an
exact frame, or a preview whose stage-1 display-scale comparison met the proxy) and at full size (exact frames only:
no prefix is full size); every frame exact; decode; a reader scrolling from slice 0 at 15 slices/s from the issue.
Ratios are against today's arm (`htj2k`) in the same round and cell, medians of rounds; the A/A spread is the p90 of
|A′/A − 1| over the cell's rounds. lab/htj2k-progressive/README.md §Stage 3, §The rule as applied

usage: [WITH_VOID=1] summary3.py ROWS.jsonl FRAMES LADDER [--json OUT]   WITH_VOID keeps the relay's VOID visits
"""
import json
import math
import os
import statistics
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from summary1 import proxy  # noqa: E402

A, AA, SVC = "htj2k", "htj2k-aa", "predicted-two-quarter-q40"
SCROLL = 15
VOLUMES = ("dbts_a1", "dbts_b1", "dbts_c1")


def med(v):
    v = [x for x in v if x is not None]
    return statistics.median(v) if v else None


def p90(v):
    v = sorted(v)
    return v[min(len(v) - 1, math.floor(0.9 * len(v)))] if v else None


def proxy_display(ladder, name, level):
    rows = [json.loads(line) for line in open(ladder / name / "metrics.jsonl")]
    return {x["frame"]: proxy(x["reducedDisplay"]) for x in rows if x["level"] == level}


def visit_metrics(r, set_, ladder):
    n = set_["frames"]
    exact, prev = r.get("exactMs") or [None] * n, r.get("previewMs") or [None] * n
    v = set_["variants"][r["variant"]]
    level = v.get("level")
    ok = {}
    if level:
        ok = proxy_display(ladder, set_["name"], level)
    at_display = [p if (level and level == set_["levelFit"] and p is not None) else x for x, p in zip(exact, prev)]
    at_proxy = [min([t for t in (x, p if ok.get(i) else None) if t is not None], default=None) for i, (x, p) in enumerate(zip(exact, prev))]
    reach = [1000 * k / SCROLL for k in range(n)]
    showed = [("exact" if x is not None and x <= t else "prefix" if p is not None and p <= t else "nothing")
              for x, p, t in zip(exact, prev, reach)]
    full = lambda a: None if None in a else max(a)  # noqa: E731
    return dict(first=r["firstMs"], pictured=r.get("shownMs", r["decodedMs"]), display=full(at_display),
                proxyDisplay=full(at_proxy), proxyFull=r["decodedMs"], exact=r["decodedMs"],
                decode=r.get("decodeMs"), previewDecode=r.get("previewDecodeMs"),
                scrollExact=showed.count("exact") / n, scrollPrefix=showed.count("prefix") / n,
                scrollNothing=showed.count("nothing") / n,
                allExact=r["exact"] == n and not r.get("failures") and r.get("previewExact", n) == n and not r.get("strays"))


def main():
    rows_path, frames, ladder, *rest = sys.argv[1:]
    frames, ladder = Path(frames), Path(ladder)
    rows = [json.loads(line) for line in open(rows_path)]
    sets = {}
    cells = defaultdict(lambda: defaultdict(dict))
    voids = defaultdict(int)
    for r in rows:
        name = r["set"]
        sets.setdefault(name, json.loads((frames / name / "variants.json").read_text()))
        key = (name, r["link"], r["throttle"])
        if (r["void"] and not os.environ.get("WITH_VOID")) or not r["frames"]:
            voids[key] += 1
            continue
        cells[key][r["variant"]][r["round"]] = visit_metrics(r, sets[name], ladder)
    out = []
    for key in sorted(cells):
        name, link, throttle = key
        arms = cells[key]
        a = arms.get(A, {})
        aa = [arms[AA][k]["exact"] / a[k]["exact"] for k in arms.get(AA, {}) if k in a]
        spread = p90([abs(x - 1) for x in aa])
        for arm, by_round in arms.items():
            ms = list(by_round.values())
            row = dict(set=name, link=link, throttle=throttle, arm=arm, n=len(ms), voids=voids[key], aaSpread=spread,
                       bytes=sets[name]["bytes"].get(arm if arm not in (AA, A, "fit", "l2") else "htj2k"),
                       allExact=all(m["allExact"] for m in ms))
            for k in ("first", "pictured", "display", "proxyDisplay", "proxyFull", "exact", "decode", "previewDecode",
                      "scrollExact", "scrollPrefix", "scrollNothing"):
                row[k] = med([m[k] for m in ms])
            row["exactVsA"] = med([m["exact"] / a[k]["exact"] for k, m in by_round.items() if k in a])
            row["displayVsA"] = med([m["display"] / a[k]["exact"] for k, m in by_round.items() if k in a and m["display"]])
            svc = arms.get(SVC, {})
            row["firstVsSvc"] = med([m["first"] / svc[k]["first"] for k, m in by_round.items() if k in svc])
            out.append(row)
    if "--json" in rest:
        Path(rest[rest.index("--json") + 1]).write_text(json.dumps(out, indent=1))
    print("| set | link | CPU | arm | n | first s | every frame pictured s | at display scale, exact at its level s "
          "| at the proxy, display · full s | exact s | ÷ A exact | display ÷ A exact | first ÷ AV1 preview | A/A p90 "
          "| scroll 15/s exact · prefix · nothing | decode prefix · exact s | all exact |")
    print("| --- | --- | --: | --- | --: | --: | --: | --: | --- | --: | --: | --: | --: | --: | --- | --- | --- |")
    s = lambda v, d=2: "—" if v is None else f"{v / 1000:.{d}f}"  # noqa: E731
    x = lambda v, d=3: "—" if v is None else f"{v:.{d}f}"  # noqa: E731
    for r in out:
        print(f"| `{r['set']}` | {r['link']} | {r['throttle']}× | {r['arm']} | {r['n']} | {s(r['first'])} | {s(r['pictured'])} "
              f"| {s(r['display'])} | {s(r['proxyDisplay'])} · {s(r['proxyFull'])} | {s(r['exact'])} | {x(r['exactVsA'])} "
              f"| {x(r['displayVsA'])} | {x(r['firstVsSvc'], 2)} | {x(r['aaSpread'])} "
              f"| {100 * r['scrollExact']:.0f} · {100 * r['scrollPrefix']:.0f} · {100 * r['scrollNothing']:.0f} % "
              f"| {s(r['previewDecode'])} · {s(r['decode'])} | {'yes' if r['allExact'] else 'NO'} |")
    rule(out)


def rule(out):
    """docs/decode/README.md §HTJ2K progressive protocol, Rule, as README §The rule as applied reads it."""
    print("\nThe rule, per volume and cell: the ladder at its fit level; strict (A/A spread 0) and with the spread.")
    by = {(r["set"], r["link"], r["throttle"], r["arm"]): r for r in out}
    cells = sorted({(r["link"], r["throttle"]) for r in out if r["set"] in VOLUMES})
    verdict = {}
    for link, thr in cells:
        passes = {}
        for v in VOLUMES:
            fit = by.get((v, link, thr, "fit"))
            if not fit:
                passes[v] = (False, False, "no split at the fit level: its exact frame is its display-scale picture")
                continue
            res = []
            for s in (0.0, fit["aaSpread"] or 0.0):
                c = [fit["allExact"],
                     fit["firstVsSvc"] is not None and fit["firstVsSvc"] <= 1.5 * (1 + s),
                     link not in ("r5000", "r20000") or (fit["displayVsA"] is not None and fit["displayVsA"] <= 0.3 * (1 + s)),
                     fit["exactVsA"] is not None and fit["exactVsA"] <= 1.02 * (1 + s)]
                res.append(all(c))
            passes[v] = (res[0], res[1], f"exact {fit['allExact']}, first ÷ AV1 {fit['firstVsSvc']}, display ÷ A {fit['displayVsA']}, "
                                         f"exact ÷ A {fit['exactVsA']}, A/A p90 {fit['aaSpread']}")
        strict = sum(p[0] for p in passes.values()) >= 2
        spread = sum(p[1] for p in passes.values()) >= 2
        verdict[(link, thr)] = (strict, spread)
        print(f"{link} {thr}×: strict {'holds' if strict else 'fails'}, with the spread {'holds' if spread else 'fails'}; "
              + "; ".join(f"{v} {'✓' if p[1] else '✗'} ({p[2]})" for v, p in passes.items()))
    if not verdict:
        return print("No volume of the rule was run.")
    print(f"\nEvery cell run: strict {'candidate' if all(s for s, _ in verdict.values()) else 'not a candidate'}, "
          f"with the spread {'candidate' if all(s for _, s in verdict.values()) else 'not a candidate'}.")


if __name__ == "__main__":
    main()
