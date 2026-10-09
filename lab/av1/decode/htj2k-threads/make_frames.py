#!/usr/bin/env python3
"""Whole series as the served HTJ2K, for lab/av1/delivery/total-time/run.mjs: one arm per OpenJPH build.

usage: make_frames.py OUT SETDIR ...   — lab/av1/decode/htj2k-threads/README.md
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parent / "per-frame"))
from make_frames import htj2k  # noqa: E402
from size import Set  # noqa: E402

# The package as `htj2k`; the others are lab/decode-bench/wasm/build.sh's arms by name.
ARMS = {"htj2k": {}, **{b: dict(ext="htj2k", codec="htj2k", openjph=b) for b in ("web", "cb2", "cb4")}}


def main():
    out = Path(sys.argv[1]).resolve()
    for d in sys.argv[2:]:
        s = Set(Path(d))
        dst, work = out / s.name, out / f".{s.name}-work"
        dst.mkdir(parents=True, exist_ok=True)
        work.mkdir(exist_ok=True)
        for i in range(s.n):
            htj2k(s, i, work, dst / f"{i:03d}.htj2k")
        size = sum((dst / f"{i:03d}.htj2k").stat().st_size for i in range(s.n))
        entry = dict(name=s.name, frames=s.n, bits=s.stored, truth=s.truth, arms=ARMS, bytes=dict(htj2k=size))
        (dst / "arms.json").write_text(json.dumps(entry, indent=1))
        print(s.name, s.n, "frames,", size, "B", flush=True)


if __name__ == "__main__":
    main()
