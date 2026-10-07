#!/usr/bin/env python3
"""HTJ2KENC's bytes table: each setting's bytes over the served profile's, per series.

usage: report.py OUT/manifest.json   — lab/av1/htj2kenc/README.md
"""
import json
import sys

SERVED = "b64x64-d5-RPCL"
ROWS = ["b32x32", "b64x64", "b32x128", "b128x32"]


def main():
    sets = json.load(open(sys.argv[1]))
    names = [k for k in sets[0]["bytes"] if not k.endswith("-LRCP")]
    print("| setting | " + " | ".join(f"`{s['name']}`" for s in sets) + " |")
    print("| --- |" + " --- |" * len(sets))
    print("| served, bytes | " + " | ".join(f"{s['bytes'][SERVED] / 1e6:.2f} MB" for s in sets) + " |")
    for k in names:
        cells = []
        for s in sets:
            b = s["bytes"]
            r = b[k] / b[SERVED]
            cells.append(f"**{r:.4f}**" if b[k] == min(b.values()) else f"{r:.4f}")
        print(f"| `{k}` | " + " | ".join(cells) + " |")
    lrcp = all(s["bytes"][k] == s["bytes"][k.replace("-LRCP", "-RPCL")] for s in sets for k in s["bytes"] if k.endswith("-LRCP"))
    print(f"\nLRCP bytes equal RPCL's on every setting and series: {lrcp}")


if __name__ == "__main__":
    main()
