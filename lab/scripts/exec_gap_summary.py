#!/usr/bin/env python3
"""Row 258's verdict from exec_gap.sh's TSV, by docs/adr/disk-access.md §9's rule for the readers' protocols.

    lab/scripts/exec_gap_summary.py exec_gap.tsv SERVER_CORES

Per cell and metric the resolution is the p90 over rounds of |G0p/G0 − 1|; an arm differs when its median
arm/G0 − 1 is past it with ≥ 80 % of rounds agreeing in sign. Lower is better for every metric.
"""
import collections
import csv
import math
import statistics
import sys

BAR = ("cot_p99_ns",)
GUARDS = ("wall_ns", "misses", "cpu_ns_per_ask")
METRICS = ("cot_p50_ns", "cot_p99_ns", "cot_max_ns") + GUARDS
SATURATED = 0.8


def p90(values):
    ordered = sorted(values)
    return ordered[max(0, math.ceil(0.9 * len(ordered)) - 1)]


def compare(by_round, arm, metric):
    """(resolution, median change, agreeing share, verdict) of `arm` against G0 over the rounds holding all three."""
    aa, d = [], []
    for row in by_round.values():
        if not all(a in row for a in ("G0", "G0p", arm)) or not float(row["G0"][metric]):
            continue
        ref = float(row["G0"][metric])
        aa.append(abs(float(row["G0p"][metric]) / ref - 1))
        d.append(float(row[arm][metric]) / ref - 1)
    if not d:
        return None
    res, med = p90(aa), statistics.median(d)
    agree = sum(1 for x in d if x * med > 0) / len(d)
    verdict = "tie" if abs(med) <= res or agree < 0.8 else "better" if med < 0 else "worse"
    return res, med, agree, verdict


def judge(path, cores):
    """Prints the table; returns each arm's verdict line."""
    cells = collections.defaultdict(lambda: collections.defaultdict(dict))
    with open(path, newline="") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            cells[r["cell"]][r["round"]][r["arm"]] = r
    print(f"{'cell':<4} {'busy':>5}  {'metric':<15} {'res':>6}  {'G1':>16}  {'G2':>16}")
    verdicts = {arm: {"bar": False, "worse": []} for arm in ("G1", "G2")}
    for cell, by_round in sorted(cells.items()):
        busy = statistics.median(
            float(r["cpu_ns_per_ask"]) * float(r["asks"]) / float(r["wall_ns"]) / cores
            for row in by_round.values() for r in row.values())
        for metric in METRICS:
            out = {arm: compare(by_round, arm, metric) for arm in verdicts}
            if not any(out.values()):
                continue
            res = next(o for o in out.values() if o)[0]
            shown = {a: f"{o[1]:+.1%} {o[2]:.0%} {o[3]}" if o else "-" for a, o in out.items()}
            print(f"{cell:<4} {busy:>5.0%}  {metric:<15} {res:>6.1%}  {shown['G1']:>16}  {shown['G2']:>16}")
            for arm, o in out.items():
                if o and metric in BAR and o[3] == "better" and busy < SATURATED:
                    verdicts[arm]["bar"] = True
                if o and metric in GUARDS and o[3] == "worse":
                    verdicts[arm]["worse"].append(f"{cell} {metric}")
    print(f"busy: server CPU over wall on {cores} cores; a cell at {SATURATED:.0%} or more counts for no arm")
    lines = {}
    for arm, v in verdicts.items():
        if v["worse"]:
            lines[arm] = f"{arm}: closed — worse beyond the resolution on {', '.join(v['worse'])}"
        elif v["bar"]:
            lines[arm] = f"{arm}: lands — the co-tenant's p99 beats G0 below saturation and no guard is worse"
        else:
            lines[arm] = f"{arm}: closed — costs the executor nothing measurable on this device"
    return lines


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    print(*judge(sys.argv[1], int(sys.argv[2])).values(), sep="\n")
