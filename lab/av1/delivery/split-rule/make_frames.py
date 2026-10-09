#!/usr/bin/env python3
"""SPLITTIME's frames: each series as HTJ2K and as AV1 payloads at every arm's split k, one file per frame and
arm, with arms.json (row TOTAL's harness) and manifest.json (the decode harness) beside them.

Arms are named by k: d12 is k = max(0, b − 12), w10 k = max(0, b − 10), and k = 2 and k = 3, each run once
however many names it has and only where its top fits a 12-bit stream. Payloads are written by
ingest/coded-frames/ingest.py --split K, which writes nothing unless native dav1d decodes every one back to its
source; `--reuse DIR` takes ingest's output from row 43's run (DIR/SET/kK.PRESET) where it exists.

usage: make_frames.py BUILD OUT SETDIR ... [--preset cpu0|good:N|allintra:N] [--reuse DIR] [--jobs 4] [--k 2]
       — lab/av1/delivery/split-rule/README.md
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parents[1] / "decode/per-frame"))
from make_frames import htj2k  # noqa: E402
from size import Set  # noqa: E402


def bits(s):
    return max(1, int(s.hi + s.offset).bit_length())


def arms(b):
    """k: the names it answers to."""
    named = {}
    for name, k in (("d12", max(0, b - 12)), ("k2", 2), ("k3", 3), ("w10", max(0, b - 10))):
        if b - k <= 12:
            named.setdefault(k, []).append(name)
    return dict(sorted(named.items()))


def payloads(build, src, out, k, preset, reuse):
    tag = f"k{k}.{preset.replace(':', '')}"
    have = reuse and reuse / src.name / tag
    if have and (have / "metadata.json").exists():
        return have
    dst = out / ".items" / src.name / tag
    if not (dst / "metadata.json").exists():
        subprocess.run([sys.executable, HERE.parents[3] / "ingest/coded-frames/ingest.py", build, src, dst, "--split", str(k),
                        "--preset", preset, "--jobs", "1"], check=True, capture_output=True)
    return dst


def htj2k_frames(src, dst):
    s = Set(src)
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(s.n):
            if not (dst / f"{i:03d}.htj2k").exists():
                htj2k(s, i, Path(tmp), dst / f"{i:03d}.htj2k")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", type=Path, nargs="+")
    ap.add_argument("--preset", default="cpu0")
    ap.add_argument("--reuse", type=Path)
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--k", type=int, help="this split alone, not every arm")
    a = ap.parse_args()
    build, out = a.build.resolve(), a.out.resolve()
    with ThreadPoolExecutor(a.jobs) as pool, ProcessPoolExecutor(a.jobs) as procs:
        work = []
        for src in a.sets:
            s = Set(src)
            dst = out / s.name
            dst.mkdir(parents=True, exist_ok=True)
            work.append((src, s, dst, procs.submit(htj2k_frames, src, dst),
                         {k: pool.submit(payloads, build, src, out, k, a.preset, a.reuse) for k in arms(bits(s)) if a.k in (None, k)}))
        manifest = []
        for src, s, dst, h, ks in work:
            h.result()
            entry = dict(name=s.name, frames=s.n, bits=bits(s), preset=a.preset, truth=s.truth, arms={"htj2k": {}},
                         names={}, bytes={"htj2k": sum((dst / f"{i:03d}.htj2k").stat().st_size for i in range(s.n))})
            for k, f in ks.items():
                made = f.result()
                for i in range(s.n):
                    shutil.copyfile(made / f"{i:03d}.av1", dst / f"{i:03d}.k{k}.av1")
                entry["arms"][f"k{k}"] = dict(ext=f"k{k}.av1")
                entry["names"][f"k{k}"] = arms(entry["bits"])[k]
                entry["bytes"][f"k{k}"] = sum((dst / f"{i:03d}.k{k}.av1").stat().st_size for i in range(s.n))
            (dst / "arms.json").write_text(json.dumps(entry, indent=1))
            manifest.append(dict(name=s.name, arms=entry["arms"], frames=[dict(truth=t) for t in s.truth]))
            ratio = ", ".join(f"{n} {v / entry['bytes']['htj2k']:.3f}" for n, v in entry["bytes"].items() if n != "htj2k")
            print(f"{s.name}: {s.n} frames, {entry['bits']} bits, over HTJ2K {ratio}", flush=True)
    (out / "manifest.json").write_text(json.dumps(manifest))


if __name__ == "__main__":
    main()
