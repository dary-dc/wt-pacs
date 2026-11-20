#!/usr/bin/env python3
"""Row SPLITPREVIEWB's bytes stage (split-preview-b.md §Protocol, stage 2): bytes.py's cells for the forms top8,
top8at10 and 10bit on system B, one item at a time, the forms alternating in one pool; and the 10bit anchor
streams the decode reads, coded again and checked unit for unit against the bytes run.

usage: split_preview_bytes.py BUILD WORK OUT_DIR --item 1|2|3|4|streams|b_max [--keep DIR] [--jobs 4]
       split_preview_bytes.py BUILD WORK OUT_DIR --check C1|C2|C3|C4 [--mutate]
"""
import argparse
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from itertools import zip_longest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bytes as run  # noqa: E402
import split_preview_report as report  # noqa: E402

DATA = HERE.parent / "data"
SERIES = [f"dbts_b{k}" for k in range(1, 6)]
ANCHORS = (16, 32)


def interleaved(by_form):
    """One list from each form's cells, the forms taking turns."""
    return [c for group in zip_longest(*by_form.values()) for c in group if c]


def cells(item, out):
    if item == 1:
        return interleaved({"top8": [(s, "top8", q, 1) for s in SERIES for q in (12, 16, 24, 32)],
                            "10bit": [(s, "10bit", q, 1) for s in SERIES for q in (12, 24)]})
    if item == 2:
        pairs = report.partners(report.rows(out))
        return sorted({(s, "top8", p["q"], 16) for (s, _), p in pairs.items()})
    if item == 3:
        return [(s, "top8", q, 1) for q in (8, 56) for s in SERIES]
    if item == 4:
        return interleaved({"top8at10": [(s, "top8at10", q, 1) for s in ("dbts_b2", "dbts_b5") for q in ANCHORS],
                            "top8": []})
    if item == "b_max":
        return interleaved({"top8": [("dbts_b_max", "top8", q, 1) for q in ANCHORS],
                            "10bit": [("dbts_b_max", "10bit", q, 1) for q in ANCHORS]})
    if item == "streams":
        return [(s, "10bit", q, g) for s in SERIES for q in ANCHORS for g in (1, 16)]
    raise SystemExit(f"no item {item}")


def prepare(a, names):
    for name in names:
        s = run.Middle(DATA / name, 0)
        meta = run.display_windows(run.ROOT / "lab/av1/data.json", s.name, DATA)
        (a.work / f"{s.name}.display.json").write_text(json.dumps(meta))


