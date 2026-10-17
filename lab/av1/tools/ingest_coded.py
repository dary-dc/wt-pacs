#!/usr/bin/env python3
"""A set as lab/av1/fetch_data.py writes it (NNN.raw, NNN.sha256, metadata.json), coded through the product's
ingest (ingest/coded-frames/ingest.py's `coded()`): OUT/NNN.av1 or OUT/NNN.htj2k, OUT/NNN.sha256 and
OUT/metadata.json ("codec": "av1" for AV1), which pack-series bundles; nothing unless every frame decodes back.

usage: ingest_coded.py BUILD SET_DIR OUT [--codec av1|htj2k] [--representation plain|optimized] [--split K]
                       [--grey8 400|420] [--preset cpu0|good:N|allintra:N] [--frames N] [--jobs N]   — ingest/coded-frames/README.md
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
    ap.add_argument("--codec", choices=list(ingest.CODECS), default="av1")
    ap.add_argument("--representation", choices=["plain", "optimized"], default="optimized")
    ap.add_argument("--split", type=int)
    ap.add_argument("--grey8", choices=["400", "420"], default="400")
    ap.add_argument("--preset", default="cpu0")
    ap.add_argument("--frames", type=int)
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    s = size.Set(a.set_dir)
    n = min(a.frames or s.n, s.n)
    try:
        payloads = ingest.coded(a.build, s, n, a.codec, a.jobs, a.representation, a.split, a.preset, a.grey8)
    except ingest.Refused as e:
        sys.exit(f"{a.set_dir.name}: nothing written — {e}")
    a.out.mkdir(parents=True, exist_ok=True)
    for i, data in payloads:
        (a.out / f"{i:03d}.{a.codec}").write_bytes(data)
        shutil.copy(a.set_dir / f"{i:03d}.sha256", a.out / f"{i:03d}.sha256")
    meta = json.loads((a.set_dir / "metadata.json").read_text())
    meta.update(frameCount=n, digests=ingest.digests(s, n, a.codec, a.representation, a.split, a.grey8))
    if a.codec == "av1":
        meta.update(codec="av1", representation=a.representation)
    if a.codec == "av1" and a.split is not None:
        meta["split"] = a.split
    (a.out / "metadata.json").write_text(json.dumps(meta, indent=1) + "\n")
    total = sum(len(d) for _, d in payloads)
    digest = hashlib.sha256(b"".join(d for _, d in payloads)).hexdigest()[:12]
    kind = a.representation if a.codec == "av1" else "htj2k"
    print(f"{a.set_dir.name}: {n} payloads, {total} B, {kind}, every one exact ({digest})")


if __name__ == "__main__":
    main()
