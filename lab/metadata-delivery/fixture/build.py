#!/usr/bin/env python3
"""The template study DB from the fetched ct series, and frame 0's samples as the stand-in coded frame.

usage: build.py DATA OUT     DATA/ct/*.dcm (fetch.py); writes OUT/template.db and OUT/frame0.gz
The groups are split by the parser's level table as lab/metadata-store/repetition/measure.py (#150) splits them.
"""
import gzip
import os
import sqlite3
import struct
import sys

import pydicom
import xxhash
from pydicom.dataelem import RawDataElement
from pydicom.filebase import DicomBytesIO
from pydicom.filewriter import write_data_element

HERE = os.path.dirname(os.path.abspath(__file__))
LEVELS = ("exam", "series", "instance", "private")
SYNTHETIC_INSTANCES = 2000
LONG_VRS = ("OB", "OW", "OF", "OD", "OL", "OV", "SQ", "UC", "UN", "UR", "UT", "SV", "UV")

SCHEMA = """
CREATE TABLE exam (uid TEXT PRIMARY KEY, grp BLOB NOT NULL, xxh3 INTEGER NOT NULL,
  patient_name TEXT, patient_id TEXT, birth_date TEXT, sex TEXT, study_date TEXT, description TEXT,
  institution TEXT, accession TEXT);
CREATE TABLE series (uid TEXT PRIMARY KEY, exam_uid TEXT NOT NULL, grp BLOB NOT NULL, xxh3 INTEGER NOT NULL,
  name TEXT NOT NULL, number INTEGER, modality TEXT, description TEXT, codec TEXT NOT NULL, bundle_digest TEXT NOT NULL);
CREATE TABLE instance (uid TEXT PRIMARY KEY, series_uid TEXT NOT NULL, grp BLOB NOT NULL, xxh3 INTEGER NOT NULL,
  number INTEGER NOT NULL, pos_x REAL, pos_y REAL, pos_z REAL, orientation TEXT, spacing TEXT,
  window_center REAL, window_width REAL, rescale_slope REAL, rescale_intercept REAL,
  rows INTEGER, columns INTEGER, samples INTEGER, bits_allocated INTEGER, bits_stored INTEGER, high_bit INTEGER,
  signed INTEGER, photometric TEXT);
CREATE INDEX instance_series ON instance (series_uid, number);
CREATE TABLE private (uid TEXT PRIMARY KEY, grp BLOB NOT NULL, xxh3 INTEGER NOT NULL);
CREATE TABLE series_paint (series_uid TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE series_gz (series_uid TEXT PRIMARY KEY, revision INTEGER NOT NULL, gz BLOB NOT NULL);
"""


def parser_levels() -> dict:
    with open(os.path.join(HERE, "parser_levels.txt")) as fh:
        return {int(tag, 16): level for tag, level, _ in (line.split() for line in fh)}


PARSER_LEVELS = parser_levels()


def record(key: bytes, value: bytes) -> bytes:
    return bytes([len(key)]) + key + struct.pack("<I", len(value)) + value


def value_bytes(raw, elem) -> bytes:
    if isinstance(raw, RawDataElement):
        return raw.value or b""
    out = DicomBytesIO()
    out.is_little_endian, out.is_implicit_VR = True, False
    write_data_element(out, elem)
    return out.getvalue()[12 if elem.VR in LONG_VRS else 8:]


def walk(ds, path: bytes, root_level, groups: dict) -> None:
    for tag in sorted(ds._dict):
        raw = ds._dict[tag]
        elem = ds[tag]
        group, element = tag >> 16, tag & 0xFFFF
        vr = (raw.VR if isinstance(raw, RawDataElement) and raw.VR else elem.VR)[:2]
        if element == 0 or tag == 0x00080005 or group == 0x7FE0:
            continue
        if vr == "UN":
            level = "private"
        elif path:
            level = root_level
        elif group == 2 or group & 1:
            level = "private"
        else:
            level = PARSER_LEVELS.get(tag, "instance")
        if vr == "SQ":
            for n, item in enumerate(elem.value, 1):
                walk(item, path + struct.pack(">HHI", group, element, n), level, groups)
            continue
        key = path + struct.pack(">HH", group, element) + vr.encode() + b"\0\0"
        groups[level].append(record(key, value_bytes(raw, elem)))


