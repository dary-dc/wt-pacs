#!/usr/bin/env python3
"""The 220-level form against DEPTH8-MEASURE's rows (C1), and a second picture (C2): hw-inverted.md §8, amended.

usage: measure.py HARNESS BUILD WORK DATA DEPTH8_ROWS c1|c2 [--jobs 4]
       HARNESS is claude/av1-noise-ratio at 0a9d33ca; DEPTH8_ROWS holds DEPTH8-MEASURE's stage-a.jsonl, stage-c.jsonl.
"""
import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROWS = HERE / "rows"
STAGE_A = ["dbts_a1", "dbts_b1", "dbts_c1", "dbt12_ea1141", "dbts_b2", "dbts_c4"]
STAGE_C = ["dbts_a3", "dbts_a4", "dbts_a5", "dbts_b4", "dbt10_d",
           "dbt12_c", "dbts_a2", "dbts_c2", "dbts_c3", "dbts_c5", "dbt10_ea1141", "dbts_b3", "dbts_b5"]
TIMED, PICTURE_A_Q = ["dbts_a1", "dbts_b1", "dbts_c1"], (24, 40)
BAR, BAR_WIDE = 1.00, 1.03
LOW, HIGH, NEUTRAL, MID = 16, 235, 128, 126
FORM, RESIDUAL = "inv220-420", "residual-420"
seen = {}


def scale(depth):
    return ((1 << depth) - 1) / (HIGH - LOW)


def code220(v, depth):
    return LOW + np.floor(v / scale(depth) + 0.5).astype(np.int32)


def back220(c, depth):
    return np.floor((c.astype(np.int32) - LOW) * scale(depth) + 0.5).astype(np.int32)


def code8(v, k):
    return np.minimum((v + (1 << (k - 1))) >> k, 255)


def residual(v, ra, depth):
    """Picture B's codes for source luma v over A's decoded luma ra, and how many of them clamped."""
    raw = v - back220(ra, depth) + MID
    return np.clip(raw, LOW, HIGH), int(np.count_nonzero((raw < LOW) | (raw > HIGH)))


def shown(ra, rb, depth):
    return back220(ra, depth) + rb.astype(np.int32) - MID


def reset():
    seen.update(chroma_off=0, luma_out=0, frames_out=0, luma_min=255, luma_max=0)


def count(planes):
    """Decoded luma outside 16 … 235 (I4) and chroma other than 128 (I5), over every frame since reset()."""
    luma = planes[0]
    out = int(np.count_nonzero((luma < LOW) | (luma > HIGH)))
    seen["luma_out"] += out
    seen["frames_out"] += out > 0
    seen["luma_min"] = min(seen["luma_min"], int(luma.min()))
    seen["luma_max"] = max(seen["luma_max"], int(luma.max()))
    seen["chroma_off"] += sum(int(np.count_nonzero(c != NEUTRAL)) for c in planes[1:])


