#!/usr/bin/env python3
"""DEPTH8-MEASURE (docs/av1/depth-cut-8.md §7): the 8-bit cut's forms added to the quality study's harness, its cells
run in the protocol's fixed order, and the plan extended until each volume's highest passing Q is bracketed.

usage: measure.py HARNESS BUILD WORK DATA OUT.jsonl --stage a|b [--jobs 4]
       HARNESS is a checkout of claude/av1-noise-ratio at the commit the rows record.
"""
import argparse
import json
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
STAGE_A = ["dbts_a1", "dbts_b1", "dbts_c1", "dbt12_ea1141", "dbts_b2", "dbts_c4"]
BAR, BAR_WIDE = 1.00, 1.03
NEUTRAL = 128
chroma_off = [0]


def code8(v, k):
    return np.minimum((v + (1 << (k - 1))) >> k, 255)


def cut_forms(harness_forms, form_cls):
    def forms(s, win):
        k = s.b - 8
        half = ((s.h + 1) // 2, (s.w + 1) // 2)
        grey = lambda v: [code8(v[..., 0], k), np.full(half, NEUTRAL), np.full(half, NEUTRAL)]
        back = lambda p: (p[0].astype(np.int32) << k)[..., None]

        def back_counting_chroma(p):
            chroma_off[0] += sum(int(np.count_nonzero(c != NEUTRAL)) for c in p[1:])
            return back(p)
        return harness_forms(s, win) + [form_cls("cut8", 8, 0, True, lambda v: [code8(v[..., 0], k)], back),
                                        form_cls("cut8-420", 8, 0, False, grey, back_counting_chroma)]
    return forms


def cut_args(harness_args):
    def args(form, q, g, n, altref=False):
        out = harness_args(form, q, g, n, altref)
        if form.name != "cut8-420":
            return out
        return out[:out.index("--bit-depth=8")] + ["--profile=0", "--bit-depth=8", "--input-bit-depth=8"]
    return args


def load_harness(path):
    sys.path.insert(0, str(Path(path) / "lab/av1/metrics"))
    import cell
    cell.forms = cut_forms(cell.forms, sys.modules["bytes"].Form)
    cell.aomenc_args = cut_args(cell.aomenc_args)
    return cell


def today(b):
    return "top10" if b > 10 else f"{b}bit"


def run_cell(job):
    chroma_off[0] = 0
    row = CELL.cell(job)
    if row["form"] == "cut8-420":
        row["chroma_off"] = chroma_off[0]
    return row


def cut_only(job):
    """The codes uncoded, measured as a cell: §7 P1."""
    _, work, path = job[:3]
    s = CELL.Middle(Path(path), 0)
    meta = json.loads((Path(work) / f"{s.name}.display.json").read_text())
    form = next(f for f in CELL.forms(s, meta["windows"]) if f.name == "cut8")
    codes = (form.fwd(s.frame(i).astype(np.int32) + s.offset) for i in range(s.n))
    frames = CELL.measure(s, form, meta, codes)
    mean = [float(np.mean(form.back(form.fwd(v)) - v))
            for v in (s.frame(i).astype(np.int32) + s.offset for i in range(s.n))]
    for f, m in zip(frames, mean):
        f["mean_err"] = m
    return dict(kind="cut_only", set=s.name, form="cut8", k=s.b - 8, frames=frames)


def worst(cell_row, sigma):
    return max(f["err_noise_band"] / x for f, x in zip(cell_row["frames"], sigma))


def initial(p, b):
    """§7 Stage A's Qs from predictions.json: cut8 from the independent Q to the removal Q + 1, both bars."""
    lo, hi = p["g1_bar1.00"], p["g1_bar1.03"]
    q8 = range(lo["cut8_independent"], max(lo["cut8_removal"], hi["cut8_removal"]) + 2)
    return {"cut8": set(q8), today(b): {lo["today"], lo["today"] + 1},
            "cut8-420": {lo["cut8_independent"], lo["cut8_removal"]}}


def bracket(plan, cells, sigma):
    """Amendment A3: extend each form's Qs until the highest tested fails 1.03 and the lowest passes 1.00."""
    for form in [f for f in plan if f != "cut8-420"]:
        got = {c["q"]: worst(c, sigma) for c in cells if c["form"] == form}
        if set(plan[form]) - set(got):
            continue
        if got[max(got)] <= BAR_WIDE:
            plan[form].add(max(got) + 1)
        if got[min(got)] > BAR and min(got) > 1:
            plan[form].add(min(got) - 1)
    return plan


def highest(cells, form, sigma, bar):
    return max((c["q"] for c in cells if c["form"] == form and worst(c, sigma) <= bar), default=None)


def order(plan):
    """Per volume the Qs ascending, each Q's forms in the order cut8, today's form, cut8-420."""
    rank = {"cut8": 0, "cut8-420": 2}
    return sorted(((q, f) for f, qs in plan.items() for q in qs), key=lambda u: (u[0], rank.get(u[1], 1)))


def plans(a, rows, predictions):
    out = []
    for s in STAGE_A:
        series = next((r for r in rows if r["kind"] == "series" and r["set"] == s), None)
        cells = [r for r in rows if r["kind"] == "cell" and r["set"] == s and r["g"] == a.g]
        if series is None:
            out.append((s, None))
            continue
        b, sigma = series["b"], series["sigma"]
        if a.stage == "a":
            plan = bracket(initial(predictions[s]["q"], b), cells, sigma)
        else:
            a_cells = [r for r in rows if r["kind"] == "cell" and r["set"] == s and r["g"] == 1]
            top = highest(a_cells, "cut8", sigma, BAR)
            plan = {"cut8": {top, top + 1}, today(b): {highest(a_cells, today(b), sigma, BAR)}}
        out.append((s, plan))
    return out


def main():
    global CELL
    ap = argparse.ArgumentParser()
    for name in ("harness", "build", "work", "data", "out"):
        ap.add_argument(name, type=Path)
    ap.add_argument("--stage", choices=["a", "b"], required=True)
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    a.g = 1 if a.stage == "a" else 16
    a.build, a.work = a.build.resolve(), a.work.resolve()
    a.work.mkdir(parents=True, exist_ok=True)
    CELL = load_harness(a.harness)
    harness_commit = subprocess.run(["git", "-C", str(a.harness), "rev-parse", "HEAD"], capture_output=True,
                                    text=True, check=True).stdout.strip()
    predictions = {v["set"]: v for v in json.loads((HERE / "predictions.json").read_text())["volumes"]}
    paths = {s: str(a.data / s) for s in STAGE_A}
    for s, path in paths.items():
        meta = CELL.display_windows(CELL.ROOT / "lab/av1/data.json", s, a.data)
        (a.work / f"{s}.display.json").write_text(json.dumps(meta))
    with ProcessPoolExecutor(a.jobs) as pool:
        while True:
            rows = [json.loads(r) for r in a.out.open()] if a.out.exists() else []
            seen = {(r["set"], r["kind"], r.get("form"), r.get("q"), r.get("g")) for r in rows}
            series = [s for s in STAGE_A if (s, "series", None, None, None) not in seen]
            cuts = [s for s in STAGE_A if (s, "cut_only", "cut8", None, None) not in seen] if a.stage == "a" else []
            todo = [(a.build, str(a.work), paths[s], f, q, a.g, None) for s, plan in plans(a, rows, predictions)
                    if plan for q, f in order(plan) if (s, "cell", f, q, a.g) not in seen]
            if not (series or cuts or todo):
                break
            print(f"{len(series)} series, {len(cuts)} cut-only, {len(todo)} cells", flush=True)
            with open(a.out, "a") as fh:
                done = [pool.map(CELL.series_row, [paths[s] for s in series], [a.work] * len(series)),
                        pool.map(cut_only, [(a.build, str(a.work), paths[s]) for s in cuts])]
                if not series:
                    done.append(pool.map(run_cell, todo))
                for batch in done:
                    for row in batch:
                        row["harness"] = harness_commit
                        fh.write(json.dumps(row) + "\n")
                        fh.flush()
                        print(row["set"], row["kind"], row.get("form"), row.get("q"), flush=True)


if __name__ == "__main__":
    main()
