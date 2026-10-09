#!/usr/bin/env python3
"""Summarise an l3_lossy_link.sh TSV: per cell and variant, median [range] and rounds better than the
default variant, paired by round, and that lead by the variant's predecessor (lab/scripts/order.py). Fill is wall time (connect included) and goodput; on demand is the
per-ask p50 and p90; loss is the server's own datagram count.

    lab/scripts/l3_summary.py .local/measurements/l3-*.tsv [--fill-bytes N]
"""
import csv
import os
import statistics
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from order import leads_by_predecessor

args = sys.argv[1:]
fill_bytes = 5_120_000
if "--fill-bytes" in args:
    i = args.index("--fill-bytes")
    fill_bytes = int(args[i + 1])
    del args[i : i + 2]

rows = [r for r in csv.DictReader(open(args[0]), delimiter="\t") if r["code"] == "0"]
by = defaultdict(dict)  # (cell, mode, variant) -> round -> row
for r in rows:
    by[(r["cell"], r["mode"], r["variant"])][r["round"]] = r


def med(xs):
    return f"{statistics.median(xs):.1f} [{min(xs):.1f}–{max(xs):.1f}]" if xs else "NA"


def better(cell, mode, variant, key):
    """Rounds where `variant` is lower than the default variant on `key`, out of rounds both have."""
    a, d = by[(cell, mode, variant)], by[(cell, mode, "default")]
    common = [k for k in a if k in d]
    return f"{sum(float(a[k][key]) < float(d[k][key]) for k in common)}/{len(common)}"


cells = list(dict.fromkeys(r["cell"] for r in rows))
variants = list(dict.fromkeys(r["variant"] for r in rows))
for cell in cells:
    print(f"== {cell}  (one-way delay ms : rate Mbit : loss %)")
    print(f"   {'variant':8} {'fill s':>22} {'goodput Mbit':>20} {'vs def':>6} {'loss %':>6} {'events':>6}"
          f" {'srtt ms':>7} {'cpu ms':>6} | {'ask p50 ms':>22} {'vs def':>6} {'ask p90 ms':>22}")
    for variant in variants:
        f = list(by[(cell, "fill", variant)].values())
        o = list(by[(cell, "on-demand", variant)].values())
        wall = [int(r["wall_ns"]) / 1e9 for r in f]
        good = [fill_bytes * 8 / 1e6 / w for w in wall]
        sent = sum(int(r["sent"]) for r in f if r["sent"] != "NA")
        lost = sum(int(r["lost"]) for r in f if r["lost"] != "NA")
        events = [int(r["loss_events"]) for r in f if r["loss_events"] != "NA"]
        srtt = [int(r["srtt_us"]) / 1e3 for r in f if r["srtt_us"] != "NA"]
        cpu = [int(r["server_cpu_ns"]) / 1e6 for r in f]
        p50 = [int(r["p50_ns"]) / 1e6 for r in o]
        p90 = [int(r["p90_ns"]) / 1e6 for r in o]
        vs_f = "—" if variant == "default" else better(cell, "fill", variant, "wall_ns")
        vs_o = "—" if variant == "default" else better(cell, "on-demand", variant, "p50_ns")
        loss = f"{100 * lost / sent:.2f}" if sent else "NA"
        print(f"   {variant:8} {med(wall):>22} {med(good):>20} {vs_f:>6} {loss:>6}"
              f" {statistics.median(events) if events else 'NA':>6} {statistics.median(srtt) if srtt else 0:>7.1f}"
              f" {statistics.median(cpu):>6.0f} | {med(p50):>22} {vs_o:>6} {med(p90):>22}")
    if "prev" not in rows[0]:
        continue
    for mode, key in (("fill", "wall_ns"), ("on-demand", "p50_ns")):
        split = [{"round": int(r["round"]), "unit": r["variant"], "prev": None if r["prev"] == "first" else r["prev"],
                  "v": int(r[key]) / 1e6} for r in rows if r["cell"] == cell and r["mode"] == mode]
        print(f"   {mode} ms, each lead by the predecessor it ran after, rounds in brackets")
        for line in leads_by_predecessor(split, variants, [(a, "default") for a in variants if a != "default"], 1):
            print(f"   {line}")
