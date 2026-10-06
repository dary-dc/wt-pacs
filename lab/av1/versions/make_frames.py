#!/usr/bin/env python3
"""VERSIONS' frames: each series' first N frames as the served HTJ2K (OpenJPH 0.31.0) and as the optimized AV1
item at the series' shipped preset, with manifest.json for decode.mjs. Every HTJ2K frame is encoded by OpenJPH
0.32.0 too and must come out byte-identical; every item is checked by ingest.py through native dav1d.

usage: make_frames.py BUILD OUT SETDIR@PRESET ... [--frames 4] [--jobs 4]   — lab/av1/versions/README.md
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
from size import Set, pnm  # noqa: E402

PROFILE = ["-num_decomps", "5", "-block_size", "{64,64}", "-prog_order", "RPCL", "-reversible", "true"]


def same_codestream(build, s, i, served):
    """OpenJPH 0.32.0's codestream of frame i, against 0.31.0's as served (unsigned series only)."""
    new = build / "ojph-0.32.0/install"
    with tempfile.TemporaryDirectory() as tmp:
        src, out = Path(tmp) / ("in.pgm" if s.ch == 1 else "in.ppm"), Path(tmp) / "out.j2c"
        pnm(s, i, src)
        subprocess.run([new / "bin/ojph_compress", "-i", src, "-o", out, *PROFILE], check=True, capture_output=True,
                       env={"LD_LIBRARY_PATH": str(new / "lib")})
        return out.read_bytes() == served.read_bytes()


def series(build, out, spec, frames):
    src, _, preset = spec.partition("@")
    src = Path(src)
    s = Set(src)
    preset = preset or "cpu0"
    n = min(frames, s.n)
    dst = out / s.name
    dst.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(n):
            if not (dst / f"{i:03d}.htj2k").exists():
                htj2k(s, i, Path(tmp), dst / f"{i:03d}.htj2k")
    same = sum(same_codestream(build, s, i, dst / f"{i:03d}.htj2k") for i in range(n)) if not s.signed else None
    items = out / ".items" / s.name
    if not (items / "metadata.json").exists():
        subprocess.run([sys.executable, HERE.parent / "item/ingest.py", build, src, items, "--preset", preset,
                        "--frames", str(n), "--jobs", "1"], check=True, capture_output=True)
    for i in range(n):
        shutil.copyfile(items / f"{i:03d}.av1", dst / f"{i:03d}.av1")
    size = lambda ext: sum((dst / f"{i:03d}.{ext}").stat().st_size for i in range(n))  # noqa: E731
    print(f"{s.name}: {n} frames, {preset}, item over HTJ2K {size('av1') / size('htj2k'):.3f}, "
          f"OpenJPH 0.32.0 codestreams identical {same}/{n}", flush=True)
    return dict(name=s.name, preset=preset, ojph032_identical=same, bytes=dict(htj2k=size("htj2k"), av1=size("av1")),
                frames=[dict(truth=t) for t in s.truth[:n]])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", nargs="+")
    ap.add_argument("--frames", type=int, default=4)
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    build, out = a.build.resolve(), a.out.resolve()
    with ThreadPoolExecutor(a.jobs) as pool:
        manifest = list(pool.map(lambda spec: series(build, out, spec, a.frames), a.sets))
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
