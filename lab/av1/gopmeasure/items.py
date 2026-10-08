#!/usr/bin/env python3
"""The decode timing's frames: each kept run as product items at every kept G — the top stream from the group
coding, the low stream from the intra one, as the client decodes a group — and as HTJ2K, with manifest.json.

usage: items.py BUILD WORK OUT SET_DIR ... [--groups 1,4,8,16] [--cell aom-good6.optimized]   — README.md here
"""
import argparse
import json
import struct
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "item"))
import ingest  # noqa: E402
import size  # noqa: E402
from gop import run_of  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("work", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", nargs="+", type=Path)
    ap.add_argument("--groups", default="1,4,8,16")
    ap.add_argument("--cell", default="aom-good6.optimized")
    ap.add_argument("--frames", type=int, default=16)
    a = ap.parse_args()
    groups = [int(g) for g in a.groups.split(",")]
    manifest = []
    for path in a.sets:
        s = size.Set(path)
        a0, a1 = run_of(s, a.frames)
        header, _ = ingest.plan(s, "optimized")
        header["offset"] = s.offset
        dst = a.out / s.name
        dst.mkdir(parents=True, exist_ok=True)

        def streams(g):
            cell = a.work / "ivf" / f"{s.name}.{a.cell}.g{g}"
            return [size.ivf_units(cell / f"{j}.ivf") for j in range(2 if header["split"] else 1)]
        low = streams(1)[1] if header["split"] else None
        for g in groups:
            top = streams(g)[0]
            for k, unit in enumerate(top):
                frame = struct.pack("<I", len(unit)) + unit + low[k] if low else unit
                (dst / f"{k:03d}.g{g}").write_bytes(ingest.item(header, [frame]))
        with tempfile.TemporaryDirectory() as tmp:
            for i, data in ingest.htj2k(a.build.resolve(), s, Path(tmp), a0, a1):
                (dst / f"{i - a0:03d}.htj2k").write_bytes(data)
        manifest.append(dict(name=s.name, first=a0, groups=groups, frames=[dict(truth=s.truth[i]) for i in range(a0, a1)]))
    (a.out / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")


if __name__ == "__main__":
    main()
