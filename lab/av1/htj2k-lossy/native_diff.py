#!/usr/bin/env python3
"""Cell E's native leg: each lossy frame decoded by native ojph_expand against dump.mjs's WASM samples.

usage: native_diff.py BUILD STREAMS_DIR    (after: node dump.mjs STREAMS_DIR/lossy-*.j2c)
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

build, d = Path(sys.argv[1]), Path(sys.argv[2])
env = {**os.environ, "LD_LIBRARY_PATH": str(build / "openjph/lib")}
out = []
with tempfile.TemporaryDirectory() as t:
    for cs in sorted(d.glob("lossy-*.j2c")):
        subprocess.run([build / "openjph/bin/ojph_expand", "-i", cs, "-o", f"{t}/n.pgm"], check=True,
                       capture_output=True, env=env)
        head, body = Path(f"{t}/n.pgm").read_bytes().split(b"\n", 3)[1:3], None
        w, h = map(int, head[0].split())
        native = np.frombuffer(Path(f"{t}/n.pgm").read_bytes()[-w * h * 2:], ">u2").astype(np.int32)
        wasm = np.fromfile(f"{cs}.wasm.u16", "<u2").astype(np.int32)
        diff = native - wasm
        out.append(dict(frame=cs.name, samples=int(diff.size), differ=int(np.count_nonzero(diff)),
                        max_abs=int(np.abs(diff).max()), mean=float(diff.mean())))
print(json.dumps(out))
