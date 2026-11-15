#!/usr/bin/env python3
"""PROFILEDECODE's content (README.md §6): per series, the bytes run's encodings coded again with its own functions
and kept — HTJ2K and lossless AV1 as shipped, the lossy streams at each rung and G, the G = 16 residual — with the
references the browser is checked against. Each lossy stream's unit sizes and residual sizes must equal the bytes
run's row (results/cells.jsonl): the same encodings, byte for byte.

usage: streams.py BUILD OUT SETDIR --rungs 8,16,32 [--forms 12bit,top10] [--jobs 4]
"""
import argparse
import hashlib
import json
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bytes as run  # noqa: E402
from bytes import AOM, Middle, aomenc_args, forms, htj2k_residual, ingest, obu, write_y4m, y4m_frames  # noqa: E402

GROUPS = (1, 8, 16, 0)
RESIDUAL_G = 16


def sha(a):
    return hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()


def bytes_run_row(name, form, q, g):
    for r in map(json.loads, (HERE / "results/cells.jsonl").open()):
        if (r["set"], r["form"], r["q"], 0 if r["whole"] else r["g"]) == (name, form, q, g) and not r.get("altref"):
            return r
    sys.exit(f"{name} {form} Q{q} G{g}: no row in the bytes run")


def lossy(job):
    build, out, path, form_name, q, g = job
    s = Middle(Path(path), 0)
    meta = json.loads((out / f"{s.name}.display.json").read_text())
    form = next(f for f in forms(s, meta["windows"]) if f.name == form_name)
    cell = f"{form.name}-q{q}-g{g or s.n}"
    d = out / s.name / cell
    d.mkdir(parents=True, exist_ok=True)
    y4m, ivf, dec = d / "in.y4m", d / "out.ivf", d / "dec.y4m"
    write_y4m(s, form, y4m)
    run.child([build / f"aom-{AOM}/bin/aomenc", "-o", ivf, f"--limit={s.n}", "--disable-warning-prompt",
               *aomenc_args(form, q, g, s.n), y4m])
    y4m.unlink()
    units = ingest.ivf_units(ivf)
    for i, u in enumerate(units):
        (d / f"{i:03d}.obu").write_bytes(u)
    run.child([build / "dav1d/bin/dav1d", "-q", "--threads=1", "-i", ivf, "-o", dec])
    row = bytes_run_row(s.name, form.name, q, g)
    if [len(u) for u in units] != row["lossy"]:
        sys.exit(f"{s.name} {cell}: unit sizes differ from the bytes run's")
    keys = [i for i, u in enumerate(units) if obu.sequence_header(u) is not None]
    grain = [obu.film_grain_params_present(obu.sequence_header(units[k]))["film_grain"] for k in keys]
    c = dict(cell=cell, form=form.name, q=q, g=g or s.n, depth=form.depth, shift=s.b - 10 if form.name == "top10" else 0,
             units=[len(u) for u in units], keyframes=keys, film_grain=grain,
             lossy=[sha(p[0]) for p in y4m_frames(dec, s, form)])
    if g == RESIDUAL_G:
        c.update(residual(build, d, s, form, lambda: y4m_frames(dec, s, form), row))
    for f in (ivf, dec):
        f.unlink()
    return s.name, c


def residual(build, d, s, form, frames, row):
    """As bytes.py's measure(): source − lossy frame + one offset, HTJ2K lossless; added back, every frame exact."""
    lo, hi = 1 << 30, -(1 << 30)
    for i, planes in enumerate(frames()):
        diff = form.back(planes) - (s.frame(i).astype(np.int32) + s.offset)
        lo, hi = min(lo, int(diff.min())), max(hi, int(diff.max()))
    ro, bits = hi, max(1, (hi - lo).bit_length())
    (d / "r").mkdir(exist_ok=True)
    sizes, hashes, exact = [], [], 0
    for i, planes in enumerate(frames()):
        v = s.frame(i).astype(np.int32) + s.offset
        b = form.back(planes)
        n, back = htj2k_residual(build, d, s, v - b + ro, bits)
        (d / "r.j2c").rename(d / "r" / f"{i:03d}.j2c")
        sizes.append(n)
        hashes.append(sha(back[..., 0].astype("<u2" if bits > 8 else "u1")))
        exact += ingest.exact(s, i, b + back - ro)
    for f in ("r.pgm",):
        (d / f).unlink(missing_ok=True)
    if (sizes, ro, bits) != (row["residual"], row["residual_offset"], row["residual_bits"]) or exact != s.n:
        sys.exit(f"{s.name} {form.name}: residual differs from the bytes run's, or {exact}/{s.n} exact")
    return dict(residual_offset=ro, residual_bits=bits, residual_units=sizes, residuals=hashes)


def lossless(build, out, s, codec, preset):
    d = out / s.name / ("htj2k" if codec == "htj2k" else "lossless")
    d.mkdir(parents=True, exist_ok=True)
    payloads = ingest.coded(build, s, s.n, codec, 4, "optimized", None, preset)
    for i, data in payloads:
        (d / f"{i:03d}.{'j2c' if codec == 'htj2k' else 'av1'}").write_bytes(data)
    want = next(r[2] for r in map(json.loads, (HERE / "results/lossless.jsonl").open()) if r[:2] == [s.name, codec])
    if [len(p) for _, p in payloads] != want:
        sys.exit(f"{s.name} {codec}: sizes differ from the bytes run's")
    return [len(p) for _, p in payloads]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("set", type=Path)
    ap.add_argument("--rungs", type=lambda v: [int(x) for x in v.split(",")], required=True)
    ap.add_argument("--forms", type=lambda v: v.split(","))
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    build, out = a.build.resolve(), a.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    s = Middle(a.set, 0)
    meta = run.display_windows(run.ROOT / "lab/av1/data.json", s.name, a.set.parent)
    (out / f"{s.name}.display.json").write_text(json.dumps(meta))
    names = a.forms or [f.name for f in forms(s, meta["windows"])][:1]
    e = dict(name=s.name, frames=s.n, width=s.w, height=s.h, bits=s.b, stored=s.stored, offset=s.offset,
             middle=(s.n - 16) // 2, truth=s.truth, htj2k=lossless(build, out, s, "htj2k", "-"),
             lossless=lossless(build, out, s, "av1", "good:6"))
    jobs = [(build, out, str(a.set), f, q, g) for q in a.rungs for f in names for g in GROUPS]
    with ProcessPoolExecutor(a.jobs) as pool:
        e["cells"] = [c for _, c in pool.map(lossy, jobs)]
    (out / f"{s.name}.json").write_text(json.dumps(e))
    for c in e["cells"]:
        print(s.name, c["cell"], sum(c["units"]), "B", "film grain", sum(c["film_grain"]), "of", len(c["film_grain"]),
              *(["residual", sum(c["residual_units"]), "B"] if "residuals" in c else []), flush=True)


if __name__ == "__main__":
    main()
