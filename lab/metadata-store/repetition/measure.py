#!/usr/bin/env python3
"""Split each fetched series into the parser's groups, then weigh them, compress them and count what repeats.

usage: measure.py DATA [--ojph DIR] [--rounds N] [NAME ...]   one JSON line per series on stdout
"""
import argparse
import io
import json
import os
import statistics
import struct
import subprocess
import tarfile
import tempfile
import time

import blake3
import pydicom
import zstandard
from pydicom.dataelem import RawDataElement
from pydicom.filebase import DicomBytesIO
from pydicom.filewriter import write_data_element

HERE = os.path.dirname(os.path.abspath(__file__))
LEVELS = ("exam", "series", "instance", "private")
MARKERS = {"exam": "--", "series": "---", "instance": "----", "private": "priv"}
ZSTD_LEVELS = (1, 3, 9, 19)
HTJ2K_ARGS = ["-num_decomps", "5", "-block_size", "{64,64}", "-prog_order", "RPCL", "-reversible", "true"]
UID_DIGITS = "\0\\^-+.0123456789"
UID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~"


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
    return out.getvalue()[12 if elem.VR in ("OB", "OW", "OF", "OD", "OL", "OV", "SQ", "UC", "UN", "UR", "UT", "SV",
                                            "UV") else 8:]


def walk(ds, path: bytes, root_level, groups: dict) -> int:
    """Append ds's records to groups by the parser's rule; returns the top level's pixel data bytes."""
    pixels = 0
    for tag in sorted(ds._dict):
        raw = ds._dict[tag]
        elem = ds[tag]
        group, element = tag >> 16, tag & 0xFFFF
        vr = (raw.VR if isinstance(raw, RawDataElement) and raw.VR else elem.VR)[:2]
        if element == 0 or tag == 0x00080005:
            continue
        if group == 0x7FE0:
            pixels += len(value_bytes(raw, elem)) if not path else 0
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
        groups[level].append((key, value_bytes(raw, elem)))
    return pixels


def split(path: str):
    ds = pydicom.dcmread(path)
    groups = {level: [] for level in LEVELS}
    pixels = walk(ds.file_meta, b"", None, groups) + walk(ds, b"", None, groups)
    return ds, groups, pixels


def coded_uid(uid: str) -> str:
    """contract.md §The layout's coding of a UID into a directory name."""
    n = [UID_DIGITS.index(c) for c in uid]
    out = []
    for i in range(0, len(n) - len(n) % 3, 3):
        v = n[i] << 8 | n[i + 1] << 4 | n[i + 2]
        out += [UID_ALPHABET[v >> 6], UID_ALPHABET[v & 63]]
    rest = n[len(n) - len(n) % 3:]
    if len(rest) == 1:
        out += [UID_ALPHABET[rest[0] << 2], "0"]
    elif len(rest) == 2:
        out += [UID_ALPHABET[(rest[0] << 2) + (rest[1] >> 2)], UID_ALPHABET[(rest[1] & 3) << 4]]
    return "".join(out)


def htj2k_bytes(ds, ojph: str) -> int:
    """The frames coded as the ingest codes them, each decoded back and compared; codestream bytes."""
    px = ds.pixel_array
    frames = int(ds.get("NumberOfFrames") or 1)
    px = px.reshape(frames, ds.Rows, ds.Columns, -1)
    stored, signed = ds.BitsStored, ds.PixelRepresentation == 1
    shift, maxval = (1 << (stored - 1) if signed else 0), (1 << stored) - 1
    env = {"LD_LIBRARY_PATH": os.path.join(ojph, "lib")}
    total = 0
    with tempfile.TemporaryDirectory() as tmp:
        ext = ".pgm" if px.shape[3] == 1 else ".ppm"
        src, cs, back = (os.path.join(tmp, n) for n in ("in" + ext, "out.j2c", "back" + ext))
        for frame in px:
            body = (frame.astype("int32") + shift).astype(">u2" if maxval > 255 else "u1").tobytes()
            head = b"%s\n%d %d\n%d\n" % (b"P5" if ext == ".pgm" else b"P6", ds.Columns, ds.Rows, maxval)
            with open(src, "wb") as fh:
                fh.write(head + body)
            subprocess.run([os.path.join(ojph, "bin/ojph_compress"), "-i", src, "-o", cs, *HTJ2K_ARGS],
                           check=True, capture_output=True, env=env)
            subprocess.run([os.path.join(ojph, "bin/ojph_expand"), "-i", cs, "-o", back],
                           check=True, capture_output=True, env=env)
            with open(back, "rb") as fh:
                if not fh.read().endswith(body):
                    raise SystemExit(f"{ds.SOPInstanceUID}: a frame does not decode back")
            total += os.path.getsize(cs)
    return total


