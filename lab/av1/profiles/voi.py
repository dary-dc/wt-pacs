"""The series' display, as the product paints it: every window pair its header carries and the 8-bit code of each
stored value through it — client/paint/voi.js ported, PS3.3 C.11.2.1.2.1 and C.11.2.1.3."""
import json
import sys
from pathlib import Path

import numpy as np
import pydicom

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "ingest/from-dicom"))
import dicom_series  # noqa: E402


def voi(fn, c, w):
    if fn == "LINEAR":
        lo, hi = c - 0.5 - (w - 1) / 2, c - 0.5 + (w - 1) / 2
        return lambda x: np.where(x <= lo, 0, np.where(x > hi, 255, ((x - (c - 0.5)) / (w - 1) + 0.5) * 255))
    if fn == "LINEAR_EXACT":
        return lambda x: np.where(x <= c - w / 2, 0, np.where(x > c + w / 2, 255, ((x - c) / w + 0.5) * 255))
    if fn == "SIGMOID":
        return lambda x: 255 / (1 + np.exp(-4 * (x - c) / w))
    raise ValueError(f"VOI LUT function {fn}")


def code(y):
    return np.clip(np.floor(np.asarray(y, np.float64) + 0.5), 0, 255).astype(np.uint8)


def window_codes(win, rescale, top):
    """Code by stored value 0 … top; MONOCHROME1's inversion is left out, it changes no |Δcode|."""
    x = np.arange(top + 1) * rescale["slope"] + rescale["intercept"]
    return code(voi(win["function"], win["center"], win["width"])(x))


def display_windows(manifest, name, data):
    """The first object's first frame: every window pair, its function and rescale; [] where it carries none."""
    entry = next(s for s in json.loads(Path(manifest).read_text())["sets"] if s["name"] == name)
    files = entry.get("files") or []
    if not files:
        return dict(windows=[], rescale=dict(slope=1.0, intercept=0.0), photometric="as stored")
    ds = pydicom.dcmread(Path(data) / "dicom" / files[0]["key"], stop_before_pixels=True)
    shared = ds.get("SharedFunctionalGroupsSequence", [None])[0]
    per = ds.get("PerFrameFunctionalGroupsSequence")
    d = dicom_series.frame_display(ds, per[0] if per else None, shared)
    w = d.get("window")
    wins = [] if not w else [dict(center=c, width=wd, function=w["function"]) for c, wd in zip(w["center"], w["width"])]
    return dict(windows=wins, rescale=d["rescale"], photometric=str(ds.get("PhotometricInterpretation", "")))
