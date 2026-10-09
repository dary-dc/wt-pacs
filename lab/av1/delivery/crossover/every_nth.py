#!/usr/bin/env python3
"""Every Nth frame of a fetched set as a set of its own, hard-linked and renumbered; the range stays the whole
set's, so ingest represents each frame as it would in the whole. lab/av1/delivery/crossover/README.md §Measured

usage: every_nth.py SETDIR OUTDIR N
"""
import json
import os
import sys
from pathlib import Path

src, dst, n = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3])
meta = json.loads((src / "metadata.json").read_text())
picked = range(0, meta["frameCount"], n)
dst.mkdir(parents=True)
for j, i in enumerate(picked):
    for ext in ("raw", "sha256"):
        os.link(src / f"{i:03d}.{ext}", dst / f"{j:03d}.{ext}")
meta["frameCount"] = len(picked)
(dst / "metadata.json").write_text(json.dumps(meta, indent=1))
print(f"{dst.name}: frames {list(picked)} of {src.name}")
