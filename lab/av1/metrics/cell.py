#!/usr/bin/env python3
"""Row METRICS (README.md §Quality metrics protocol, pre-registered): per series its frames' own noise and the
step between neighbouring slices; per (series, form, Q, G) the lossy stream re-encoded, decoded by dav1d and
measured frame by frame against the source.

usage: cell.py BUILD WORK OUT.jsonl SETDIR ... --q 1,2,4 [--g 1,16] [--forms all|primary] [--jobs 4]
               [--vdp TORCH_PYTHON]      (ColorVideoVDP on the stored form's middle VDP_FRAMES frames)
"""
import argparse
import json
import resource
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "profiles"))
sys.path.insert(0, str(HERE.parents[1] / "scripts"))
import quality  # noqa: E402
from bytes import AOM, ROOT, Middle, aomenc_args, child, forms, q_hist, write_y4m, y4m_frames  # noqa: E402
from order import order  # noqa: E402
from voi import display_windows, window_codes  # noqa: E402
sys.path.insert(0, str(ROOT / "ingest/coded-frames"))
import ingest  # noqa: E402

VDP_FRAMES = 8


def display(meta, peak):
    """Code tables by stored value, one per header window; a series without one is shown as stored."""
    return [window_codes(w, meta["rescale"], peak) for w in meta["windows"]] or [np.arange(peak + 1).clip(0, 255)]


def planes(v):
    return [v[..., c] for c in range(v.shape[-1])]


def series_row(path, work):
    """What does not depend on the coding: σ per frame, and each neighbour step in every unit the cells use."""
    s = Middle(Path(path), 0)
    meta = json.loads((Path(work) / f"{s.name}.display.json").read_text())
    peak = (1 << s.b) - 1
    tables = display(meta, peak)
    sig, step, step_band, step_codes = [], [], [], []
    prev = None
    for i in range(s.n):
        v = s.frame(i).astype(np.int32) + s.offset
        inside = [(tables[0][p - s.offset] > 0) & (tables[0][p - s.offset] < 255) for p in planes(v)]
        sig.append(float(np.median([quality.sigma(p, m) for p, m in zip(planes(v), inside)])))
        if prev is not None:
            pv, pin = prev
            d = (v - pv).astype(np.float64)
            m = np.stack(pin, -1)
            step.append(quality.rms(d[m]))
            step_band.append(band_rms(d, m))
            step_codes.append([quality.display_moves(t[pv - s.offset], t[v - s.offset]) for t in tables])
        prev = (v, inside)
    return dict(kind="series", set=s.name, frames=s.n, width=s.w, height=s.h, channels=s.ch, b=s.b,
                bits_stored=s.stored, windows=meta["windows"], sigma=sig, step=step, step_band=step_band,
                step_codes=step_codes)


def band_rms(d, inside):
    """RMS of a difference at MS-SSIM's third scale, over 4 × 4 blocks wholly in the window."""
    out = []
    for c in range(d.shape[-1]):
        b = quality.band(d[..., c])
        m = quality.band(inside[..., c].astype(np.float64)) == 1
        out.append(b[m])
    return quality.rms(np.concatenate(out))


def cell(job):
    build, work, path, form_name, q, g, vdp = job
    t0 = time.perf_counter()
    s = Middle(Path(path), 0)
    meta = json.loads((Path(work) / f"{s.name}.display.json").read_text())
    form = next(f for f in forms(s, meta["windows"]) if f.name == form_name)
    tmp = Path(work) / f"{s.name}-{form.name}-q{q}-g{g}"
    tmp.mkdir(parents=True, exist_ok=True)
    y4m, ivf, dec = tmp / "in.y4m", tmp / "out.ivf", tmp / "dec.y4m"
    write_y4m(s, form, y4m)
    wall, cpu, err = child([build / f"aom-{AOM}/bin/aomenc", "-o", ivf, f"--limit={s.n}", "--q-hist=64",
                            "--disable-warning-prompt", *aomenc_args(form, q, g, s.n), y4m])
    y4m.unlink()
    units = ingest.ivf_units(ivf)
    dwall, dcpu, _ = child([build / "dav1d/bin/dav1d", "-q", "--threads=1", "-i", ivf, "-o", dec])
    t1 = time.perf_counter()
    shown = {}
    frames = measure(s, form, meta, y4m_frames(dec, s, form), shown=shown if vdp else None)
    seen = visibility(vdp, tmp, shown) if vdp else None
    for f in tmp.iterdir():
        f.unlink()
    tmp.rmdir()
    return dict(kind="cell", set=s.name, form=form.name, q=q, g=g or s.n, whole=g == 0, units=[len(u) for u in units],
                q_hist=q_hist(err), encode_wall=wall, encode_cpu=cpu, decode_cpu=dcpu, measure_wall=time.perf_counter() - t1,
                cell_wall=time.perf_counter() - t0, mpx=s.n * s.w * s.h * s.ch / 1e6, frames=frames, vdp=seen)


