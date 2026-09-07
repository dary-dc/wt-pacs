#!/usr/bin/env python3
"""Summarise an L2 v4 TSV (local or cloud).

Groups by (trace, rtt, loss, arm). Prints median / IQR / p95 of p95_lateness_ms,
lateness_median_ms, stranded_bytes, and (if present) netem_drops. For every
loss-0 cell, runs the FIFO simulator at that cell's median achieved_mbps and
flags a >5 % miss.

Usage:
  python3 lab/scripts/l2_v4_summarize.py .local/l2/v4/l2_ask_policy_v4.tsv
  python3 lab/scripts/l2_v4_summarize.py .local/l2/v4-local/l2_ask_policy_v4_local.tsv
"""
import csv
import math
import os
import statistics
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SIM = os.path.join(ROOT, "lab/scripts/l2_policy_sim.py")
TRACE_MAP = {"scroll": "v2", "v2": "v2", "jump": "jump", "reversal": "reversal"}
ARM_ORDER = ["control", "window", "adr", "bulk", "bounded", "dynpath", "dynclean"]


def fnum(s, default=0.0):
    try:
        return float(s)
    except (TypeError, ValueError):
        return default


def quantile(xs, p):
    if not xs:
        return 0.0
    s = sorted(xs)
    if len(s) == 1:
        return s[0]
    rank = max(1, min(len(s), math.ceil(p / 100.0 * len(s))))
    return s[rank - 1]


def iqr(xs):
    if len(xs) < 2:
        return 0.0
    return quantile(xs, 75) - quantile(xs, 25)


def sim_p95(trace, step, rtt, depth, prefetch, rate):
    tr = TRACE_MAP.get(trace, trace)
    pf = prefetch
    try:
        pf = int(float(prefetch))
    except (TypeError, ValueError):
        pf = 0
    out = subprocess.check_output(
        [
            sys.executable, SIM, "--cell",
            "--trace", tr, "--step-ms", str(step), "--rtt", str(rtt),
            "--depth", str(int(float(depth or 0))), "--prefetch", str(pf),
            "--shape", "forward", "--rate-mbps", str(rate or 10),
        ],
        text=True,
    )
    # fmt is `p95=   71.2` (spaces after =) so split() yields `p95=` then the number.
    parts = out.split()
    for i, part in enumerate(parts):
        if part.startswith("p95="):
            rest = part.split("=", 1)[1].strip()
            if rest:
                return float(rest)
            if i + 1 < len(parts):
                return float(parts[i + 1])
    return None


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, ".local/l2/v4/l2_ask_policy_v4.tsv")
    rows = list(csv.DictReader(open(path), delimiter="\t"))
    if not rows:
        print("empty TSV", path, file=sys.stderr)
        return 1
    void = [r for r in rows if r.get("run_rc", "0") not in ("0", "") or fnum(r.get("wait_samples", 1)) == 0]
    print(f"file={path} n={len(rows)} void={len(void)}")

    groups = {}
    for r in rows:
        key = (
            r.get("trace", ""),
            r.get("step_ms", r.get("step", "40")),
            r.get("rtt_nom_ms", r.get("rtt_ms", "")),
            r.get("loss_pct", "0"),
            r["arm"],
        )
        groups.setdefault(key, []).append(r)

    print(f"{'trace':8} {'rtt':>5} {'loss':>5} {'arm':10} {'n':>3} "
          f"{'p95_med':>8} {'p95_iqr':>8} {'p95_p95':>8} "
          f"{'lat_med':>8} {'strand_KB':>9} {'drops':>6} {'sim_p95':>8} {'vs_sim':>8}")

    flags = []
    keys = sorted(groups, key=lambda k: (k[0], float(k[2] or 0), float(k[3] or 0), ARM_ORDER.index(k[4]) if k[4] in ARM_ORDER else 99))
    for key in keys:
        g = groups[key]
        trace, step, rtt, loss, arm = key
        p95s = [fnum(r.get("p95_lateness_ms")) for r in g]
        meds = [fnum(r.get("lateness_median_ms")) for r in g]
        strand = [fnum(r.get("stranded_bytes")) / 1000.0 for r in g]
        drops = [fnum(r.get("netem_drops", 0)) for r in g]
        rates = [fnum(r.get("achieved_mbps")) for r in g if fnum(r.get("achieved_mbps"))]
        rate = statistics.median(rates) if rates else 10.0
        path_rtts = [fnum(r.get("path_rtt_ms")) for r in g if fnum(r.get("path_rtt_ms"))]
        sim_rtt = statistics.median(path_rtts) if path_rtts else fnum(rtt)
        depth = g[0].get("depth", 0)
        prefetch = g[0].get("prefetch", 0)
        sim = None
        vs = ""
        if fnum(loss) == 0 and arm in ("control", "window", "adr", "bulk", "bounded"):
            try:
                sim = sim_p95(trace, step, sim_rtt, depth, prefetch, rate)
            except Exception as e:
                vs = f"sim-err {e}"
            if sim is not None:
                med = statistics.median(p95s)
                if sim == 0:
                    gap = 0.0 if med == 0 else 1.0
                else:
                    gap = abs(med - sim) / sim
                vs = f"{gap*100:.1f}%"
                if gap > 0.05:
                    flags.append((key, med, sim, gap))
        print(f"{trace:8} {rtt:>5} {loss:>5} {arm:10} {len(g):3} "
              f"{statistics.median(p95s):8.1f} {iqr(p95s):8.1f} {quantile(p95s, 95):8.1f} "
              f"{statistics.median(meds):8.1f} {statistics.median(strand):9.0f} "
              f"{statistics.median(drops):6.0f} "
              f"{(f'{sim:.1f}' if sim is not None else '-'):>8} {vs:>8}")

    print()
    if flags:
        print("LOSS-0 cells >5 % from simulator (reported, not smoothed):")
        for key, med, sim, gap in flags:
            print(f"  {key} harness_p95_med={med:.1f} sim={sim:.1f} gap={gap*100:.1f}%")
    else:
        print("No loss-0 cell more than 5 % from the simulator (or no comparable arms).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
