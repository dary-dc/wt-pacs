#!/usr/bin/env python3
"""The frames FASTHTJ2K profiles: each set's first FRAMES frames as the served HTJ2K.

Encoded and checked exactly as lab/av1/decode/per-frame's HTJ2K variant (ojph_expand against the checksum written when
the series was fetched; a signed series signed in SIZ).

usage: make_frames.py OUT SETDIR ...   — lab/av1/decode/htj2k-profile/README.md
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parent / "per-frame"))
from make_frames import htj2k  # noqa: E402
from size import Set  # noqa: E402

FRAMES = int(os.environ.get("FRAMES", 8))


def main():
    out = Path(sys.argv[1]).resolve()
    manifest = []
    for d in sys.argv[2:]:
        s = Set(Path(d))
        s.n = min(s.n, FRAMES)
        dst, work = out / s.name, out / f".{s.name}-work"
        dst.mkdir(parents=True, exist_ok=True)
        work.mkdir(exist_ok=True)
        frames = []
        for i in range(s.n):
            htj2k(s, i, work, dst / f"{i:03d}.htj2k")
            frames.append(dict(htj2k=(dst / f"{i:03d}.htj2k").stat().st_size, truth=s.truth[i]))
        manifest.append(dict(name=s.name, width=s.w, height=s.h, channels=s.ch, bits=s.stored,
                             signed=bool(s.offset), frames=frames))
        print(s.name, len(frames), "frames,", sum(f["htj2k"] for f in frames), "B", flush=True)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
