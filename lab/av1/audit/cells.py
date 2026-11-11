#!/usr/bin/env python3
"""Protocols A and B's shared cells, B1's split halves and B2's injected noise (docs/av1/audit-protocols.md §Shared
cells, §B amendment 1), on the groups protocol's own cell code at claude/av1-groups-settings 0e0e58c8, unchanged.

usage: GROUPS_DIR=<checkout of 0e0e58c8>/lab/av1/groups cells.py BUILD WORK OUT.jsonl SETDIR ... [--g 1 16]
       [--jobs 4] [--memory-gb 13.5] [--mutate]     (--mutate: only the check's --cpu-used=5 encode, then exit)
"""
import argparse
import json
import os
import subprocess
import sys
import zlib
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, os.environ["GROUPS_DIR"])
import cell  # noqa: E402
import plan  # noqa: E402
from bytes import Middle  # noqa: E402

metrics, quality = cell.metrics, cell.metrics.quality
LADDER = {12: range(4, 13), 10: range(6, 17)}
CHECK_Q = {12: (4, 8, 12), 10: (4, 8, 12, 16)}
TIMED = ("dbts_a1", "dbts_b1", "dbts_c1")
TILE, MIDDLE_FRAMES, ADDED = 64, 8, (0.5, 1.0)
STUDY = "2f04f648"
MUTANT = ("dbt12_ea1141", 8)


def audit_cells(name, b, g):
    """The protocol's ladder for one volume at one G; the timed volumes have no G 16 (groups §S4 covers them)."""
    if g > 1 and name in TIMED:
        return []
    return [dict(arm="O", g=g, q=q, src="real", bands=False, keep=False, vdp=False) for q in LADDER[b]]


