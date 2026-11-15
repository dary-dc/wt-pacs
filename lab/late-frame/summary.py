#!/usr/bin/env python3
"""The README's tables from WORK/rows.jsonl, costs.jsonl and host.jsonl: medians, with the range.

usage: summary.py WORK
"""
import json
import statistics
import sys
from pathlib import Path


def load(path):
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def ms(values):
    values = sorted(v / 1e6 for v in values)
    return f"{statistics.median(values):.1f} ({values[0]:.1f}–{values[-1]:.1f})"


def main():
    work = Path(sys.argv[1])
    rows = load(work / "rows.jsonl")
    cells = {}
    for r in rows:
        cells.setdefault((r["container"], r["n"], r["k"], r["where"]), {}).setdefault(r["fsync"], []).append(r)
    print("| container | N | k | where | read | written | dead | warm ms | fsync'd ms | runs |")
    print("| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |")
    for (c, n, k, where), arms in cells.items():
        first = arms[False][0]
        print(f"| {c} | {n} | {k} | {where} | {first['read']:,} | {first['written']:,} | {first.get('dead', 0):,} | "
              f"{ms(r['wall_ns'] for r in arms[False])} | {ms(r['wall_ns'] for r in arms[True])} | "
              f"{len(arms[False])}+{len(arms[True])} |")
    costs = load(work / "costs.jsonl")
    print("\n| encode | N | k | phase | frames | CPU s | CPU s a frame | wall s | runs |")
    print("| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |")
    groups = {}
    for c in costs:
        groups.setdefault((c["kind"], c["n"], c["k"]), []).append(c)
    for (kind, n, k), runs in sorted(groups.items()):
        for phase in ("decode", "encode"):
            if phase not in runs[0]:
                continue
            count = runs[0].get(f"frames_{phase}d", k)
            cpu = statistics.median(r[phase]["cpu_s"] for r in runs)
            wall = statistics.median(r[phase]["wall_s"] for r in runs)
            print(f"| {kind} | {n or '—'} | {k} | {phase} | {count} | {cpu:.2f} | {cpu / count:.3f} | {wall:.2f} | {len(runs)} |")
    host = load(work / "host.jsonl")
    if host:
        gib = host[0]["bytes"] / 1e9
        for key in ("write_cached_s", "write_fsync_s", "copy_warm_s"):
            rates = sorted(gib / h[key] for h in host)
            print(f"\n{key}: {statistics.median(rates):.2f} GB/s ({rates[0]:.2f}–{rates[-1]:.2f}), {len(rates)} runs", end="")
        print()


if __name__ == "__main__":
    main()
