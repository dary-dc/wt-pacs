#!/usr/bin/env python3
"""The proof of concept's 10-bit gap: lossless AV1 over HTJ2K on real 10-bit DBT, paired frame for
frame, and how much each setting the brief names moves it — libaom's --threads, the background crop,
libaom 3.8.2 against 3.15.1 at cpu6, and an 8-bit copy (v >> 2) of the same frames.

Derived sets are written from the fetched, pinned frames (or, uncropped, from the pinned DICOM) with
their own checksums, so every coding is still checked against the encoder's input. llsize.py codes
and checks every cell.

usage: pocgap.py BUILD WORK OUT.tsv   [FRAMES=4 JOBS=4]  — README.md here
"""
import hashlib
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pydicom

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1] / "llsize"))
import llsize  # noqa: E402

DATA = HERE.parents[1] / "data"
FRAMES = int(os.environ.get("FRAMES", 4))
SETS = ("dbt10_ea1141", "dbt10_d")
llsize.AOM.update({"threads4": ["--threads=4"], "cpu6": ["--cpu-used=6"]})
llsize.frames = lambda s: min(FRAMES, s.n)


def write_set(dest, frames, like):
    """frames: (h, w) arrays of the stored samples; like: the source set's metadata.json."""
    dest.mkdir(parents=True, exist_ok=True)
    digests = []
    for i, f in enumerate(frames):
        raw = np.ascontiguousarray(f).tobytes()
        (dest / f"{i:03d}.raw").write_bytes(raw)
        digests.append(hashlib.sha256(raw).hexdigest())
        (dest / f"{i:03d}.sha256").write_text(digests[-1])
    meta = {**like, "frameCount": len(frames), "height": frames[0].shape[0], "width": frames[0].shape[1],
            "bitsStored": 8 if frames[0].dtype == np.uint8 else like["bitsStored"],
            "min": int(min(f.min() for f in frames)), "max": int(max(f.max() for f in frames)),
            "framesSha256": hashlib.sha256("".join(digests).encode()).hexdigest()}
    (dest / "metadata.json").write_text(json.dumps(meta, indent=1))


def uncropped(spec, s):
    """The pinned DICOM's first FRAMES frames whole, each checked to hold the set's pinned crop."""
    frames = pydicom.dcmread(DATA / "dicom" / spec["files"][0]["key"]).pixel_array[:FRAMES]
    y, x, h, w = spec["crop"]
    for i, f in enumerate(frames):
        crop = np.ascontiguousarray(f[y:y + h, x:x + w], "<u2").tobytes()
        if hashlib.sha256(crop).hexdigest() != s.truth[i]:
            sys.exit(f"{spec['name']}: frame {i} uncropped does not hold the pinned crop")
    return [f.astype("<u2") for f in frames]


def derive(work):
    """The uncropped and the 8-bit copies of each set's first FRAMES frames."""
    spec = {s["name"]: s for s in json.loads((HERE.parents[1] / "data.json").read_text())["sets"]}
    out = []
    for name in SETS:
        s = llsize.size.Set(DATA / name)
        meta = json.loads((DATA / name / "metadata.json").read_text())
        full = work / "sets" / f"{name}_full"
        if not full.exists():
            write_set(full, uncropped(spec[name], s), meta)
        u8 = work / "sets" / f"{name}_u8"
        if not u8.exists():
            write_set(u8, [(s.frame(i)[..., 0] >> 2).astype(np.uint8) for i in range(FRAMES)], meta)
        out += [DATA / name, full, u8]
    return out


def cells(path):
    """10-bit as cropped: every setting; uncropped and 8-bit: plain and optimized only."""
    yield "htj2k", "-", llsize.size.AOM
    yield "direct", "aom", "3.15.1"
    if path.parent == DATA:
        yield "direct", "threads4", "3.15.1"
        yield "direct", "cpu6", "3.15.1"
        yield "direct", "cpu6", "3.8.2"
    if not path.name.endswith("_u8"):
        yield "low2", "screen-sb64", "3.15.1"


def job(build, work, path, rep, variant, aom):
    llsize.size.AOM = aom
    row = llsize.job(build, work / aom, path, rep, variant)
    return {**row, "variant": f"{variant}@{aom}" if rep != "htj2k" else "-"}


def main():
    build, work, out = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    jobs = [(p, *c) for p in derive(work) for c in cells(p)]
    with open(out, "w") as fh, ProcessPoolExecutor(int(os.environ.get("JOBS", 4))) as pool:
        fh.write("\t".join(llsize.KEYS) + "\n")
        for f in [pool.submit(job, build, work, *j) for j in jobs]:
            line = "\t".join(str(f.result().get(k, "")) for k in llsize.KEYS)
            fh.write(line + "\n")
            fh.flush()
            print(line, flush=True)


if __name__ == "__main__":
    main()
