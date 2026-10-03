#!/usr/bin/env python3
"""TOTAL's frames: each set's every frame as each arm serves it, one file per frame and arm.

htj2k (the served profile) and av1 (libaom lossless intra, cpu0) for every set; on a 12-bit grey set
the two splits as the client takes them (`[u32le len(top)][top unit][low unit]`): t11 (v >> 2 at 12
bits + v & 3, dav1d-WASM) and t10 (v >> 3 at 10 bits + v & 7, WebCodecs); on a set where a group
beat intra, gop (the whole series one group, no alt-ref); on the fluoroscopy, pre — row PREVIEW's
lossy preview, 10-bit 4:0:0, G = 8, CRF 20, cpu6. Every exact arm is decoded natively and matched
with the series' checksum; a preview's truth is its native decode's hash.

usage: make_frames.py BUILD OUT SETDIR ...  (OUT/SET/arms.json says what was made) — lab/av1/total/README.md
"""
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "speed"))
sys.path.insert(0, str(HERE.parent / "preview"))
import depth  # noqa: E402
import encode as preview  # noqa: E402
from make_frames import htj2k  # noqa: E402
from size import AOM, Set, av1_cell, decode_y4m, exact, ivf_units, timed, write_y4m  # noqa: E402

GOP = {"dbt10_ea1141"}
PREVIEW = {"rf_fluoro": (8, 20)}


def intra(build, s, work):
    """As SPEED's, but colour tagged sRGB: WebCodecs reports any other identity stream as BT.709."""
    y4m, ivf = work / "in.y4m", work / "out.ivf"
    write_y4m(s, y4m)
    colour = ["--monochrome"] if s.ch == 1 else \
        ["--color-primaries=bt709", "--transfer-characteristics=srgb", "--matrix-coefficients=identity"]
    profile = 2 if s.av1_bits == 12 else (1 if s.ch == 3 else 0)
    timed([build / f"aom-{AOM}/bin/aomenc", "-q", "--ivf", "-o", ivf, "--lossless=1", "--cpu-used=0",
           f"--limit={s.n}", f"--bit-depth={s.av1_bits}", f"--input-bit-depth={s.av1_bits}", f"--profile={profile}",
           *colour, "--kf-max-dist=0", y4m])
    units = ivf_units(ivf)
    for i, unit in enumerate(units):
        (work / "u.obu").write_bytes(unit)
        if not exact(s, i, decode_y4m(build, work / "u.obu", work / "u.y4m")[0]):
            sys.exit(f"{s.name} {i}: AV1 not exact alone")
    return units


def split(build, s, work, top_bits, shift):
    v = [s.frame(i)[..., 0].astype(np.int32) for i in range(s.n)]
    units = []
    for k, (bits, take) in enumerate(((top_bits, lambda x: x >> shift), (8, lambda x: x & ((1 << shift) - 1)))):
        y4m, ivf = work / f"s{k}.y4m", work / f"s{k}.ivf"
        depth.write_y4m([take(x) for x in v], bits, s.w, s.h, y4m)
        depth.encode(build, y4m, ivf, s.n, bits, 0, 1)
        units.append(ivf_units(ivf))
    frames = []
    for i, (top, low) in enumerate(zip(*units)):
        merged = 0
        for unit, up in ((top, shift), (low, 0)):
            (work / "u.obu").write_bytes(unit)
            merged = merged + (decode_y4m(build, work / "u.obu", work / "u.y4m")[0].astype(np.int32) << up)
        if not exact(s, i, merged):
            sys.exit(f"{s.name} {i}: split {top_bits}+{shift} not exact alone")
        frames.append(len(top).to_bytes(4, "little") + top + low)
    return frames


def gop(build, s, work):
    y4m = work / "in.y4m"
    write_y4m(s, y4m)
    cell = av1_cell(build, s, work, y4m, "aom", 0, s.n)
    if not cell["exact"]:
        sys.exit(f"{s.name}: one group not exact")
    return ivf_units(work / "out.ivf")


def lossy(build, s, work, group, crf):
    y4m = work / "pre.y4m"
    preview.write_y4m(s, y4m)
    units, hashes, _, _ = preview.av1_cell(build, s, work, y4m, group, crf)
    return units, hashes


def main():
    build, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    for d in sys.argv[3:]:
        s = Set(Path(d))
        if s.offset or s.av1_bits is None:
            sys.exit(f"{s.name}: needs an offset or more than 12 bits")
        dst, work = out / s.name, out / f".{s.name}-work"
        dst.mkdir(parents=True, exist_ok=True)
        work.mkdir(exist_ok=True)
        files = {"av1": intra(build, s, work)}
        arms = {"htj2k": {}, "av1": {}}
        if s.av1_bits <= 10:
            arms["wc"] = dict(ext="av1", depth=s.av1_bits)
        if s.ch == 1 and s.av1_bits == 12:
            files["t11"] = split(build, s, work, 12, 2)
            files["t10"] = split(build, s, work, 10, 3)
            arms["t11"] = dict(split=2)
            arms["t10"] = dict(split=3, depth=10)
        if s.name in GOP:
            files["gop"] = gop(build, s, work)
            arms["gop"] = dict(group=s.n)
        if s.name in PREVIEW:
            group, crf = PREVIEW[s.name]
            files["pre"], truth = lossy(build, s, work, group, crf)
            arms["pre"] = dict(group=group, truth=truth)
        for ext, units in files.items():
            for i, unit in enumerate(units):
                (dst / f"{i:03d}.{ext}").write_bytes(unit)
        for i in range(s.n):
            htj2k(s, i, work, dst / f"{i:03d}.htj2k")
        sizes = {ext: sum((dst / f"{i:03d}.{ext}").stat().st_size for i in range(s.n)) for ext in ["htj2k", *files]}
        entry = dict(name=s.name, frames=s.n, bits=s.av1_bits, truth=s.truth, arms=arms, bytes=sizes)
        (dst / "arms.json").write_text(json.dumps(entry, indent=1))
        print(s.name, s.n, "frames,", ", ".join(f"{k} {v} B" for k, v in sizes.items()), flush=True)


if __name__ == "__main__":
    main()