def halves(shape):
    y, x = np.indices(shape)
    zero = (y // TILE + x // TILE) % 2 == 0
    return zero, ~zero


def window(meta, s, v):
    table = metrics.display(meta, (1 << s.b) - 1)[0]
    return (table[v - s.offset] > 0) & (table[v - s.offset] < 255)


def measure_with_halves(s, form, meta, decoded, shift=0, shown=None):
    """The groups measure(), unchanged, plus each frame's e_N on the two checkerboard halves."""
    split = []

    def tee():
        for i, p in enumerate(decoded):
            v = s.frame(i)[..., 0].astype(np.int32) + s.offset
            d = (form.back(p)[..., 0] - v).astype(np.float64)
            inside = window(meta, s, v)
            split.append([quality.noise_band(d, inside & h) for h in halves(v.shape)])
            yield p

    rows = MEASURE(s, form, meta, tee(), shift, shown)
    for r, h in zip(rows, split):
        r["err_noise_band_halves"] = h
    return rows


MEASURE, metrics.measure = metrics.measure, measure_with_halves


def split(job):
    """Per volume, no encode: σ on each half of every frame (B1), and σ re-read after injected noise (B2)."""
    path, work = job
    s = Middle(Path(path), 0)
    meta = json.loads((Path(work) / f"{s.name}.display.json").read_text())
    top, first = (1 << s.b) - 1, max(0, (s.n - MIDDLE_FRAMES) // 2)
    sig, injected = [], []
    for i in range(s.n):
        v = s.frame(i)[..., 0].astype(np.int32) + s.offset
        inside = window(meta, s, v)
        sig.append([quality.sigma(v, inside & h) for h in halves(v.shape)])
        if first <= i < first + MIDDLE_FRAMES:
            base = quality.sigma(v, inside)
            for k, share in enumerate(ADDED):
                rng = np.random.default_rng([zlib.crc32(s.name.encode()), i, k])
                noisy = v + np.rint(rng.normal(0, share * base, v.shape)).astype(np.int32)
                clipped = int(((noisy < 0) | (noisy > top)).sum())
                got = quality.sigma(np.clip(noisy, 0, top), inside)
                b = (got ** 2 - base ** 2) / ((share * base) ** 2 + 1 / 12) - 1
                injected.append(dict(frame=i, share=share, sigma=base, sigma_noisy=got, b=b, clipped=clipped))
    return dict(kind="split", set=s.name, sigma_halves=sig, injected=injected)


def study_units():
    """The quality study's stored-form G 1 unit sizes by (volume, Q), read from its committed rows."""
    out = {}
    for k in (1, 2, 3, 4):
        text = subprocess.run(["git", "show", f"{STUDY}:lab/av1/metrics/rows/shard-{k}.jsonl"], capture_output=True,
                              check=True, text=True, cwd=os.environ["GROUPS_DIR"]).stdout
        for r in map(json.loads, text.splitlines()):
            if r["kind"] == "cell" and r["g"] == 1 and r["form"].endswith("bit") and r["form"][:-3].isdigit():
                out[(r["set"], r["q"])] = r["units"]
    return out


def checked(row, study, b):
    """None when the row is no check rung; else whether its units equal the study's, frame for frame."""
    if row["kind"] not in ("cell", "check") or row["g"] != 1 or row["q"] not in CHECK_Q[b]:
        return None
    return row["units"] == study.get((row["set"], row["q"]))


def order(sets, depth, gs):
    """The three timed volumes' check rungs first, then each G's cells volume by volume, check rungs first."""
    first, rest = [], []
    for g in gs:
        for p in sets:
            n = Path(p).name
            cs = sorted(audit_cells(n, depth[n], g), key=lambda c: (c["q"] not in CHECK_Q[depth[n]], c["q"]))
            take = first if g == 1 and n in TIMED else rest
            take += [(p, c) for c in cs if c["q"] in CHECK_Q[depth[n]]]
            rest += [(p, c) for c in cs if c["q"] not in CHECK_Q[depth[n]]]
    return first + rest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("work", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", nargs="+")
    ap.add_argument("--g", type=int, nargs="+", default=[1, 16])
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--memory-gb", type=float, default=13.5)
    ap.add_argument("--mutate", action="store_true")
    a = ap.parse_args()
    a.build, a.work = a.build.resolve(), a.work.resolve()
    a.work.mkdir(parents=True, exist_ok=True)
    plan.MIDDLE.clear()  # read every series whole, as the quality study did; the pool's workers fork after this
    depth = {}
    for p in a.sets:
        s = Middle(Path(p), 0)
        depth[s.name], plan.FRAME_MPX[s.name] = s.b, s.w * s.h * s.ch
        meta = cell.display_windows(cell.ROOT / "lab/av1/data.json", s.name, Path(p).parent)
        (a.work / f"{s.name}.display.json").write_text(json.dumps(meta))
    study = study_units()
    rows = [json.loads(r) for r in a.out.open()] if a.out.exists() else []
    done = {plan.key(r["set"], r) for r in rows if r["kind"] == "cell"}
    have = {(r["kind"], r["set"]) for r in rows}
    emit = lambda fh, row: (fh.write(json.dumps(row) + "\n"), fh.flush())
    with open(a.out, "a") as fh, ProcessPoolExecutor(a.jobs) as pool:
        if a.mutate:
            p = next(p for p in a.sets if Path(p).name == MUTANT[0])
            c = dict(arm="O", g=1, q=MUTANT[1], src="real", kind="check", tag="cpu5", extra=["--cpu-used=5"])
            row = cell.run((a.build, a.work, p, c, None))
            ok = checked(row, study, depth[MUTANT[0]])
            emit(fh, dict(row, study_equal=ok))
            print(f"mutation --cpu-used=5: study_equal={ok} (must be False)", flush=True)
            sys.exit(0 if ok is False else 1)
        for kind, fn in (("series", cell.series), ("split", split)):
            todo = [(p, a.work) for p in a.sets if (kind, Path(p).name) not in have]
            for row in pool.map(fn, todo):
                emit(fh, row)
                print(row["set"], kind, flush=True)
        todo = [(a.build, a.work, p, c, None) for p, c in order(a.sets, depth, a.g)
                if plan.key(Path(p).name, c) not in done]
        need = lambda j: (max(0.5, cell.MEASURE_GB_PER_FRAME_MPX) * plan.FRAME_MPX[Path(j[2]).name] / 1e6
                          + cell.WORKER_GB)
        print(f"{len(todo)} cells", flush=True)
        for row in cell.scheduled(pool, todo, need, a.memory_gb, a.jobs):
            ok = checked(row, study, depth[row["set"]])
            emit(fh, dict(row, study_equal=ok) if ok is not None else row)
            print(cell.line(row), "" if ok is None else f"study_equal={ok}", flush=True)
            if ok is False:
                sys.exit(f"{row['set']} Q {row['q']}: units differ from the quality study; the run stops")


if __name__ == "__main__":
    main()
