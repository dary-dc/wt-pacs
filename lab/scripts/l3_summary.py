#!/usr/bin/env python3
"""Summarise an l3_lossy_link.sh TSV: per cell and arm, median [range] and rounds better than the
default arm, paired by round. Fill is wall time (connect included) and goodput; on demand is the
per-ask p50 and p90; loss is the server's own datagram count.

    lab/scripts/l3_summary.py .local/measurements/l3-*.tsv [--fill-bytes N]
"""
import csv
import statistics
import sys
from collections import defaultdict

args = sys.argv[1:]
fill_bytes = 5_120_000
if "--fill-bytes" in args:
    i = args.index("--fill-bytes")
    fill_bytes = int(args[i + 1])
    del args[i : i + 2]

rows = [r for r in csv.DictReader(open(args[0]), delimiter="\t") if r["code"] == "0"]
by = defaultdict(dict)  # (cell, mode, arm) -> round -> row
for r in rows:
    by[(r["cell"], r["mode"], r["arm"])][r["round"]] = r


def med(xs):
    return f"{statistics.median(xs):.1f} [{min(xs):.1f}–{max(xs):.1f}]" if xs else "NA"


def better(cell, mode, arm, key):
    """Rounds where `arm` is lower than the default arm on `key`, out of rounds both have."""
    a, d = by[(cell, mode, arm)], by[(cell, mode, "default")]
    common = [k for k in a if k in d]
    return f"{sum(float(a[k][key]) < float(d[k][key]) for k in common)}/{len(common)}"


cells = list(dict.fromkeys(r["cell"] for r in rows))
arms = list(dict.fromkeys(r["arm"] for r in rows))
for cell in cells:
    print(f"== {cell}  (one-way delay ms : rate Mbit : loss %)")
    print(f"   {'arm':8} {'fill s':>22} {'goodput Mbit':>20} {'vs def':>6} {'loss %':>6} {'events':>6}"
          f" {'srtt ms':>7} {'cpu ms':>6} | {'ask p50 ms':>22} {'vs def':>6} {'ask p90 ms':>22}")
    for arm in arms:
        f = list(by[(cell, "fill", arm)].values())
        o = list(by[(cell, "on-demand", arm)].values())
        wall = [int(r["wall_ns"]) / 1e9 for r in f]
        good = [fill_bytes * 8 / 1e6 / w for w in wall]
        sent = sum(int(r["sent"]) for r in f if r["sent"] != "NA")
        lost = sum(int(r["lost"]) for r in f if r["lost"] != "NA")
        events = [int(r["loss_events"]) for r in f if r["loss_events"] != "NA"]
        srtt = [int(r["srtt_us"]) / 1e3 for r in f if r["srtt_us"] != "NA"]
        cpu = [int(r["server_cpu_ns"]) / 1e6 for r in f]
        p50 = [int(r["p50_ns"]) / 1e6 for r in o]
        p90 = [int(r["p90_ns"]) / 1e6 for r in o]
        vs_f = "—" if arm == "default" else better(cell, "fill", arm, "wall_ns")
        vs_o = "—" if arm == "default" else better(cell, "on-demand", arm, "p50_ns")
        loss = f"{100 * lost / sent:.2f}" if sent else "NA"
        print(f"   {arm:8} {med(wall):>22} {med(good):>20} {vs_f:>6} {loss:>6}"
              f" {statistics.median(events) if events else 'NA':>6} {statistics.median(srtt) if srtt else 0:>7.1f}"
              f" {statistics.median(cpu):>6.0f} | {med(p50):>22} {vs_o:>6} {med(p90):>22}")
