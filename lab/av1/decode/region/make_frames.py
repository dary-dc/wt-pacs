#!/usr/bin/env python3
"""REGIONDECODE's frames: each set's first FRAMES frames as the served HTJ2K, beside the encoder's input samples.

The samples (NNN.raw, the set's dtype, row-major) are what every region and stripe is compared with; each is
checked against the checksum written when the set was made before anything is written. `g512` is generated
here as lab/scripts/gen_htj2k_fixtures.sh makes it (87 frames, the first FRAMES kept).

usage: make_frames.py OUT SETDIR|g512 ...   — lab/av1/decode/region/README.md
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parent / "per-frame"))
from make_frames import htj2k  # noqa: E402
from size import Set  # noqa: E402

FRAMES = int(os.environ.get("FRAMES", 4))
GEN = HERE.parents[2] / "scripts/gen_frame_pnm.py"


def g512(out):
    src = out / ".g512-src" / "g512"
    src.mkdir(parents=True, exist_ok=True)
    for i in range(FRAMES):
        subprocess.run([sys.executable, GEN, src / f"{i:03d}.pgm", "512", "512", "1", "65535", str(i), "87"],
                       check=True)
    return src


def main():
    out = Path(sys.argv[1]).resolve()
    manifest = []
    for arg in sys.argv[2:]:
        s = Set(g512(out) if arg == "g512" else Path(arg))
        s.n = min(s.n, FRAMES)
        dst, work = out / s.name, out / f".{s.name}-work"
        dst.mkdir(parents=True, exist_ok=True)
        work.mkdir(exist_ok=True)
        frames = []
        for i in range(s.n):
            px = s.frame(i).tobytes()
            if hashlib.sha256(px).hexdigest() != s.truth[i]:
                sys.exit(f"{s.name} {i}: the input is not the set's checksum")
            (dst / f"{i:03d}.raw").write_bytes(px)
            htj2k(s, i, work, dst / f"{i:03d}.htj2k")
            frames.append(dict(htj2k=(dst / f"{i:03d}.htj2k").stat().st_size, truth=s.truth[i]))
        shutil.rmtree(work)
        manifest.append(dict(name=s.name, width=s.w, height=s.h, channels=s.ch, bits=s.stored,
                             signed=bool(s.offset), frames=frames))
        print(s.name, len(frames), "frames,", sum(f["htj2k"] for f in frames), "B", flush=True)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
