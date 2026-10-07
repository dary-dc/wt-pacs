#!/usr/bin/env python3
"""VERSIONS: libaom's development head against the pinned 3.15.1 — the optimized item's bytes per series and
preset, each written only if ingest.py decodes every frame back to its checksum.

usage: aom_bytes.py BUILD OUT SETDIR@PRESET[,PRESET] ... [--frames 4] [--jobs 4]   — lab/av1/versions/README.md
"""
import argparse
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from size import Set  # noqa: E402

VERSIONS = ("3.15.1", "head")


def item(build, src, out, version, preset, frames):
    s = Set(src)
    split = ["--split", str(max(0, s.stored - 12))] if s.stored > 12 else []
    dst = out / version / preset.replace(":", "") / src.name
    if not (dst / "metadata.json").exists():
        subprocess.run([sys.executable, HERE.parent / "item/ingest.py", build, src, dst, "--preset", preset,
                        "--frames", str(frames), "--jobs", "1", *split], check=True, capture_output=True,
                       env={**os.environ, "AOM_VERSION": version})
    n = json.loads((dst / "metadata.json").read_text())["frameCount"]
    return [(dst / f"{i:03d}.av1").read_bytes() for i in range(n)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", nargs="+")
    ap.add_argument("--frames", type=int, default=4)
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    cells = [(Path(src), preset, v) for spec in a.sets for src, _, ps in [spec.partition("@")]
             for preset in ps.split(",") for v in VERSIONS]
    with ThreadPoolExecutor(a.jobs) as pool:
        got = dict(zip(cells, pool.map(lambda c: item(a.build.resolve(), c[0], a.out.resolve(), c[2], c[1],
                                                      a.frames), cells)))
    rows = []
    print("set\tpreset\tframes\tB 3.15.1\tB head\thead/3.15.1\tidentical items")
    for (src, preset, v) in cells:
        if v != "head":
            continue
        old, new = got[(src, preset, "3.15.1")], got[(src, preset, "head")]
        same = sum(x == y for x, y in zip(old, new))
        b0, b1 = sum(map(len, old)), sum(map(len, new))
        rows.append(dict(set=src.name, preset=preset, frames=len(old), old=b0, new=b1, identical=same))
        print(f"{src.name}\t{preset}\t{len(old)}\t{b0}\t{b1}\t{b1 / b0:.4f}\t{same}/{len(old)}", flush=True)
    (a.out / "aom_bytes.json").write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