def stream(job):
    """A bytes-run cell coded again for the decode only: its units and frames kept, its unit sizes checked."""
    build, work, keep, name, form_name, q, g = job
    s = run.Middle(DATA / name, 0)
    form = next(f for f in run.forms(s, []) if f.name == form_name)
    d = Path(work) / f"stream-{name}-{form_name}-q{q}-g{g}"
    d.mkdir(parents=True, exist_ok=True)
    y4m, ivf, dec = d / "in.y4m", d / "out.ivf", d / "dec.y4m"
    run.write_y4m(s, form, y4m)
    run.child([build / f"aom-{run.AOM}/bin/aomenc", "-o", ivf, f"--limit={s.n}", "--disable-warning-prompt",
               *run.aomenc_args(form, q, g, s.n), y4m])
    y4m.unlink()
    units = run.ingest.ivf_units(ivf)
    run.child([build / "dav1d/bin/dav1d", "-q", "--threads=1", "-i", ivf, "-o", dec])
    run.kept(Path(keep) / name / f"{form_name}-q{q}-g{g}", units, dec, s, form)
    want = report.bytes_run(name, form_name, q, g)
    for f in d.iterdir():
        f.unlink()
    d.rmdir()
    return dict(set=name, form=form_name, q=q, g=g, units=[len(u) for u in units],
                same_as_bytes_run=want is not None and [len(u) for u in units] == want["lossy"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("work", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--item")
    ap.add_argument("--check")
    ap.add_argument("--mutate", action="store_true")
    ap.add_argument("--keep", type=Path)
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    a.build, a.work, a.out = a.build.resolve(), a.work.resolve(), a.out.resolve()
    a.work.mkdir(parents=True, exist_ok=True)
    a.out.mkdir(parents=True, exist_ok=True)
    if a.check:
        return check(a)
    item = int(a.item) if a.item.isdigit() else a.item
    todo = cells(item, a.out)
    prepare(a, sorted({c[0] for c in todo}))
    if item == "streams":
        path = a.out / "streams.jsonl"
        done = {(r["set"], r["form"], r["q"], r["g"]) for r in report.jsonl(path)}
        jobs = [(a.build, str(a.work), str(a.keep), *c) for c in todo if c not in done]
        fn = stream
    else:
        path = a.out / "cells.jsonl"
        done = {(r["set"], r["form"], r["q"], r["g"]) for r in report.jsonl(path)}
        keep = str(a.keep) if a.keep else None
        jobs = [(a.build, str(a.work), str(DATA / s), 0, f, q, g, False, None, False, keep)
                for s, f, q, g in todo if (s, f, q, g) not in done]
    print(f"item {item}: {len(jobs)} cells", flush=True)
    with open(path, "a") as fh, ProcessPoolExecutor(a.jobs) as pool:
        for row in pool.map(fn if item == "streams" else run.cell, jobs):
            row["item"] = item
            fh.write(json.dumps(row) + "\n")
            fh.flush()
            print(json.dumps({k: row.get(k) for k in ("set", "form", "q", "g", "psnr", "exact_frames", "same_as_bytes_run")}),
                  flush=True)


def uncoded(name, floor):
    """The top 8 bits shown back at 10 bits with no coder between: their mean square, and the v mod 4 prediction."""
    s = run.Middle(DATA / name, 0)
    sse = hist = 0
    weights = np.array([0, 1, 4, 1], np.float64)
    for i in range(s.n):
        v = s.frame(i).astype(np.int64)[..., 0] + s.offset
        p = (v >> 2) if floor else np.minimum((v + 2) >> 2, 255)
        sse += float(np.sum((v - (p << 2)) ** 2))
        w = weights[v & 3]
        w[v == 1022], w[v == 1023] = 4.0, 9.0
        hist += float(w.sum())
    n = s.n * s.w * s.h
    return dict(mean_square=sse / n, from_histogram=hist / n, psnr=run.psnr(sse / n, 1023), same=abs(sse - hist) / n < 1e-9)


def check(a):
    """C1–C4 on dbts_b2, as §Checks states them; with --mutate, the check's mutation. One JSON line out."""
    name = "dbts_b2"
    prepare(a, [name])
    path = str(DATA / name)
    job = lambda form, q, g, mutate=None, aomdec=False: (a.build, str(a.work), path, 0, form, q, g, aomdec, mutate, False)
    if a.check == "C1":
        r = run.cell(job("10bit", 33 if a.mutate else 32, 1))
        want = report.bytes_run(name, "10bit", 32, 1)
        same = r["lossy"] == want["lossy"] and abs(r["psnr"] - want["psnr"]) < 1e-3
        res = dict(bytes=sum(r["lossy"]), want=sum(want["lossy"]), psnr=r["psnr"], want_psnr=want["psnr"], same=same)
    elif a.check == "C2":
        res = dict(series={n: uncoded(n, a.mutate) for n in SERIES})
        res["same"] = all(x["same"] for x in res["series"].values())
    elif a.check == "C3" and a.mutate:
        lossy = run.cell(job("top8", 16, 1, "lowbits"))
        own = run.cell(job("top8", 0, 1, "splittop"))
        res = dict(lossy_top_exact=lossy["exact_frames"], own_top_exact=own["exact_frames"], frames=own["frames"])
    elif a.check in ("C3", "C4"):
        r = run.cell(job("top8", 16, 1, "shift0" if a.mutate else None, aomdec=True))
        res = dict(psnr=r["psnr"], exact=r["exact_frames"], frames=r["frames"], aomdec_matches=r["aomdec_matches"])
    print(json.dumps(dict(check=a.check, mutated=a.mutate, **res)), flush=True)


if __name__ == "__main__":
    main()
