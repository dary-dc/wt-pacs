#!/usr/bin/env python3
"""Stage 1 of docs/av1/top-first.md §4, items 1–4, on every shipped payload: the top and low lengths and the top's
share; every cut payload rejoined equal to the shipped one; every top unit decoded by native dav1d equal to the
source ≫ k; and the top-only picture's error against the source. One JSON row a slice.

usage: stage1.py BUILD SHIPPED OUT.jsonl SET_DIR ... [--mutate low-byte|shift1]   — lab/av1/delivery/top-first/README.md
"""
import argparse
import json
import struct
import sys
import tempfile
from pathlib import Path

import numpy as np
import pydicom

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
from make_frames import HEADER, cut, join  # noqa: E402
from size import Set, decode_y4m  # noqa: E402


def voi_window(set_dir):
    """The header's first window and its function, as f4c396c8's lab/av1/delivery/scalable/tool/layer_error.py reads it."""
    meta = json.loads((set_dir / "metadata.json").read_text())
    dcm = next(p for p in (set_dir.parent / "dicom").rglob("*")
               if p.is_file() and pydicom.dcmread(p, stop_before_pixels=True).SeriesInstanceUID == meta["series"])
    ds = pydicom.dcmread(dcm, stop_before_pixels=True)
    voi = ds.get("WindowCenter") and ds
    if voi is None and "SharedFunctionalGroupsSequence" in ds:
        voi = ds.SharedFunctionalGroupsSequence[0].get("FrameVOILUTSequence", [None])[0]
    if voi is None:
        return {"center": (meta["min"] + meta["max"] + 1) / 2, "width": meta["max"] - meta["min"] + 1, "function": "LINEAR"}
    first = lambda v: float(v[0] if isinstance(v, pydicom.multival.MultiValue) else v)  # noqa: E731
    return {"center": first(voi.WindowCenter), "width": first(voi.WindowWidth),
            "function": str(voi.get("VOILUTFunction", "LINEAR")) or "LINEAR"}


def to_codes(x, win):
    """layer_error.py's, the same commit: PS3.3 C.11.2.1.2.1's LINEAR and SIGMOID to display codes 0–255."""
    c, w = win["center"], win["width"]
    if win["function"] == "SIGMOID":
        y = 255 / (1 + np.exp(-4 * (x - c) / w))
    elif win["function"] == "LINEAR":
        lo, hi = c - 0.5 - (w - 1) / 2, c - 0.5 + (w - 1) / 2
        y = np.where(x <= lo, 0, np.where(x > hi, 255, ((x - (c - 0.5)) / (w - 1) + 0.5) * 255))
    else:
        raise ValueError(win["function"])
    return np.clip(np.floor(y + 0.5), 0, 255)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("shipped", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", type=Path, nargs="+")
    ap.add_argument("--mutate", choices=["low-byte", "shift1"])
    a = ap.parse_args()
    rows, failed = [], 0
    with tempfile.TemporaryDirectory() as tmp, a.out.open("w") as out:
        tmp = Path(tmp)
        for d in a.sets:
            s = Set(d)
            win = voi_window(d)
            peak = (1 << s.stored) - 1
            for i in range(s.n):
                p = (a.shipped / s.name / f"{i:03d}.k2.av1").read_bytes()
                frame_len, top_len = struct.unpack_from("<II", p, HEADER)
                top, low, k = cut(p)
                if a.mutate == "low-byte" and i == 0:
                    low = low[:-1] + bytes([low[-1] ^ 1])
                rejoined = join(top, low, k) == p
                (tmp / "top.obu").write_bytes(top[HEADER + 4:])
                pic = decode_y4m(a.build, tmp / "top.obu", tmp / "top.y4m")[0]
                pic = pic[..., 0] if pic.ndim == 3 else pic
                src = s.frame(i)[..., 0]
                want = src >> (1 if a.mutate == "shift1" else k)
                top_exact = pic.dtype.itemsize <= src.dtype.itemsize and np.array_equal(pic.astype(src.dtype), want)
                shown = (src >> k) << k
                diff = (src.astype(np.int64) - shown).ravel()
                mse = float((diff * diff).mean())
                moved = to_codes(src.astype(np.float64), win) != to_codes(shown.astype(np.float64), win)
                row = dict(set=s.name, i=i, bits=s.stored, k=k, payload=len(p), top=top_len, low=frame_len - 4 - top_len,
                           rejoined=rejoined, topExact=bool(top_exact), maxErr=int(diff.max()),
                           psnr=99.0 if mse == 0 else 10 * np.log10(peak * peak / mse),
                           lowBits=[float((diff == v).mean()) for v in range(1 << k)], windowMoved=float(moved.mean()),
                           window=win)
                failed += not (rejoined and top_exact)
                out.write(json.dumps(row) + "\n")
                rows.append(row)
            print(f"{s.name}: {sum(r['rejoined'] for r in rows if r['set'] == s.name)}/{s.n} rejoined, "
                  f"{sum(r['topExact'] for r in rows if r['set'] == s.name)}/{s.n} tops equal to the source ≫ {k}", flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
