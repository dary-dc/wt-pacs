#!/usr/bin/env python3
"""P2's encodes (docs/lines/proposals.md §P2, amendment 1): ingest_coded.py on the demo tip, its lossy_args given the
arm's tile options at its end and nothing else changed; then pack-series, as scripts/demo-series.sh does.

usage: p2_encode.py TIP ARM SET ID Q G [--depth-cut]     ARM: one | 2x2 | 2x1; writes OUT=$P2_OUT/ARM/ID.{sbnd,metadata.json}
"""
import os
import subprocess
import sys
from pathlib import Path

TILES = {"one": [], "2x2": ["--tile-columns=1", "--tile-rows=1"], "2x1": ["--tile-columns=1", "--tile-rows=0"]}

tip, arm, set_, id_, q, g, *cut = sys.argv[1:]
tip, out = Path(tip), Path(os.environ["P2_OUT"]) / arm
sys.path.insert(0, str(tip / "lab/av1/tools"))
sys.argv = ["ingest_coded.py", str(tip / "ingest/.build"), str(tip / "lab/av1/data" / set_), str(out / id_), "--jobs",
            str(os.cpu_count()), "--lossy", q, g, "--exact-series", set_, *cut]
import ingest_coded  # noqa: E402

today = ingest_coded.ingest.lossy_args
ingest_coded.ingest.lossy_args = lambda *a: today(*a) + TILES[arm]
ingest_coded.main()
subprocess.run([tip / "target/release/pack-series", "--metadata", out / id_ / "metadata.json", "--frames", out / id_,
                "--output", out / f"{id_}.sbnd"], check=True, capture_output=True)
(out / id_ / "metadata.json").rename(out / f"{id_}.metadata.json")
