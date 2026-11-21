#!/usr/bin/env python3
"""I2's pre-registered protocol (claude/unified:docs/lines/proposals.md §I2): the ingest's `codingError` against the
quality study's committed rows, cell by cell, frame by frame. Results: docs/av1/payload-format.md §Integrity.

usage: i2_compare.py BUILD DATA STUDY_ROWS STUDY_LAB OUT.jsonl SET:Q:G ... [--mutant NAME]
  STUDY_ROWS  the study's shard-*.jsonl concatenated; STUDY_LAB  a tree holding claude/unified's lab/av1/{metrics,profiles}
"""
import argparse
import json
import math
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ingest/coded-frames"))
sys.path.insert(0, str(ROOT / "lab/av1"))
import coding_error  # noqa: E402
import ingest  # noqa: E402
import size  # noqa: E402

FORM = {10: "10bit", 12: "12bit"}
RMS_ROUNDING = 1e-4
RATIO_SHARE = 0.01


def units(path):
    """The one AV1 unit of an optimal-quality payload: header(16) · len[1] · unit."""
    data = path.read_bytes()
    n, = struct.unpack_from("<I", data, 12)
    length, = struct.unpack_from("<I", data, 16)
    assert n == 1
    return data[20:20 + length]


def study_cell(rows, name, q, g, b):
    series = next(r for r in rows if r.get("kind") == "series" and r["set"] == name)
    cell = next(r for r in rows if r.get("kind") == "cell" and r["set"] == name and r["form"] == FORM[b]
                and r["q"] == q and r["g"] == g and not r.get("whole"))
    return [dict(rms=math.sqrt(f["mse"]), max=f["max_abs"], ratio=f["err_noise_band"] / s)
            for f, s in zip(cell["frames"], series["sigma"])]


def in_window(study_lab, data, name, b):
    """The study's mask: stored values whose code under the series' first header window is strictly inside 0 … 255."""
    sys.path.insert(0, str(study_lab / "lab/av1/profiles"))
    sys.path.insert(0, str(study_lab / "lab/av1/metrics"))
    import voi
    meta = voi.display_windows(study_lab / "lab/av1/data.json", name, data)
    table = voi.window_codes(meta["windows"][0], meta["rescale"], (1 << b) - 1)
    return lambda src: (table[src] > 0) & (table[src] < 255)


def diagnose(build, s, out, g, inside):
    """Per frame, from the ingest's own payloads: the study's code with and without its mask, and the ingest's
    formula with the mask, so a difference in the ratio is laid to the mask or to the formula."""
    import quality
    us = [units(out / f"{i:03d}.av1") for i in range(s.n)]
    rows = []
    for i in range(s.n):
        k = ingest.keyframe(i, g)
        px, _ = ingest.decoded(build, "av1", b"".join(us[k:i + 1]), s.h * s.w)
        src = s.frame(i)[..., 0].astype(np.int64)
        d = (px[..., 0].astype(np.int64) - s.offset - src).astype(np.float64)
        m = inside(src)
        mi = m[1:-1, 1:-1]
        band = coding_error.interior(d, coding_error.LAPLACIAN) / 6
        rows.append(dict(study_masked=quality.noise_band(d, m) / quality.sigma(src, m),
                         study_unmasked=quality.noise_band(d) / quality.sigma(src),
                         ingest_masked=float(np.sqrt(np.mean(np.square(band[mi])))) / masked_sigma(src, mi),
                         in_window_share=float(m.mean())))
    return rows


def masked_sigma(src, mi):
    x = src.astype(np.float64)
    lap = np.abs(coding_error.interior(x, coding_error.LAPLACIAN))[mi]
    grad = (np.abs(coding_error.interior(x, coding_error.SOBEL)) + np.abs(coding_error.interior(x, coding_error.SOBEL.T)))[mi]
    s = np.sqrt(np.pi / 2) * lap[grad <= np.quantile(grad, 1 - coding_error.EDGE_SHARE)].mean() / 6
    return float(np.sqrt(max(0.0, s * s - 1 / 12)))


def judge(ing, ref):
    e = [abs(a - round(b["rms"], 4)) for a, b in zip(ing["rms"], ref)]
    m = [a != b["max"] for a, b in zip(ing["max"], ref)]
    r = [abs(a - b["ratio"]) / b["ratio"] for a, b in zip(ing["noiseBandRatio"], ref)]
    return dict(rms_worst=max(e), rms_ok=max(e) <= RMS_ROUNDING, max_off=sum(m), max_ok=not any(m),
                ratio_worst_share=max(r), ratio_median_share=float(np.median(r)), ratio_ok=max(r) <= RATIO_SHARE)


def main():
    ap = argparse.ArgumentParser()
    for name in ("build", "data", "study_rows", "study_lab", "out"):
        ap.add_argument(name, type=Path)
    ap.add_argument("cells", nargs="+")
    ap.add_argument("--mutant", default="")
    ap.add_argument("--no-diagnosis", action="store_true")
    a = ap.parse_args()
    rows = [json.loads(line) for line in a.study_rows.read_text().splitlines() if line.strip()]
    for cell in a.cells:
        name, q, g = cell.split(":")
        q, g = int(q), int(g)
        s = size.Set(a.data / name)
        ref = study_cell(rows, name, q, g, s.stored)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            t = time.monotonic()
            subprocess.run([sys.executable, ROOT / "lab/av1/tools/ingest_coded.py", a.build, a.data / name, out,
                            "--lossy", str(q), str(g), "--exact-series", name, "--integrity", "--jobs", "4"],
                           check=True, capture_output=True)
            wall = time.monotonic() - t
            ing = json.loads((out / "metadata.json").read_text())["lossy"]["codingError"]
            diag = [] if a.no_diagnosis else diagnose(a.build, s, out, g, in_window(a.study_lab, a.data, name, s.stored))
        row = dict(set=name, q=q, g=g, form=FORM[s.stored], frames=s.n, mutant=a.mutant or None, ingest_wall_s=round(wall, 1),
                   **judge(ing, ref), ingest=ing, study=ref, diagnosis=diag)
        with a.out.open("a") as f:
            f.write(json.dumps(row) + "\n")
        print(name, q, g, a.mutant, {k: row[k] for k in ("rms_ok", "max_ok", "ratio_ok", "ratio_median_share", "ingest_wall_s")})


if __name__ == "__main__":
    main()
