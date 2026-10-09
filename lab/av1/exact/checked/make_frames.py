#!/usr/bin/env python3
"""The frame check's series for total-time's run.mjs: each set through the product's ingest, as HTJ2K and as the
optimized AV1 payload, every frame's digest from the ingest's metadata, and the variants that serve them:

  htj2k, chk        the HTJ2K frames, unchecked and checked
  av1chk            the AV1 payloads, checked, through the decoder the product picks
  av1dchk           the same, through dav1d-WASM alone (WebCodecs taken away)
  av1mchk           where the top is over 10 bits: the top through dav1d, its low through WebCodecs (`mixed`)

usage: make_frames.py BUILD OUT SETDIR ... [--frames N] — lab/av1/exact/checked/README.md
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
NO_WEBCODECS = "/client/contract/webcodecs-spy.js?mode=none"


def ingest(build, src, out, codec, frames):
    if (out / "metadata.json").exists():
        return json.loads((out / "metadata.json").read_text())
    args = [sys.executable, ROOT / "ingest/coded-frames/ingest.py", build, src, out, "--codec", codec, "--jobs", "3"]
    if codec == "av1":
        args += ["--representation", "optimized", "--preset", "good:6"]
    subprocess.run([*map(str, args), *(["--frames", str(frames)] if frames else [])], check=True)
    return json.loads((out / "metadata.json").read_text())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", type=Path, nargs="+")
    ap.add_argument("--frames", type=int)
    a = ap.parse_args()
    for src in a.sets:
        dst = a.out.resolve() / src.name
        h = ingest(a.build, src, dst / "htj2k", "htj2k", a.frames)
        v = ingest(a.build, src, dst / "av1", "av1", a.frames)
        n = h["frameCount"]
        for i in range(n):
            for codec in ("htj2k", "av1"):
                link = dst / f"{i:03d}.{codec}"
                link.unlink(missing_ok=True)
                link.symlink_to(dst / codec / f"{i:03d}.{codec}")
        av1 = dict(ext="av1", digests=v["digests"]["frames"])
        variants = dict(htj2k={}, chk=dict(ext="htj2k", codec="htj2k", digests=h["digests"]["frames"]),
                        av1chk=av1, av1dchk=dict(av1, worker=NO_WEBCODECS))
        if (dst / "000.av1").read_bytes()[2] > 10:
            variants["av1mchk"] = dict(av1, mixed=True)
        truth = [(src / f"{i:03d}.sha256").read_text().strip() for i in range(n)]
        entry = dict(name=src.name, frames=n, truth=truth, variants=variants)
        (dst / "variants.json").write_text(json.dumps(entry, indent=1))
        print(src.name, n, "frames", flush=True)


if __name__ == "__main__":
    main()
