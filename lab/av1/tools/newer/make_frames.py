#!/usr/bin/env python3
"""VERSIONS' frames: each series' first N frames as the served HTJ2K (OpenJPH 0.31.0) and as the optimized AV1
payload at the series' shipped preset, with manifest.json for decode.mjs. Every HTJ2K frame is encoded by OpenJPH
0.32.0 too and must come out byte-identical; every payload is checked by ingest.py through native dav1d.

usage: make_frames.py BUILD OUT SETDIR@PRESET ... [--frames 4] [--jobs 4]   — lab/av1/tools/newer/README.md
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
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parents[1] / "decode/per-frame"))
from make_frames import htj2k  # noqa: E402
from size import Set, pnm  # noqa: E402

PROFILE = ["-num_decomps", "5", "-block_size", "{64,64}", "-prog_order", "RPCL", "-reversible", "true"]


def same_codestream(build, s, i, served):
    """OpenJPH 0.32.0's codestream of frame i, against 0.31.0's as served (unsigned series only), comments aside."""
    new = build / "ojph-0.32.0/install"
    with tempfile.TemporaryDirectory() as tmp:
        src, out = Path(tmp) / ("in.pgm" if s.ch == 1 else "in.ppm"), Path(tmp) / "out.j2c"
        pnm(s, i, src)
        subprocess.run([new / "bin/ojph_compress", "-i", src, "-o", out, *PROFILE], check=True, capture_output=True,
                       env={"LD_LIBRARY_PATH": str(new / "lib")})
        return without_comment(out.read_bytes()) == without_comment(served.read_bytes())


def without_comment(j2c):
    """The codestream with its main header's COM segments cut: OpenJPH writes its version there."""
    out, i = bytearray(j2c[:2]), 2
    while j2c[i:i + 2] != b"\xff\x90":
        n = 2 + int.from_bytes(j2c[i + 2:i + 4], "big")
        if j2c[i:i + 2] != b"\xff\x64":
            out += j2c[i:i + n]
        i += n
    return bytes(out + j2c[i:])


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
    payloads = out / ".items" / s.name
    if not (payloads / "metadata.json").exists():
        split = ["--split", str(s.stored - 12)] if s.stored > 12 else []
        subprocess.run([sys.executable, HERE.parents[3] / "ingest/coded-frames/ingest.py", build, src, payloads, "--preset", preset,
                        "--frames", str(n), "--jobs", "1", *split], check=True, capture_output=True)
    for i in range(n):
        shutil.copyfile(payloads / f"{i:03d}.av1", dst / f"{i:03d}.av1")
    size = lambda ext: sum((dst / f"{i:03d}.{ext}").stat().st_size for i in range(n))  # noqa: E731
    print(f"{s.name}: {n} frames, {preset}, payload over HTJ2K {size('av1') / size('htj2k'):.3f}, "
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
