#!/usr/bin/env python3
"""Row GREY420's frames: each 8-bit grey series as ingest.py writes it three ways — HTJ2K, AV1 4:0:0 (today's)
and AV1 4:2:0 at full range (--grey8 420) — laid out for lab/av1/exact/engines/run.mjs (manifest.json) and
lab/av1/delivery/total-time/run.mjs (SET/arms.json). Every payload was checked exact by ingest.py; the truth is the source's checksum.

usage: make_frames.py INGEST OUT SET [SET …] [--frames N]   — lab/av1/delivery/grey-420/README.md
  INGEST holds SET.htj2k/, SET.mono/ and SET.420/, each ingest.py's output for that set.
"""
import argparse
import json
import shutil
from pathlib import Path

FORMS = {"htj2k": ("htj2k", "htj2k"), "mono": ("mono", "av1"), "420": ("420", "av1")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ingest", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", nargs="+")
    ap.add_argument("--frames", type=int)
    a = ap.parse_args()
    manifest = []
    for name in a.sets:
        dirs = {form: a.ingest / f"{name}.{form}" for form in FORMS}
        n = min(len(list(d.glob("*.sha256"))) for d in dirs.values())
        n = min(n, a.frames or n)
        truth = [(dirs["htj2k"] / f"{i:03d}.sha256").read_text().split()[0] for i in range(n)]
        for form, d in dirs.items():
            if [(d / f"{i:03d}.sha256").read_text().split()[0] for i in range(n)] != truth:
                raise SystemExit(f"{name}: {form} was written from other sources")
        out = a.out / name
        out.mkdir(parents=True, exist_ok=True)
        for form, (ext, codec) in FORMS.items():
            for i in range(n):
                shutil.copy(dirs[form] / f"{i:03d}.{codec}", out / f"{i:03d}.{form}.{codec}")
        arms = {form: {"ext": f"{form}.{codec}"} for form, (_, codec) in FORMS.items()}
        (out / "arms.json").write_text(json.dumps(dict(name=name, frames=n, truth=truth, arms=arms), indent=1) + "\n")
        # The decode harness also times each AV1 form through dav1d-WASM alone (`.d`: no VideoDecoder).
        timed = {**arms, **{f"{f}.d": {**arms[f], "webcodecs": False} for f in ("mono", "420")}}
        manifest.append(dict(name=name, frames=[dict(truth=t) for t in truth], arms=timed))
        sizes = {f: sum((out / f"{i:03d}.{f}.{c}").stat().st_size for i in range(n)) for f, (_, c) in FORMS.items()}
        print(name, n, "frames", sizes, f"420/mono {sizes['420'] / sizes['mono']:.5f}", flush=True)
    (a.out / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")


if __name__ == "__main__":
    main()
