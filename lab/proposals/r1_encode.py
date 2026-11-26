#!/usr/bin/env python3
"""R1's encodes (docs/lines/proposals.md §R1, amendment 1): P2's wrapper on the integrity build, with --integrity, and
each frame's error also measured by the quality study's code, one JSON line a frame to $R1_OUT/ARM/ID.quality.jsonl.

usage: QUALITY=<dir of quality.py> R1_OUT=... r1_encode.py BUILD_TIP ARM SET ID Q G [--depth-cut]     ARM: one | 2x2
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

TILES = {"one": [], "2x2": ["--tile-columns=1", "--tile-rows=1"]}

tip, arm, set_, id_, q, g, *cut = sys.argv[1:]
tip, out = Path(tip), Path(os.environ["R1_OUT"]) / arm
out.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, os.environ["QUALITY"])
sys.path.insert(0, str(tip / "lab/av1/tools"))
sys.argv = ["ingest_coded.py", str(tip / "ingest/.build"), str(tip / "lab/av1/data" / set_), str(out / id_), "--jobs",
            str(os.cpu_count()), "--lossy", q, g, "--exact-series", set_, *cut, "--integrity"]
import ingest_coded  # noqa: E402
import quality  # noqa: E402

ingest = ingest_coded.ingest
today, built = ingest.lossy_args, ingest.integrity
ingest.lossy_args = lambda *a: today(*a) + TILES[arm]
rows = out / f"{id_}.quality.jsonl"
rows.unlink(missing_ok=True)


def measured(s, header, i, px, cut_):
    r = built(s, header, i, px, cut_)
    source = s.frame(i)[..., 0].astype(np.int64)
    stored = (px[..., 0] if cut_ else px[..., 0] - s.offset).astype(source.dtype)
    d = (stored << (s.stored - ingest.CUT_DEPTH if cut_ else 0)) - source
    sig = quality.sigma(source)
    with open(rows, "a") as f:
        f.write(json.dumps({"frame": i, "e": quality.rms(d), "max": int(np.abs(d).max()),
                            "eNOverSigma": quality.noise_band(d) / sig if sig > 0 else None, "sigma": sig,
                            "built": {k: r[k] for k in ("rms", "max", "noiseBandRatio")}}) + "\n")
    return r


ingest.integrity = measured
ingest_coded.main()
subprocess.run([tip / "target/release/pack-series", "--metadata", out / id_ / "metadata.json", "--frames", out / id_,
                "--output", out / f"{id_}.sbnd"], check=True, capture_output=True)
(out / id_ / "metadata.json").rename(out / f"{id_}.metadata.json")
