#!/usr/bin/env python3
"""Append one measurement row to a campaign TSV. Shared by the shaped rig."""
import json
import sys

arm, fx, sm, rate, d, run, c0, c1, rss, out, jf = sys.argv[1:12]
m = json.load(open(jf))
cpu = float(c1) - float(c0)
gb = m["bytes_on_wire"] / 1e9
row = "\t".join(
    [
        arm, fx, sm, rate, d, run,
        "%.2f" % m["fill_rate"],
        str(m["fill_frames"]),
        str(m["fill_bytes"]),
        "%.3f" % cpu,
        rss,
        "%.3f" % (cpu / gb if gb else 0.0),
    ]
)
print(row)
with open(out, "a") as f:
    f.write(row + "\n")
