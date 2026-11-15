"""A ladder picture against its exact frame, at full size and at display scale: the protocol's Stage 1 metrics.
lab/htj2k-progressive/README.md §Stage 1 says what each is and where its definition comes from.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pydicom
from PIL import Image
from skimage.metrics import structural_similarity

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "lab/av1"))
sys.path.insert(0, str(ROOT / "ingest/from-dicom"))
from display_tags import code, window  # noqa: E402
from dicom_series import frame_display  # noqa: E402
from size import Set  # noqa: E402
from witness import picture  # noqa: E402

LEVELS = (1, 2, 3, 4, 5)
SCREEN = 1000


def windows(s):
    """The first frame's header windows (every alternative) and rescale; [] where the series carries none.
    Kept beside the set as windows.json once read, so the DICOM files need not stay."""
    kept = s.path / "windows.json"
    if kept.exists():
        return json.loads(kept.read_text())
    out = header_windows(s)
    kept.write_text(json.dumps(out))
    return out


def header_windows(s):
    spec = next((x for x in json.loads((ROOT / "lab/av1/data.json").read_text())["sets"] if x["name"] == s.name), {})
    if "files" not in spec:
        return {"rescale": {"slope": 1.0, "intercept": 0.0}, "windows": []}
    ds = pydicom.dcmread(s.path.parent / "dicom" / spec["files"][0]["key"], stop_before_pixels=True)
    per = ds.get("PerFrameFunctionalGroupsSequence")
    d = frame_display(ds, per[0] if per else None, ds.get("SharedFunctionalGroupsSequence", [None])[0])
    w = d.get("window")
    pairs = [] if not w else [{"center": c, "width": wd, "function": w["function"]} for c, wd in zip(w["center"], w["width"])]
    return {"rescale": d["rescale"], "windows": pairs}


def codes(x, display, k):
    """8-bit codes as client/paint/voi.js paints them; samples as stored where the series has no window."""
    if not display["windows"]:
        return np.clip(np.floor(x + 0.5), 0, 255)
    w = display["windows"][k]
    m = x * display["rescale"]["slope"] + display["rescale"]["intercept"]
    return code(window(m, w["center"], w["width"], w["function"]))


def resample(px, shape):
    """Area resampling (PIL's box filter) of every channel to shape (h, w)."""
    if px.shape[:2] == shape:
        return px.astype(np.float64)
    return np.stack([np.asarray(Image.fromarray(px[..., c].astype(np.float32), "F").resize((shape[1], shape[0]), Image.BOX),
                                np.float64) for c in range(px.shape[2])], axis=-1)


def display_shape(h, w):
    k = min(1.0, SCREEN / max(h, w))
    return round(h * k), round(w * k)


def compare(ref, got, display, peak):
    """Squared error, max |Δ|, SSIM; the same over in-window samples; each window's display error."""
    ref, got = ref.astype(np.float64), got.astype(np.float64)
    d = got - ref
    colour = ref.shape[2] == 3
    _, smap = structural_similarity(ref if colour else ref[..., 0], got if colour else got[..., 0], gaussian_weights=True,
                                    sigma=1.5, use_sample_covariance=False, data_range=peak, full=True,
                                    channel_axis=2 if colour else None)
    smap = smap if colour else smap[..., None]
    out = {"n": int(d.size), "sse": float((d * d).sum()), "maxAbs": float(np.abs(d).max()), "ssim": float(smap.mean()),
           "windows": []}
    for k in range(max(1, len(display["windows"]))):
        a, b = codes(ref, display, k), codes(got, display, k)
        inside = (a > 0) & (a < 255)
        dc = np.abs(b - a)[inside]
        out["windows"].append({"in": int(inside.sum()), "differ": int((dc > 0).sum()), "over1": int((dc > 1).sum()),
                               "maxCode": float(dc.max()) if dc.size else 0.0})
        if k == 0:
            out.update(nIn=int(inside.sum()), sseIn=float((d[inside] ** 2).sum()),
                       ssimIn=float(smap[inside].mean()) if inside.any() else None)
    return out


def frame_rows(job):
    path, i, display, cut = job
    s = Set(Path(path))
    f = s.frame(i).astype(np.int64)
    peak = (1 << s.stored) - 1
    shape = display_shape(s.h, s.w)
    exact_d = resample(f, shape)
    rows = []
    for r in LEVELS:
        args = (s.stored, s.signed, s.ch == 3)
        full, red = picture(f, r, "full", *args), picture(f, r, "reduced", *args)
        rows.append({"set": s.name, "frame": i, "level": r, "prefix": cut["levels"][str(r)]["prefix"], "whole": cut["whole"],
                     "full": compare(f, full, display, peak),
                     "fullDisplay": compare(exact_d, resample(full, shape), display, peak),
                     "reducedDisplay": compare(exact_d, resample(red, shape), display, peak)})
    return rows
