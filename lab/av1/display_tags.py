#!/usr/bin/env python3
"""Which sets carry the display attributes the ingest drops (rows COLORTAGS and VOILUT): docs/display.md §Which series carry them.

Each pinned DICOM file is streamed, checked against its SHA-256 and read; nothing is kept on disk. Prints one JSON
line per set: the files carrying each attribute, anywhere in the object, nested included; and where an object carries
both a VOI LUT and a window pair, the 8-bit codes of its samples through each LUT against through the paired window.

usage: display_tags.py MANIFEST [SET ...]
"""
import hashlib
import io
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pydicom

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[2] / "ingest/from-dicom"))
import dicom_series  # noqa: E402

BUCKET = "https://idc-open-data.s3.amazonaws.com/"
HEAD = 64 << 20
TAGS = {
    0x00282000: "ICCProfile",
    0x00282002: "ColorSpace",
    0x00283000: "ModalityLUTSequence",
    0x00283010: "VOILUTSequence",
    0x20500010: "PresentationLUTSequence",
    0x20500020: "PresentationLUTShape",
}


def head(key: str, sha: str, tries: int = 3) -> bytes:
    for _ in range(tries):
        h, kept = hashlib.sha256(), bytearray()
        with urllib.request.urlopen(BUCKET + key) as r:
            for block in iter(lambda: r.read(1 << 20), b""):
                h.update(block)
                if len(kept) < HEAD:
                    kept += block
        if h.hexdigest() == sha:
            return bytes(kept)
        print(f"{key}: sha256 {h.hexdigest()}, pinned {sha}", file=sys.stderr)
    raise SystemExit(f"{key}: no transfer matched its pin in {tries}")


def found(ds) -> dict:
    out = {}

    def visit(d, elem):
        if elem.tag in TAGS:
            name = TAGS[elem.tag]
            if name == "VOILUTSequence":
                value = [{"descriptor": list(i.get("LUTDescriptor", [])),
                          "explanation": str(i.get("LUTExplanation", ""))} for i in elem.value]
            elif name == "ICCProfile":
                value = len(elem.value)
            elif elem.VR == "SQ":
                value = len(elem.value)
            else:
                value = str(elem.value)
            out.setdefault(name, value)

    ds.walk(visit)
    out["window"] = "WindowCenter" in ds or any(
        "FrameVOILUTSequence" in g for g in ds.get("SharedFunctionalGroupsSequence", []))
    out["photometric"] = str(ds.get("PhotometricInterpretation", ""))
    out["modality"] = str(ds.get("Modality", ""))
    return out


def code(y):
    return np.clip(np.floor(y + 0.5), 0, 255)


def window(x, c, w, fn):
    """PS3.3 C.11.2.1.2.1, C.11.2.1.3.2, C.11.2.1.3.1, output 0–255: client/paint/voi.js's formulas."""
    if fn == "SIGMOID":
        return 255 / (1 + np.exp(-4 * (x - c) / w))
    lo, hi, mid, span = (c - w / 2, c + w / 2, c, w) if fn == "LINEAR_EXACT" else (
        c - 0.5 - (w - 1) / 2, c - 0.5 + (w - 1) / 2, c - 0.5, w - 1)
    return np.where(x <= lo, 0, np.where(x > hi, 255, ((x - mid) / span + 0.5) * 255))


def lut_against_window(ds) -> dict:
    """Per LUT item, by its explanation: the largest |Δ| in codes, and the share of samples whose code differs."""
    x = dicom_series.samples(ds)[..., 0].astype(np.float64) * float(ds.get("RescaleSlope", 1)) + float(
        ds.get("RescaleIntercept", 0))
    centers, widths = dicom_series.floats(ds.WindowCenter), dicom_series.floats(ds.WindowWidth)
    names = [str(v) for v in ds.get("WindowCenterWidthExplanation", [])]
    out = {}
    for k, item in enumerate(ds.VOILUTSequence):
        n, first, bits = (int(v) for v in item.LUTDescriptor)
        data = item.LUTData
        lut = np.frombuffer(data, "<u2") if isinstance(data, bytes) else np.asarray(data)
        through = code(lut[np.clip(x - first, 0, (n or 65536) - 1).astype(np.int64)] / ((1 << bits) - 1) * 255)
        name = str(item.get("LUTExplanation", k))
        j = names.index(name) if name in names else k
        if j >= len(centers):
            continue
        fn = str(ds.get("VOILUTFunction", "LINEAR"))
        d = np.abs(through - code(window(x, centers[j], widths[j], fn)))
        out[name] = {"pair": j, "function": fn, "max": int(d.max()), "differ": float((d > 0).mean())}
    return out


def one(f: dict) -> dict:
    ds = pydicom.dcmread(io.BytesIO(head(f["key"], f["sha256"])))
    out = found(ds)
    if "VOILUTSequence" in ds and "WindowCenter" in ds:
        out["lutAgainstWindow"] = lut_against_window(ds)
    return out


def main():
    manifest, names = sys.argv[1], set(sys.argv[2:])
    sets = [s for s in json.load(open(manifest))["sets"] if s.get("files") and (not names or s["name"] in names)]
    with ThreadPoolExecutor(8) as pool:
        for s in sets:
            per = list(pool.map(one, s["files"]))
            carries = {t: sum(t in p for p in per) for t in TAGS.values()}
            values = {t: sorted({json.dumps(p[t]) for p in per if t in p}) for t in TAGS.values() if carries[t]}
            print(json.dumps({"set": s["name"], "provenance": s["provenance"], "files": len(per),
                              "modality": sorted({p["modality"] for p in per}),
                              "photometric": sorted({p["photometric"] for p in per}),
                              "window": sum(p["window"] for p in per),
                              "carries": {t: n for t, n in carries.items() if n}, "values": values,
                              "lutAgainstWindow": [p["lutAgainstWindow"] for p in per if "lutAgainstWindow" in p]}),
                  flush=True)


if __name__ == "__main__":
    main()
