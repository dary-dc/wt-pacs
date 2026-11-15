#!/usr/bin/env python3
"""MOBILE-OPT-HTJ2K-LOSSY Cell B (docs/decode/mobile/htj2k-lossy.md §4): each volume coded as irreversible HTJ2K at a
ladder of base steps, measured by the quality study's harness, the ladder bracketed around the noise rule's bar.

usage: measure.py HARNESS BUILD WORK DATA OUT.jsonl [--sets a,b] [--jobs 4]
       HARNESS is a checkout of claude/av1-noise-ratio at 0a9d33ca; BUILD holds ingest/tools.sh's openjph.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

VOLUMES = ["dbts_a1", "dbts_b1", "dbts_c1", "dbt12_ea1141", "dbts_b2", "dbts_c4", "dbts_a3", "dbts_a4", "dbts_a5",
           "dbts_b4", "dbt10_d", "dbt12_c", "dbts_a2", "dbts_c2", "dbts_c3", "dbts_c5", "dbt10_ea1141", "dbts_b3",
           "dbts_b5"]
LADDER = {12: [8, 16, 24, 32, 48, 64], 10: [2, 4, 6, 8, 12, 16]}
SETTINGS = ["-num_decomps", "5", "-block_size", "{64,64}", "-prog_order", "RPCL"]
BAR, BAR_WIDE, EXTENSIONS = 1.00, 1.03, 3


def load_harness(path):
    sys.path.insert(0, str(Path(path) / "lab/av1/metrics"))
    import cell
    return cell


def stored_form(cell):
    return sys.modules["bytes"].Form("stored", 0, 0, True, None, lambda p: p[0].astype(np.int32)[..., None])


def write_pgm(v, bits, path):
    with open(path, "wb") as fh:
        fh.write(b"P5\n%d %d\n%d\n" % (v.shape[1], v.shape[0], (1 << bits) - 1))
        fh.write(v.astype(">u2").tobytes())


def read_pgm(path, h, w):
    return np.frombuffer(Path(path).read_bytes()[-h * w * 2:], ">u2").reshape(h, w).astype(np.int32)


def code(build, v, bits, delta, tmp):
    """One frame through ojph_compress and ojph_expand: (codestream bytes, decoded samples or None)."""
    env = {**os.environ, "LD_LIBRARY_PATH": str(build / "openjph/lib")}
    src, cs, out = tmp / "in.pgm", tmp / "f.j2c", tmp / "out.pgm"
    write_pgm(v, bits, src)
    lossy = ["-reversible", "false", "-qstep", f"{delta / (1 << bits):.10f}"] if delta else ["-reversible", "true"]
    subprocess.run([build / "openjph/bin/ojph_compress", "-i", src, "-o", cs, *SETTINGS, *lossy], check=True,
                   capture_output=True, env=env)
    size = cs.stat().st_size
    if not delta:
        return size, None
    subprocess.run([build / "openjph/bin/ojph_expand", "-i", cs, "-o", out], check=True, capture_output=True, env=env)
    return size, read_pgm(out, *v.shape)


def cell_row(job):
    build, work, path, delta = job
    t0 = time.perf_counter()
    s = CELL.Middle(Path(path), 0)
    meta = json.loads((Path(work) / f"{s.name}.display.json").read_text())
    sizes, decoded = [], []
    with tempfile.TemporaryDirectory(dir=work) as d:
        for i in range(s.n):
            v = s.frame(i)[..., 0].astype(np.int32) + s.offset
            size, x = code(build, v, s.stored, delta, Path(d))
            sizes.append(size)
            decoded.append(x)
    t1 = time.perf_counter()
    frames = CELL.measure(s, FORM, meta, ([x] for x in decoded)) if delta else None
    return dict(kind="cell", set=s.name, form="htj2k-irv" if delta else "htj2k-rev", delta=delta, bits=s.stored,
                qstep=delta / (1 << s.stored), bytes=sizes, code_wall=t1 - t0, measure_wall=time.perf_counter() - t1,
                frames=frames, harness="0a9d33ca", openjph="0.31.0 c68064d0")


def worst(row, sigma):
    return max(f["err_noise_band"] / x for f, x in zip(row["frames"], sigma))


def extend(deltas, got, depth):
    """DEPTH8-MEASURE's A3 on Δ: up by ×1.5 while the largest passes 1.03, down by ÷1.5 while the smallest fails 1.00."""
    base = set(LADDER[depth])
    add = set()
    top, low = max(got), min(got)
    if got[top] <= BAR_WIDE and len([d for d in deltas if d > max(base)]) < EXTENSIONS:
        add.add(round(top * 1.5, 3))
    if got[low] > BAR and len([d for d in deltas if d < min(base)]) < EXTENSIONS:
        add.add(round(low / 1.5, 3))
    return add - set(deltas)


def main():
    global CELL, FORM
    ap = argparse.ArgumentParser()
    for name in ("harness", "build", "work", "data", "out"):
        ap.add_argument(name, type=Path)
    ap.add_argument("--sets", default=",".join(VOLUMES))
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    CELL = load_harness(a.harness)
    FORM = stored_form(CELL)
    a.work.mkdir(parents=True, exist_ok=True)
    names = a.sets.split(",")
    for n in names:
        meta = CELL.display_windows(a.harness / "lab/av1/data.json", n, a.data)
        (a.work / f"{n}.display.json").write_text(json.dumps(meta))
    rows = [json.loads(r) for r in a.out.open()] if a.out.exists() else []
    with open(a.out, "a") as fh, ProcessPoolExecutor(a.jobs, initializer=_init, initargs=(a.harness,)) as pool:
        def emit(row):
            rows.append(row)
            fh.write(json.dumps(row) + "\n")
            fh.flush()
            print(row["set"], row.get("form", row["kind"]), row.get("delta", ""), flush=True)

        todo = [n for n in names if not any(r["kind"] == "series" and r["set"] == n for r in rows)]
        for row in pool.map(_series, [str(a.data / n) for n in todo], [str(a.work)] * len(todo)):
            emit(row)
        while True:
            jobs = []
            for n in names:
                series = next(r for r in rows if r["kind"] == "series" and r["set"] == n)
                done = {r["delta"]: r for r in rows if r["kind"] == "cell" and r["set"] == n}
                depth = 12 if series["bits_stored"] > 10 else 10
                want = {0, *LADDER[depth]}
                lossy = {d: worst(r, series["sigma"]) for d, r in done.items() if d}
                if want <= set(done):
                    want |= extend(sorted(done), lossy, depth)
                jobs += [(a.build, str(a.work), str(a.data / n), d) for d in sorted(want - set(done))]
            if not jobs:
                break
            for row in pool.map(cell_row, jobs):
                emit(row)


def _init(harness):
    global CELL, FORM
    CELL = load_harness(harness)
    FORM = stored_form(CELL)


def _series(path, work):
    return CELL.series_row(path, work)


if __name__ == "__main__":
    main()
