#!/usr/bin/env python3
"""Report an L4 campaign, refusing to quote a void row.

Primary metric is `nz_p95` — a percentile over waits that actually waited. The older
`p95_wait_ms` includes cache-hit zeros, so at nz_n≈37 of 191 it is roughly the 76th
percentile of informative waits and at nz_n≈19 roughly their median. Three rows with
p95_wait_ms == 0 were quoted as results once already; rows now carry their own verdict
and this refuses to aggregate them.

Separation rule is the lane's pre-registered one: ranges must not overlap.
"""
import csv
import statistics as st
import sys
from collections import defaultdict


def main(path, metric="nz_p95", baseline=None):
    rows = list(csv.DictReader(open(path), delimiter="\t"))
    g, voids = defaultdict(list), defaultdict(list)
    for r in rows:
        key = (r["cell"], r["arm"])
        (voids if r.get("verdict", "ok") != "ok" else g)[key].append(r)

    for cell in sorted({c for c, _ in list(g) + list(voids)}):
        arms = sorted({a for c, a in g if c == cell})
        if not arms:
            print("\ncell %s — ALL ROWS VOID" % cell)
            continue
        base = baseline if baseline in arms else arms[0]
        sample = g[(cell, base)][0]
        print("\n=== cell %s · %s ms RTT · %s Mbps · %s%% loss burst %s · %s · depth %s ==="
              % (cell, sample["rtt_ms"], sample["rate_mbps"], sample["loss_pct"],
                 sample.get("loss_burst", "?"), sample["fixture"], sample["depth"]))
        b = sorted(float(x[metric]) for x in g[(cell, base)])
        print("%-16s %3s %11s %18s %10s %9s %8s %8s"
              % ("arm", "n", metric, "range", "vs base", "wall", "qdrop", "void"))
        for arm in arms:
            v = sorted(float(x[metric]) for x in g[(cell, arm)])
            m = st.median(v)
            sep = ("" if arm == base else
                   "BETTER" if max(v) < min(b) else
                   "WORSE" if min(v) > max(b) else "overlap")
            print("%-16s %3d %11.1f %18s %+9.1f%% %9.1f %8.0f %8d  %s"
                  % (arm, len(v), m, "%.0f-%.0f" % (v[0], v[-1]),
                     100 * (m - st.median(b)) / st.median(b) if st.median(b) else 0.0,
                     st.median(float(x["wall_s"]) for x in g[(cell, arm)]),
                     st.median(float(x.get("ns_qdrop", 0) or 0) for x in g[(cell, arm)]),
                     len(voids.get((cell, arm), [])), sep))


if __name__ == "__main__":
    main(sys.argv[1],
         sys.argv[2] if len(sys.argv) > 2 else "nz_p95",
         sys.argv[3] if len(sys.argv) > 3 else None)
