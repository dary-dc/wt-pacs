#!/usr/bin/env python3
"""DECODE's frames: each series' first N frames as the served HTJ2K and as the optimized AV1 item at PRESET, with
manifest.json for run.mjs. Every frame is checked natively against its source's checksum before it is kept.

usage: make_frames.py BUILD OUT SETDIR@PRESET ... [--frames 4] [--jobs 4]   — lab/av1/decode/README.md
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "speed"))
from make_frames import htj2k  # noqa: E402
from size import Set  # noqa: E402


def series(build, out, spec, frames):
    src, _, preset = spec.partition("@")
    s = Set(Path(src))
    n = min(frames, s.n)
    dst = out / s.name
    dst.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(n):
            if not (dst / f"{i:03d}.htj2k").exists():
                htj2k(s, i, Path(tmp), dst / f"{i:03d}.htj2k")
    items = out / ".items" / s.name
    if not (items / "metadata.json").exists():
        subprocess.run([sys.executable, HERE.parent / "item/ingest.py", build, src, items, "--representation", "optimized",
                        "--preset", preset or "cpu0", "--frames", str(n), "--jobs", "4"], check=True, capture_output=True)
    for i in range(n):
        shutil.copyfile(items / f"{i:03d}.av1", dst / f"{i:03d}.av1")
    # One arms.json for lab/av1/total's fill and lab/av1/footprint's memory: each codec before and after row 49.
    before = dict(worker="/lab/.av1-work/decode/before/decoder.js", probeWorker="/lab/av1/decode/before-probed.js")
    arms = {"htj2k": {}, "htj2k-before": dict(codec="htj2k", ext="htj2k", **before), "av1": {}, "av1-before": dict(ext="av1", **before)}
    (dst / "arms.json").write_text(json.dumps(dict(name=s.name, frames=n, truth=s.truth[:n], arms=arms), indent=1))
    print(f"{s.name}: {n} frames of {s.w}x{s.h}x{s.ch}, {s.stored}-bit, {preset or 'cpu0'}", flush=True)
    return dict(name=s.name, preset=preset or "cpu0", frames=[dict(truth=t) for t in s.truth[:n]])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", nargs="+")
    ap.add_argument("--frames", type=int, default=4)
    ap.add_argument("--jobs", type=int, default=2)
    a = ap.parse_args()
    build, out = a.build.resolve(), a.out.resolve()
    with ThreadPoolExecutor(a.jobs) as pool:
        manifest = list(pool.map(lambda spec: series(build, out, spec, a.frames), a.sets))
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
