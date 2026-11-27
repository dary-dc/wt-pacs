#!/usr/bin/env python3
"""R3's plumbing table and verdict from its rows, by docs/lines/proposals.md §R3 and its amendment 1: per series,
`on 100` − `off` is −100 ± 15 ms, the tolerance widened to the A/A arm's |off-aa − off| where larger (R0). A run
counts only if it ends at Lossless with the optimal-quality series whole and no error.

usage: r3_summary.py ROWS.jsonl
"""
import json
import re
import statistics
import sys

rows = [json.loads(line) for line in open(sys.argv[1])]
ms, failed, promoted = {}, {}, {}
for r in rows:
    u, key = r["run"], (r["run"]["id"], r["variant"])
    after = u.get("statusAfter") or ""
    whole = re.search(r" of (\d+) .* received (\d+)", after)
    if u.get("lossless") and "error:" not in after and whole and whole[1] == whole[2]:
        ms.setdefault(key, []).append(u["losslessMs"])
    else:
        failed[key] = failed.get(key, 0) + 1
    promoted.setdefault(key, []).append(int(re.search(r"promoted (\d+)", " ".join(u.get("relay", [])))[1]))

verdict = "holds"
print("| series | off ms | on 100 ms | A/A ms | on − off | tolerance | n off/on/aa | promoted per run | failed |")
print("| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |")
for sid in sorted({k[0] for k in ms}):
    m = {v: statistics.median(ms[(sid, v)]) if ms.get((sid, v)) else float("nan") for v in ("off", "on100", "off-aa")}
    tol = max(15, abs(m["off-aa"] - m["off"]))
    gain = m["on100"] - m["off"]
    bad = sum(failed.get((sid, v), 0) for v in ("off", "on100", "off-aa"))
    if bad or not abs(gain + 100) <= tol:
        verdict = "refuted"
    n = "/".join(str(len(ms.get((sid, v), []))) for v in ("off", "on100", "off-aa"))
    counts = sorted({c for v in ("off", "on100", "off-aa") for c in promoted.get((sid, v), [])})
    print(f"| {sid} | {m['off']:.0f} | {m['on100']:.0f} | {m['off-aa']:.0f} | {gain:+.0f} | {tol:.0f} | {n} | {counts} | {bad} |")
print(f"\nrule (plumbing): {verdict}")
