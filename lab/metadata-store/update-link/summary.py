#!/usr/bin/env python3
"""The README's tables from packages.jsonl and link.jsonl: medians per cell, measured beside estimated.

usage: summary.py packages.jsonl link.jsonl
"""
import json
import os
import statistics
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import wire  # noqa: E402

CLASSES = ("fiber", "4g5g", "geo", "adsl")


def main() -> None:
    sizes = {(r["series"], r["kind"]): r["bytes"] for r in map(json.loads, open(sys.argv[1]))}
    ms = defaultdict(list)
    for r in map(json.loads, open(sys.argv[2])):
        if r["status"] != "201":
            sys.exit(f"a transfer failed: {r}")
        ms[r["class"], r["series"], r["kind"], r["variant"], r["protocol"]].append(r["ms"])
    floor = [statistics.median(v) for k, v in ms.items() if k[0] == "floor"]
    print(f"floor: medians {min(floor):.1f}-{max(floor):.1f} ms over {len(floor)} cells")
    print("| class | package | protocol | raw → zstd-1 bytes | measured raw → zstd-1 ms (saved, in RTT) | "
          "estimated ms | tie band ms |")
    print("| --- | --- | --- | --- | --- | --- | --- |")
    for cls in CLASSES:
        rtt = wire.CLASSES[cls]["rtt"] * 1000
        for (c, series, kind, variant, protocol), raw in sorted(ms.items()):
            if c != cls or variant != "raw":
                continue
            z = ms[cls, series, kind, "zstd_1", protocol]
            mr, mz = statistics.median(raw), statistics.median(z)
            size = sizes[series, kind]
            est = [wire.transfer(size[v], protocol, wire.CLASSES[cls])["seconds"] * 1000 for v in ("raw", "zstd_1")]
            band = max(0.03 * mr, 2.0)
            print(f"| {cls} | {series} {kind} | {protocol} | {size['raw']:,} → {size['zstd_1']:,} | "
                  f"{mr:.0f} → {mz:.0f} ({mr - mz:+.0f}, {(mr - mz) / rtt:+.2f}) | {est[0]:.0f} → {est[1]:.0f} | "
                  f"{band:.0f} |")


if __name__ == "__main__":
    main()
