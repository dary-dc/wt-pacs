#!/usr/bin/env python3
"""The receiver updating one study while each arm reads it; then torn reads, never-committed pairs and staleness.

usage: consistency.py run ROOT OUT [--seconds N] [--gap-ms G]   OUT.receive and OUT.read, one JSON line each
       consistency.py summary OUT [OUT ...]                     one JSON line per arm and run
"""
import argparse
import bisect
import json
import os
import statistics
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.join(HERE, "target", "release", "metadata-delivery")


def seen(study_rev, paint_rev):
    """The revision a read reflects (-1 before any update), or None if its two parts were never committed together.

    `metadata-delivery receive` stamps even revisions on the study fields and odd ones on the windows, from 0.
    """
    if paint_rev is None:
        return {None: -1, 0: 0}.get(study_rev)
    if study_rev is None:
        return None
    return max(study_rev, paint_rev) if abs(study_rev - paint_rev) == 1 else None


def staleness_ms(start: int, revision, commits: list) -> float:
    """How long before the read began the first revision newer than the one it saw had committed; 0 if none had."""
    nxt = revision + 1
    if nxt >= len(commits) or commits[nxt] >= start:
        return 0.0
    return (start - commits[nxt]) / 1e6


def pct(values: list, p: float) -> float:
    s = sorted(values)
    return s[round((len(s) - 1) * p)] if s else float("nan")


def summarize(out: str) -> list:
    receive = [json.loads(line) for line in open(out + ".receive")]
    commits = [r["commit"] for r in receive]
    lag = [(r["derived"] - r["commit"]) / 1e6 for r in receive]
    rows = []
    reads = [json.loads(line) for line in open(out + ".read")]
    for arm in sorted({r["arm"] for r in reads}):
        mine = [r for r in reads if r["arm"] == arm]
        ok = [r for r in mine if "error" not in r]
        never = [r for r in ok if seen(r["study_rev"], r["paint_rev"]) is None]
        stale = [staleness_ms(r["start"], seen(r["study_rev"], r["paint_rev"]), commits) for r in ok if r not in never]
        took = [(r["end"] - r["start"]) / 1e6 for r in ok]
        rows.append({"run": os.path.basename(out), "arm": arm, "reads": len(mine), "errors": len(mine) - len(ok),
                     "torn": sum(r["torn"] for r in ok), "never_committed": len(never),
                     "stale_reads": sum(s > 0 for s in stale), "stale_ms_p50": pct(stale, 0.5),
                     "stale_ms_p99": pct(stale, 0.99), "stale_ms_max": max(stale, default=0.0),
                     "read_ms_p50": pct(took, 0.5), "read_ms_p99": pct(took, 0.99), "read_ms_max": max(took, default=0.0),
                     "revisions": len(receive), "derive_ms_p50": statistics.median(lag), "derive_ms_p99": pct(lag, 0.99)})
    return rows


def run(args) -> None:
    with open(args.out + ".receive", "w") as rec, open(args.out + ".read", "w") as red:
        writer = subprocess.Popen([BIN, "receive", args.root, "--seconds", str(args.seconds), "--gap-ms",
                                   str(args.gap_ms)], stdout=rec)
        subprocess.run([BIN, "read", args.root, "--seconds", str(args.seconds)], stdout=red, check=True)
        writer.wait()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=("run", "summary"))
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--seconds", type=int, default=20)
    ap.add_argument("--gap-ms", type=int, default=5)
    args = ap.parse_args()
    if args.mode == "run":
        args.root, args.out = args.paths
        run(args)
    else:
        for out in args.paths:
            for row in summarize(out):
                print(json.dumps(row))


if __name__ == "__main__":
    main()
