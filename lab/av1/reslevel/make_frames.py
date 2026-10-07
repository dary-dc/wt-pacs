#!/usr/bin/env python3
"""RESLEVEL's frames: each set's first N frames in the served HTJ2K profile, the resolution level a phone screen
needs, and that level's truth from an independent decoder.

The level is the most reduced one whose long side still holds SCREEN pixels. Its truth is OpenJPEG's `-r` output
of the same codestream, which must equal ll.py's 5/3 analysis of the source clamped to [0, 2^B - 1]; the full
frame's is the series' checksum, checked by the native decode before anything is written. prefix.mjs cuts after.

usage: make_frames.py BUILD OUT SETDIR ... [--frames 4] [--screen 1000]   — lab/av1/reslevel/README.md
"""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "speed"))
sys.path.insert(0, str(HERE.parents[1] / "scripts"))
from ll import low_band  # noqa: E402
from make_frames import htj2k  # noqa: E402
from size import Set  # noqa: E402

DECOMPOSITIONS = 5


def level_for(w, h, screen):
    """The most reduced level whose long side is at least `screen`; 0 when the frame is no larger."""
    r = 0
    while r < DECOMPOSITIONS and -(-max(w, h) // (2 ** (r + 1))) >= screen:
        r += 1
    return r


def reduced(build, cs, level, work):
    """OpenJPEG's decode at `level`, as little-endian samples — the layout OpenJPH's buffer has."""
    j2c, out = work / "in.j2c", work / "out.rawl"
    j2c.write_bytes(cs.read_bytes())
    out.unlink(missing_ok=True)
    subprocess.run([build / "openjpeg-native/bin/opj_decompress", "-i", j2c, "-o", out, "-r", str(level), "-quiet"],
                   check=True, capture_output=True)
    return out.read_bytes()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("build", type=Path)
    p.add_argument("out", type=Path)
    p.add_argument("sets", nargs="+", type=Path)
    p.add_argument("--frames", type=int, default=4)
    p.add_argument("--screen", type=int, default=1000)
    a = p.parse_args()
    for path in a.sets:
        s = Set(path)
        if s.ch != 1 or s.signed:
            sys.exit(f"{s.name}: grey unsigned only")
        n = min(a.frames, s.n)
        level = level_for(s.w, s.h, a.screen)
        dst, work = a.out / s.name, a.out / f".{s.name}-work"
        dst.mkdir(parents=True, exist_ok=True)
        work.mkdir(exist_ok=True)
        truth, over = [], 0
        for i in range(n):
            cs = dst / f"{i:03d}.htj2k"
            htj2k(s, i, work, cs)
            px = reduced(a.build, cs, level, work)
            want = 2 * -(-s.w // 2 ** level) * -(-s.h // 2 ** level)
            if len(px) != want:
                sys.exit(f"{s.name} {i}: OpenJPEG gave {len(px)} bytes at level {level}, {want} due")
            band = low_band(s.frame(i)[..., 0], level)
            over += int((band > (1 << s.stored) - 1).sum() + (band < 0).sum())
            if np.clip(band, 0, (1 << s.stored) - 1).astype("<u2").tobytes() != px:
                sys.exit(f"{s.name} {i}: OpenJPEG at level {level} is not the clamped 5/3 low band")
            truth.append(hashlib.sha256(px).hexdigest())
        entry = dict(name=s.name, frames=n, width=s.w, height=s.h, bits=s.stored, level=level,
                     truth=s.truth[:n], reducedTruth=truth, outOfRange=over, arms={"htj2k": {}},
                     bytes={"htj2k": sum((dst / f"{i:03d}.htj2k").stat().st_size for i in range(n))})
        (dst / "arms.json").write_text(json.dumps(entry, indent=1))
        print(f"{s.name}: {n} × {s.w}×{s.h}, level {level} ({-(-s.w // 2 ** level)}×{-(-s.h // 2 ** level)}),"
              f" {entry['bytes']['htj2k']} B, {over} low-band samples out of range", flush=True)


if __name__ == "__main__":
    main()
