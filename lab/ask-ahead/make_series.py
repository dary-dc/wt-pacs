#!/usr/bin/env python3
"""ASKAHEAD's series: a fetched set as the served HTJ2K, every frame decoded natively and matched with the
checksum written when it was fetched, then packed; `digests.json` holds each codestream's SHA-256, which the
page checks every delivered frame against.

usage: make_series.py SETDIR OUT   — lab/ask-ahead/README.md
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "lab/av1"))
sys.path.insert(0, str(ROOT / "lab/av1/decode/per-frame"))
sys.path.insert(0, str(ROOT / "lab/scripts"))
from size import Set  # noqa: E402
from make_frames import htj2k  # noqa: E402


def main():
    s, out = Set(Path(sys.argv[1]).resolve()), Path(sys.argv[2]).resolve()
    frames, work = out / "frames", out / ".work"
    frames.mkdir(parents=True, exist_ok=True)
    work.mkdir(exist_ok=True)
    digests = []
    for i in range(s.n):
        f = frames / f"{i:03d}.htj2k"
        htj2k(s, i, work, f)
        digests.append(hashlib.sha256(f.read_bytes()).hexdigest())
    (out / "digests.json").write_text(json.dumps(digests))
    (out / "metadata.json").write_text(json.dumps({"frameCount": s.n, "width": s.w, "height": s.h}))
    subprocess.run([ROOT / "target/debug/pack-series", "--metadata", out / "metadata.json", "--frames", frames,
                    "--output", out / "series.sbnd"], check=True, stdout=subprocess.DEVNULL)
    sizes = [(frames / f"{i:03d}.htj2k").stat().st_size for i in range(s.n)]
    print(f"{s.name}: {s.n} frames exact, {sum(sizes)} B, largest {max(sizes)} B")


if __name__ == "__main__":
    main()
