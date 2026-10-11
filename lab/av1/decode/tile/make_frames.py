#!/usr/bin/env python3
"""TILEMEASURE's frames: each set's first FRAMES frames as the served HTJ2K whole, and cut into k = 2 and 3
horizontal tiles, each tile its own codestream in the same profile, beside the encoder's input samples.

Every tile is encoded from its rows of the input and decoded natively against those rows' checksum; the input is
checked against the set's checksum before anything is written. Tile j of k holds rows [round(H·j/k), round(H·(j+1)/k)).

usage: make_frames.py OUT SETDIR|g512 ...   — lab/av1/decode/tile/README.md
"""
import hashlib
import importlib.util
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parent / "per-frame"))
from make_frames import htj2k  # noqa: E402
from size import Set  # noqa: E402

spec = importlib.util.spec_from_file_location("region_frames", HERE.parent / "region/make_frames.py")
region = importlib.util.module_from_spec(spec)
spec.loader.exec_module(region)
FRAMES, KS = region.FRAMES, (2, 3)


def rows(h, k, j):
    return round(h * j / k), round(h * (j + 1) / k)


class Tile:
    """Rows [y0, y1) of a set, as htj2k() reads a set: its own size and the checksum of its own samples."""

    def __init__(self, s, i, y0, y1):
        self.name, self.w, self.h, self.ch = f"{s.name}-tile", s.w, y1 - y0, s.ch
        self.stored, self.signed, self.offset, self.dtype = s.stored, s.signed, s.offset, s.dtype
        self.px = s.frame(i)[y0:y1]
        self.truth = {i: hashlib.sha256(self.px.tobytes()).hexdigest()}

    def frame(self, i):
        return self.px


def main():
    out = Path(sys.argv[1]).resolve()
    manifest = []
    for arg in sys.argv[2:]:
        s = Set(region.g512(out) if arg == "g512" else Path(arg))
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
            f = dict(truth=s.truth[i], whole=(dst / f"{i:03d}.htj2k").stat().st_size)
            for k in KS:
                f[f"t{k}"] = []
                for j in range(k):
                    tile = dst / f"{i:03d}.t{k}-{j}.htj2k"
                    htj2k(Tile(s, i, *rows(s.h, k, j)), i, work, tile)
                    f[f"t{k}"].append(tile.stat().st_size)
            frames.append(f)
        shutil.rmtree(work)
        manifest.append(dict(name=s.name, width=s.w, height=s.h, channels=s.ch, bits=s.stored,
                             signed=bool(s.offset), frames=frames))
        whole = sum(f["whole"] for f in frames)
        print(s.name, len(frames), "frames,", whole, "B;", ", ".join(
            f"t{k} ×{sum(sum(f[f't{k}']) for f in frames) / whole:.4f}" for k in KS), flush=True)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
