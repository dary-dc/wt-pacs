#!/usr/bin/env python3
"""BASES' frames: each set as HTJ2K, intra AV1, single-layer and layer-major scalable AV1, one file per entry.

htj2k and av1 as the total-time harness makes them. single: libaom 3.15.1's svc_encoder_rtc, one lossless layer, one
keyframe, in frame order. svc: the same encoder at the scalable-shape sweep's least-overhead shape (two spatial
layers, a quarter-size base at q 40, a lossless top, one keyframe) as docs/av1/adr-unit.md §5 lays it
out: entry i < F is frame i's base (its temporal unit up to the first OBU of spatial layer 1), entry
F + i the whole unit. Every exact entry is decoded natively and matched with the checksum of the
encoder's input; each base must equal the encoder's own base-layer unit, and its truth is the hash of
its native decode at operating point 1.

usage: make_frames.py BUILD OUT SETDIR ...   — lab/av1/delivery/bases-first/README.md
"""
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parent / "scalable/encoder"))
sys.path.insert(0, str(HERE.parent / "scalable/client"))
import svc  # noqa: E402
from size import Set  # noqa: E402
from units import drop_top, ivf_units  # noqa: E402

# The total-time frame maker, under its own name: it imports speed's make_frames itself.
_spec = importlib.util.spec_from_file_location("total_frames", HERE.parent / "total-time/make_frames.py")
total = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(total)

SPEED = 7
# (layering mode, spatial layers, the encoder's other flags)
SHAPES = {"single": (0, 1, ["--layer-q=0"]), "svc": (5, 2, ["-r", "1/4,1/1", "--layer-q=40,0"])}


def padded(s, i):
    """The encoder's input: svc_encoder_rtc refuses odd sizes, so an odd edge is replicated once."""
    px = s.frame(i)
    return np.pad(px, ((0, s.h % 2), (0, s.w % 2), (0, 0)), mode="edge")


def write_y4m(s, path):
    tag = ("444" if s.ch == 3 else "420") + ("" if s.av1_bits == 8 else f"p{s.av1_bits}")
    dt = "u1" if s.av1_bits == 8 else "<u2"
    h, w = s.h + s.h % 2, s.w + s.w % 2
    neutral = np.full((h // 2, w // 2), 1 << (s.av1_bits - 1), dt)
    with open(path, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{w} H{h} F25:1 Ip A1:1 C{tag}\n".encode())
        for i in range(s.n):
            px = padded(s, i).astype(dt)
            planes = [px[..., 1], px[..., 2], px[..., 0]] if s.ch == 3 else [px[..., 0], neutral, neutral]
            fh.write(b"FRAME\n" + b"".join(np.ascontiguousarray(p).tobytes() for p in planes))


def encode(build, s, y4m, ivf, shape):
    mode, sl, flags = SHAPES[shape]
    subprocess.run([build / "aom-3.15.1-svc-b/svc_encoder_rtc", "-o", ivf, "-lm", str(mode), "-sl", str(sl), *flags,
                    "-tl", "1", "-b", str(svc.KBPS * sl), "-bl", ",".join([str(svc.KBPS)] * sl), "--min-q=0", "--max-q=0",
                    "-k", "100000", "-sp", str(SPEED), "-d", str(s.av1_bits), f"--profile={2 if s.av1_bits == 12 else s.ch // 3}",
                    *(["--monochrome"] if s.ch == 1 else ["--rgb"]), y4m], check=True, capture_output=True)


def contract(planes, ch):
    """A native decode as the client's frame bytes: R, G, B interleaved from planes G, B, R, or grey."""
    px = np.stack([planes[2], planes[0], planes[1]], -1) if ch == 3 else planes[0]
    return np.ascontiguousarray(px).tobytes()


def dav1d(build, stream, out, op):
    subprocess.run([build / "dav1d/bin/dav1d", "-q", "-i", stream, "-o", out, "--alllayers", "0", "--oppoint", str(op)],
                   check=True, capture_output=True, env={"LD_LIBRARY_PATH": str(build / "dav1d/lib")})
    return svc.read_y4m(out)


def scalable(build, s, work, shape, truth):
    """The shape's entries, every exact one decoded natively whole and matched; and the bases' truth."""
    y4m, ivf = work / "in.y4m", work / f"{shape}.ivf"
    write_y4m(s, y4m)
    encode(build, s, y4m, ivf, shape)
    layers = SHAPES[shape][1]
    whole = ivf_units(Path(f"{ivf}_{layers - 1}.av1").read_bytes())
    (work / "whole.obu").write_bytes(b"".join(whole))
    got = [hashlib.sha256(contract(p, s.ch)).hexdigest() for p in dav1d(build, work / "whole.obu", work / "d.y4m", 0)]
    if got != truth:
        sys.exit(f"{s.name} {shape}: {sum(a == b for a, b in zip(got, truth))}/{s.n} exact")
    if layers == 1:
        return whole, None
    own = ivf_units(Path(f"{ivf}_0.av1").read_bytes())
    bases = []
    for i, unit in enumerate(whole):
        (work / "u.obu").write_bytes(unit)
        drop_top(work / "u.obu", work / "b.obu")
        bases.append((work / "b.obu").read_bytes())
        if bases[-1] != own[i]:
            sys.exit(f"{s.name} {shape} {i}: the unit's prefix is not the encoder's base unit")
    (work / "bases.obu").write_bytes(b"".join(bases))
    base_truth = [hashlib.sha256(contract(p, s.ch)).hexdigest() for p in dav1d(build, work / "bases.obu", work / "d.y4m", 1)]
    return bases + whole, base_truth


def main():
    build, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    for d in sys.argv[3:]:
        s = Set(Path(d))
        if s.offset or s.av1_bits is None:
            sys.exit(f"{s.name}: needs an offset or more than 12 bits")
        dst, work = out / s.name, out / f".{s.name}-work"
        dst.mkdir(parents=True, exist_ok=True)
        work.mkdir(exist_ok=True)
        truth = [hashlib.sha256(padded(s, i).tobytes()).hexdigest() for i in range(s.n)]
        files = {"av1": total.intra(build, s, work)}
        files["single"], _ = scalable(build, s, work, "single", truth)
        files["svc"], base_truth = scalable(build, s, work, "svc", truth)
        for ext, units in files.items():
            for i, unit in enumerate(units):
                (dst / f"{i:03d}.{ext}").write_bytes(unit)
        for i in range(s.n):
            total.htj2k(s, i, work, dst / f"{i:03d}.htj2k")
        sizes = {ext: sum(f.stat().st_size for f in dst.glob(f"*.{ext}")) for ext in ["htj2k", *files]}
        sizes["svc base"] = sum(len(u) for u in files["svc"][:s.n])
        variants = {"htj2k": {}, "av1": {},
                "single": dict(group=s.n, truth=truth),
                "svc": dict(group=s.n, layers=2, truth=truth, previewTruth=base_truth)}
        entry = dict(name=s.name, frames=s.n, bits=s.av1_bits, truth=s.truth, variants=variants, bytes=sizes)
        (dst / "variants.json").write_text(json.dumps(entry, indent=1))
        print(s.name, s.n, "frames,", ", ".join(f"{k} {v} B" for k, v in sizes.items()), flush=True)


if __name__ == "__main__":
    main()
