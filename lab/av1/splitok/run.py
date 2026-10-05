#!/usr/bin/env python3
"""Every set make_sets.py wrote, at every split k of its depth's matrix and every preset, through
ingest.py — which writes nothing unless native dav1d decodes each item back to its source.

  ITEMS/{b}{u|s}/{geometry}/k{K}.{preset}/NNN.av1 …   and ITEMS/native.json, a row a cell

usage: run.py BUILD SETS ITEMS [--presets cpu0,allintra:7] [--ks all|2,3,b-10] [--jobs 4]   — README.md
"""
import argparse
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from make_sets import splits  # noqa: E402


def ks(b, which):
    if which == "all":
        return list(splits(b))
    named = {"b-10": max(0, b - 10)}
    return sorted({named.get(k) if k in named else int(k) for k in which.split(",")} & set(splits(b)))


def cell(job):
    build, src, out, k, preset, name = job
    r = subprocess.run([sys.executable, HERE.parent / "item/ingest.py", build, src, out, "--split", str(k),
                        "--preset", preset, "--jobs", "1"], capture_output=True, text=True)
    meta = json.loads((src / "metadata.json").read_text())
    said = (r.stdout + r.stderr).strip().splitlines()
    return dict(set=name, bits=meta.get("bits"), signed=meta["signed"], k=k, preset=preset,
                frames=meta["frameCount"], exact=r.returncode == 0, said=said[-1] if said else "", dir=str(out))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("sets", type=Path)
    ap.add_argument("items", type=Path)
    ap.add_argument("--presets", default="cpu0,allintra:7")
    ap.add_argument("--ks", default="all")
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    jobs = []
    for src in sorted(p.parent for p in a.sets.glob("**/metadata.json")):
        name = str(src.relative_to(a.sets))
        meta = json.loads((src / "metadata.json").read_text())
        b = meta.get("bits") or max(1, int(meta["max"] - min(meta["min"], 0)).bit_length())
        for k in ks(b, a.ks):
            for preset in a.presets.split(","):
                out = a.items / name / f"k{k}.{preset.replace(':', '')}"
                jobs.append((a.build.resolve(), src, out, k, preset, name))
    with ThreadPoolExecutor(a.jobs) as pool:
        rows = list(pool.map(cell, jobs))
    a.items.mkdir(parents=True, exist_ok=True)
    (a.items / "native.json").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    exact = [r for r in rows if r["exact"]]
    print(f"native dav1d: {len(exact)}/{len(rows)} cells exact, {sum(r['frames'] for r in exact)} frames")
    for r in rows:
        if not r["exact"]:
            print(f"  {r['set']} k={r['k']} {r['preset']}: {r['said']}")


if __name__ == "__main__":
    main()
