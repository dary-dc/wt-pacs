#!/usr/bin/env python3
"""Time to a playable base, arithmetic over measured bytes and decode times: every base of the series
sent first back to back at the link's rate (row SVCORDER's bases-first, proposed, not built), each
frame's share of the bytes equal, one decoder in order (the base is inter-coded); playable when the
last base is decoded. The exact series: every byte of the payload, then its last frame decoded.

usage: playable.py SWEEP.tsv TIMES.json
"""
import csv
import json
import statistics
import sys

RATES = (5, 20, 50)  # Mbit/s
SHAPES = ("half", "quarter", "quality", "three", "L1T3")


def finish(n, payload, rate, ms):
    """Seconds until the last of n frames is decoded, frame i's bytes arriving at (i + 1)/n of payload."""
    done = 0.0
    for i in range(n):
        done = max(done, (i + 1) * payload * 8 / n / (rate * 1e6)) + ms / 1000
    return done


def main():
    sweep = {(r["set"], r["shape"]): r for r in csv.DictReader(open(sys.argv[1]), delimiter="\t")}
    times = {}
    for row in json.load(open(sys.argv[2])):
        times.setdefault((row["set"], row["variant"], row["throttle"]), []).append(row["ms"])
    ms = {k: statistics.median(v) for k, v in times.items()}
    print("set\tshape\tthrottle\t" + "\t".join(f"base {r}M s" for r in RATES) + "\t" +
          "\t".join(f"exact {r}M s" for r in RATES))
    for s in dict.fromkeys(k[0] for k in sweep):
        for throttle in sorted({k[2] for k in ms}):
            low = ms.get((s, "low", throttle), 0)
            for shape in ("single", *SHAPES):
                row = sweep[(s, shape if shape in ("single", "L1T3") else f"{shape}-q40")]
                n = int(row["frames"])
                full = ms[(s, "single" if shape == "single" else f"{shape}-all", throttle)] + low
                exact = [finish(n, int(row["total_bytes"]), r, full) for r in RATES]
                base = ["-"] * len(RATES)
                if shape != "single":
                    bn = int(row["base_frames"])
                    base = [round(finish(bn, int(row["base_bytes"]), r, ms[(s, f"{shape}-base", throttle)]), 2) for r in RATES]
                print(f"{s}\t{shape}\t{throttle}\t" + "\t".join(map(str, base)) + "\t" +
                      "\t".join(f"{t:.2f}" for t in exact))


if __name__ == "__main__":
    main()
