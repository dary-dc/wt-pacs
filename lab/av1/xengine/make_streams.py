#!/usr/bin/env python3
"""XENGINE's streams: each layout a client could hand WebCodecs, coded from real frames, one unit per frame.

Every stream is libaom 3.15.1 lossless intra (cpu0, one thread), decoded by native dav1d and matched plane by
plane with the encoder's input before it is written; each plane's checksum is taken from that input.

  make_streams.py BUILD OUT US_LIVER DBT10   OUT/LAYOUT/NNN.obu, OUT/manifest.json — lab/av1/xengine/README.md
"""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "llsize"))
import llsize  # noqa: E402
from size import AOM, Set, ivf_units  # noqa: E402

FRAMES = int(os.environ.get("FRAMES", 2))
SRGB = ["--color-primaries=bt709", "--transfer-characteristics=srgb", "--matrix-coefficients=identity"]


def layouts(us, dbt):
    """name: (bits, chroma, profile, aomenc colour flags, frame i → [planes in coded order])."""
    grey8 = lambda i: us.frame(i)[..., 1].astype(np.int32)  # noqa: E731
    grey10 = lambda i: dbt.frame(i)[..., 0].astype(np.int32)  # noqa: E731
    rct = next(r for r in llsize.representations(us) if r.name == "rct").planes[0][2]
    neutral = lambda g, bits: [g, *[np.full(((g.shape[0] + 1) // 2, (g.shape[1] + 1) // 2), 1 << (bits - 1))] * 2]  # noqa: E731
    return {
        "g8-mono": (8, "mono", 0, ["--monochrome"], lambda i: [grey8(i)]),
        "g8-420": (8, "420", 0, [], lambda i: neutral(grey8(i), 8)),
        "g8-gbr": (8, "444", 1, SRGB, lambda i: [grey8(i)] * 3),
        "g10-mono": (10, "mono", 0, ["--monochrome"], lambda i: [grey10(i)]),
        "g10-420": (10, "420", 0, [], lambda i: neutral(grey10(i), 10)),
        "rgb8-gbr": (8, "444", 1, SRGB, lambda i: [us.frame(i)[..., c].astype(np.int32) for c in (1, 2, 0)]),
        "rct10": (10, "444", 1, SRGB, lambda i: [rct(i)[..., c] for c in range(3)]),
    }


def sample_bytes(plane, bits):
    return np.ascontiguousarray(plane.astype("u1" if bits == 8 else "<u2")).tobytes()


def code(build, work, name, bits, chroma, profile, colour, planes, h, w):
    y4m, ivf = work / f"{name}.y4m", work / f"{name}.ivf"
    tag = ("444" if chroma == "444" else "420") + ("" if bits == 8 else f"p{bits}")
    with open(y4m, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{w} H{h} F25:1 Ip A1:1 C{tag}\n".encode())
        for i in range(FRAMES):
            ps = planes(i)
            if chroma == "mono":
                ps = [ps[0], *[np.full(((h + 1) // 2, (w + 1) // 2), 1 << (bits - 1))] * 2]
            fh.write(b"FRAME\n" + b"".join(sample_bytes(p, bits) for p in ps))
    subprocess.run([build / f"aom-{AOM}/bin/aomenc", "-q", "--ivf", "-o", ivf, "--lossless=1", "--cpu-used=0", "--threads=1",
                    f"--limit={FRAMES}", f"--bit-depth={bits}", f"--input-bit-depth={bits}", f"--profile={profile}",
                    "--kf-max-dist=0", *colour, y4m], check=True, capture_output=True)
    return ivf_units(ivf)


def main():
    build, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    us, dbt = Set(Path(sys.argv[3])), Set(Path(sys.argv[4]))
    work = out / ".work"
    work.mkdir(parents=True, exist_ok=True)
    manifest = []
    for name, (bits, chroma, profile, colour, planes) in layouts(us, dbt).items():
        h, w = planes(0)[0].shape
        units = code(build, work, name, bits, chroma, profile, colour, planes, h, w)
        (out / name).mkdir(exist_ok=True)
        frames = []
        for i, unit in enumerate(units):
            (work / "u.obu").write_bytes(unit)
            back = llsize.decoded(build, work / "u.obu", work / "u.y4m")[0]
            src = planes(i)
            for c, p in enumerate(src[:1] if chroma in ("mono", "420") else src):
                if not np.array_equal(back[: p.shape[0], : p.shape[1], c], p):
                    sys.exit(f"{name} {i}: plane {c} not exact natively")
            (out / name / f"{i:03d}.obu").write_bytes(unit)
            image = src[:1] if chroma in ("mono", "420") else src
            frames.append(dict(planes=[hashlib.sha256(sample_bytes(p, bits)).hexdigest() for p in image], bytes=len(unit)))
        manifest.append(dict(name=name, bits=bits, chroma=chroma, width=w, height=h, frames=frames))
        print(name, w, "x", h, bits, "bit", chroma, [f["bytes"] for f in frames], "B", flush=True)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
