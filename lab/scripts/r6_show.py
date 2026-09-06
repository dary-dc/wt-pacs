#!/usr/bin/env python3
"""Column-align an R6 TSV. `column(1)` is not present in every lab container."""
import sys

rows = [l.rstrip("\n").split("\t") for l in open(sys.argv[1]) if l.strip()]
if not rows:
    raise SystemExit
keep = sys.argv[2].split(",") if len(sys.argv) > 2 else None
if keep:
    idx = [rows[0].index(k) for k in keep if k in rows[0]]
    rows = [[r[i] for i in idx] for r in rows]
w = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
for r in rows:
    print("  ".join(c.ljust(w[i]) for i, c in enumerate(r)))