def groups_of(ds) -> dict:
    groups = {level: [] for level in LEVELS}
    walk(ds.file_meta, b"", None, groups)
    walk(ds, b"", None, groups)
    return {level: b"".join(records) for level, records in groups.items()}


def first(value) -> float:
    return float(value[0] if isinstance(value, pydicom.multival.MultiValue) else value)


def text(value) -> str:
    return "" if value is None else str(value)


def xxh3(data: bytes) -> int:
    """XXH3-64 as SQLite's signed INTEGER holds it."""
    v = xxhash.xxh3_64_intdigest(data)
    return v - (1 << 64) if v >> 63 else v


def instance_row(ds, uid: str, series_uid: str, grp: bytes, number: int, z: float) -> tuple:
    x, y, _ = (float(v) for v in ds.ImagePositionPatient)
    return (uid, series_uid, grp, xxh3(grp), number, x, y, z,
            "\\".join(str(float(v)) for v in ds.ImageOrientationPatient),
            "\\".join(str(float(v)) for v in ds.PixelSpacing),
            first(ds.WindowCenter), first(ds.WindowWidth), float(ds.RescaleSlope), float(ds.RescaleIntercept),
            ds.Rows, ds.Columns, ds.SamplesPerPixel, ds.BitsAllocated, ds.BitsStored, ds.HighBit,
            ds.PixelRepresentation, str(ds.PhotometricInterpretation))


def main() -> None:
    data, out = sys.argv[1:3]
    folder = os.path.join(data, "ct")
    files = [pydicom.dcmread(os.path.join(folder, name)) for name in sorted(os.listdir(folder))]
    files.sort(key=lambda ds: int(ds.InstanceNumber))
    os.makedirs(out, exist_ok=True)
    head = files[0]
    frame0 = gzip.compress(head.pixel_array.astype("<i2" if head.PixelRepresentation else "<u2").tobytes(), 6)
    with open(os.path.join(out, "frame0.gz"), "wb") as fh:
        fh.write(frame0)
    path = os.path.join(out, "template.db")
    if os.path.exists(path):
        os.unlink(path)
    db = sqlite3.connect(path)
    db.executescript(SCHEMA)
    split = [(ds, groups_of(ds)) for ds in files]
    exam = split[0][1]["exam"]
    db.execute("INSERT INTO exam VALUES (?,?,?,?,?,?,?,?,?,?,?)",
               (str(head.StudyInstanceUID), exam, xxh3(exam), text(head.get("PatientName")),
                text(head.get("PatientID")), text(head.get("PatientBirthDate")), text(head.get("PatientSex")),
                text(head.get("StudyDate")), text(head.get("StudyDescription")), text(head.get("InstitutionName")),
                text(head.get("AccessionNumber"))))
    step = float(files[1].ImagePositionPatient[2]) - float(head.ImagePositionPatient[2])
    for name, count in (("ct", len(files)), ("ct2000", SYNTHETIC_INSTANCES)):
        series_uid = str(head.SeriesInstanceUID) + ("" if name == "ct" else ".2000")
        series = split[0][1]["series"]
        digest = f"{xxhash.xxh3_64_intdigest(frame0 + series_uid.encode()):016x}"
        db.execute("INSERT INTO series VALUES (?,?,?,?,?,?,?,?,?,?)",
                   (series_uid, str(head.StudyInstanceUID), series, xxh3(series), name, int(head.SeriesNumber),
                    str(head.Modality), text(head.get("SeriesDescription")), "htj2k", digest))
        for n in range(count):
            ds, groups = split[n % len(split)]
            uid = str(ds.SOPInstanceUID) + ("" if name == "ct" else f".{n}")
            z = float(head.ImagePositionPatient[2]) + n * step
            db.execute(f"INSERT INTO instance VALUES ({','.join('?' * 22)})",
                       instance_row(ds, uid, series_uid, groups["instance"], n + 1, z))
            if name == "ct":
                db.execute("INSERT INTO private VALUES (?,?,?)", (uid, groups["private"], xxh3(groups["private"])))
    db.commit()
    db.execute("VACUUM")
    db.close()
    print(f"{path}: {os.path.getsize(path)} B; frame0.gz {len(frame0)} B")


if __name__ == "__main__":
    main()
