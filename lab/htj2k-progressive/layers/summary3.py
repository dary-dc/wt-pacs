#!/usr/bin/env python3
"""Stage 3's metrics for the quality shapes and the protocol's second clause, from run.mjs --per-frame rows.

Per visit: the first picture; every frame pictured; every frame at the proxy, at full size and at display scale (an
exact frame, or a layer-1 preview whose stage-1 comparison met the proxy); every frame exact; decode; a reader
scrolling from slice 0 at 15 slices/s from the issue. Ratios are against today's arm (`htj2k`) in the same round and
cell, medians of rounds; the A/A spread is the p90 of |A′/A − 1| over the cell's rounds. layers/README.md, §Quality
layers, measured

usage: [WITH_VOID=1] summary3.py ROWS.jsonl FRAMES WORK [--json OUT]   WITH_VOID keeps the relay's VOID visits
"""
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from summary3 import AA, A, SCROLL, med, p90  # noqa: E402

BYTES, TIME, PROXY = 1.10, 1.10, 0.99


def at_proxy(m):
    return all(w["in"] == 0 or (w["in"] - w["over1"]) / w["in"] >= PROXY for w in m["windows"])


def proxies(work, name, shape):
    rows = [json.loads(x) for x in (work / name / "stage1.jsonl").read_text().splitlines()]
    return ({r["frame"]: at_proxy(r["full"]) for r in rows if r["shape"] == shape},
            {r["frame"]: at_proxy(r["fullDisplay"]) for r in rows if r["shape"] == shape})


def visit_metrics(r, n, ok):
    exact, prev = r.get("exactMs") or [None] * n, r.get("previewMs") or [None] * n
    full_ok, disp_ok = ok
    at = lambda good: [min([t for t in (x, p if good.get(i) else None) if t is not None], default=None)  # noqa: E731
                       for i, (x, p) in enumerate(zip(exact, prev))]
    reach = [1000 * k / SCROLL for k in range(n)]
    showed = [("exact" if x is not None and x <= t else "prefix" if p is not None and p <= t else "nothing")
              for x, p, t in zip(exact, prev, reach)]
    full = lambda a: None if None in a else max(a)  # noqa: E731
    return dict(first=r["firstMs"], pictured=r.get("shownMs", r["decodedMs"]), proxyFull=full(at(full_ok)),
                proxyDisplay=full(at(disp_ok)), exact=r["decodedMs"], decode=r.get("decodeMs"),
                previewDecode=r.get("previewDecodeMs"), scrollExact=showed.count("exact") / n,
                scrollPrefix=showed.count("prefix") / n, scrollNothing=showed.count("nothing") / n,
                allExact=r["exact"] == n and not r.get("failures") and r.get("previewExact", n) == n and not r.get("strays"))


