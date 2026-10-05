#!/usr/bin/env python3
"""llsize.py's checks, each broken on purpose: every line printed must show the check failing.

usage: mutate.py BUILD WORK   — fluoroscopy and the ultrasound, two frames each.
"""
import os
import sys
from pathlib import Path

os.environ["FRAMES"] = "2"
sys.path.insert(0, str(Path(__file__).resolve().parent))
import llsize  # noqa: E402

build, work = Path(sys.argv[1]), Path(sys.argv[2])
data = Path(__file__).resolve().parents[1] / "data"


def run(s, rep, variant="aom"):
    row = llsize.run_coding(build, work, s, rep, variant)
    return f"{row['exact']}/{row['frames']}, alone {row['last_alone']}"


grey = llsize.size.Set(data / "rf_fluoro")
low2 = next(r for r in llsize.representations(grey) if r.name == "low2")
print("low2 as built:", run(grey, low2))
print("low2 merged at the wrong shift:", run(grey, llsize.Rep("low2", low2.planes, lambda p: (p[0] << 1) | p[1])))
print("low2 without its low bits:", run(grey, llsize.Rep("low2", low2.planes, lambda p: p[0] << 2)))
grey.truth[1] = "0" * 64
print("one truth checksum corrupted:", run(grey, low2))

rgb = llsize.size.Set(data / "us_liver")
rct = next(r for r in llsize.representations(rgb) if r.name == "rct")
print("rct as built:", run(rgb, rct))
print("rct's inverse rounding the other way:",
      run(rgb, llsize.Rep("rct", rct.planes, lambda p: llsize.np.stack([
          p[0][..., 2] - 256 + p[0][..., 0] - ((p[0][..., 1] + p[0][..., 2] - 511) >> 2),
          p[0][..., 0] - ((p[0][..., 1] + p[0][..., 2] - 511) >> 2),
          p[0][..., 1] - 256 + p[0][..., 0] - ((p[0][..., 1] + p[0][..., 2] - 511) >> 2)], -1))))
ycocg = next(r for r in llsize.representations(rgb) if r.name == "ycocg-r")
print("ycocg-r with Co and Cg swapped back:", run(rgb, llsize.Rep("ycocg-r", ycocg.planes,
                                                                    lambda p: ycocg.merge([p[0][..., [0, 2, 1]]]))))
