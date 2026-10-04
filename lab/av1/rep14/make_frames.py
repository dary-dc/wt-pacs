#!/usr/bin/env python3
"""REP14's frames: a 13- or 14-bit series in two layouts, each frame as the client takes it.

d12: the two low bits apart, v >> 2 at 12 bits (dav1d only) + v & 3. w10: v >> (b - 10) at 10 bits +
the b - 10 low bits, every stream WebCodecs takes. Each stream is libaom 3.15.1, lossless intra,
`--tune-content=screen --sb-size=64` at PRESET; a frame is `[u32le len(top)][top unit][low unit]`.
Every unit is decoded alone by native dav1d, merged and matched with the series' checksum before a
frame is written; HTJ2K is the served profile.

  make_frames.py BUILD OUT SETDIR ...            OUT/SET/NNN.{htj2k,d12,w10}, arms.json; OUT/manifest.json
  make_frames.py BUILD OUT --sweep P,P SETDIR ...  bytes and encode seconds of the first FRAMES frames a preset

lab/av1/rep14/README.md
"""
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "speed"))
import depth  # noqa: E402
from make_frames import htj2k  # noqa: E402
from size import AOM, Set, decode_y4m, exact, ivf_units, timed  # noqa: E402

PRESET = int(os.environ.get("PRESET", 0))
FRAMES = int(os.environ.get("FRAMES", 2))
FLAGS = ["--tune-content=screen", "--sb-size=64"]


def layouts(bits):
    """name: (top's container bits, low bits k); the frame is top << k | low."""
    return {"d12": (12, 2), "w10": (10, bits - 10)}


def stream(build, planes, bits, work, preset):
    y4m, ivf = work / "in.y4m", work / "out.ivf"
    depth.write_y4m(planes, bits, planes[0].shape[1], planes[0].shape[0], y4m)
    secs = timed([build / f"aom-{AOM}/bin/aomenc", "-q", "--ivf", "-o", ivf, "--lossless=1", f"--cpu-used={preset}",
                  "--threads=1", f"--limit={len(planes)}", f"--bit-depth={bits}", f"--input-bit-depth={bits}",
                  f"--profile={2 if bits == 12 else 0}", "--monochrome", "--kf-max-dist=0", *FLAGS, y4m])
    return ivf_units(ivf), secs


def layout(build, path, name, work, preset, n):
    """Both streams of one layout, every frame exact alone; the frames as stored and the encode seconds."""
    s = load(path)
    work = work / f".{s.name}-{name}-{preset}"
    work.mkdir(parents=True, exist_ok=True)
    top_bits, k = layouts(s.bits)[name]
    v = [s.frame(i)[..., 0].astype(np.int32) + s.offset for i in range(n)]
    top, t_secs = stream(build, [x >> k for x in v], top_bits, work, preset)
    low, l_secs = stream(build, [x & ((1 << k) - 1) for x in v], 8, work, preset)
    frames = []
    for i, (a, b) in enumerate(zip(top, low)):
        merged = 0
        for unit, up in ((a, k), (b, 0)):
            (work / "u.obu").write_bytes(unit)
            merged = merged + (decode_y4m(build, work / "u.obu", work / "u.y4m")[0].astype(np.int32) << up)
        if not exact(s, i, merged):
            sys.exit(f"{s.name} {i}: {name} not exact alone")
        frames.append(len(a).to_bytes(4, "little") + a + b)
    return dict(set=s.name, layout=name, preset=preset, frames=frames, top=sum(map(len, top)),
                low=sum(map(len, low)), encode_s=round(t_secs + l_secs, 1))


def bits_of(s):
    return int(s.hi + s.offset).bit_length()


def load(path):
    s = Set(Path(path))
    s.bits = bits_of(s)
    if s.ch != 1 or s.bits not in (13, 14):
        sys.exit(f"{s.name}: {s.bits} bits, {s.ch} channels — REP14 is grey at 13 or 14 bits")
    return s


def htj2k_bytes(path, work, n, dst=None):
    s = load(path)
    work = work / f".{s.name}-htj2k"
    work.mkdir(parents=True, exist_ok=True)
    total = 0
    for i in range(n):
        out = (dst or work) / f"{i:03d}.htj2k"
        htj2k(s, i, work, out)
        total += out.stat().st_size
    return total


def sweep(build, out, presets, paths):
    jobs = []
    with ProcessPoolExecutor(int(os.environ.get("JOBS", 4))) as pool:
        for p in paths:
            s = load(p)
            n = min(FRAMES, s.n)
            jobs.append((s.name, "htj2k", None, pool.submit(htj2k_bytes, p, out, n)))
            for name in layouts(s.bits):
                for preset in presets:
                    jobs.append((s.name, name, preset, pool.submit(layout, build, p, name, out, preset, n)))
        print("set\tlayout\tpreset\tbytes\ttop\tlow\tencode_s", flush=True)
        for name, lay, preset, f in jobs:
            r = f.result()
            if lay == "htj2k":
                print(f"{name}\thtj2k\t-\t{r}\t\t\t", flush=True)
                continue
            print(f"{name}\t{lay}\t{preset}\t{r['top'] + r['low']}\t{r['top']}\t{r['low']}\t{r['encode_s']}", flush=True)


def frames(build, out, paths):
    with ProcessPoolExecutor(int(os.environ.get("JOBS", 4))) as pool:
        made = []
        for p in paths:
            s = load(p)
            dst = out / s.name
            dst.mkdir(parents=True, exist_ok=True)
            made.append((p, s, pool.submit(htj2k_bytes, p, out, s.n, dst),
                         {name: pool.submit(layout, build, p, name, out, PRESET, s.n) for name in layouts(s.bits)}))
        manifest = []
        for p, s, h, lays in made:
            dst = out / s.name
            sizes = {"htj2k": h.result()}
            for name, f in lays.items():
                r = f.result()
                for i, frame in enumerate(r["frames"]):
                    (dst / f"{i:03d}.{name}").write_bytes(frame)
                sizes[name] = sum(map(len, r["frames"]))
            k = layouts(s.bits)["w10"][1]
            signed = {"offset": s.offset} if s.offset else {}
            arms = {"htj2k": {}, "d12": dict(split=2, **signed), "w10": dict(split=k, depth=10, **signed),
                    "w10d": dict(ext="w10", split=k, **signed)}
            entry = dict(name=s.name, frames=s.n, bits=s.bits, preset=PRESET, truth=s.truth, arms=arms, bytes=sizes)
            (dst / "arms.json").write_text(json.dumps(entry, indent=1))
            manifest.append(dict(name=s.name, arms=arms, frames=[dict(truth=t) for t in s.truth]))
            print(s.name, s.n, "frames,", ", ".join(f"{a} {b} B" for a, b in sizes.items()), flush=True)
    (out / "manifest.json").write_text(json.dumps(manifest))


def main():
    build, out, *rest = sys.argv[1:]
    build, out = Path(build).resolve(), Path(out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    if rest[0] == "--sweep":
        sweep(build, out, [int(x) for x in rest[1].split(",")], rest[2:])
    else:
        frames(build, out, rest)


if __name__ == "__main__":
    main()
