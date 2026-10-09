#!/usr/bin/env python3
"""HELPERSTART's two series in both harnesses' shapes: total-time sets with the three arms, and a builds.mjs fixture.

usage: sets.py OUT G512_FIXTURE_DIR PROJECTIONS_SET_DIR PROJECTIONS_DATA_DIR   — lab/decode-bench/helper-start/README.md
"""
import json
import shutil
import sys
from pathlib import Path

ARMS = {a: dict(ext="htj2k", codec="htj2k", openjph=a) for a in ("ref", "cb2", "cb2late")}


def main():
    out, g512, proj, data = (Path(a).resolve() for a in sys.argv[1:5])
    frames = sorted(g512.glob("*.j2c"))
    dst = out / "g512"
    dst.mkdir(parents=True, exist_ok=True)
    for i, f in enumerate(frames):
        shutil.copyfile(f, dst / f"{i:03d}.htj2k")
    truth = [f.with_suffix(".sha256").read_text().strip() for f in frames]
    (dst / "variants.json").write_text(json.dumps(dict(name="g512", frames=len(frames), bits=16, truth=truth, variants=ARMS), indent=1))

    s = json.loads((proj / "variants.json").read_text())
    s["variants"] = ARMS
    (proj / "variants.json").write_text(json.dumps(s, indent=1))
    fx = out / f"decode_{s['name']}"
    fx.mkdir(exist_ok=True)
    m = json.loads((data / "metadata.json").read_text())
    meta = dict(frameCount=m["frameCount"], width=m["width"], height=m["height"], channels=m["channels"], maxValue=m["max"])
    (fx / "metadata.json").write_text(json.dumps(meta) + "\n")
    for i, t in enumerate(s["truth"]):
        shutil.copyfile(proj / f"{i:03d}.htj2k", fx / f"{i:03d}.j2c")
        (fx / f"{i:03d}.sha256").write_text(t + "\n")
    print(dst, len(frames), "frames;", fx, s["frames"], "frames")


if __name__ == "__main__":
    main()
