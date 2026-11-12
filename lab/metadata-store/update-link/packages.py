#!/usr/bin/env python3
"""Build every metadata-only update package of each fetched series, raw and compressed; weigh and time them.

usage: packages.py DATA OUT [--rounds N] [NAME ...]   packages under OUT/<series>/, one JSON line per package on stdout
"""
import argparse
import io
import json
import os
import statistics
import struct
import sys
import tarfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "repetition"))

import zstandard  # noqa: E402

import measure  # noqa: E402

LEVELS = (1, 3, 9)
PATIENT_NAME, BIRTH_DATE = (0x0010, 0x0010), (0x0010, 0x0030)
SERIES_DESCRIPTION, IMAGE_COMMENTS = (0x0008, 0x103E), (0x0020, 0x4000)
LEVEL_CODE = {"exam": 1, "series": 2, "instance": 3}


def key(tag: tuple, vr: str) -> bytes:
    return struct.pack(">HH", *tag) + vr.encode() + b"\0\0"


def set_op(tag: tuple, vr: str, value: bytes) -> bytes:
    return b"S" + measure.record(key(tag, vr), value)


def changed_group(level: str, uid: str, base: bytes, ops: list) -> bytes:
    """One group's differences: level, the UID naming it, the base's 8-byte hash, then its operations (#148 §4)."""
    name = uid.encode()
    return (bytes([LEVEL_CODE[level], len(name)]) + name + measure.blake3.blake3(base).digest()[:8]
            + struct.pack("<I", len(ops)) + b"".join(ops))


def header(kind: str, unit: str, compressed: bool) -> bytes:
    return (f"layout 1\nkind {kind}\nunit {unit}\nrevision 2\nsender pcs-01\nreason CORRECT\n"
            f"metadata {'zstd' if compressed else 'none'}\n").encode()


def tar(members: list) -> bytes:
    """#149 §4's container: pax tar, members in the given order, mtime, owner and mode fixed, ending at its two zero
    blocks; tarfile, GNU tar and bsdtar would pad it on to a 10 240-byte record."""
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w", format=tarfile.PAX_FORMAT) as t:
        for name, data in members:
            info = tarfile.TarInfo(name)
            info.size, info.mtime, info.mode = len(data), 0, 0o644
            t.addfile(info, io.BytesIO(data))
        end = t.offset + 2 * tarfile.BLOCKSIZE
    return out.getvalue()[:end]


def package(kind: str, unit: str, members: list, level) -> bytes:
    """Raw: each member alone. Compressed: the members as one tar, zstd at `level`, in one member (#149 §5)."""
    if level is None:
        return tar([("header", header(kind, unit, False))] + members)
    inner = zstandard.ZstdCompressor(level=level).compress(tar(members))
    return tar([("header", header(kind, unit, True)), ("metadata.tar.zst", inner)])


def corrections(instances: list) -> dict:
    """Every kind's members, from one series' split instances."""
    first = instances[0]
    files = measure.group_files(instances)
    exam_file, series_file = files[0], files[1]
    middle = sorted(instances, key=lambda i: len(i["files"]["instance"]))[len(instances) // 2]
    instance_file = next(f for f in files if measure.coded_uid(middle["sop"]) in f[0] and "/----." in f[0])
    exam_ops = [set_op(PATIENT_NAME, "PN", b"CORRECTED^NAME"), set_op(BIRTH_DATE, "DA", b"19700101")]
    comment = set_op(IMAGE_COMMENTS, "LT", b"corrected")
    fanout = b"".join(changed_group("instance", i["sop"], i["files"]["instance"], [comment]) for i in instances)
    return {
        "exam-diff": [("operations", changed_group("exam", first["study"], first["files"]["exam"], exam_ops))],
        "exam-group": [exam_file],
        "series-diff": [("operations", changed_group("series", first["series"], first["files"]["series"],
                                                      [set_op(SERIES_DESCRIPTION, "LO", b"CORRECTED DESCRIPTION")]))],
        "series-group": [series_file],
        "instance-diff": [("operations", changed_group("instance", middle["sop"], middle["files"]["instance"],
                                                        [comment]))],
        "instance-group": [instance_file],
        "fanout-diff": [("operations", fanout)],
        "fanout-groups": [f for f in files if "/----." in f[0]],
        "series-resend": files,
    }


def timed_us(fn) -> float:
    t = time.perf_counter_ns()
    fn()
    return (time.perf_counter_ns() - t) / 1e3


def cpu(members: list, rounds: int) -> dict:
    """Median µs to compress the members' tar and to decompress it, levels interleaved, the order rotated per round."""
    stream = tar(members)
    comp = {level: zstandard.ZstdCompressor(level=level) for level in LEVELS}
    packed = {level: comp[level].compress(stream) for level in LEVELS}
    dec = zstandard.ZstdDecompressor()
    times = {level: ([], []) for level in LEVELS}
    for r in range(rounds):
        order = LEVELS[r % len(LEVELS):] + LEVELS[:r % len(LEVELS)]
        for level in order:
            times[level][0].append(timed_us(lambda: comp[level].compress(stream)))
            times[level][1].append(timed_us(lambda: dec.decompress(packed[level])))
    return {f"zstd_{level}": {"compress_us": statistics.median(c), "decompress_us": statistics.median(d)}
            for level, (c, d) in times.items()}


def build(name: str, folder: str, out: str, rounds: int):
    instances = []
    for fname in sorted(os.listdir(folder)):
        ds, groups, _ = measure.split(os.path.join(folder, fname))
        instances.append({"study": ds.StudyInstanceUID, "series": ds.SeriesInstanceUID, "sop": ds.SOPInstanceUID,
                          "files": {level: b"".join(measure.record(k, v) for k, v in groups[level])
                                    for level in measure.LEVELS}})
    os.makedirs(os.path.join(out, name), exist_ok=True)
    unit = measure.coded_uid(instances[0]["series"])
    for kind, members in corrections(instances).items():
        raw = package(kind, unit, members, None)
        sizes = {"raw": len(raw), "content": sum(len(d) for _, d in members),
                 "raw_in_records": -(-len(raw) // tarfile.RECORDSIZE) * tarfile.RECORDSIZE,
                 "whole_zstd_1": len(zstandard.ZstdCompressor(level=1).compress(raw))}
        for level in LEVELS:
            sizes[f"zstd_{level}"] = len(package(kind, unit, members, level))
        for variant, data in (("raw", raw), ("zstd_1", package(kind, unit, members, 1))):
            with open(os.path.join(out, name, f"{kind}.{variant}.tar"), "wb") as fh:
                fh.write(data)
        yield {"series": name, "kind": kind, "members": len(members), "bytes": sizes, "cpu": cpu(members, rounds)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("data")
    ap.add_argument("out")
    ap.add_argument("names", nargs="*")
    ap.add_argument("--rounds", type=int, default=31)
    args = ap.parse_args()
    for series in json.load(open(os.path.join(HERE, "..", "repetition", "series.json")))["series"]:
        if not args.names or series["name"] in args.names:
            for row in build(series["name"], os.path.join(args.data, series["name"]), args.out, args.rounds):
                print(json.dumps(row), flush=True)


if __name__ == "__main__":
    main()
