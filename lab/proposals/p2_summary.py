#!/usr/bin/env python3
"""P2's tables and verdict from its rows, by the rule docs/lines/proposals.md §P2 amendment 1 reads.

usage: p2_summary.py ROWS.jsonl BYTES.jsonl
"""
import json
import re
import statistics
import sys

rows = [json.loads(line) for line in open(sys.argv[1])]
nbytes = {(r["id"], r["arm"]): r["ratio"] for r in map(json.loads, open(sys.argv[2]))}
ARMS = ("one", "2x2", "2x1")
SERIES = sorted({r["id"] for r in rows})
G8 = [s for s in SERIES if "-g8" in s]
dec, fill, jump, bad = {}, {}, {}, []
for r in rows:
    u, k = r["run"], (r["cores"], r["id"], r["arm"])
    if r["cell"] == "decode":
        if u.get("error") or u.get("wrong"):
            bad.append((r["round"], *k, u.get("error") or u["wrong"][:1]))
        dec.setdefault(k, []).extend(u.get("ms", []))
    else:
        if not u.get("checks", "").endswith("passed"):
            bad.append((r["round"], *k, u.get("checks", "")[-200:]))
        p = {x["query"]: x for x in u.get("passes", [])}
        m = re.search(r"fill (\d+) ms", p.get("", {}).get("status", ""))
        if m:
            fill.setdefault(k, []).append(int(m.group(1)))
        if p.get("&fill=0", {}).get("jumpMs") is not None:
            jump.setdefault(k, []).append(p["&fill=0"]["jumpMs"])
med = lambda d, k: statistics.median(d[k]) if d.get(k) else None


def table(title, d, series, unit):
    print(f"\n{title}\n\n| cores | series | one tile {unit} | 2 × 2 | 2 × 1 | n |\n| ---: | --- | ---: | ---: | ---: | --- |")
    for cores in (4, 2):
        for s in series:
            one = med(d, (cores, s, "one"))
            if one is None:
                continue
            cell = [f"{one:.0f}" if unit == "ms" else f"{one:.0f}"]
            for arm in ARMS[1:]:
                v = med(d, (cores, s, arm))
                cell.append(f"{v:.0f} ({v / one:.2f}×)" if v is not None else "—")
            print(f"| {cores} | {s} | {' | '.join(cell)} | {len(d[(cores, s, 'one')])} a side |")


table("Per-frame decode, median over every frame of every round", dec, SERIES, "ms")
table("Jump (`End` under `&fill=0`), median of rounds", jump, G8, "ms")
table("Fill (the status line's `fill N ms`), median of rounds", fill, G8, "ms")
print("\n| series | 2 × 2 bytes | 2 × 1 bytes |\n| --- | ---: | ---: |")
for s in SERIES:
    print(f"| {s} | {nbytes[(s, '2x2')]:.4f}× | {nbytes[(s, '2x1')]:.4f}× |")
ratio = lambda d, s, arm: med(d, (4, s, arm)) / med(d, (4, s, "one"))
for arm in ARMS[1:]:
    why = [f"decode {s} {ratio(dec, s, arm):.2f}×" for s in SERIES if s.startswith(("dbts_a1", "dbts_b1")) and ratio(dec, s, arm) > 0.8]
    why += [f"jump {s} {ratio(jump, s, arm):.2f}×" for s in G8 if ratio(jump, s, arm) > 0.85]
    why += [f"bytes {s} {nbytes[(s, arm)]:.4f}×" for s in SERIES if nbytes[(s, arm)] > 1.03]
    why += [f"fill {s} {ratio(fill, s, arm):.2f}×" for s in G8 if ratio(fill, s, arm) > 1.05]
    why += [f"a failed run, round {b[0]}" for b in bad if b[1] == 4 and b[3] == arm]
    print(f"\n{arm}: {'adopt' if not why else 'reject: ' + '; '.join(why)}")
print(f"\nfailed runs (2-core ones decide nothing): {len(bad)}", *bad[:10], sep="\n")
