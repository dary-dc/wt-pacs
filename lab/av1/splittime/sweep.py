#!/usr/bin/env python3
"""The shipped preset, re-found per series and k: the fastest of `--allintra` 9…6 and good 6…3 whose
bytes on the first two frames are within 2 % of cpu0's, then the whole series at it. Encodes run
`--jobs` at once, so their seconds rank the presets and are not uncontended times (row 14's are).

usage: sweep.py BUILD FRAMES SETDIR ... [--jobs 4] [--out sweep.json]
       FRAMES is make_frames.py's cpu0 OUT (its arms and HTJ2K bytes) — lab/av1/splittime/README.md
"""
import argparse
import json
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
CANDIDATES = ["allintra:9", "allintra:8", "allintra:7", "allintra:6", "good:6", "good:5", "good:4", "good:3"]
WITHIN = 1.02


def encode(build, src, k, preset, frames, out):
    t0 = time.monotonic()
    args = ["--frames", str(frames)] if frames else []
    subprocess.run([sys.executable, HERE.parent / "item/ingest.py", build, src, out, "--split", str(k), "--preset", preset,
                    "--jobs", "1", *args], check=True, capture_output=True)
    return sum(p.stat().st_size for p in out.glob("*.av1")), time.monotonic() - t0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("frames", type=Path)
    ap.add_argument("sets", type=Path, nargs="+")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()
    build = a.build.resolve()
    rows = []
    with tempfile.TemporaryDirectory() as tmp, ThreadPoolExecutor(a.jobs) as pool:
        cells = []
        for src in a.sets:
            entry = json.loads((a.frames / src.name / "arms.json").read_text())
            two = min(2, entry["frames"])
            for arm in (x for x in entry["arms"] if x != "htj2k"):
                k = int(arm[1:])
                ref = sum((a.frames / src.name / f"{i:03d}.{arm}.av1").stat().st_size for i in range(two))
                tries = {p: pool.submit(encode, build, src, k, p, two, Path(tmp) / f"{src.name}.{arm}.{p}") for p in CANDIDATES}
                cells.append((src, entry, arm, k, ref, tries))
        for src, entry, arm, k, ref, tries in cells:
            got = {p: f.result() for p, f in tries.items()}
            ok = [p for p in CANDIDATES if got[p][0] <= ref * WITHIN]
            pick = min(ok, key=lambda p: got[p][1]) if ok else "cpu0"
            whole = encode(build, src, k, pick, None, Path(tmp) / f"{src.name}.{arm}.whole")[0] if pick != "cpu0" else entry["bytes"][arm]
            row = dict(set=src.name, arm=arm, names=entry["names"][arm], preset=pick,
                       two={p: [round(b / ref, 4), round(s, 1)] for p, (b, s) in got.items()},
                       cpu0=round(entry["bytes"][arm] / entry["bytes"]["htj2k"], 4),
                       shipped=round(whole / entry["bytes"]["htj2k"], 4))
            rows.append(row)
            print(f"{src.name} {arm} ({'/'.join(row['names'])}): {pick}, over HTJ2K cpu0 {row['cpu0']} shipped {row['shipped']}",
                  flush=True)
    if a.out:
        a.out.write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
