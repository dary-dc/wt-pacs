#!/usr/bin/env python3
"""Paired before/after A/B, both arms measured inside the same round.

Build the two binaries first — the "before" one from a git worktree at the base commit, so
the working tree is never disturbed:

    git worktree add /tmp/before <base-commit>
    (cd /tmp/before && cargo build --release -p disk-access-bench --bin wire_send_bench)

Then alternate them *within* each round. Running one arm to completion and then the other
does not work: the two runs sit minutes apart, and machine drift between them reads as a
difference with high sign agreement. Measured here — the same code compared sequentially
said +8.1% RESOLVED at 16 sessions and interleaved said -1.8%, a tie.
"""
import csv, statistics as st, sys, collections, math
DRIFT = 7.0
cells = collections.defaultdict(dict)
for r in csv.DictReader(open(sys.argv[1]), delimiter="\t"):
    if r["cpu_ns_per_frame"]:
        cells[(r["round"], r["sessions"])][r["arm"]] = int(r["cpu_ns_per_frame"])
print(f"{'sessions':>8}  {'n':>3}  {'CPU/frame Δ':>12}  {'signs':>7}  {'verdict':<9}  {'before':>9}  {'after':>9}")
for n in sorted({k[1] for k in cells}, key=int):
    ds, b, a = [], [], []
    for (rnd, sess), arms in cells.items():
        if sess != n or "before" not in arms or "after" not in arms:
            continue
        x, y = arms["before"], arms["after"]
        ds.append((y - x) / x * 100); b.append(x); a.append(y)
    if not ds: continue
    med = st.median(ds)
    agree = max(sum(1 for d in ds if d < 0), sum(1 for d in ds if d > 0))
    ok = abs(med) >= DRIFT and agree >= math.ceil(0.8 * len(ds))
    print(f"{n:>8}  {len(ds):>3}  {med:>+11.1f}%  {agree:>3}/{len(ds):<3}  "
          f"{'RESOLVED' if ok else 'tie':<9}  {st.median(b):>9.0f}  {st.median(a):>9.0f}")
