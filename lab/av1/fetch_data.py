#!/usr/bin/env python3
"""Fetch the AV1 phase's public series and extract their frames as raw samples.

Every DICOM file is checked against the SHA-256 pinned in data.json before it is read, and every
set's frames against the digest pinned there after extraction: a mismatch exits non-zero and
leaves nothing marked good. docs/FIXTURES.md §AV1 data says what each set is and why.

A set with a "crop" [y, x, h, w] keeps that window of every frame. A set with an "archive" is not
DICOM: its members, pinned inside a pinned zip, are decoded with FFmpeg — "luma" keeps a video's Y
plane, "rgb" converts it bit-exactly to RGB, "png" reads a grey still — and "frames" [first, count]
keeps that run of each member's frames.

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
import subprocess
import urllib.request
import zipfile

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


def fetch_archive(spec: dict, out: str) -> zipfile.ZipFile:
    a = spec["archive"]
    path = os.path.join(out, "archives", os.path.basename(a["url"]))
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        urllib.request.urlretrieve(a["url"], path + ".part")
        os.replace(path + ".part", path)
    got = sha256(path)
    if got != a["sha256"]:
        sys.exit(f"{a['url']}: sha256 {got}, pinned {a['sha256']}")
    return zipfile.ZipFile(path)


def ffmpeg_frames(data: bytes, decode: str) -> np.ndarray:
    fmt = {"luma": "yuv420p", "rgb": "rgb24", "png": "gray"}[decode]
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                            "stream=width,height", "-of", "csv=p=0", "-"], input=data,
                           capture_output=True, check=True).stdout
    w, h = (int(v) for v in probe.decode().split(",")[:2])
    raw = subprocess.run(["ffmpeg", "-v", "error", "-threads", "1", "-i", "-", "-sws_flags",
                          "bicubic+accurate_rnd+full_chroma_int+bitexact", "-f", "rawvideo",
                          "-pix_fmt", fmt, "-"], input=data, capture_output=True, check=True).stdout
    if decode == "luma":
        size = w * h + 2 * ((w + 1) // 2) * ((h + 1) // 2)
        a = np.frombuffer(raw, np.uint8).reshape(-1, size)[:, :w * h]
        return a.reshape(-1, h, w)
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w, *((3,) if decode == "rgb" else ()))


def archive_frames(spec: dict, out: str):
    """Yields each member's frames, after checking the member against its pin."""
    zf = fetch_archive(spec, out)
    first, count = spec.get("frames", (0, None))
    for m in spec["members"]:
        data = zf.read(m["name"])
        got = hashlib.sha256(data).hexdigest()
        if got != m["sha256"]:
            sys.exit(f"{m['name']}: sha256 {got}, pinned {m['sha256']}")
        yield from ffmpeg_frames(data, spec["decode"])[first:first + count if count else None]


def frames(ds) -> np.ndarray:
    a = ds.pixel_array
    multi = int(ds.get("NumberOfFrames", 1)) > 1
    return a if multi else a[None]


class Archived:
    """What extract() reads from a DICOM header, for an archive's frames."""

    def __init__(self, f: np.ndarray):
        self.PixelRepresentation, self.BitsAllocated, self.BitsStored = 0, 8, 8
        self.Rows, self.Columns = f.shape[:2]
        self.SamplesPerPixel = 3 if f.ndim == 3 else 1
        self.PhotometricInterpretation = "RGB" if f.ndim == 3 else "MONOCHROME2"


def each_frame(spec: dict, out: str):
    if "archive" in spec:
        for f in archive_frames(spec, out):
            yield f, Archived(f)
        return
    for entry in spec["files"]:
        ds = pydicom.dcmread(fetch(entry, out))
        for f in frames(ds):
            yield f, ds


def extract(spec: dict, out: str) -> None:
    dest = os.path.join(out, spec["name"])
    os.makedirs(dest, exist_ok=True)
    digests, lo, hi, first = [], None, None, None
    y, x, h, w = spec.get("crop", (0, 0, None, None))
    for f, ds in each_frame(spec, out):
        first = ds if first is None else first
        signed = ds.PixelRepresentation == 1
        dtype = "<u1" if ds.BitsAllocated == 8 else ("<i2" if signed else "<u2")
        f = f[y:y + h if h else None, x:x + w if w else None]
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
        "width": w or int(first.Columns),
        "height": h or int(first.Rows),
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