def group_files(instances: list) -> list:
    """(path, bytes) of every group file the parser writes for the series, exam and series groups once."""
    first = instances[0]
    exam = f"PbPb/{coded_uid(first['study'])}"
    series = f"{exam}/{coded_uid(first['series'])}"
    out = []
    for level, folder in (("exam", exam), ("series", series)):
        data = first["files"][level]
        out.append((f"{folder}/{MARKERS[level]}.{blake3.blake3(data).hexdigest()}", data))
    for inst in instances:
        for level in ("instance", "private"):
            data = inst["files"][level]
            if data:
                out.append((f"{series}/{coded_uid(inst['sop'])}/{MARKERS[level]}.{blake3.blake3(data).hexdigest()}",
                            data))
    return out


def tar_stream(files: list) -> bytes:
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w", format=tarfile.PAX_FORMAT) as tar:
        for name, data in files:
            info = tarfile.TarInfo(name)
            info.size, info.mtime, info.mode = len(data), 0, 0o644
            tar.addfile(info, io.BytesIO(data))
    return out.getvalue()


def timed(fn) -> float:
    t = time.perf_counter_ns()
    fn()
    return (time.perf_counter_ns() - t) / 1e6


def zstd_arms(files: list, stream: bytes, rounds: int) -> dict:
    """Ratio, compress and decompress ms per level, per file and as one stream, arms rotated round by round."""
    blobs = [data for _, data in files]
    arms = [(level, mode) for level in ZSTD_LEVELS for mode in ("per_file", "stream")]
    comp = {level: zstandard.ZstdCompressor(level=level) for level in ZSTD_LEVELS}
    dec = zstandard.ZstdDecompressor()
    packed = {}
    for level, mode in arms:
        packed[level, mode] = [comp[level].compress(b) for b in blobs] if mode == "per_file" else [comp[level].compress(stream)]
    times = {arm: ([], []) for arm in arms}
    for r in range(rounds):
        for level, mode in arms[r % len(arms):] + arms[:r % len(arms)]:
            src = blobs if mode == "per_file" else [stream]
            c, d = comp[level], packed[level, mode]
            times[level, mode][0].append(timed(lambda: [c.compress(b) for b in src]))
            times[level, mode][1].append(timed(lambda: [dec.decompress(b) for b in d]))
    raw = sum(len(b) for b in blobs)
    out = {}
    for (level, mode), (ct, dt) in times.items():
        size = sum(len(b) for b in packed[level, mode])
        out[f"{mode}_{level}"] = {"bytes": size, "ratio": raw / size, "compress_ms": statistics.median(ct),
                                  "decompress_ms": statistics.median(dt)}
    return out