def visibility(python, tmp, shown):
    """vdp.py in its own venv on the first window's codes of the kept frames."""
    for k in ("source", "lossy"):
        np.save(tmp / f"{k}.npy", np.stack(shown[k]))
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    r = subprocess.run([str(python), str(HERE / "vdp.py"), str(tmp / "source.npy"), str(tmp / "lossy.npy")],
                       capture_output=True, check=True)
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    return dict(json.loads(r.stdout), frames=len(shown["source"]),
                cpu=after.ru_utime + after.ru_stime - before.ru_utime - before.ru_stime)


def measure(s, form, meta, decoded, shift=0, shown=None):
    """Each frame against its source at depth b: error, structure, error in the window's band, displayed levels.
    shift ≠ 0 compares frame i with source frame i + shift (the alignment check's mutation); shown collects the
    first window's codes of the middle VDP_FRAMES frames."""
    keep = range(max(0, (s.n - VDP_FRAMES) // 2), max(0, (s.n - VDP_FRAMES) // 2) + VDP_FRAMES)
    peak = (1 << s.b) - 1
    tables = display(meta, peak)
    out = []
    for i, p in enumerate(decoded):
        v = s.frame(min(i + shift, s.n - 1)).astype(np.int32) + s.offset
        x = form.back(p)
        d = (x - v).astype(np.float64)
        inside = np.stack([(tables[0][c - s.offset] > 0) & (tables[0][c - s.offset] < 255) for c in planes(v)], -1)
        st = [quality.ssim(v[..., c], x[..., c], peak) for c in range(s.ch)]
        xs = np.clip(x - s.offset, 0, peak)
        if shown is not None and i in keep and s.ch == 1:
            shown.setdefault("source", []).append(tables[0][v[..., 0] - s.offset])
            shown.setdefault("lossy", []).append(tables[0][xs[..., 0]])
        out.append(dict(mse=float(np.mean(d * d)), mse_in=float(np.mean(d[inside] ** 2)) if inside.any() else None,
                        max_abs=int(np.abs(d).max()), ssim=float(np.mean([a for a, _ in st])),
                        ms_ssim=float(np.mean([b for _, b in st])), err_band=band_rms(d, inside),
                        codes=[quality.display_moves(t[v - s.offset], t[xs]) for t in tables]))
    return out


def jobs(a):
    out = []
    for k, path in enumerate(a.sets):
        s = Middle(Path(path), 0)
        meta = display_windows(ROOT / "lab/av1/data.json", s.name, Path(path).parent)
        (a.work / f"{s.name}.display.json").write_text(json.dumps(meta))
        names = [f.name for f in forms(s, meta["windows"])]
        names = names[:1] if a.forms == "primary" else names
        units = [(n, q, g) for n in names for q in a.q for g in a.g]
        out += [(a.build, str(a.work), path, n, q, g, a.vdp if n == names[0] else None) for n, q, g in order(units, k)]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("work", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", nargs="+")
    ap.add_argument("--q", type=lambda v: [int(x) for x in v.split(",")], required=True)
    ap.add_argument("--g", type=lambda v: [int(x) for x in v.split(",")], default=[1, 16])
    ap.add_argument("--forms", choices=["all", "primary"], default="all")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--vdp", type=Path)
    a = ap.parse_args()
    a.build, a.work = a.build.resolve(), a.work.resolve()
    a.work.mkdir(parents=True, exist_ok=True)
    rows = [json.loads(r) for r in a.out.open()] if a.out.exists() else []
    done = {(r["set"], r.get("form"), r.get("q"), 0 if r.get("whole") else r.get("g")) for r in rows}
    todo = [j for j in jobs(a) if (Path(j[2]).name, j[3], j[4], j[5]) not in done]
    series = [p for p in a.sets if (Path(p).name, None, None, None) not in done]
    print(f"{len(series)} series, {len(todo)} cells", flush=True)
    with open(a.out, "a") as fh, ProcessPoolExecutor(a.jobs) as pool:
        for row in pool.map(series_row, series, [a.work] * len(series)):
            fh.write(json.dumps(row) + "\n")
            fh.flush()
            print(row["set"], f"σ median {np.median(row['sigma']):.3f}", flush=True)
        for row in pool.map(cell, todo):
            fh.write(json.dumps(row) + "\n")
            fh.flush()
            print(row["set"], row["form"], f"Q{row['q']}", f"G{row['g']}", f"{sum(row['units'])} B",
                  f"enc {row['encode_cpu']:.0f} cpu-s", f"measure {row['measure_wall']:.0f} s", flush=True)


if __name__ == "__main__":
    main()
