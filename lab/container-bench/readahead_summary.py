#!/usr/bin/env python3
"""Row 197's tables and its decision rule's inputs from WORK/readahead.jsonl (readahead.py time).

    readahead_summary.py WORK

Per filesystem, set and fill count: each arm's median, its median ratio to W0 paired by round, the share of rounds
agreeing in sign, and the resolution (the p90 over rounds of |W0aa/W0 − 1|); misses are compared as differences.
"""
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

METRICS = [  # (key, higher is better)
    ("cold_fill_fps", True), ("cold_fill_misses", False), ("cold_fill_cpu_ns_per_gb", False),
    ("cold_fill_first_ns", False), ("hit_p50_ns", False), ("hit_p99_ns", False), ("fill_hit_fps", True),
    ("fill_hit_cpu_ns_per_gb", False), ("forced_miss_p50_ns", False), ("folios_per_frame", False),
]
COUNTS = {"cold_fill_misses"}


def p90(xs):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(0.9 * len(xs)))]


def compare(rows, arm, key):
    """(median, paired change against W0, share of rounds agreeing with its sign, resolution, beyond, better)."""
    by = {(r["round"], r["arm"]): r[key] for r in rows}
    rounds = sorted({r["round"] for r in rows if (r["round"], "W0") in by and (r["round"], arm) in by})
    if not rounds:
        return None
    a = [by[(k, arm)] for k in rounds]
    w0 = [by[(k, "W0")] for k in rounds]
    aa = [by[(k, "W0aa")] for k in rounds if (k, "W0aa") in by]
    w0_aa = [by[(k, "W0")] for k in rounds if (k, "W0aa") in by]
    if key in COUNTS:
        d = [x - y for x, y in zip(a, w0)]
        res = p90([abs(x - y) for x, y in zip(aa, w0_aa)]) if aa else 0
    else:
        d = [x / y - 1 for x, y in zip(a, w0) if y]
        res = p90([abs(x / y - 1) for x, y in zip(aa, w0_aa) if y]) if aa else 0
    change = statistics.median(d)
    agree = sum(1 for x in d if (x > 0) == (change > 0) and x != 0) / len(d)
    beyond = abs(change) > res and agree >= 0.8
    return statistics.median(a), change, agree, res, beyond


def main():
    work = Path(sys.argv[1])
    rows = [json.loads(line) for line in (work / "readahead.jsonl").read_text().splitlines()]
    cells = defaultdict(list)
    for r in rows:
        cells[(r["fs"], r["set"], r["fills"])].append(r)
    bad = sum(r["inexact"] for r in rows)
    print(f"{len(rows)} rows, {sum(r['checked'] for r in rows)} frames checked, {bad} inexact; "
          f"refused madvise {sum(r['refused'] for r in rows)}; cached after the O_DIRECT copy "
          f"{sum(r['cached_after_copy'] for r in rows)} pages\n")
    for (fs, name, fills), cr in sorted(cells.items()):
        arms = sorted({r["arm"] for r in cr})
        n = len({r["round"] for r in cr})
        print(f"### {fs} · {name} · {fills} fill{'s' if fills > 1 else ''} · {n} rounds · "
              f"{cr[0]['frame_bytes_mean'] / 1e3:.0f} kB a frame\n")
        print("| metric | " + " | ".join(arms) + " |")
        print("| --- |" + " --: |" * len(arms))
        for key, up in METRICS:
            cells_out = []
            for arm in arms:
                c = compare(cr, arm, key)
                if c is None:
                    cells_out.append("—")
                    continue
                med, change, agree, res, beyond = c
                if arm == "W0":
                    cells_out.append(f"{med:,.3g}")
                    continue
                better = beyond and ((change > 0) == up)
                worse = beyond and not better
                tag = " **better**" if better else " **worse**" if worse else ""
                fmt = f"{change:+.0f}" if key in COUNTS else f"×{1 + change:.3f}"
                res_s = f"±{res:.0f}" if key in COUNTS else f"±{res:.3f}"
                cells_out.append(f"{med:,.3g} ({fmt}, {agree:.0%}, {res_s}){tag}")
            print(f"| {key} | " + " | ".join(cells_out) + " |")
        w1 = [r for r in cr if r["arm"] == "W1" and r["w1_blocks"]]
        if w1:
            share = sum(r["w1_blocks_one_folio"] for r in w1) / sum(r["w1_blocks"] for r in w1)
            print(f"\nW1's blocks that are one 2 MiB folio: {share:.1%} of {sum(r['w1_blocks'] for r in w1)}")
        print(f"compact_stall a round: {statistics.median(r['compact_stall'] for r in cr)}, "
              f"pgmajfault: {statistics.median(r['pgmajfault'] for r in cr)}\n")


if __name__ == "__main__":
    main()
