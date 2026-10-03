#!/usr/bin/env python3
"""The frames DECSPEED fills: each set whole as the served HTJ2K and as AV1 intra in every encoder variant.

A variant is libaom 3.15.1 lossless intra, one temporal unit a frame, plus the arguments VARIANTS
names. Every unit of every variant is decoded alone by native dav1d and matched with the checksum
written when the series was fetched before it is written out; a variant that is not exact stops
the run.

usage: make_variants.py BUILD OUT SETDIR ...   [VARIANTS=base,t4 FRAMES=N JOBS=4]  — README.md here
"""
import json
import os
import shutil
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "speed"))
sys.path.insert(0, str(HERE.parents[1] / "scripts"))
from make_frames import htj2k  # noqa: E402
from size import AOM, Set, decode_y4m, exact, ivf_units, timed, write_y4m  # noqa: E402

VARIANTS = {
    "base": [],
    "cpu6": ["--cpu-used=6"],
    "ai9": ["--allintra", "--cpu-used=9"],
    "sb64": ["--sb-size=64"],
    "t2": ["--tile-columns=1"],
    "t4": ["--tile-columns=2"],
    "t2x2": ["--tile-columns=1", "--tile-rows=1"],
    "t4sb64": ["--tile-columns=2", "--sb-size=64"],
    "lean": ["--enable-filter-intra=0", "--enable-intra-edge-filter=0", "--enable-smooth-intra=0",
             "--enable-paeth-intra=0", "--enable-cfl-intra=0", "--enable-palette=0", "--enable-intrabc=0",
             "--enable-angle-delta=0", "--enable-directional-intra=0"],
}
FRAMES = int(os.environ.get("FRAMES", 1000))
CHOSEN = os.environ.get("VARIANTS", ",".join(VARIANTS)).split(",")


def encode(build, d, variant, out):
    s = Set(Path(d))
    s.n = min(s.n, FRAMES)
    work = out / f".{s.name}-{variant}"
    work.mkdir(parents=True, exist_ok=True)
    y4m, ivf = work / "in.y4m", work / "out.ivf"
    write_y4m(s, y4m)
    profile = 2 if s.av1_bits == 12 else (1 if s.ch == 3 else 0)
    timed([build / f"aom-{AOM}/bin/aomenc", "-q", "--ivf", "-o", ivf, "--lossless=1", "--cpu-used=0",
           f"--limit={s.n}", f"--bit-depth={s.av1_bits}", f"--input-bit-depth={s.av1_bits}", f"--profile={profile}",
           "--monochrome" if s.ch == 1 else "--matrix-coefficients=identity", "--kf-max-dist=0",
           *VARIANTS[variant], y4m])
    units = ivf_units(ivf)
    if len(units) != s.n:
        sys.exit(f"{s.name} {variant}: {len(units)} units for {s.n} frames")
    for i, unit in enumerate(units):
        (work / "u.obu").write_bytes(unit)
        if not exact(s, i, decode_y4m(build, work / "u.obu", work / "u.y4m")[0]):
            sys.exit(f"{s.name} {variant} {i}: AV1 not exact alone")
        (out / s.name / f"{i:03d}.{ext(variant)}").write_bytes(unit)
    shutil.rmtree(work)
    print(s.name, variant, sum(map(len, units)), "B", flush=True)
    return s.name, variant, [len(u) for u in units], profile


def ext(variant):
    return "av1" if variant == "base" else f"av1-{variant}"


def main():
    build, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    sets = [Set(Path(d)) for d in sys.argv[3:]]
    for s in sets:
        if s.offset or s.av1_bits is None:
            sys.exit(f"{s.name}: needs an offset or more than 12 bits — row DEPTH's")
        (out / s.name).mkdir(parents=True, exist_ok=True)
    with ProcessPoolExecutor(int(os.environ.get("JOBS", os.cpu_count()))) as pool:
        done = list(pool.map(encode, *zip(*[(build, str(s.path), v, out) for s in sets for v in CHOSEN])))
    manifest = []
    for s in sets:
        s.n = min(s.n, FRAMES)
        work = out / f".{s.name}-htj2k"
        work.mkdir(exist_ok=True)
        for i in range(s.n):
            htj2k(s, i, work, out / s.name / f"{i:03d}.htj2k")
        shutil.rmtree(work)
        mine = {v: (sizes, p) for name, v, sizes, p in done if name == s.name}
        profile = next(iter(mine.values()))[1]
        frames = [dict(htj2k=(out / s.name / f"{i:03d}.htj2k").stat().st_size, truth=s.truth[i],
                       **{ext(v): sizes[i] for v, (sizes, _) in mine.items()}) for i in range(s.n)]
        manifest.append(dict(name=s.name, width=s.w, height=s.h, channels=s.ch, bits=s.av1_bits, frames=frames,
                             variants=[ext(v) for v in CHOSEN],
                             webcodecs=f"av01.{profile}.00M.{s.av1_bits:02d}" if s.av1_bits <= 10 else None))
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
