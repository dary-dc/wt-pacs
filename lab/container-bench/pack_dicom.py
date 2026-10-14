#!/usr/bin/env python3
"""A coded series as one DICOM multi-frame instance with an Extended Offset Table: ours (`pack`), and
pydicom's own encapsulation (`--tool`) for the round trip of docs/disk-layout/containers.md §Measured.

Frames are ingest's NNN.htj2k or NNN.av1; the identity the .sbnd draft carries (both UIDs native, each
frame's coded and samples XXH3-64 in a private block). `--fg source` adds the source's per-frame
attributes: a multi-frame source's own functional groups, or each single-frame file's position,
orientation, spacing, windowing and rescale moved into a frame's group.

usage: pack_dicom.py MANIFEST DATA SET FRAMES OUT [--fg none|source] [--tool]
"""
import argparse
import json
import struct
import sys
import time
import uuid
from pathlib import Path

import pydicom
import xxhash
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.encaps import encapsulate, encapsulate_extended
from pydicom.sequence import Sequence

HTJ2K_LOSSLESS = "1.2.840.10008.1.2.4.201"
# No DICOM transfer syntax carries the AV1 payload (docs/av1/payload-format.md): a private UID, opaque.
AV1_PAYLOAD = "2.25.%d" % uuid.uuid5(uuid.NAMESPACE_URL, "wt-pacs:av1-payload").int
CREATOR = "WTPACS IDENTITY"
SERIES_LEVEL = ("PatientID", "PatientName", "StudyInstanceUID", "StudyDate", "SeriesInstanceUID", "Modality",
                "SeriesNumber", "FrameOfReferenceUID", "Laterality")
PER_FILE = {
    "PlanePositionSequence": ("ImagePositionPatient",),
    "PlaneOrientationSequence": ("ImageOrientationPatient",),
    "PixelMeasuresSequence": ("PixelSpacing", "SliceThickness"),
    "FrameVOILUTSequence": ("WindowCenter", "WindowWidth"),
    "PixelValueTransformationSequence": ("RescaleIntercept", "RescaleSlope", "RescaleType"),
}


def sources(manifest, data, name):
    spec = next(s for s in json.loads(Path(manifest).read_text())["sets"] if s["name"] == name)
    return [pydicom.dcmread(Path(data) / "dicom" / e["key"], stop_before_pixels=True) for e in spec["files"]]


def per_frame_groups(srcs, n):
    if len(srcs) == 1 and "PerFrameFunctionalGroupsSequence" in srcs[0]:
        s = srcs[0]
        return s.get("SharedFunctionalGroupsSequence"), Sequence(list(s.PerFrameFunctionalGroupsSequence)[:n])
    frames = Sequence()
    for s in srcs:
        group = Dataset()
        for seq, keys in PER_FILE.items():
            item = Dataset()
            for k in keys:
                if k in s:
                    setattr(item, k, s[k].value)
            if len(item):
                setattr(group, seq, Sequence([item]))
        ref = Dataset()
        ref.ReferencedSOPClassUID, ref.ReferencedSOPInstanceUID = s.SOPClassUID, s.SOPInstanceUID
        group.ConversionSourceAttributesSequence = Sequence([ref])
        frames.append(group)
    return None, frames


def pack(manifest, data, name, frames_dir, out, fg, tool):
    meta = json.loads((Path(frames_dir) / "metadata.json").read_text())
    av1 = meta.get("codec") == "av1"
    frames = [p.read_bytes() for p in sorted(Path(frames_dir).glob("*.av1" if av1 else "*.htj2k"))]
    t = time.perf_counter()
    srcs = sources(manifest, data, name)
    first = srcs[0]
    ds = Dataset()
    for k in SERIES_LEVEL:
        if k in first:
            setattr(ds, k, first[k].value)
    ds.SOPClassUID = first.SOPClassUID
    ds.SOPInstanceUID = pydicom.uid.generate_uid()
    ds.InstanceNumber = 1
    ds.NumberOfFrames = len(frames)
    ds.Rows, ds.Columns = meta["height"], meta["width"]
    ds.SamplesPerPixel = meta["channels"]
    ds.PhotometricInterpretation = meta["photometric"]
    ds.BitsAllocated = 16 if meta["bitsStored"] > 8 else 8
    ds.BitsStored = meta["bitsStored"]
    ds.HighBit = meta["bitsStored"] - 1
    ds.PixelRepresentation = 1 if meta["signed"] else 0
    if fg == "source":
        shared, per_frame = per_frame_groups(srcs, len(frames))
        if shared is not None:
            ds.SharedFunctionalGroupsSequence = shared
        ds.PerFrameFunctionalGroupsSequence = per_frame
    block = ds.private_block(0x0009, CREATOR, create=True)
    block.add_new(0x01, "OB", b"".join(struct.pack("<Q", xxhash.xxh3_64_intdigest(f)) for f in frames))
    block.add_new(0x02, "OB", b"".join(struct.pack("<Q", int(h, 16)) for h in meta["digests"]["frames"]))
    if tool:
        ds.PixelData, ds.ExtendedOffsetTable, ds.ExtendedOffsetTableLengths = encapsulate_extended(frames)
    else:
        offsets, at = [], 0
        for f in frames:
            offsets.append(at)
            at += 8 + len(f) + len(f) % 2
        ds.PixelData = encapsulate(frames, has_bot=False)
        ds.ExtendedOffsetTable = struct.pack(f"<{len(frames)}Q", *offsets)
        ds.ExtendedOffsetTableLengths = struct.pack(f"<{len(frames)}Q", *(len(f) for f in frames))
    ds["PixelData"].VR = "OB"
    ds["PixelData"].is_undefined_length = True
    ds.file_meta = FileMetaDataset()
    ds.file_meta.MediaStorageSOPClassUID = ds.SOPClassUID
    ds.file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
    ds.file_meta.TransferSyntaxUID = AV1_PAYLOAD if av1 else HTJ2K_LOSSLESS
    ds.save_as(out, enforce_file_format=True, implicit_vr=False, little_endian=True)
    ms = (time.perf_counter() - t) * 1e3
    print(json.dumps({"arm": "dicom" + ("-fg" if fg == "source" else "") + ("-tool" if tool else ""),
                      "bytes": Path(out).stat().st_size, "pack_ms": ms}))


def main():
    ap = argparse.ArgumentParser()
    for a in ("manifest", "data", "set", "frames", "out"):
        ap.add_argument(a)
    ap.add_argument("--fg", choices=["none", "source"], default="none")
    ap.add_argument("--tool", action="store_true", help="pydicom's encapsulate_extended, lengths as it writes them")
    a = ap.parse_args()
    pack(a.manifest, a.data, a.set, a.frames, a.out, a.fg, a.tool)


if __name__ == "__main__":
    sys.exit(main())
