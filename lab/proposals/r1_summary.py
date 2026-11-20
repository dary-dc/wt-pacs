#!/usr/bin/env python3
"""R1's tables and verdict from its rows, by the rule of docs/lines/proposals.md §R1 and its amendment 1.

usage: r1_summary.py R1_OUT BYTES.jsonl CORRECT.jsonl JUMP.jsonl     R1_OUT/ARM/ID.quality.jsonl per series
"""
import json
import statistics
import sys
from pathlib import Path

out, bytes_rows, correct_rows, jump_rows = Path(sys.argv[1]), *[[json.loads(x) for x in open(p)] for p in sys.argv[2:5]]
fmt = lambda x, f="{:.3f}": "—" if x is None else f.format(x)
ok = {1: True, 2: True, 3: True, 4: True}

print("| series | e one / 2×2 (median, max) | e_N÷σ one / 2×2 (median, max) | max |Δ| median one / 2×2 | built agrees | bytes |")
print("| --- | --- | --- | --- | --- | ---: |")
for b in bytes_rows:
    sid, q = b["id"], {}
    for arm in ("one", "2x2"):
        fr = [json.loads(x) for x in open(out / arm / f"{sid}.quality.jsonl")]
        q[arm] = fr
    stat = lambda arm, k, f: f([x[k] for x in q[arm] if x[k] is not None])
    cells = []
    for k in ("e", "eNOverSigma"):
        for f in (statistics.median, max):
            one, two = stat("one", k, f), stat("2x2", k, f)
            ok[1] &= two <= 1.02 * one
            cells.append((one, two))
    mo, mt = stat("one", "max", statistics.median), stat("2x2", "max", statistics.median)
    ok[1] &= mt - mo <= 1
    agree = all(abs(x["e"] - x["built"]["rms"]) <= 1e-3 * max(1, x["e"]) and x["max"] == x["built"]["max"]
                and (x["eNOverSigma"] is None or x["built"]["noiseBandRatio"] is None
                     or abs(x["eNOverSigma"] - x["built"]["noiseBandRatio"]) <= 0.01 * x["eNOverSigma"] + 1e-4)
                for arm in q for x in q[arm])
    nosig = sum(x["eNOverSigma"] is None for arm in q for x in q[arm])
    ok[4] &= b["ratio"] <= 1.03
    print(f"| {sid} | {fmt(cells[0][0])}, {fmt(cells[1][0])} / {fmt(cells[0][1])}, {fmt(cells[1][1])} | "
          f"{fmt(cells[2][0])}, {fmt(cells[3][0])} / {fmt(cells[2][1])}, {fmt(cells[3][1])} | {mo:.0f} / {mt:.0f} | "
          f"{'yes' if agree else 'NO'}{f', {nosig} frames σ = 0' if nosig else ''} | {b['ratio']:.4f} |")

print("\n| arm | series | as coded / received / frames | paths |\n| --- | --- | --- | --- |")
for r in correct_rows:
    good = r["asCoded"] == r["received"] == r["frames"] and r["paths"] == f"av1-webcodecs {r['frames']}" and not r["errors"]
    ok[2] &= good
    print(f"| {r['armDir']} | {r['id']} | {r['asCoded']} / {r['received']} / {r['frames']} | {r['paths']}{'' if good else ' FAILS'} |")

print("\n| cores | one ms | 2×2 ms | A/A ms | 2×2 ÷ one | A/A ÷ one | hardwareConcurrency |\n| --- | ---: | ---: | ---: | ---: | ---: | --- |")
for cores in (4, 2):
    j = {a: [r["run"]["passes"][1]["jumpMs"] for r in jump_rows if r["cores"] == cores and r["arm"] == a
             and len(r["run"].get("passes", [])) > 1 and r["run"]["passes"][1].get("jumpMs") is not None] for a in ("one", "2x2", "aa")}
    m = {a: statistics.median(v) if v else None for a, v in j.items()}
    hc = sorted({r["hardwareConcurrency"] for r in jump_rows if r["cores"] == cores})
    rt = m["2x2"] / m["one"] if m["one"] and m["2x2"] else None
    aa = m["aa"] / m["one"] if m["one"] and m["aa"] else None
    if cores == 4:
        ok[3] &= rt is not None and rt <= 0.85 + abs((aa or 1) - 1)
    print(f"| {cores} | {fmt(m['one'], '{:.0f}')} | {fmt(m['2x2'], '{:.0f}')} | {fmt(m['aa'], '{:.0f}')} | {fmt(rt, '{:.2f}')} | "
          f"{fmt(aa, '{:.2f}')} | {hc} | n {len(j['one'])}/{len(j['2x2'])}/{len(j['aa'])}")
print("\nconditions:", ok, "→", "2×2 ready for adoption after the demo" if all(ok.values()) else "not ready")
