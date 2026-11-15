#!/usr/bin/env python3
"""Stage 3's entries for the quality shapes, from stage1.py's work: today's codestream twice (A, A′), and each named
shape layer-major — entry i frame i's layer-1 prefix (its first tile-part), entry F + i its rest (the second tile-part
and EOC), decoded by decoder.js. stage0.mjs must have passed every frame. layers/README.md, §Quality layers, measured

usage: make_frames.py WORK OUT SET:SHAPE[,SHAPE] ...
"""
import json
import os
import sys
from pathlib import Path


def main():
    work, out = Path(sys.argv[1]), Path(sys.argv[2])
    for spec in sys.argv[3:]:
        name, shapes = spec.split(":")
        src, dst = (work / name).resolve(), out / name
        dst.mkdir(parents=True, exist_ok=True)
        items = json.loads((src / "items.json").read_text())
        checks = [json.loads(x) for x in (src / "stage0.jsonl").read_text().splitlines()]
        if len(checks) != len(items) or not all(c["whole"] and c["layer1"] and c["smallest"] == c["layerEnd"] for c in checks):
            sys.exit(f"{name}: stage0.mjs did not pass every coding; nothing written")
        ids = sorted({it["file"].split("/")[0] for it in items})
        n = len(ids)
        if [int(i) for i in ids] != list(range(n)):
            sys.exit(f"{name}: not every frame was coded")
        by = {(it["file"].split("/")[0], it["shape"]): it for it in items}
        truth = [by[i, "oneset"]["source"] for i in ids]
        delivered = {"codec": "htj2k", "openjph": "delivered"}
        entry = dict(name=name, frames=n, truth=truth,
                     variants={"htj2k": dict(delivered), "htj2k-aa": dict(delivered, ext="htj2k")}, bytes={})
        entry["bytes"]["htj2k"] = sum((src / i / "today.j2c").stat().st_size for i in ids)
        for k, i in enumerate(ids):
            link = dst / f"{k:03d}.htj2k"
            if not link.exists():
                os.symlink(src / i / "today.j2c", link)
        for shape in shapes.split(","):
            for k, i in enumerate(ids):
                it = by[i, shape]
                cs = (src / it["file"]).read_bytes()
                cut = it["header"] + it["layer1"]
                (dst / f"{k:03d}.{shape}").write_bytes(cs[:cut])
                (dst / f"{n + k:03d}.{shape}").write_bytes(cs[cut:])
            entry["variants"][shape] = dict(codec="htj2k", openjph="layered", layers=2, worker="/lab/htj2k-progressive/layers/delivery/decoder.js",
                                            previewTruth=[by[i, shape]["want1"] for i in ids])
            entry["bytes"][shape] = sum((src / by[i, shape]["file"]).stat().st_size for i in ids)
            entry["bytes"][f"{shape}-layer1"] = sum(by[i, shape]["header"] + by[i, shape]["layer1"] for i in ids)
        (dst / "variants.json").write_text(json.dumps(entry, indent=1))
        print(name, ", ".join(f"{k} {v} B" for k, v in entry["bytes"].items()), flush=True)


if __name__ == "__main__":
    main()
