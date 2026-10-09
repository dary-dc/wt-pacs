#!/usr/bin/env python3
"""Bytes of each variant over HTJ2K's, every frame of each series: the reference split(s), and each map that
fits 12 bits coded at k = 0 and k = 2 and as HTJ2K, the map's own bytes included. ingest.py writes nothing that does
not decode back to its input, and remap.py nothing that does not come back to the source.

usage: bytes.py BUILD WORK SET_DIR... [--out bytes.json] [--frames N] [--preset P]   — README.md here
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
INGEST = HERE.parents[3] / "ingest/coded-frames/ingest.py"
# The split-rule sweep's shipped preset for k = 2 (k = 6 on the 16-bit mammogram): every AV1 variant of a series at it.
PRESETS = {"dbtproj": "allintra:7", "ct": "good:6", "xa": "good:6", "mg16": "allintra:6"}
# k = 2, and w10 (every stream ≤ 10 bits, WebCodecs) where it differs: the split-rule sweep's variants.
REFERENCE = {13: [2, 3], 14: [2, 4], 16: [4, 6]}


def ingest(build, src, out, *args):
    if (out / "metadata.json").exists():
        return coded(out)
    r = subprocess.run([sys.executable, INGEST, build, src, out, *args], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"{src}: {r.stderr.strip() or r.stdout.strip()}")
    return coded(out)


def coded(out):
    return sum(p.stat().st_size for p in out.glob("[0-9][0-9][0-9].*") if p.suffix in (".av1", ".htj2k"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build")
    ap.add_argument("work", type=Path)
    ap.add_argument("sets", type=Path, nargs="+")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--frames", type=int)
    ap.add_argument("--preset")
    a = ap.parse_args()
    frames = ["--frames", str(a.frames)] if a.frames else []
    rows = []
    for src in a.sets:
        name = src.name
        preset = a.preset or next(p for k, p in PRESETS.items() if name.startswith(k))
        w = a.work / name
        bits = json.loads((src / "metadata.json").read_text())
        bits = (bits["max"] - min(bits["min"], 0)).bit_length()
        row = dict(set=name, bits=bits, preset=preset, htj2k=ingest(a.build, src, w / "htj2k", "--codec", "htj2k", *frames))
        for k in REFERENCE.get(bits, [2]):
            row[f"k{k}"] = ingest(a.build, src, w / f"k{k}", "--split", str(k), "--preset", preset, *frames)
        for mode in ("map", "palette"):
            remapped = a.work / f"{name}.{mode}"
            if not (remapped / "remap.json").exists():
                continue
            side = json.loads((remapped / "remap.json").read_text())
            if mode == "map" and side["side_bytes"] > row["htj2k"] // 100:
                continue
            n = a.frames or len(list(remapped.glob("*.raw")))
            side_bytes = side["side_bytes"] if mode == "palette" else \
                sum((remapped / f"{i:03d}.map").stat().st_size for i in range(n))
            for k in (0, 2):
                row[f"{mode}k{k}"] = side_bytes + ingest(a.build, remapped, w / f"{mode}k{k}", "--split", str(k),
                                                         "--preset", preset, *frames)
            row[f"{mode}_htj2k"] = side_bytes + ingest(a.build, remapped, w / f"{mode}_htj2k", "--codec", "htj2k", *frames)
            row[f"{mode}_side"] = side_bytes
        print(json.dumps(row), flush=True)
        rows.append(row)
    if a.out:
        a.out.write_text(json.dumps(rows, indent=1) + "\n")


if __name__ == "__main__":
    main()
