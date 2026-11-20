#!/usr/bin/env python3
"""A series' first N frames as a series of its own, `<id>-p<N>`, beside it in DIR as scripts/demo-series.sh lays
them out (DIR/<id>/ frames, DIR/<id>.metadata.json, DIR/<id>.sbnd): the prefix forms of
docs/client/evidence/delivery-comparison.md §3, for both series of a pair.

    lab/delivery/prefix.py DIR ID N [--pack target/release/pack-series]
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def prefix_metadata(meta, n, exact_id=None):
    """The metadata of the first n frames; a view's exact series renamed to its own prefix."""
    if n > meta["frameCount"]:
        raise SystemExit(f"a prefix of {n} frames from a series of {meta['frameCount']}")
    group = (meta.get("lossy") or {}).get("g")
    if group and n % group:
        raise SystemExit(f"a prefix of {n} frames cuts a group of {group}")
    out = {**meta, "frameCount": n}
    if "digests" in meta:
        out["digests"] = {**meta["digests"], "frames": meta["digests"]["frames"][:n]}
    if exact_id:
        out["exactSeries"] = exact_id
    return out


def main(argv):
    p = argparse.ArgumentParser()
    p.add_argument("dir", type=Path)
    p.add_argument("id")
    p.add_argument("n", type=int)
    p.add_argument("--pack", default="target/release/pack-series")
    a = p.parse_args(argv)
    src = a.dir / a.id
    meta = json.loads((src / "metadata.json").read_text())
    name = f"{a.id}-p{a.n}"
    out = a.dir / name
    out.mkdir(exist_ok=True)
    frames = sorted(f for f in src.iterdir() if f.name != "metadata.json" and f.name[:3].isdigit())
    for f in frames:
        if int(f.name[:3]) < a.n and not (out / f.name).exists():
            (out / f.name).symlink_to(f.resolve())
    exact = f"{meta['exactSeries']}-p{a.n}" if meta.get("exactSeries") else None
    text = json.dumps(prefix_metadata(meta, a.n, exact), indent=1)
    (out / "metadata.json").write_text(text)
    (a.dir / f"{name}.metadata.json").write_text(text)
    subprocess.run([a.pack, "--metadata", out / "metadata.json", "--frames", out, "--output", a.dir / f"{name}.sbnd"],
                   check=True, stdout=subprocess.DEVNULL)
    print(a.dir / f"{name}.sbnd")


if __name__ == "__main__":
    main(sys.argv[1:])
