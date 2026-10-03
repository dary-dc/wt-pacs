#!/usr/bin/env python3
"""Fetch the AV1 phase's public series and extract their frames as raw samples.

Every DICOM file is checked against the SHA-256 pinned in data.json before it is read, and every
set's frames against the digest pinned there after extraction: a mismatch exits non-zero and
leaves nothing marked good. docs/FIXTURES.md §AV1 data says what each set is and why.

Frames land in OUT/<set>/NNN.raw: the stored samples, little-endian, colour interleaved as stored,
signed sign-extended to int16 — the layout and checksum convention of the HTJ2K sets.
NNN.sha256 is the hex digest of NNN.raw; the set digest is the digest of those hex strings
concatenated in frame order.

usage: fetch_data.py MANIFEST OUT [SET ...]
"""
import hashlib
import json
import os
import sys
import urllib.request

import numpy as np
import pydicom

BUCKET = "https://idc-open-data.s3.amazonaws.com/"


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def fetch(entry: dict, out: str) -> str:
    path = os.path.join(out, "dicom", entry["key"])
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        urllib.request.urlretrieve(BUCKET + entry["key"], path + ".part")
        os.replace(path + ".part", path)
    got = sha256(path)
    if got != entry["sha256"]:
        sys.exit(f"{entry['key']}: sha256 {got}, pinned {entry['sha256']}")
    return path


def frames(ds) -> np.ndarray:
    a = ds.pixel_array
    multi = int(ds.get("NumberOfFrames", 1)) > 1
    return a if multi else a[None]


def extract(spec: dict, out: str) -> None:
    dest = os.path.join(out, spec["name"])
    os.makedirs(dest, exist_ok=True)
    digests, lo, hi, first = [], None, None, None
    for entry in spec["files"]:
        ds = pydicom.dcmread(fetch(entry, out))
        first = ds if first is None else first
        signed = ds.PixelRepresentation == 1
        dtype = "<u1" if ds.BitsAllocated == 8 else ("<i2" if signed else "<u2")
        for f in frames(ds):
            samples = np.ascontiguousarray(f, dtype=dtype).tobytes()
            name = os.path.join(dest, "%03d" % len(digests))
            with open(name + ".raw", "wb") as fh:
                fh.write(samples)
            digests.append(hashlib.sha256(samples).hexdigest())
            with open(name + ".sha256", "w") as fh:
                fh.write(digests[-1])
            lo = f.min() if lo is None else min(lo, f.min())
            hi = f.max() if hi is None else max(hi, f.max())

    got = hashlib.sha256("".join(digests).encode()).hexdigest()
    if got != spec["frames_sha256"]:
        sys.exit(f"{spec['name']}: frames digest {got}, pinned {spec['frames_sha256']}")
    meta = {
        "frameCount": len(digests),
        "width": int(first.Columns),
        "height": int(first.Rows),
        "channels": int(first.SamplesPerPixel),
        "bitsStored": int(first.BitsStored),
        "signed": first.PixelRepresentation == 1,
        "min": int(lo),
        "max": int(hi),
        "photometric": first.PhotometricInterpretation,
        "framesSha256": got,
        **{k: spec[k] for k in ("collection", "series", "licence", "doi")},
    }
    with open(os.path.join(dest, "metadata.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print(f"{spec['name']}: {len(digests)} frames {meta['width']}x{meta['height']}"
          f"x{meta['channels']}, {meta['bitsStored']}-bit stored, range {lo}..{hi}")


def main() -> None:
    manifest, out, *names = sys.argv[1:]
    with open(manifest) as fh:
        sets = json.load(fh)["sets"]
    for spec in sets:
        if not names or spec["name"] in names:
            extract(spec, out)


if __name__ == "__main__":
    main()
