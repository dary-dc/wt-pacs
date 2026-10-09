#!/usr/bin/env python3
"""XBROWSER's frames: the first FRAMES frames of each set in every layout row LLSIZE codes, each as
the client takes it, and the served HTJ2K. Every stream is libaom 3.15.1 lossless intra, cpu0,
`--tune-content=screen --sb-size=64`; every frame is decoded by native dav1d, merged and matched with
the series' checksum before it is written (total/make_frames.py's `represented`).

An arm is `connect`'s decoder fields: `depth` is the top stream's container, so the product's own
rule picks WebCodecs at ≤ 10 bits; an arm ending `.d` is the same file with no depth, so dav1d-WASM.
`grey8` is the ultrasound's green plane as 8-bit grey PGMs, its checksums written as it is made.

  make_frames.py BUILD OUT SETDIR ...   OUT/SET/NNN.{htj2k,dir,low2,low3,gbr,rct}, OUT/manifest.json
                                         [FRAMES=4 JOBS=4] — lab/av1/exact/engines/README.md
"""
import hashlib
import importlib.util
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
for d in ("", "speed", "llsize"):
    sys.path.insert(0, str(HERE.parents[1] / d))
import llsize  # noqa: E402
from make_frames import htj2k  # noqa: E402
from size import Set  # noqa: E402

# total/make_frames.py imports speed's make_frames by that name, so it is loaded under another.
_spec = importlib.util.spec_from_file_location("total_frames", HERE.parents[1] / "delivery/total-time/make_frames.py")
total = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(total)

FRAMES = int(os.environ.get("FRAMES", 4))
FLAGS = ["--tune-content=screen", "--sb-size=64"]
REPS = {"direct": "dir", "low2": "low2", "low3": "low3", "gbr": "gbr", "rct": "rct"}


def grey8(src, out):
    """The ultrasound's green plane, 8-bit grey; the checksum is written from the samples as they are made."""
    s = Set(src)
    out.mkdir(parents=True, exist_ok=True)
    for i in range(FRAMES):
        g = np.ascontiguousarray(s.frame(i)[..., 1])
        (out / f"{i:03d}.pgm").write_bytes(b"P5\n%d %d\n255\n" % (s.w, s.h) + g.tobytes())
        (out / f"{i:03d}.pgm.sha256").write_text(hashlib.sha256(g.tobytes()).hexdigest() + "\n")
    return out


def arms_of(s, reps):
    """name: (file, connect's decoder fields), and the reps to code."""
    bits = int(s.hi + s.offset).bit_length()
    offset = {"offset": s.offset} if s.offset else {}
    arms, coded = {"htj2k": ("htj2k", {})}, []
    for rep in reps.values():
        # low3 only where it alone brings the top to WebCodecs' 10 bits; no split at 8 bits.
        if rep.name not in REPS or (rep.name == "low3" and not llsize.container(bits - 3) <= 10 < llsize.container(bits - 2)) \
                or (rep.name == "low2" and bits <= 8):
            continue
        name = REPS[rep.name]
        top = llsize.container(rep.planes[0][0])
        fields = dict(offset)
        if rep.name.startswith("low"):
            fields["split"] = int(rep.name[3:])
        if rep.name == "rct":
            fields["rct"] = True
        coded.append(rep)
        arms[name] = (name, {**fields, "depth": top})
        if top <= 10:
            arms[f"{name}.d"] = (name, fields)
    return arms, coded


def make(build, out, src):
    s = Set(src)
    s.n, s.truth = min(FRAMES, s.n), s.truth[:FRAMES]
    dst, work = out / s.name, out / f".{s.name}-work"
    dst.mkdir(parents=True, exist_ok=True)
    work.mkdir(exist_ok=True)
    arms, coded = arms_of(s, {r.name: r for r in llsize.representations(s)})
    for rep in coded:
        for i, unit in enumerate(total.represented(build, s, work, rep, FLAGS, 1)):
            (dst / f"{i:03d}.{REPS[rep.name]}").write_bytes(unit)
    for i in range(s.n):
        htj2k(s, i, work, dst / f"{i:03d}.htj2k")
    sizes = {f: sum((dst / f"{i:03d}.{f}").stat().st_size for i in range(s.n)) for f, _ in arms.values()}
    entry = dict(name=s.name, w=s.w, h=s.h, ch=s.ch, bits=int(s.hi + s.offset).bit_length(), bytes=sizes,
                 arms={k: dict(ext=f, **fields) for k, (f, fields) in arms.items()},
                 frames=[dict(truth=t) for t in s.truth])
    print(s.name, s.n, "frames,", ", ".join(f"{k} {v} B" for k, v in sizes.items()), flush=True)
    return entry


def main():
    build, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    sets = [Path(d).resolve() for d in sys.argv[3:]]
    us = next((d for d in sets if d.name == "us_liver"), None)
    if us:
        sets.append(grey8(us, out / ".src" / "grey8"))
    with ProcessPoolExecutor(int(os.environ.get("JOBS", 4))) as pool:
        manifest = list(pool.map(make, [build] * len(sets), [out] * len(sets), sets))
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
