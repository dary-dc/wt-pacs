#!/usr/bin/env python3
"""Row SNRPREVIEW: the pilot's spread, which sizes the rounds (docs/av1/snr-preview.md §6). Per stage, the robust SD
(1.4826 × MAD) of the per-round log ratio of every pair the rule reads, the largest over volumes, G and rungs, and the
A/A's; and each pair's median ratio.

usage: pilot_spread.py ROWS.jsonl ...
"""
import math
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rule  # noqa: E402


def sd(d):
    m = st.median(d)
    return 1.4826 * st.median(abs(x - m) for x in d)


rows, voids = rule.load(sys.argv[1:])
cells = rule.arms(rows)
norm = rule.normalized(cells)
print("VOID", voids, "rounds", sorted({r["round"] for r in rows}))
aa = defaultdict(list)
for (s, g, v, _), a in cells.items():
    if "ctrl" in a and "ctrl-aa" in a:
        m = [st.median(a[x]["cine-exact"][0]["ms"]) for x in ("ctrl-aa", "ctrl")]
        aa[s].append(math.log(m[0] / m[1]))
print("A/A sd", {s: round(sd(d), 4) for s, d in aa.items()})
worst = defaultdict(float)
for stage in rule.STAGES:
    for (s, g, v, c), by in sorted(norm.items()):
        if c not in rule.TWO_LAYER:
            continue
        for t, x in rule.PAIRS:
            if t != c:
                continue
            X, Y = by, norm.get((s, g, v, x), {})
            d = [math.log(X[r][stage] / Y[r][stage]) for r in X if r in Y]
            if len(d) > 2:
                worst[stage] = max(worst[stage], sd(d))
                print(f"{stage} | {s} G {g} Q {v} | {t}/{x} {math.exp(st.median(d)):.3g} sd {sd(d):.3f}")
print("largest sd per stage", {k: round(v, 3) for k, v in worst.items()})
