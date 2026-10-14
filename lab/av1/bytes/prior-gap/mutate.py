#!/usr/bin/env python3
"""pocgap.py's checks, each broken on purpose: every line after the first must show the check failing.

usage: mutate.py BUILD WORK   — after pocgap.py has written its derived sets under WORK.
"""
import json
import os
import sys
from pathlib import Path

os.environ["FRAMES"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pocgap  # noqa: E402

build, work = Path(sys.argv[1]), Path(sys.argv[2])
Set, run = pocgap.llsize.size.Set, pocgap.llsize.run_coding


def coded(s, rep="direct"):
    row = run(build, work / "mut", s, next(r for r in pocgap.llsize.representations(s) if r.name == rep), "cpu6")
    return f"{row['exact']}/{row['frames']} {row['verdict']}"


u8 = Set(work / "sets" / "dbt10_d_u8")
print("8-bit copy as built:", coded(u8))
u8.truth[0] = "0" * 64
print("8-bit copy, its checksum corrupted:", coded(u8))

full = Set(work / "sets" / "dbt10_d_full")
full.frame = lambda i, f=full.frame: f(i) ^ (f(i) == 0)  # every background zero becomes one
print("uncropped, its samples changed after the checksum:", coded(full))
low2 = Set(work / "sets" / "dbt10_d_full")
low2_rep = next(r for r in pocgap.llsize.representations(low2) if r.name == "low2")
low2_rep.merge = lambda p: p[0] << 2
print("uncropped low2 without its low bits:",
      f"{run(build, work / 'mut', low2, low2_rep, 'cpu6')['verdict']}")

spec = next(s for s in json.loads((pocgap.HERE.parents[2] / "data.json").read_text())["sets"] if s["name"] == "dbt10_d")
spec["crop"] = [spec["crop"][0] + 1, *spec["crop"][1:]]
try:
    pocgap.uncropped(spec, Set(pocgap.DATA / "dbt10_d"))
    print("crop off by a row: NOT CAUGHT")
except SystemExit as e:
    print("crop off by a row:", e)
