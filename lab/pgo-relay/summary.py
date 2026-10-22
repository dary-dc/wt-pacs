#!/usr/bin/env python3
"""Per cell: median CPU per MB and delivered Mbit/s per arm, server cores busy, and aa_rule.py's verdict.

    lab/pgo-relay/summary.py rows/103000.tsv rows/18000.tsv
"""
import json
import os
import statistics
import subprocess
import sys
import tempfile

MB_PER_FRAME = 0.25
ARMS = ("plain", "plain2", "pgo")
RULE = os.path.join(os.path.dirname(__file__), "..", "scripts", "aa_rule.py")

for path in sys.argv[1:]:
    rows = [l.rstrip("\n").split("\t") for l in open(path) if l.strip() and not l.startswith("label")]
    by = {a: {r[0]: r for r in rows if r[1] == a and r[0] != "r0"} for a in ARMS}
    rounds = sorted(set.intersection(*(set(v) for v in by.values())), key=lambda l: int(l[1:]))
    ms_per_mb = {a: [int(by[a][l][11]) / MB_PER_FRAME / 1e6 for l in rounds] for a in ARMS}
    mbit = {a: [80 * MB_PER_FRAME * 8e9 / int(by[a][l][9]) for l in rounds] for a in ARMS}
    cores = {a: [int(by[a][l][11]) * 80 / int(by[a][l][9]) for l in rounds] for a in ARMS}
    busy = [list(map(float, l.split())) for l in open(path.replace(".tsv", ".cores")) if l.strip()]
    p90 = [statistics.quantiles([b[c] for b in busy], n=10)[-1] for c in range(4)]
    print(f"{path}: n = {len(rounds)}; cores 0-3 busy at p90 " + " ".join(f"{v:.2f}" for v in p90))
    for a in ARMS:
        print(f"  {a:7} {statistics.median(ms_per_mb[a]):7.3f} ms CPU/MB  {statistics.median(mbit[a]):6.1f} Mbit/s"
              f"  {statistics.median(cores[a]):.3f} cores busy")
    half = len(rounds) // 2
    files = []
    for part in (slice(0, half), slice(half, None)):
        f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump({"cpu_per_mb": {"ref": ms_per_mb["plain"][part], "aa": ms_per_mb["plain2"][part],
                                  "arm": ms_per_mb["pgo"][part]}}, f)
        f.close()
        files.append(f.name)
    print("  " + subprocess.run([sys.executable, RULE, files[0], "--confirm", files[1]],
                                capture_output=True, text=True, check=True).stdout.strip())
    full = files[0] + ".full"
    json.dump({"cpu_per_mb": {"ref": ms_per_mb["plain"], "aa": ms_per_mb["plain2"], "arm": ms_per_mb["pgo"]}},
              open(full, "w"))
    print("  all rounds " + subprocess.run([sys.executable, RULE, full], capture_output=True, text=True,
                                           check=True).stdout.strip())
