"""A DICOM series as the ingest core codes it, and its display attributes — docs/FIXTURES.md §From DICOM."""
import hashlib
from pathlib import Path

import numpy as np
import pydicom
from pydicom.uid import UID

NATIVE = {"1.2.840.10008.1.2", "1.2.840.10008.1.2.1", "1.2.840.10008.1.2.1.99", "1.2.840.10008.1.2.2"}
RLE = "1.2.840.10008.1.2.5"
# Lossless, but pydicom decodes them only through a plugin this ingest does not pin.
UNPINNED = {"1.2.840.10008.1.2.4.57", "1.2.840.10008.1.2.4.70", "1.2.840.10008.1.2.4.80", "1.2.840.10008.1.2.4.90",
            "1.2.840.10008.1.2.4.201", "1.2.840.10008.1.2.4.202"}
SAME = ("SeriesInstanceUID", "Rows", "Columns", "BitsAllocated", "BitsStored", "PhotometricInterpretation")
PHOTOMETRIC = {"MONOCHROME1", "MONOCHROME2", "RGB"}


class Refused(Exception):
    pass


class DicomSeries:
    """frame(i) → h×w×c samples in stored order; the attributes ingest/coded-frames/ingest.py reads of a set."""

    def __init__(self, frames, first):
        self.frames = frames
        self.n = len(frames)
        self.h, self.w, self.ch = frames[0].shape
        self.stored, self.signed = int(first.BitsStored), first.PixelRepresentation == 1
        self.dtype = frames[0].dtype
        self.lo = int(min(f.min() for f in frames))
        self.hi = int(max(f.max() for f in frames))
        self.offset = -self.lo if self.lo < 0 else 0
        self.truth = [hashlib.sha256(f.tobytes()).hexdigest() for f in frames]

    def frame(self, i):
        return self.frames[i]

    def part(self, a, b):
        """The same series carrying frames [a, b) alone: what one encoder process is sent."""
        piece = object.__new__(DicomSeries)
        piece.__dict__.update(self.__dict__, frames=[f if a <= i < b else None for i, f in enumerate(self.frames)])
        return piece


def objects(path):
    """One multi-frame object, or a folder of single-frame objects of one series in InstanceNumber order."""
    path = Path(path)
    if path.is_file():
        return [pydicom.dcmread(path)]
    files = sorted(p for p in path.iterdir() if p.is_file())
    if not files:
        raise Refused(f"{path}: no file")
    ds = []
    for f in files:
        try:
            ds.append(pydicom.dcmread(f))
        except pydicom.errors.InvalidDicomError:
            raise Refused(f"{f.name}: not DICOM") from None
    for d, f in zip(ds, files):
        if int(d.get("NumberOfFrames", 1)) > 1:
            raise Refused(f"{f.name}: a multi-frame object in a folder of single frames")
        for k in SAME:
            if d.get(k) != ds[0].get(k):
                raise Refused(f"{f.name}: {k} {d.get(k)}, not {ds[0].get(k)} as {files[0].name}")
        if "InstanceNumber" not in d:
            raise Refused(f"{f.name}: no InstanceNumber to order it by")
    order = sorted(range(len(ds)), key=lambda i: int(ds[i].InstanceNumber))
    for a, b in zip(order, order[1:]):
        if int(ds[a].InstanceNumber) == int(ds[b].InstanceNumber):
            raise Refused(f"{files[a].name} and {files[b].name}: both InstanceNumber {ds[a].InstanceNumber}")
    return [ds[i] for i in order]