def main():
    rows_path, frames, work, *rest = sys.argv[1:]
    frames, work = Path(frames), Path(work)
    sets, cells, voids, oks = {}, defaultdict(lambda: defaultdict(dict)), defaultdict(int), {}
    for r in map(json.loads, open(rows_path)):
        name = r["set"]
        sets.setdefault(name, json.loads((frames / name / "variants.json").read_text()))
        key = (name, r["link"], r["throttle"])
        if (r["void"] and not os.environ.get("WITH_VOID")) or not r["frames"]:
            voids[key] += 1
            continue
        arm = r["variant"]
        if (name, arm) not in oks:
            oks[name, arm] = proxies(work, name, arm) if arm not in (A, AA) else ({}, {})
        cells[key][arm][r["round"]] = visit_metrics(r, sets[name]["frames"], oks[name, arm])
    out = []
    for key in sorted(cells):
        name, link, throttle = key
        arms = cells[key]
        a = arms.get(A, {})
        spread = p90([abs(arms[AA][k]["exact"] / a[k]["exact"] - 1) for k in arms.get(AA, {}) if k in a])
        today = sets[name]["bytes"][A]
        for arm, by_round in arms.items():
            ms = list(by_round.values())
            full_ok = oks[name, arm][0]
            row = dict(set=name, link=link, throttle=throttle, arm=arm, n=len(ms), voids=voids[key], aaSpread=spread,
                       bytesVsA=sets[name]["bytes"].get(arm, today) / today, allExact=all(m["allExact"] for m in ms),
                       layer1AtProxy=sum(full_ok.values()), frames=sets[name]["frames"])
            for k in ("first", "pictured", "proxyFull", "proxyDisplay", "exact", "decode", "previewDecode",
                      "scrollExact", "scrollPrefix", "scrollNothing"):
                row[k] = med([m[k] for m in ms])
            for k in ("exact", "proxyFull", "first"):
                row[f"{k}VsA"] = med([m[k] / a[r_]["exact" if k != "first" else "first"] for r_, m in by_round.items()
                                      if r_ in a and m[k] is not None])
            out.append(row)
    if "--json" in rest:
        Path(rest[rest.index("--json") + 1]).write_text(json.dumps(out, indent=1))
    s = lambda v, d=2: "—" if v is None else f"{v / 1000:.{d}f}"  # noqa: E731
    x = lambda v, d=3: "—" if v is None else f"{v:.{d}f}"  # noqa: E731
    print("| set | link | CPU | arm | n | bytes ÷ A | first s | every frame pictured s | every frame at the proxy, full · display s "
          "| proxy full ÷ A exact | exact s | ÷ A exact | A/A p90 | scroll 15/s exact · layer 1 · nothing | decode layer 1 · exact s | all exact |")
    print("| --- | --- | --: | --- | --: | --: | --: | --: | --- | --: | --: | --: | --: | --- | --- | --- |")
    for r in out:
        print(f"| `{r['set']}` | {r['link']} | {r['throttle']}× | {r['arm']} | {r['n']} | {r['bytesVsA']:.3f} | {s(r['first'])} "
              f"| {s(r['pictured'])} | {s(r['proxyFull'])} · {s(r['proxyDisplay'])} | {x(r['proxyFullVsA'])} | {s(r['exact'])} "
              f"| {x(r['exactVsA'])} | {x(r['aaSpread'])} | {100 * r['scrollExact']:.0f} · {100 * r['scrollPrefix']:.0f} · "
              f"{100 * r['scrollNothing']:.0f} % | {s(r['previewDecode'])} · {s(r['decode'])} | {'yes' if r['allExact'] else 'NO'} |")
    print("\nThe second clause, per series, shape and cell: every layer-1 frame at the proxy at full size (stage 1), the whole "
          f"≤ {BYTES}× today's bytes, the exact series ≤ {TIME}× today's; strict, and with the A/A spread.")
    print("| set | arm | layer 1 at the proxy | bytes ÷ A | cells | exact ÷ A, range | holds strict · with spread |")
    print("| --- | --- | --: | --: | --: | --- | --- |")
    for (name, arm) in dict.fromkeys((r["set"], r["arm"]) for r in out if r["arm"] not in (A, AA)):
        rs = [r for r in out if r["set"] == name and r["arm"] == arm]
        proxy = rs[0]["layer1AtProxy"] == rs[0]["frames"]
        byt = rs[0]["bytesVsA"] <= BYTES
        times = [r["exactVsA"] for r in rs if r["exactVsA"] is not None]
        strict = proxy and byt and all(r["exactVsA"] is not None and r["exactVsA"] <= TIME and r["allExact"] for r in rs)
        loose = proxy and byt and all(r["exactVsA"] is not None and r["exactVsA"] <= TIME * (1 + (r["aaSpread"] or 0))
                                      and r["allExact"] for r in rs)
        print(f"| `{name}` | {arm} | {rs[0]['layer1AtProxy']}/{rs[0]['frames']} | {rs[0]['bytesVsA']:.3f} | {len(rs)} "
              f"| {min(times, default=0):.3f}–{max(times, default=0):.3f} | {'yes' if strict else 'no'} · {'yes' if loose else 'no'} |")


if __name__ == "__main__":
    main()
