#!/usr/bin/env python3
"""Summarise an L4 campaign TSV.

Reports median and full range per (cell, arm), because n is small: with 3 repeats a
mean and an SD invite more confidence than the data carries. An arm is only called a
winner when its range does not overlap the baseline's — a deliberately blunt rule that
cannot be talked into a result by a favourable mean.

Also enforces the pre-registered stop conditions and marks offending rows VOID.
"""
import csv
import statistics as st
import sys
from collections import defaultdict


def load(path):
    rows = list(csv.DictReader(open(path), delimiter="\t"))
    for r in rows:
        for k in ("p95_wait_ms", "mean_wait_ms", "fill_rate", "srv_cpu_s", "cli_cpu_s",
                  "ns_cpu_s", "wall_s"):
            r[k] = float(r[k])
        for k in ("depth", "peak_outstanding", "wait_samples"):
            r[k] = int(r[k])
    return rows


def stop_conditions(r):
    bad = []
    if r["p95_wait_ms"] == 0:
        bad.append("p95=0")
    if r["peak_outstanding"] < r["depth"]:
        bad.append("depth<%d" % r["depth"])
    if r["wall_s"] > 0 and r["cli_cpu_s"] / r["wall_s"] >= 0.9:
        bad.append("client>=0.9core")
    if r["wall_s"] > 0 and r["ns_cpu_s"] / r["wall_s"] >= 0.9:
        bad.append("netsim>=0.9core")
    return bad


def main(path, baseline=None):
    rows = load(path)
    groups = defaultdict(list)
    voids = defaultdict(list)
    for r in rows:
        bad = stop_conditions(r)
        key = (r["cell"], r["arm"])
        if bad:
            voids[key].extend(bad)
        groups[key].append(r)

    cells = sorted({c for c, _ in groups})
    for cell in cells:
        arms = [a for c, a in groups if c == cell]
        base = baseline if baseline in arms else sorted(arms)[0]
        b = [x["p95_wait_ms"] for x in groups[(cell, base)]]
        bmed = st.median(b) if b else float("nan")
        sample = groups[(cell, base)][0]
        print("\n=== cell %s · RTT %s ms · %s Mbps · %s%% loss · %s · baseline %s ==="
              % (cell, sample["rtt_ms"], sample["rate_mbps"], sample["loss_pct"],
                 sample["fixture"], base))
        print("%-16s %10s %18s %10s %8s %7s  %s"
              % ("arm", "p95_med", "p95_range", "vs_base", "mean", "Mbps", "flags"))
        for arm in sorted(arms):
            g = groups[(cell, arm)]
            p = sorted(x["p95_wait_ms"] for x in g)
            m = st.median(p)
            delta = (m - bmed) / bmed * 100 if bmed else float("nan")
            # blunt separation rule: ranges must not overlap
            sep = ""
            if arm != base and b:
                if max(p) < min(b):
                    sep = "BETTER"
                elif min(p) > max(b):
                    sep = "WORSE"
                else:
                    sep = "overlap"
            flags = ",".join(sorted(set(voids.get((cell, arm), []))))
            print("%-16s %10.1f %18s %+9.1f%% %8.1f %7.1f  %s"
                  % (arm, m, "%.0f-%.0f" % (p[0], p[-1]), delta,
                     st.median([x["mean_wait_ms"] for x in g]),
                     st.median([x["fill_rate"] for x in g]),
                     (sep + (" VOID:" + flags if flags else "")).strip()))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
