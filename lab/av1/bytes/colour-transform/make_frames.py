#!/usr/bin/env python3
"""RGBNATIVE's frames: each colour set as HTJ2K and as AV1 payloads in GBR (plain) and the reversible colour transform
(optimized), one file per frame and arm, with arms.json (row TOTAL's harness) and manifest.json (the decode harness).

Payloads are written by ingest/coded-frames/ingest.py, which writes nothing unless native dav1d decodes every one back to its
source. RGB ships at cpu0 (payload-format.md).

usage: make_frames.py BUILD OUT SETDIR ... [--preset cpu0] [--jobs 4]   — lab/av1/bytes/colour-transform/README.md
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parents[1] / "decode/per-frame"))
from make_frames import htj2k  # noqa: E402
from size import Set  # noqa: E402

ARMS = {"gbr": "plain", "rct": "optimized"}


def htj2k_frames(src, dst):
    s = Set(src)
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(s.n):
            if not (dst / f"{i:03d}.htj2k").exists():
                htj2k(s, i, Path(tmp), dst / f"{i:03d}.htj2k")


def payloads(build, src, out, arm, preset):
    dst = out / ".payloads" / src.name / f"{arm}.{preset.replace(':', '')}"
    if not (dst / "metadata.json").exists():
        subprocess.run([sys.executable, HERE.parents[3] / "ingest/coded-frames/ingest.py", build, src, dst, "--representation", ARMS[arm],
                        "--preset", preset, "--jobs", "1"], check=True, capture_output=True)
    return dst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", type=Path, nargs="+")
    ap.add_argument("--preset", default="cpu0")
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    build, out = a.build.resolve(), a.out.resolve()
    with ThreadPoolExecutor(a.jobs) as pool:
        work = []
        for src in a.sets:
            s = Set(src)
            dst = out / s.name
            dst.mkdir(parents=True, exist_ok=True)
            work.append((s, dst, pool.submit(htj2k_frames, src, dst),
                         {arm: pool.submit(payloads, build, src, out, arm, a.preset) for arm in ARMS}))
        manifest = []
        for s, dst, h, arms in work:
            h.result()
            entry = dict(name=s.name, frames=s.n, preset=a.preset, truth=s.truth, arms={"htj2k": {}},
                         bytes={"htj2k": sum((dst / f"{i:03d}.htj2k").stat().st_size for i in range(s.n))})
            for arm, f in arms.items():
                made = f.result()
                for i in range(s.n):
                    link = dst / f"{i:03d}.{arm}.av1"
                    link.unlink(missing_ok=True)
                    os.link(made / f"{i:03d}.av1", link)
                entry["arms"][arm] = dict(ext=f"{arm}.av1")
                entry["bytes"][arm] = sum((dst / f"{i:03d}.{arm}.av1").stat().st_size for i in range(s.n))
            (dst / "arms.json").write_text(json.dumps(entry, indent=1))
            manifest.append(dict(name=s.name, arms=entry["arms"], frames=[dict(truth=t) for t in s.truth]))
            ratio = ", ".join(f"{n} {v / entry['bytes']['htj2k']:.3f}" for n, v in entry["bytes"].items() if n != "htj2k")
            print(f"{s.name}: {s.n} frames, over HTJ2K {ratio}", flush=True)
    (out / "manifest.json").write_text(json.dumps(manifest))


if __name__ == "__main__":
    main()
