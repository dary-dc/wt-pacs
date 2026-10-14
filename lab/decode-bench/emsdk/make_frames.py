#!/usr/bin/env python3
"""P-EMSDK's frames: every frame of each set in the served HTJ2K profile, checked against the set's checksum, with
manifest.json for lab/av1/tools/newer/decode.mjs (a frame) and variants.json for lab/av1/delivery/total-time/run.mjs
(a cold ask and a fill): `del` the delivered build, `em6` the same recipe under emscripten 6.0.11.

usage: make_frames.py OUT SETDIR|g512|c512 ...   — lab/decode-bench/emsdk/README.md
"""
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
AV1 = HERE.parents[1] / "av1"
sys.path.insert(0, str(AV1))
sys.path.insert(0, str(AV1 / "decode/per-frame"))
from make_frames import htj2k  # noqa: E402
from size import Set  # noqa: E402

GEN = HERE.parents[1] / "scripts/gen_frame_pnm.py"
SYNTHETIC = {"g512": ("1", "65535"), "c512": ("3", "255")}
SYNTHETIC_FRAMES = 87
VARIANTS = {"del": dict(ext="htj2k", codec="htj2k", openjph="delivered"),
            "em6": dict(ext="htj2k", codec="htj2k", openjph="em6")}


def synthetic(out, name):
    """As lab/scripts/gen_htj2k_fixtures.sh makes it: 87 frames of 512², grey at 16 bits or RGB at 8."""
    src = out / f".{name}-src" / name
    src.mkdir(parents=True, exist_ok=True)
    ch, top = SYNTHETIC[name]
    for i in range(SYNTHETIC_FRAMES):
        subprocess.run([sys.executable, GEN, src / f"{i:03d}.{'pgm' if ch == '1' else 'ppm'}", "512", "512", ch, top, str(i),
                        str(SYNTHETIC_FRAMES)], check=True)
    return src


def main():
    out = Path(sys.argv[1]).resolve()
    manifest = []
    for arg in sys.argv[2:]:
        s = Set(synthetic(out, arg) if arg in SYNTHETIC else Path(arg))
        dst, work = out / s.name, out / f".{s.name}-work"
        dst.mkdir(parents=True, exist_ok=True)
        work.mkdir(exist_ok=True)
        frames = []
        for i in range(s.n):
            if hashlib.sha256(s.frame(i).tobytes()).hexdigest() != s.truth[i]:
                sys.exit(f"{s.name} {i}: the input is not the set's checksum")
            htj2k(s, i, work, dst / f"{i:03d}.htj2k")
            frames.append(dict(htj2k=(dst / f"{i:03d}.htj2k").stat().st_size, truth=s.truth[i]))
        shutil.rmtree(work)
        manifest.append(dict(name=s.name, width=s.w, height=s.h, channels=s.ch, bits=s.stored, frames=frames))
        (dst / "variants.json").write_text(json.dumps(dict(name=s.name, frames=s.n, truth=s.truth, variants=VARIANTS,
                                                           bytes={"htj2k": sum(f["htj2k"] for f in frames)}), indent=1))
        print(s.name, len(frames), "frames,", sum(f["htj2k"] for f in frames), "B", flush=True)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
