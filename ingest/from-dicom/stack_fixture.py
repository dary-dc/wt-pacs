#!/usr/bin/env python3
"""A fetched set (lab/av1/fetch_data.py's OUT/<set>/NNN.raw, docs/FIXTURES.md §AV1 data) as the ingest's input, and a
bundle's metadata held to that set's pin.

usage: stack_fixture.py dicom SET_DIR OUT.dcm --size H W --channels C --modality M [--cine-rate R]
       stack_fixture.py same SET_DIR MANIFEST NAME BUNDLE.metadata.json
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import xxhash
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

US_MULTIFRAME = "1.2.840.10008.5.1.4.1.1.3.1"


def raws(set_dir):
    return sorted(Path(set_dir).glob("[0-9][0-9][0-9].raw"))


def dicom(a):
    """8-bit frames as one multi-frame object, explicit little-endian; RGB colour-by-pixel as fetched."""
    frames = [f.read_bytes() for f in raws(a.set_dir)]
    h, w = a.size
    if not frames or any(len(f) != h * w * a.channels for f in frames):
        sys.exit(f"{a.set_dir}: frames are not {a.channels} × {h}×{w} bytes each")
    ds = Dataset()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = US_MULTIFRAME
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.SOPClassUID, ds.SOPInstanceUID = US_MULTIFRAME, ds.file_meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID, ds.SeriesInstanceUID, ds.Modality = generate_uid(), generate_uid(), a.modality
    ds.Rows, ds.Columns, ds.SamplesPerPixel = h, w, a.channels
    ds.PhotometricInterpretation = "RGB" if a.channels == 3 else "MONOCHROME2"
    if a.channels == 3:
        ds.PlanarConfiguration = 0
    ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 8, 8, 7, 0
    ds.NumberOfFrames = len(frames)
    if a.cine_rate:
        ds.CineRate, ds.FrameTime = a.cine_rate, 1000 / a.cine_rate
    ds.PixelData = b"".join(frames)
    ds.save_as(a.out, enforce_file_format=True)


def same(a):
    """The set's frames are its pin, and the bundle's digests are the XXH3-64 of those frames' bytes in order."""
    files = raws(a.set_dir)
    sets = {s["name"]: s for s in json.loads(Path(a.manifest).read_text())["sets"]}
    hexes = "".join(hashlib.sha256(f.read_bytes()).hexdigest() for f in files)
    if hashlib.sha256(hexes.encode()).hexdigest() != sets[a.name]["frames_sha256"]:
        sys.exit(f"{a.set_dir}: its {len(files)} frames are not {a.name}'s pin in {a.manifest}")
    meta = json.loads(Path(a.metadata).read_text())
    want = [xxhash.xxh3_64_hexdigest(f.read_bytes()) for f in files]
    got = meta.get("digests", {}).get("frames", [])
    if got != want:
        bad = [i for i in range(max(len(got), len(want))) if got[i:i + 1] != want[i:i + 1]]
        sys.exit(f"{a.metadata}: {len(got)} digests against {a.name}'s {len(want)} pinned frames, frames {bad[:5]} differ")
    print(f"{a.name}: {len(want)} frames, each bundle digest the pinned frame's")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("dicom")
    d.add_argument("set_dir")
    d.add_argument("out")
    d.add_argument("--size", type=int, nargs=2, required=True, metavar=("H", "W"))
    d.add_argument("--channels", type=int, choices=[1, 3], default=1)
    d.add_argument("--modality", default="US")
    d.add_argument("--cine-rate", type=int)
    s = sub.add_parser("same")
    s.add_argument("set_dir")
    s.add_argument("manifest")
    s.add_argument("name")
    s.add_argument("metadata")
    a = ap.parse_args()
    dicom(a) if a.cmd == "dicom" else same(a)


if __name__ == "__main__":
    main()
