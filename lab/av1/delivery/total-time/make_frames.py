#!/usr/bin/env python3
"""TOTAL's frames: each set's every frame as each arm serves it, one file per frame and arm.

htj2k (the served profile) and av1 (libaom lossless intra, cpu0) for every set; on a 12-bit grey set
the two splits as the client takes them (`[u32le len(top)][top unit][low unit]`): t11 (v >> 2 at 12
bits + v & 3, dav1d-WASM) and t10 (v >> 3 at 10 bits + v & 7, WebCodecs); on a set where a group
beat intra, gop (the whole series one group, no alt-ref); on the fluoroscopy, pre — row PREVIEW's
lossy preview, 10-bit 4:0:0, G = 8, CRF 20, cpu6. Row TOTAL2 adds row LLSIZE's best codings: l2,
the two low bits apart on grey; rct, the reversible colour transform on RGB, intra and G = 8. Every
exact arm is decoded natively and matched with the series' checksum; a preview's truth is its native
decode's hash. Row TOTAL3 adds x36, row ENCX's changes to l2: the low k bits packed and raw-deflated,
k = 3 where the noise's σ ≥ 17; and names the two representations of docs/av1/item-format.md, plain
and opt, each with the decoder the format picks.

usage: [ARMS=av1,split,gop,pre,l2,rct,x36,plain] make_frames.py BUILD OUT SETDIR ...  (OUT/SET/arms.json says
what was made; ARMS limits it, htj2k always) — lab/av1/delivery/total-time/README.md
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parents[1] / "decode/per-frame"))
sys.path.insert(0, str(HERE.parent / "preview"))
sys.path.insert(0, str(HERE.parents[1] / "bytes/represented"))
sys.path.append(str(HERE.parents[1] / "bytes/low-stream"))
import depth  # noqa: E402
import llsize  # noqa: E402
import encode as preview  # noqa: E402
from make_frames import htj2k  # noqa: E402
from encx import deflate, inflate, pack, unpack  # noqa: E402
from size import AOM, Set, av1_cell, decode_y4m, exact, ivf_units, timed, write_y4m  # noqa: E402

GOP = {"dbt10_ea1141"}
PREVIEW = {"rf_fluoro": (8, 20)}
# Row ENCX's k: 3 where the noise's σ ≥ 17 (lab/av1/bytes/low-stream/README.md §The split per series), else 2.
K36 = {"rf_fluoro": 3, "dbt12_ea1141": 3, "dbt10_ea1141": 2}
SRGB = ["--color-primaries=bt709", "--transfer-characteristics=srgb", "--matrix-coefficients=identity"]


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


def represented(build, s, work, rep, flags, group):
    """Row LLSIZE's coding of every plane stream, a frame's streams as the client takes them."""
    streams = []
    for j, (used, ch, plane) in enumerate(rep.planes):
        bits = llsize.container(used)
        y4m, ivf = work / f"r{j}.y4m", work / f"r{j}.ivf"
        llsize.write_y4m(y4m, s.n, bits, ch, s.h, s.w, plane)
        kf = ["--kf-max-dist=0"] if group == 1 else [f"--kf-min-dist={group}", f"--kf-max-dist={group}", "--auto-alt-ref=0"]
        timed([build / f"aom-{AOM}/bin/aomenc", "-q", "--ivf", "-o", ivf, "--lossless=1", "--cpu-used=0", "--threads=1",
               f"--limit={s.n}", f"--bit-depth={bits}", f"--input-bit-depth={bits}",
               f"--profile={2 if bits == 12 else (1 if ch == 3 else 0)}", *kf, *flags,
               *(["--monochrome"] if ch == 1 else SRGB), y4m])
        streams.append(ivf_units(ivf))
    for g0 in range(0, s.n, group):
        planes = []
        for units in streams:
            (work / "g.obu").write_bytes(b"".join(units[g0:g0 + group]))
            planes.append(llsize.decoded(build, work / "g.obu", work / "g.y4m"))
        for k in range(min(group, s.n - g0)):
            if not exact(s, g0 + k, rep.merge([p[k][:s.h, :s.w].astype(np.int32) for p in planes]).reshape(s.h, s.w, s.ch)):
                sys.exit(f"{s.name} {g0 + k}: {rep.name} G = {group} not exact")
    if len(streams) == 1:
        return streams[0]
    return [len(top).to_bytes(4, "little") + top + low for top, low in zip(*streams)]


def deflated(build, s, work, rep, k):
    """rep's top coded as row LLSIZE codes it, the low k bits packed and raw-deflated: `[u32le len(top)][top][low]`."""
    (used, _, top), (_, _, low) = rep.planes
    bits = llsize.container(used)
    y4m, ivf = work / "x.y4m", work / "x.ivf"
    llsize.write_y4m(y4m, s.n, bits, 1, s.h, s.w, top)
    timed([build / f"aom-{AOM}/bin/aomenc", "-q", "--ivf", "-o", ivf, "--lossless=1", "--cpu-used=0", "--threads=1",
           f"--limit={s.n}", f"--bit-depth={bits}", f"--input-bit-depth={bits}", f"--profile={2 if bits == 12 else 0}",
           "--kf-max-dist=0", "--tune-content=screen", "--sb-size=64", "--monochrome", y4m])
    frames = []
    for i, unit in enumerate(ivf_units(ivf)):
        packed = deflate(pack(low(i), k))
        (work / "x.obu").write_bytes(unit)
        t = llsize.decoded(build, work / "x.obu", work / "x.out.y4m")[0][:s.h, :s.w].astype(np.int32)
        if not exact(s, i, (t << k) | unpack(inflate(packed), k, t.shape)):
            sys.exit(f"{s.name} {i}: top{k} + deflated low{k} not exact")
        frames.append(len(unit).to_bytes(4, "little") + unit + packed)
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
        want = os.environ.get("ARMS", "av1,split,gop,pre,l2,rct").split(",")
        files, arms = {}, {"htj2k": {}}
        if "av1" in want:
            files["av1"] = intra(build, s, work)
            arms["av1"] = {}
        if "av1" in want and s.av1_bits <= 10:
            arms["wc"] = dict(ext="av1", depth=s.av1_bits)
        reps = {r.name: r for r in llsize.representations(s)}
        if "l2" in want and "low2" in reps:
            files["l2"] = represented(build, s, work, reps["low2"], ["--tune-content=screen", "--sb-size=64"], 1)
            arms["l2"] = dict(split=2)
            arms["l2wc"] = dict(ext="l2", split=2, depth=llsize.container(reps["low2"].planes[0][0]))
        if "rct" in want and "rct" in reps:
            files["rct"] = represented(build, s, work, reps["rct"], ["--tune-content=screen", "--sb-size=64"], 1)
            files["rct8"] = represented(build, s, work, reps["rct"], [], 8)
            arms["rct"] = dict(rct=True)
            arms["rctwc"] = dict(ext="rct", rct=True, depth=10)
            arms["rct8wc"] = dict(ext="rct8", rct=True, depth=10, group=8)
        if "split" in want and s.ch == 1 and s.av1_bits == 12:
            files["t11"] = split(build, s, work, 12, 2)
            files["t10"] = split(build, s, work, 10, 3)
            arms["t11"] = dict(split=2)
            arms["t10"] = dict(split=3, depth=10)
        if "gop" in want and s.name in GOP:
            files["gop"] = gop(build, s, work)
            arms["gop"] = dict(group=s.n)
        if "pre" in want and s.name in PREVIEW:
            group, crf = PREVIEW[s.name]
            files["pre"], truth = lossy(build, s, work, group, crf)
            arms["pre"] = dict(group=group, truth=truth)
        if "x36" in want and s.name in K36:
            k = K36[s.name]
            rep = reps[f"low{k}"]
            files["x36"] = deflated(build, s, work, rep, k)
            arms["x36"] = dict(split=k, depth=llsize.container(rep.planes[0][0]), worker="/lab/av1/delivery/total-time/deflate-worker.js")
        if "plain" in want and "av1" in files:
            arms["plain"] = dict(ext="av1", **({"depth": s.av1_bits} if s.av1_bits <= 10 else {}))
        if "plain" in want and "l2wc" in arms:
            arms["opt"] = arms["l2wc"]
        if "plain" in want and "rctwc" in arms:
            arms["opt"] = arms["rctwc"]
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
