#!/usr/bin/env python3
"""What `--integrity` adds to an ingest, timed alone: the reconstruction digest and the coding error of every frame,
on one core. A derived stand-in for I2's cost cell, which needs whole `demo-series.sh` runs with and without.

usage: i2_cost.py DATA OUT.jsonl SET ... [--rounds N]
"""
import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ingest/coded-frames"))
sys.path.insert(0, str(ROOT / "lab/av1"))
import coding_error  # noqa: E402
import ingest  # noqa: E402
import size  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", nargs="+")
    ap.add_argument("--rounds", type=int, default=3)
    a = ap.parse_args()
    for r in range(a.rounds):
        for name in a.sets:
            s = size.Set(a.data / name)
            wide = ingest.wide(s.stored, s.signed, s.offset)
            t = time.process_time()
            for i in range(s.n):
                src = s.frame(i)[..., 0]
                ingest.frame_digest(src.astype(s.dtype), wide)
                coding_error.coding_error(src, src + 1)
            cpu = time.process_time() - t
            row = dict(set=name, round=r, frames=s.n, cpu_s=round(cpu, 2), mpx=round(s.n * s.h * s.w / 1e6, 2))
            with a.out.open("a") as f:
                f.write(json.dumps(row) + "\n")
            print(row)


if __name__ == "__main__":
    main()
