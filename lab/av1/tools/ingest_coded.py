#!/usr/bin/env python3
"""A set as lab/av1/fetch_data.py writes it (NNN.raw, NNN.sha256, metadata.json), coded through the product's
ingest (ingest/coded-frames/ingest.py's `coded()`): OUT/NNN.av1 or OUT/NNN.htj2k, OUT/NNN.sha256 and
OUT/metadata.json ("codec": "av1" for AV1), which pack-series bundles; nothing unless every frame decodes back.
With --lossy Q G, optimal quality paired with the exact series --exact-series names; --depth-cut codes it at 10 bits.

usage: ingest_coded.py BUILD SET_DIR OUT [--codec av1|htj2k] [--representation plain|optimized] [--split K]
                       [--grey8 400|420] [--preset cpu0|good:N|allintra:N] [--frames N] [--jobs N]
                       [--lossy Q G --exact-series ID [--depth-cut]]   — ingest/coded-frames/README.md
"""
import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "ingest/coded-frames"))
sys.path.insert(0, str(ROOT / "lab/av1"))
import ingest  # noqa: E402
import size  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("set_dir", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--codec", choices=["av1", "htj2k"], default="av1")
    ap.add_argument("--representation", choices=["plain", "optimized"], default="optimized")
    ap.add_argument("--split", type=int)
    ap.add_argument("--grey8", choices=["400", "420"], default="400")
    ap.add_argument("--preset", default="cpu0")
    ap.add_argument("--frames", type=int)
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--lossy", type=int, nargs=2, metavar=("Q", "G"))
    ap.add_argument("--exact-series")
    ap.add_argument("--depth-cut", action="store_true")
    a = ap.parse_args()
    if bool(a.lossy) != bool(a.exact_series) or (a.lossy and (a.codec != "av1" or a.split is not None)):
        ap.error("--lossy Q G and --exact-series ID go together, with --codec av1 and no --split")
    if a.depth_cut and not a.lossy:
        ap.error("--depth-cut is a form of --lossy")
    s = size.Set(a.set_dir)
    n = min(a.frames or s.n, s.n)
    try:
        payloads = ingest.coded(a.build, s, n, a.codec, a.jobs, a.representation, a.split, a.preset, a.grey8, a.lossy and (*a.lossy, a.depth_cut))
    except ingest.Refused as e:
        sys.exit(f"{a.set_dir.name}: nothing written — {e}")
    a.out.mkdir(parents=True, exist_ok=True)
    for i, data in payloads:
        (a.out / f"{i:03d}.{a.codec}").write_bytes(data)
        if not a.lossy:
            shutil.copy(a.set_dir / f"{i:03d}.sha256", a.out / f"{i:03d}.sha256")
    meta = json.loads((a.set_dir / "metadata.json").read_text())
    meta.update(frameCount=n)
    if a.lossy:
        q, g = a.lossy
        lossy = dict(q=q, g=g, depth=ingest.lossy_header(s, q, g, a.depth_cut)["depth"])
        if a.depth_cut:
            lossy["bitsStored"] = s.stored
        meta.update(codec="av1", lossy=lossy, exactSeries=a.exact_series)
    else:
        meta.update(digests=ingest.digests(s, n, a.codec, a.representation, a.split, a.grey8))
    if a.codec == "av1" and not a.lossy:
        meta.update(codec="av1", representation=a.representation)
    if a.codec == "av1" and a.split is not None:
        meta["split"] = a.split
    (a.out / "metadata.json").write_text(json.dumps(meta, indent=1) + "\n")
    total = sum(len(d) for _, d in payloads)
    digest = hashlib.sha256(b"".join(d for _, d in payloads)).hexdigest()[:12]
    if a.lossy:
        print(f"{a.set_dir.name}: {n} payloads, {total} B, optimal quality Q {q} G {a.lossy[1]}{' cut to 10 bits' if a.depth_cut else ''}, every one decoded ({digest})")
    else:
        kind = a.representation if a.codec == "av1" else "htj2k"
        print(f"{a.set_dir.name}: {n} payloads, {total} B, {kind}, every one exact ({digest})")


if __name__ == "__main__":
    main()
