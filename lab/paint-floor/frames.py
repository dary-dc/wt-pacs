#!/usr/bin/env python3
"""Decoded sample sets for the paint bench, straight from the decode bench's frame generator.

The serving profile is reversible, so the samples `lab/scripts/gen_frame_pnm.py` writes are the
samples the decoder emits: encoding and decoding them back would add OpenJPH and a decoder to a
bench about paint. Each set is checked against that generator's `.sha256` before the level shift,
so a wrong endianness or a wrong PNM parse cannot pass. Signed sets then carry the shift
`lab/scripts/sign_htj2k.py` documents: the decoder emits `v - 2^(B-1)`.

usage: frames.py [OUTDIR]   (default lab/paint-floor/frames)
"""
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
GEN = ROOT / "lab/scripts/gen_frame_pnm.py"

SETS = {
    "cine512": dict(w=512, h=512, ch=3, maxval=255, bits=8, signed=False, mode="cine", n=3),
    "ct512": dict(w=512, h=512, ch=1, maxval=4095, bits=12, signed=True, mode="ct", n=3),
    "big12mp": dict(w=4096, h=3072, ch=1, maxval=65535, bits=16, signed=False, mode="ct", n=2),
}


def samples(spec, index):
    with tempfile.TemporaryDirectory() as tmp:
        pnm = Path(tmp) / ("f.pgm" if spec["ch"] == 1 else "f.ppm")
        subprocess.run(
            [sys.executable, str(GEN), str(pnm), *(str(spec[k]) for k in ("w", "h", "ch", "maxval")),
             str(index), str(spec["n"]), spec["mode"]],
            check=True,
        )
        raw = pnm.read_bytes().split(b"\n", 3)[3]
        want = (pnm.parent / (pnm.name + ".sha256")).read_text().strip()

    wide = spec["maxval"] > 255
    data = np.frombuffer(raw, dtype=">u2").astype("<u2") if wide else np.frombuffer(raw, dtype=np.uint8)
    got = hashlib.sha256(data.tobytes()).hexdigest()
    if got != want:
        sys.exit(f"{spec['mode']} frame {index}: samples do not match the generator's checksum")

    if spec["signed"]:
        data = (data.astype(np.int32) - (1 << (spec["bits"] - 1))).astype("<i2")
    return data


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent / "frames"
    manifest = {}
    for name, spec in SETS.items():
        d = out / name
        d.mkdir(parents=True, exist_ok=True)
        lo, hi = None, None
        for i in range(spec["n"]):
            data = samples(spec, i)
            (d / f"{i:03d}.raw").write_bytes(data.tobytes())
            lo = int(data.min()) if lo is None else min(lo, int(data.min()))
            hi = int(data.max()) if hi is None else max(hi, int(data.max()))
            print(f"{name} {i}: {spec['w']}x{spec['h']}x{spec['ch']} {spec['bits']}-bit -> {d}")
        manifest[name] = dict(
            width=spec["w"], height=spec["h"], components=spec["ch"], bits=spec["bits"],
            signed=spec["signed"], frames=spec["n"], min=lo, max=hi,
        )
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