def repetition(instances: list, level: str) -> dict:
    """Each record key of the level, classed constant, varying or partial across the series' instances."""
    seen = {}
    for inst in instances:
        for key, value in inst["groups"][level]:
            seen.setdefault(key, []).append(value)
    n = len(instances)
    classes = {}
    for key, values in seen.items():
        classes[key] = "partial" if len(values) < n else "constant" if len(set(values)) == 1 else "varying"
    count = {c: sum(1 for k in classes if classes[k] == c) for c in ("constant", "varying", "partial")}
    weight = {c: 0 for c in count}
    for inst in instances:
        for key, value in inst["groups"][level]:
            weight[classes[key]] += len(record(key, value))
    shared = sum(len(record(k, seen[k][0])) for k, c in classes.items() if c == "constant")
    named = sorted((key_name(k), c) for k, c in classes.items() if c != "constant")
    return {"attributes": count, "bytes": weight, "shared_once": shared,
            "shared_plus_per_instance": shared + weight["varying"] + weight["partial"], "not_constant": named}


def key_name(key: bytes) -> str:
    tags = [struct.unpack(">HH", key[i:i + 4]) for i in range(0, len(key), 8)]
    names = []
    for g, e in tags:
        word = pydicom.datadict.keyword_for_tag(g << 16 | e)
        names.append(word or f"({g:04X},{e:04X})")
    return ".".join(names)


def measure(name: str, folder: str, ojph, rounds: int) -> dict:
    instances, pixels, coded = [], 0, 0
    for fname in sorted(os.listdir(folder)):
        ds, groups, px = split(os.path.join(folder, fname))
        files = {level: b"".join(record(k, v) for k, v in groups[level]) for level in LEVELS}
        instances.append({"study": ds.StudyInstanceUID, "series": ds.SeriesInstanceUID, "sop": ds.SOPInstanceUID,
                          "groups": groups, "files": files})
        pixels += px
        coded += htj2k_bytes(ds, ojph) if ojph else 0
    per_level = {level: [len(i["files"][level]) for i in instances] for level in LEVELS}
    distinct = {level: len({i["files"][level] for i in instances}) for level in ("exam", "series")}
    files = group_files(instances)
    meta = sum(len(d) for _, d in files)
    stream = tar_stream(files)
    zstd = zstd_arms(files, stream, rounds)
    rows = {level: sum(per_level[level]) for level in ("instance", "private")}
    blob = b"".join(i["files"]["instance"] + i["files"]["private"] for i in instances)
    rep = {level: repetition(instances, level) for level in ("instance", "private")}
    split_blob = zstandard.ZstdCompressor(level=3).compress(blob)
    return {
        "series": name, "instances": len(instances),
        "bytes": {"exam": per_level["exam"][0], "series": per_level["series"][0], "instance": rows["instance"],
                  "instance_min": min(per_level["instance"]), "instance_median": statistics.median(per_level["instance"]),
                  "instance_max": max(per_level["instance"]), "private": rows["private"],
                  "private_min": min(per_level["private"]), "private_max": max(per_level["private"]),
                  "metadata": meta, "tar": len(stream), "pixels_stored": pixels, "pixels_htj2k": coded or None},
        "records": {level: statistics.median(len(i["groups"][level]) for i in instances) for level in LEVELS},
        "distinct_groups": distinct,
        "zstd": zstd,
        "repetition": rep,
        "layouts": {"row_per_group": rows["instance"] + rows["private"], "blob_per_series": len(blob),
                    "blob_per_series_zstd3": len(split_blob),
                    "shared_plus_per_instance": sum(rep[level]["shared_plus_per_instance"] for level in rep)},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("data")
    ap.add_argument("names", nargs="*")
    ap.add_argument("--ojph", help="an OpenJPH 0.31.0 install (bin/, lib/); without it no HTJ2K size")
    ap.add_argument("--rounds", type=int, default=15)
    args = ap.parse_args()
    manifest = json.load(open(os.path.join(HERE, "series.json")))
    for series in manifest["series"]:
        if not args.names or series["name"] in args.names:
            row = measure(series["name"], os.path.join(args.data, series["name"]), args.ojph, args.rounds)
            print(json.dumps(row), flush=True)


if __name__ == "__main__":
    main()
