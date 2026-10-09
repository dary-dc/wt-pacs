#!/usr/bin/env python3
"""The shipped preset, re-found per series and k: the fastest of `--allintra` 9…6 and good 6…3 whose
bytes on the first two frames are within 2 % of cpu0's, then the whole series at it — and, if the whole
series is not within 2 % of cpu0's, the next fastest, until one is (row 33 found two frames can
mislead: the CT's a6). Encodes run `--jobs` at once, so their seconds rank the presets and are not
uncontended times (row 14's are).

usage: sweep.py BUILD FRAMES SETDIR ... [--jobs 4] [--out sweep.json] [--confirm]
       --confirm only redoes the whole-series step on --out's rows over 2 %
       FRAMES is make_frames.py's cpu0 OUT (its variants and HTJ2K bytes) — lab/av1/delivery/split-rule/README.md
"""
import argparse
import json
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
CANDIDATES = ["allintra:9", "allintra:8", "allintra:7", "allintra:6", "good:6", "good:5", "good:4", "good:3"]
WITHIN = 1.02


def encode(build, src, k, preset, frames, out):
    t0 = time.monotonic()
    args = ["--frames", str(frames)] if frames else []
    subprocess.run([sys.executable, HERE.parents[3] / "ingest/coded-frames/ingest.py", build, src, out, "--split", str(k), "--preset", preset,
                    "--jobs", "1", *args], check=True, capture_output=True)
    return sum(p.stat().st_size for p in out.glob("*.av1")), time.monotonic() - t0


def confirm(build, frames, sets, rows, tmp, jobs):
    """Each row whose whole series is over 2 %: the candidates by their two-frame speed until one is within it."""
    def one(row):
        entry = json.loads((frames / row["set"] / "variants.json").read_text())
        src = next(p for p in sets if p.name == row["set"])
        tried = {row["preset"]: row["shipped"]}
        for p in sorted(CANDIDATES, key=lambda p: row["two"][p][1]):
            if p in tried:
                continue
            tried[p] = round(encode(build, src, int(row["variant"][1:]), p, None, tmp / f"{row['set']}.{row['variant']}.{p}")[0]
                             / entry["bytes"]["htj2k"], 4)
            if tried[p] <= row["cpu0"] * WITHIN:
                break
        ok = [p for p, v in tried.items() if v <= row["cpu0"] * WITHIN]
        row["whole"] = tried
        row["preset"], row["shipped"] = (ok[-1], tried[ok[-1]]) if ok else ("cpu0", row["cpu0"])
        print(f"{row['set']} {row['variant']}: confirmed {row['preset']}, over HTJ2K {row['shipped']} (tried {tried})", flush=True)
    with ThreadPoolExecutor(jobs) as pool:
        list(pool.map(one, [r for r in rows if r["shipped"] > r["cpu0"] * WITHIN]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("frames", type=Path)
    ap.add_argument("sets", type=Path, nargs="+")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--confirm", action="store_true")
    a = ap.parse_args()
    build = a.build.resolve()
    if a.confirm:
        rows = json.loads(a.out.read_text())
        with tempfile.TemporaryDirectory() as tmp:
            confirm(build, a.frames, a.sets, rows, Path(tmp), a.jobs)
        a.out.write_text(json.dumps(rows, indent=1))
        return
    rows = []
    with tempfile.TemporaryDirectory() as tmp, ThreadPoolExecutor(a.jobs) as pool:
        cells = []
        for src in a.sets:
            entry = json.loads((a.frames / src.name / "variants.json").read_text())
            two = min(2, entry["frames"])
            for variant in (x for x in entry["variants"] if x != "htj2k"):
                k = int(variant[1:])
                ref = sum((a.frames / src.name / f"{i:03d}.{variant}.av1").stat().st_size for i in range(two))
                tries = {p: pool.submit(encode, build, src, k, p, two, Path(tmp) / f"{src.name}.{variant}.{p}") for p in CANDIDATES}
                cells.append((src, entry, variant, k, ref, tries))
        for src, entry, variant, k, ref, tries in cells:
            got = {p: f.result() for p, f in tries.items()}
            ok = [p for p in CANDIDATES if got[p][0] <= ref * WITHIN]
            pick = min(ok, key=lambda p: got[p][1]) if ok else "cpu0"
            whole = encode(build, src, k, pick, None, Path(tmp) / f"{src.name}.{variant}.whole")[0] if pick != "cpu0" else entry["bytes"][variant]
            row = dict(set=src.name, variant=variant, names=entry["names"][variant], preset=pick,
                       two={p: [round(b / ref, 4), round(s, 1)] for p, (b, s) in got.items()},
                       cpu0=round(entry["bytes"][variant] / entry["bytes"]["htj2k"], 4),
                       shipped=round(whole / entry["bytes"]["htj2k"], 4))
            rows.append(row)
            print(f"{src.name} {variant} ({'/'.join(row['names'])}): {pick}, over HTJ2K cpu0 {row['cpu0']} shipped {row['shipped']}",
                  flush=True)
    if a.out:
        a.out.write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
