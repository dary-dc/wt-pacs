#!/usr/bin/env python3
"""Row CARRIERS, amended: the pilot's spread, which sizes the rounds (docs/av1/profile-carriers.md, amended, §F).
Per volume and metric, the robust SD (1.4826 × MAD) of the per-round log ratio of chosen pairs, and of the A/A.

usage: pilot_spread.py ROWS.jsonl ...
"""
import collections
import math
import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import amended  # noqa: E402
rows, voids = amended.load(sys.argv[1:])
cells = amended.metrics(rows)
norm = amended.normalized(cells)
def sd(d):
    m = st.median(d); return 1.4826 * st.median(abs(x - m) for x in d) if len(d) > 2 else float('nan')
MET = sorted({m for v in amended.PATTERNS.values() for m in [v]})
print('voids', voids, 'rounds', sorted({r['round'] for r in rows}))
out = collections.defaultdict(list)
for s in ('dbts_a1', 'dbts_b1', 'dbts_c1'):
    aa = [math.log(c['ctrl-aa']['frame'] / c['ctrl']['frame']) for (s2, b, r), c in cells.items() if s2 == s and 'ctrl' in c and 'ctrl-aa' in c]
    print(s, 'A/A sd', round(sd(aa), 4), 'n', len(aa))
    for m in MET:
        line = []
        for x, y in [('lay-k1','sep-g1'),('lay-k4','sep-g4'),('lay-k8','sep-g8'),('lay-k16','sep-g16'),('sep-g1','sep-g16'),('lay-k1','lay-k16'),('lay-k8','whole')]:
            X, Y = norm.get((s, x), {}), norm.get((s, y), {})
            d = [math.log(X[r][m] / Y[r][m]) for r in X if r in Y and m in X[r] and m in Y[r]]
            if len(d) > 2:
                out[m].append(sd(d)); line.append(f"{x}/{y} {math.exp(st.median(d)):.3g} sd {sd(d):.3f}")
        print(' ', m, '; '.join(line))
print('max sd per metric', {m: round(max(v), 3) for m, v in out.items()})
