#!/usr/bin/env python3
"""Paired write_all vs write_chunk by session count, under the campaign's own rule.

The question: does the cost of the copy into quinn grow with concurrency? Memory bandwidth
is shared, not per-core, so a copy that is free when one sender owns the machine need not
stay free when thirty do. If the margin is flat in N, the single-session -3.2% was the whole
answer; if it grows, it never was.
"""
import csv, statistics as st, sys, collections, math

DRIFT = 7.0  # the send-path campaign's run-to-run drift, not the read campaign's 28.5%

# Generate the input with:
#   for n in 1 4 16 32; do for m in write_all write_chunk; do
#     WIRE_BENCH_SESSIONS=$n ./target/release/wire_send_bench <study> $m 20 3
#   done; done
# interleaved within each round, so a drifting machine moves both arms together.
rows = list(csv.DictReader(open(sys.argv[1]), delimiter="\t"))
by = collections.defaultdict(dict)
for r in rows:
    if not r["cpu_ns_per_frame"]:
        continue
    by[(r["round"], r["sessions"])][r["mode"]] = r

print(f"{'sessions':>8}  {'n':>3}  {'CPU/frame Δ':>12}  {'signs':>7}  {'verdict':<10}  "
      f"{'write_all':>10}  {'write_chunk':>11}")
for n in sorted({k[1] for k in by}, key=int):
    ds, wa, wc = [], [], []
    for (_, sess), arms in by.items():
        if sess != n or "write_all" not in arms or "write_chunk" not in arms:
            continue
        a = int(arms["write_all"]["cpu_ns_per_frame"])
        c = int(arms["write_chunk"]["cpu_ns_per_frame"])
        if not a:
            continue
        ds.append((c - a) / a * 100); wa.append(a); wc.append(c)
    if not ds:
        continue
    med = st.median(ds)
    agree = max(sum(1 for d in ds if d < 0), sum(1 for d in ds if d > 0))
    ok = abs(med) >= DRIFT and agree >= math.ceil(0.8 * len(ds))
    print(f"{n:>8}  {len(ds):>3}  {med:>+11.1f}%  {agree:>3}/{len(ds):<3}  "
          f"{'RESOLVED' if ok else 'tie':<10}  {st.median(wa):>10.0f}  {st.median(wc):>11.0f}")