def samples(ds):
    """Every frame of one object, n×h×w×c, little-endian, colour interleaved, signed samples sign-extended."""
    ts = UID(ds.file_meta.TransferSyntaxUID)
    if ts in UNPINNED:
        raise Refused(f"{ts.name}: lossless, but its decoder plugin is not pinned here")
    if ts not in NATIVE and ts != RLE:
        raise Refused(f"{ts.name}: lossy, or not a syntax this ingest reads; its samples may not be the original's")
    if ds.PhotometricInterpretation not in PHOTOMETRIC:
        raise Refused(f"PhotometricInterpretation {ds.PhotometricInterpretation}: MONOCHROME1, MONOCHROME2 or RGB only")
    alloc, stored, high = int(ds.BitsAllocated), int(ds.BitsStored), int(ds.HighBit)
    signed, spp = ds.PixelRepresentation == 1, int(ds.SamplesPerPixel)
    if alloc not in (8, 16) or not 0 < stored <= alloc or high >= alloc:
        raise Refused(f"BitsAllocated {alloc}, BitsStored {stored}, HighBit {high}: 8 or 16 bits allocated only")
    n, rows, cols = int(ds.get("NumberOfFrames", 1)), int(ds.Rows), int(ds.Columns)
    dtype = ("i1" if signed else "u1") if alloc == 8 else ("<i2" if signed else "<u2")
    if ts == RLE:
        # pydicom's own RLE decoder, sign and planes already handled: not an independent path.
        return np.asarray(ds.pixel_array, dtype).reshape(n, rows, cols, spp)
    raw = np.frombuffer(ds.PixelData, (">" if ts == "1.2.840.10008.1.2.2" else "<") + ("u1" if alloc == 8 else "u2"),
                        count=n * rows * cols * spp)
    planar = spp > 1 and ds.get("PlanarConfiguration", 0) == 1
    a = raw.reshape(n, spp, rows, cols).transpose(0, 2, 3, 1) if planar else raw.reshape(n, rows, cols, spp)
    if stored == alloc:
        return np.ascontiguousarray(a, a.dtype.newbyteorder("<")).view(dtype)
    v = (a.astype(np.int32) >> (high + 1 - stored)) & ((1 << stored) - 1)
    if signed:
        v = np.where(v >> (stored - 1) == 1, v - (1 << stored), v)
    return np.ascontiguousarray(v.astype(dtype))


def series(path):
    ds = objects(path)
    frames = [f for d in ds for f in samples(d)]
    return DicomSeries(frames, ds[0]), ds


def floats(v):
    return [float(x) for x in (v if isinstance(v, pydicom.multival.MultiValue) else [v])]


def group(fg, seq):
    return fg[seq][0] if fg is not None and seq in fg else None


def frame_display(d, per=None, shared=None):
    """One frame's rescale and window: its per-frame group over the shared group over the object's own."""
    def pick(seq):
        for g in (group(per, seq), group(shared, seq)):
            if g is not None:
                return g
        return d

    t, w = pick("PixelValueTransformationSequence"), pick("FrameVOILUTSequence")
    out = {"rescale": {"slope": float(t.get("RescaleSlope", 1)), "intercept": float(t.get("RescaleIntercept", 0))}}
    if "WindowCenter" in w:
        out["window"] = {"center": floats(w.WindowCenter), "width": floats(w.WindowWidth),
                         "function": str(w.get("VOILUTFunction", "LINEAR"))}
    return out


def display(ds):
    """Per series, with `perFrame` holding each attribute that varies; no patient or study identifier."""
    first = ds[0]
    frames = []
    for d in ds:
        shared = d.get("SharedFunctionalGroupsSequence", [None])[0]
        per = d.get("PerFrameFunctionalGroupsSequence")
        n = int(d.get("NumberOfFrames", 1))
        frames += [frame_display(d, per[i] if per else None, shared) for i in range(n)]
    meta = {"width": int(first.Columns), "height": int(first.Rows), "channels": int(first.SamplesPerPixel),
            "bitsAllocated": int(first.BitsAllocated), "bitsStored": int(first.BitsStored), "highBit": int(first.HighBit),
            "signed": first.PixelRepresentation == 1, "photometric": str(first.PhotometricInterpretation),
            "modality": str(first.get("Modality", ""))}
    if "FrameTime" in first:
        meta["frameTimeMs"] = float(first.FrameTime)
    if "CineRate" in first:
        meta["cineRate"] = float(first.CineRate)
    varying = {}
    for k in ("rescale", "window"):
        values = [f.get(k) for f in frames]
        if any(v != values[0] for v in values):
            varying[k] = values
        elif values[0] is not None:
            meta[k] = values[0]
    if varying:
        meta["perFrame"] = varying
    return meta
