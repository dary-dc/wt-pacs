#!/usr/bin/env python3
"""Cells D and E's inputs (docs/decode/mobile/htj2k-lossy.md §4): a volume's middle 16 frames as lossless and lossy
HTJ2K codestreams and as the AV1 view at Q 8 G 8, one file a frame, with the samples' SHA-256 for the lossy frames.

usage: streams.py HARNESS BUILD DATA OUT SET DELTA
"""
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import measure  # noqa: E402

FRAMES, Q, G = 16, 8, 8


def main():
    harness, build, data, out, name, delta = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), \
        Path(sys.argv[4]), sys.argv[5], float(sys.argv[6])
    cell = measure.load_harness(harness)
    b = sys.modules["bytes"]
    s = cell.Middle(data / name, FRAMES)
    meta = cell.display_windows(harness / "lab/av1/data.json", name, data)
    form = next(f for f in b.forms(s, meta["windows"]) if f.name == ("top10" if s.b > 10 else f"{s.b}bit"))
    d = out / name
    d.mkdir(parents=True, exist_ok=True)
    digests = []
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        for i in range(s.n):
            v = s.frame(i)[..., 0].astype(np.int32) + s.offset
            measure.code(build, v, s.stored, 0, t)
            (t / "f.j2c").rename(d / f"lossless-{i:02d}.j2c")
            _, x = measure.code(build, v, s.stored, delta, t)
            (t / "f.j2c").rename(d / f"lossy-{i:02d}.j2c")
            digests.append(hashlib.sha256(x.astype("<u2").tobytes()).hexdigest())
        y4m, ivf = t / "in.y4m", t / "out.ivf"
        b.write_y4m(s, form, y4m)
        subprocess.run([build / f"aom-{b.AOM}/bin/aomenc", "-o", ivf, f"--limit={s.n}", "--disable-warning-prompt",
                        *b.aomenc_args(form, Q, G, s.n), y4m], check=True, capture_output=True)
        for i, unit in enumerate(b.ingest.ivf_units(ivf)):
            (d / f"av1-{i:02d}.obu").write_bytes(unit)
    (d / "streams.json").write_text(json.dumps(dict(set=name, first=s.first, frames=s.n, delta=delta, q=Q, g=G,
                                                    form=form.name, native_sha256=digests), indent=1))


if __name__ == "__main__":
    main()
