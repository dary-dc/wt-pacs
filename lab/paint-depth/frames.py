"""Previews for the paint-depth check: one frame of each DBT set reduced to its top bits, as raw samples.

usage: frames.py DATA OUT   — docs/decode/paint-depth.md §Paint depth, built
"""
import json
import sys
from pathlib import Path

import numpy as np

CASES = [("dbts_a1", 2), ("dbts_b1", 0), ("dbts_b1", 2), ("dbts_c1", 2)]


def main(data, out):
    out.mkdir(parents=True, exist_ok=True)
    cases = []
    for name, shift in CASES:
        m = json.loads((data / name / "metadata.json").read_text())
        index = m["frameCount"] // 2
        v = np.fromfile(data / name / f"{index:03d}.raw", "<u2").reshape(m["height"], m["width"]).astype(np.int64)
        bits = max(8, m["bitsStored"] - shift)
        # lab/av1/delivery/residual/encode.py to_preview_grey, the clamp at the preview's own depth.
        p = np.minimum((v + ((1 << shift) >> 1)) >> shift, (1 << bits) - 1)
        key = f"{name}-k{shift}"
        p.astype("<u2" if bits > 8 else "u1").tofile(out / f"{key}.raw")
        cases.append(dict(key=key, set=name, frame=index, width=m["width"], height=m["height"], bits=bits,
                          shift=shift, bias=0, stored=m["bitsStored"], min=int(p.min()), max=int(p.max())))
    (out / "cases.json").write_text(json.dumps(cases, indent=1))


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
