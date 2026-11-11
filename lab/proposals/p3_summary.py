#!/usr/bin/env python3
"""P3's table and verdict from its rows, by docs/lines/proposals.md §P3 amendment 1: per series, each promoted
variant's median `l` above `unpromoted`'s, against 300 (off) or max(0, 300 − L) (on L), each within 10 ms. An `on`
run fails the rule unless it ends at Lossless with the optimal-quality series whole and no error.

usage: p3_summary.py ROWS.jsonl
"""
import json
import re
import statistics
import sys

rows = [json.loads(line) for line in open(sys.argv[1])]
ms, failed, promoted = {}, {}, {}
for r in rows:
    u, key = r["run"], (r["run"]["id"], r["variant"])
    whole = re.search(r"received (\d+)", u.get("statusAfter") or "")
    ok = u.get("lossless") and "error:" not in (u.get("statusAfter") or "") and whole and int(whole[1]) > 0
    if ok:
        ms.setdefault(key, []).append(u["losslessMs"])
    else:
        failed[key] = failed.get(key, 0) + 1
    count = int(re.search(r"promoted (\d+)", " ".join(u.get("relay", [])))[1])
    promoted.setdefault(key, []).append(count)

TARGET = {"off": 300, "on0": 300, "on50": 250, "on100": 200}
verdict = "holds"
print("| series | variant | `l` median ms | above unpromoted | expected | n | promoted per run | failed |")
print("| --- | --- | ---: | ---: | ---: | --- | --- | --- |")
for sid in sorted({k[0] for k in ms}):
    base = statistics.median(ms[(sid, "unpromoted")])
    for v in ("unpromoted", "off", "on0", "on50", "on100"):
        xs = ms.get((sid, v), [])
        m = statistics.median(xs) if xs else float("nan")
        above = m - base
        if v != "unpromoted" and (failed.get((sid, v)) or not abs(above - TARGET[v]) <= 10):
            verdict = "refuted"
        expect = "" if v == "unpromoted" else TARGET[v]
        counts = sorted(set(promoted.get((sid, v), [])))
        print(f"| {sid} | {v} | {m:.0f} | {above:+.0f} | {expect} | {len(xs)} | {counts} | {failed.get((sid, v), 0)} |")
print(f"\nrule: {verdict} (each promoted variant within 10 ms of its expected lead over unpromoted, every series)")
