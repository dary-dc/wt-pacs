#!/usr/bin/env python3
"""The decode harness's frames from bytes.py's work: per series NNN.htj2k, NNN.ARM.av1 and each frame's map,
and manifest.json with every frame's source checksum — the truth for every arm, remapped or not.

usage: make_frames.py WORK OUT SET_DIR... [--frames N]   — lab/av1/remap/README.md
"""
import argparse
import json
import shutil
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("work", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", type=Path, nargs="+")
    ap.add_argument("--frames", type=int)
    a = ap.parse_args()
    manifest = []
    for src in a.sets:
        meta = json.loads((src / "metadata.json").read_text())
        n = min(a.frames or meta["frameCount"], meta["frameCount"])
        w, dst = a.work / src.name, a.out / src.name
        dst.mkdir(parents=True, exist_ok=True)
        arms = {"htj2k": {}}
        for i in range(n):
            shutil.copyfile(w / f"htj2k/{i:03d}.htj2k", dst / f"{i:03d}.htj2k")
        for arm in sorted(p.name for p in w.iterdir() if p.name != "htj2k"):
            mode = next((m for m in ("map", "palette") if arm.startswith(m)), None)
            arms[arm] = dict(ext=f"{arm}.av1")
            if mode:
                arms[arm]["side"] = json.loads((a.work / f"{src.name}.{mode}/remap.json").read_text())
            for i in range(n):
                shutil.copyfile(w / f"{arm}/{i:03d}.av1", dst / f"{i:03d}.{arm}.av1")
                if mode == "map":
                    shutil.copyfile(a.work / f"{src.name}.map/{i:03d}.map", dst / f"{i:03d}.map")
        truth = [(src / f"{i:03d}.sha256").read_text().strip() for i in range(n)]
        manifest.append(dict(name=src.name, signed=meta["signed"], arms=arms, frames=[dict(truth=t) for t in truth]))
        print(f"{src.name}: {n} frames, arms {', '.join(arms)}")
    (a.out / "manifest.json").write_text(json.dumps(manifest))


if __name__ == "__main__":
    main()