def with_forms(harness_forms, form_cls):
    def forms(s, win):
        half = np.full(((s.h + 1) // 2, (s.w + 1) // 2), NEUTRAL)
        k = s.b - 8

        def back(p):
            count(p)
            return back220(p[0], s.b)[..., None]
        return harness_forms(s, win) + [
            form_cls(FORM, 8, 0, False, lambda v: [code220(v[..., 0], s.b), half, half], back),
            form_cls("cut8", 8, 0, True, lambda v: [code8(v[..., 0], k)],
                     lambda p: (p[0].astype(np.int32) << k)[..., None])]
    return forms


def with_args(harness_args):
    def args(form, q, g, n, altref=False):
        out = harness_args(form, q, g, n, altref)
        if form.name not in (FORM, RESIDUAL):
            return out
        return out[:out.index("--bit-depth=8")] + ["--profile=0", "--bit-depth=8", "--input-bit-depth=8"]
    return args


def load_harness(path):
    sys.path.insert(0, str(Path(path) / "lab/av1/metrics"))
    import cell
    cell.Form = sys.modules["bytes"].Form
    cell.forms = with_forms(cell.forms, cell.Form)
    cell.aomenc_args = with_args(cell.aomenc_args)
    return cell


def run_cell(job):
    reset()
    row = CELL.cell(job)
    if row["form"] == FORM:
        row.update(seen)
    return row


def volume(path, work):
    s = CELL.Middle(Path(path), 0)
    return s, json.loads((Path(work) / f"{s.name}.display.json").read_text())


def frames(s):
    return (s.frame(i).astype(np.int32) + s.offset for i in range(s.n))


def cut_only(job):
    """The codes uncoded, measured as a cell (I1)."""
    s, meta = volume(job[1], job[0])
    form = next(f for f in CELL.forms(s, meta["windows"]) if f.name == FORM)
    reset()
    out = CELL.measure(s, form, meta, (form.fwd(v) for v in frames(s)))
    for f, v in zip(out, frames(s)):
        f["mean_err"] = float(np.mean(form.back(form.fwd(v)) - v))
    return dict(kind="cut_only", set=s.name, form=FORM, b=s.b, frames=out, **seen)


def encode(build, s, form, q, tmp):
    """aomenc on tmp/in.y4m (removed after), dav1d to tmp/dec.y4m: the units' bytes and the encoder's CPU seconds."""
    y4m, ivf, dec = tmp / "in.y4m", tmp / "out.ivf", tmp / "dec.y4m"
    _, cpu, _ = CELL.child([build / f"aom-{CELL.AOM}/bin/aomenc", "-o", ivf, f"--limit={s.n}", "--q-hist=64",
                            "--disable-warning-prompt", *CELL.aomenc_args(form, q, 1, s.n), y4m])
    y4m.unlink()
    CELL.child([build / "dav1d/bin/dav1d", "-q", "--threads=1", "-i", ivf, "-o", dec])
    return [len(u) for u in CELL.ingest.ivf_units(ivf)], cpu


def picture_a(job):
    """Picture A at Q_A, measured as a C1 cell; its decoded luma kept in WORK for picture B's cells (A5)."""
    work, path, build, qa = job
    t0 = time.perf_counter()
    s, meta = volume(path, work)
    form = next(f for f in CELL.forms(s, meta["windows"]) if f.name == FORM)
    tmp = Path(work) / f"{s.name}-a{qa}"
    tmp.mkdir(exist_ok=True)
    CELL.write_y4m(s, form, tmp / "in.y4m")
    units, cpu = encode(build, s, form, qa, tmp)
    reset()
    lumas = np.lib.format.open_memmap(tmp / "luma.npy", "w+", np.uint8, (s.n, s.h, s.w))

    def kept():
        for i, p in enumerate(CELL.y4m_frames(tmp / "dec.y4m", s, form)):
            lumas[i] = p[0]
            yield p
    out = CELL.measure(s, form, meta, kept())
    lumas.flush()
    (tmp / "dec.y4m").unlink()
    (tmp / "out.ivf").unlink()
    return dict(kind="picture_a", set=s.name, form=FORM, q=qa, units=units, encode_cpu=cpu, frames=out,
                cell_wall=time.perf_counter() - t0, **seen)


def write_residual(s, ra, path):
    half = np.full(((s.h + 1) // 2, (s.w + 1) // 2), NEUTRAL, np.uint8).tobytes()
    clamped = 0
    with open(path, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{s.w} H{s.h} F25:1 Ip A1:1 C420\n".encode())
        for v, a in zip(frames(s), ra):
            b, n = residual(v[..., 0], a, s.b)
            clamped += n
            fh.write(b"FRAME\n" + b.astype(np.uint8).tobytes() + half + half)
    return clamped


def picture_b(job):
    """Picture B at Q over A's reconstruction, measured on shown = back(r_A) + r_B − 126 against the source."""
    work, path, build, qa, q = job
    t0 = time.perf_counter()
    s, meta = volume(path, work)
    ra = np.load(Path(work) / f"{s.name}-a{qa}/luma.npy", mmap_mode="r")
    form = CELL.Form(RESIDUAL, 8, 0, False, None, lambda p: p[0][..., None])
    tmp = Path(work) / f"{s.name}-a{qa}-b{q}"
    tmp.mkdir(exist_ok=True)
    clamped = write_residual(s, ra, tmp / "in.y4m")
    units, cpu = encode(build, s, form, q, tmp)
    reset()

    def decoded():
        for p, a in zip(CELL.y4m_frames(tmp / "dec.y4m", s, form), ra):
            count(p)
            yield [shown(a, p[0], s.b)]
    out = CELL.measure(s, form, meta, decoded())
    for f in tmp.iterdir():
        f.unlink()
    tmp.rmdir()
    return dict(kind="cell", set=s.name, form=RESIDUAL, qa=qa, q=q, g=1, units=units, encode_cpu=cpu,
                clamped=clamped, samples=s.n * s.h * s.w, frames=out, cell_wall=time.perf_counter() - t0, **seen)


def worst(row, sigma):
    return max(f["err_noise_band"] / x for f, x in zip(row["frames"], sigma))


def highest(cells, form, sigma, bar):
    return max((c["q"] for c in cells if c["form"] == form and worst(c, sigma) <= bar), default=None)


def initial(p):
    """A3: from bar 1.00's independent Q to the larger removal Q of the two bars, + 1."""
    lo, hi = p["bar1.00"]["inv220_independent_removal"], p["bar1.03"]["inv220_independent_removal"]
    return set(range(lo[0], max(lo[1], hi[1]) + 2))


def bracket(qs, cells, sigma):
    """§8.1, after DEPTH8's A3: the next Q while the highest tested passes 1.03, the Q below while the lowest fails 1.00."""
    got = {c["q"]: worst(c, sigma) for c in cells if c["form"] == FORM}
    if qs - set(got):
        return qs
    if got[max(got)] <= BAR_WIDE:
        qs = qs | {max(got) + 1}
    if got[min(got)] > BAR and min(got) > 1:
        qs = qs | {min(got) - 1}
    return qs


def next_b(got):
    """A4: Q 1, then multiples of 4 until the worst frame exceeds 1.03, then every Q between the highest multiple
    passing 1.00 and that one; None when done. got maps Q → worst frame."""
    if not got:
        return 1
    top = max(got)
    if got[top] <= BAR_WIDE:
        return min(top + 4 - top % 4, 63) if top < 63 else None
    lo = max((q for q, w in got.items() if (q == 1 or q % 4 == 0) and w <= BAR), default=top)
    return min((q for q in range(lo + 1, top) if q not in got), default=None)


def read(path):
    return [json.loads(r) for r in path.open()] if path.exists() else []


def depth8_cut8_top(d8_rows, s):
    sigma = next(r["sigma"] for r in d8_rows if r["kind"] == "series" and r["set"] == s)
    return highest([r for r in d8_rows if r["kind"] == "cell" and r["set"] == s and r["g"] == 1], "cut8", sigma, BAR)


def c1(a, pool, predictions, d8_rows):
    out = ROWS / "c1.jsonl"
    for stage in (STAGE_A, STAGE_C):
        while True:
            rows = read(out)
            have = {(r["set"], r["kind"], r.get("form"), r.get("q")) for r in rows}
            series = [s for s in stage if (s, "series", None, None) not in have]
            cuts = [s for s in stage if (s, "cut_only", FORM, None) not in have]
            todo = []
            for s in [] if series else stage:
                sigma = next(r["sigma"] for r in rows if r["kind"] == "series" and r["set"] == s)
                cells = [r for r in rows if r["kind"] == "cell" and r["set"] == s]
                plan = [(q, FORM) for q in bracket(initial(predictions[s]), cells, sigma)]
                plan += [(depth8_cut8_top(d8_rows, s), "cut8")] if s in STAGE_A else []
                todo += [(a.build, str(a.work), a.paths[s], f, q, 1, None) for q, f in sorted(plan)
                         if (s, "cell", f, q) not in have]
            if not (series or cuts or todo):
                break
            print(f"{len(series)} series, {len(cuts)} cut-only, {len(todo)} cells", flush=True)
            done = [pool.map(CELL.series_row, [a.paths[s] for s in series], [a.work] * len(series)),
                    pool.map(cut_only, [(str(a.work), a.paths[s]) for s in cuts])]
            if not series:
                done.append(pool.map(run_cell, todo))
            append(out, a.harness_commit, (row for batch in done for row in batch))


def c2(a, pool):
    out = ROWS / "c2.jsonl"
    sigma = {r["set"]: r["sigma"] for r in read(ROWS / "c1.jsonl") if r["kind"] == "series"}
    running = {}
    while True:
        rows = read(out)
        for s in TIMED:
            for qa in PICTURE_A_Q:
                if (s, qa) in running.values():
                    continue
                if not any(r["kind"] == "picture_a" and r["set"] == s and r["q"] == qa for r in rows):
                    running[pool.submit(picture_a, (str(a.work), a.paths[s], a.build, qa))] = (s, qa)
                    continue
                got = {r["q"]: worst(r, sigma[s]) for r in rows if r["kind"] == "cell" and r["set"] == s
                       and r["qa"] == qa}
                q = next_b(got)
                if q is not None:
                    running[pool.submit(picture_b, (str(a.work), a.paths[s], a.build, qa, q))] = (s, qa)
        if not running:
            break
        finished, _ = wait(running, return_when=FIRST_COMPLETED)
        append(out, a.harness_commit, (f.result() for f in finished))
        for f in finished:
            del running[f]


def append(path, commit, rows):
    with open(path, "a") as fh:
        for row in rows:
            row["harness"] = commit
            fh.write(json.dumps(row) + "\n")
            fh.flush()
            print(row["set"], row["kind"], row.get("form"), row.get("qa"), row.get("q"), flush=True)


def main():
    global CELL
    ap = argparse.ArgumentParser()
    for name in ("harness", "build", "work", "data", "depth8_rows"):
        ap.add_argument(name, type=Path)
    ap.add_argument("cell", choices=["c1", "c2"])
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    a.build, a.work = a.build.resolve(), a.work.resolve()
    a.work.mkdir(parents=True, exist_ok=True)
    CELL = load_harness(a.harness)
    a.harness_commit = subprocess.run(["git", "-C", str(a.harness), "rev-parse", "HEAD"], capture_output=True,
                                      text=True, check=True).stdout.strip()
    a.paths = {s: str(a.data / s) for s in STAGE_A + STAGE_C}
    for s in (TIMED if a.cell == "c2" else STAGE_A + STAGE_C):
        meta = CELL.display_windows(CELL.ROOT / "lab/av1/data.json", s, a.data)
        (a.work / f"{s}.display.json").write_text(json.dumps(meta))
    predictions = {v["set"]: v for v in json.loads((HERE / "predictions.json").read_text())["volumes"]}
    d8_rows = read(a.depth8_rows / "stage-a.jsonl") + read(a.depth8_rows / "stage-c.jsonl")
    with ProcessPoolExecutor(a.jobs) as pool:
        c1(a, pool, predictions, d8_rows) if a.cell == "c1" else c2(a, pool)


if __name__ == "__main__":
    main()
