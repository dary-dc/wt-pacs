#!/usr/bin/env python3
"""Run the parser's directory output on each fetched series, then weigh, compress and compare what it wrote.

usage: measure_parser.py DATA PARSER OUT [--rounds N] [NAME ...]   one JSON line per series on stdout
DATA as ../repetition/fetch.py writes it, PARSER the ESIPFfiled that build.sh prints, OUT emptied per series.
"""
import argparse
import json
import os
import shutil
import statistics
import struct
import subprocess
import sys

import blake3
import pydicom
import zstandard
from pydicom.uid import ExplicitVRLittleEndian

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "repetition"))
import measure as split  # noqa: E402

MARKERS = {"--": "exam", "---": "series", "----": "instance", "priv": "private"}
FRAME_DIRS = ("G", "P", "R")
# frames coded HTJ2K-lossless by ../repetition (its README §Repetition), the same pixels
HTJ2K_BYTES = {"ct": 41_184_983, "pt": 7_707_320, "mr": 25_959_791, "mg": 3_480_592, "us": 78_499_765}

LEGACY_CONVERTED = {"CT": "1.2.840.10008.5.1.4.1.1.2.2", "MR": "1.2.840.10008.5.1.4.1.1.4.4",
                    "PT": "1.2.840.10008.5.1.4.1.1.128.1"}
SHARED, PER_FRAME = (0x5200, 0x9229), (0x5200, 0x9230)
UNASSIGNED_SHARED, UNASSIGNED_PER_FRAME = (0x0020, 0x9170), (0x0020, 0x9171)
FRAME_CONTENT, CONVERSION_SOURCE, DERIVATION_IMAGE = (0x0020, 0x9111), (0x0020, 0x9172), (0x0008, 0x9124)
FRAME_TYPE_SEQUENCE = {"CT": (0x0018, 0x9329), "MR": (0x0018, 0x9226), "PT": (0x0018, 0x9751)}
MACROS = {
    (0x0028, 0x9110): ((0x0028, 0x0030), (0x0018, 0x0050), (0x0018, 0x0088)),
    (0x0020, 0x9113): ((0x0020, 0x0032),),
    (0x0020, 0x9116): ((0x0020, 0x0037),),
    (0x0028, 0x9132): ((0x0028, 0x1050), (0x0028, 0x1051), (0x0028, 0x1055)),
    (0x0028, 0x9145): ((0x0028, 0x1052), (0x0028, 0x1053), (0x0028, 0x1054)),
    (0x0018, 0x9477): ((0x0008, 0x3010),),
}
TOP_LEVEL = {(0x0008, 0x0008), (0x0008, 0x0012), (0x0008, 0x0013), (0x0008, 0x0014), (0x0008, 0x0016),
             (0x0008, 0x0018), (0x0008, 0x0023), (0x0008, 0x0033), (0x0020, 0x0013), (0x0028, 0x0002),
             (0x0028, 0x0004), (0x0028, 0x0006), (0x0028, 0x0008), (0x0028, 0x0010), (0x0028, 0x0011),
             (0x0028, 0x0034), (0x0028, 0x0100), (0x0028, 0x0101), (0x0028, 0x0102), (0x0028, 0x0103),
             (0x0028, 0x0301), (0x0028, 0x2110), (0x0028, 0x2112), (0x0028, 0x2114), (0x2050, 0x0020)}


def records(data: bytes) -> list:
    """(key, value) of every record in a group file; refuses bytes that are not whole records."""
    out, i = [], 0
    while i < len(data):
        kl = data[i]
        if i + 5 + kl > len(data):
            raise ValueError(f"record at {i} runs past the end")
        key = data[i + 1:i + 1 + kl]
        vl = struct.unpack_from("<I", data, i + 1 + kl)[0]
        end = i + 5 + kl + vl
        if end > len(data):
            raise ValueError(f"value at {i} runs past the end")
        out.append((key, data[i + 5 + kl:end]))
        i = end
    return out


def tag(key: bytes) -> tuple:
    return struct.unpack(">HH", key[:4])


def masked(key: bytes) -> bytes:
    """A nested key with what the parser writes there from a pointer zeroed: every byte from the 16th on."""
    return key if len(key) == 8 else key[:15] + bytes(len(key) - 15)


def masked_group(group: list) -> list:
    """The group's keys masked, a repeat of a masked key within the group numbered in its last byte to stay apart."""
    seen, out = {}, []
    for key, value in group:
        m = masked(key)
        seen[m] = seen.get(m, -1) + 1
        out.append((m[:-1] + bytes([seen[m]]) if seen[m] else m, value))
    return out


def nest(path: list, key: bytes) -> bytes:
    """DECK's key for `key` inside the sequences of `path`, each (tag, item number)."""
    return b"".join(struct.pack(">HHI", g, e, n) for (g, e), n in path) + key


def top_key(t: tuple, vr: bytes) -> bytes:
    return struct.pack(">HH", *t) + vr + b"\0\0"


def roots(group: list) -> dict:
    """A group's records by the top-level attribute they belong to, a sequence with everything inside it."""
    out = {}
    for key, value in group:
        out.setdefault(tag(key), []).append((key, value))
    return out


def converted_enhanced(instances: list, modality: str, keyed=lambda k: k) -> list:
    """The records of one Legacy Converted Enhanced instance made of the series (PS3.3 A.70-A.72, C.7.6.16), simulated.

    A Functional Group goes in the Shared Functional Groups Sequence when its records are the same in every instance,
    else in every frame's Per-Frame item; Frame Content and Conversion Source are per-frame by the standard; every
    other attribute, private included, goes once in Unassigned Shared when constant, else per frame. `keyed` maps a
    parser key before comparison and writing (masked, to see the parser's key defect removed).
    """
    frames = [{t: [(keyed(k), v) for k, v in rs] for t, rs in
               roots(inst["groups"]["instance"] + inst["groups"]["private"]).items()} for inst in instances]
    n = len(frames)
    first = frames[0]
    out = []

    def placed(tags_by_frame: list, wrap: list):
        same = all(f == tags_by_frame[0] for f in tags_by_frame)
        for number, recs in enumerate(tags_by_frame[:1] if same else tags_by_frame, 1):
            base = [(SHARED, 1)] if same else [(PER_FRAME, number)]
            out.extend((nest(base + wrap, k), v) for k, v in recs)

    taken = set()
    for t in first:
        if t[0] == 0x0002 or t in TOP_LEVEL:
            out.extend(first[t])
            taken.add(t)
    out.append((top_key((0x0028, 0x0008), b"IS"), str(n).encode() + (b" " if len(str(n)) % 2 else b"")))
    sop_class = LEGACY_CONVERTED[modality].encode()
    out = [(k, sop_class + b"\0" * (len(sop_class) % 2) if tag(k) == (0x0008, 0x0016) else v) for k, v in out]

    for macro, members in MACROS.items():
        per_frame = [[r for m in members for r in f.get(m, [])] for f in frames]
        if any(per_frame):
            placed(per_frame, [(macro, 1)])
        taken.update(members)
    if any((0x0008, 0x0008) in f for f in frames):
        frame_type = [[(top_key((0x0008, 0x9007), b"CS"), v) for _, v in f.get((0x0008, 0x0008), [])] for f in frames]
        placed(frame_type, [(FRAME_TYPE_SEQUENCE[modality], 1)])
    for seq, wrap in (((0x0008, 0x1140), []), ((0x0008, 0x2112), [(DERIVATION_IMAGE, 1)])):
        if any(seq in f for f in frames):
            placed([f.get(seq, []) for f in frames], wrap)
            taken.add(seq)

    dated = all((0x0008, 0x0022) in f and (0x0008, 0x0032) in f for f in frames)
    numbered = all(f.get((0x0020, 0x0012), [(b"", b"")])[0][1].strip() for f in frames)
    for number, f in enumerate(frames, 1):
        content = []
        if dated:
            stamp = f[(0x0008, 0x0022)][0][1].rstrip() + f[(0x0008, 0x0032)][0][1]
            content.append((top_key((0x0018, 0x9074), b"DT"), stamp))
        if numbered:
            content.append((top_key((0x0020, 0x9156), b"US"), struct.pack("<H", int(f[(0x0020, 0x0012)][0][1]))))
        out.extend((nest([(PER_FRAME, number), (FRAME_CONTENT, 1)], k), v) for k, v in content)
        source = [(top_key((0x0008, 0x1150), b"UI"), f[(0x0008, 0x0016)][0][1]),
                  (top_key((0x0008, 0x1155), b"UI"), f[(0x0008, 0x0018)][0][1])]
        out.extend((nest([(PER_FRAME, number), (CONVERSION_SOURCE, 1)], k), v) for k, v in source)
    taken.update({(0x0008, 0x0022), (0x0008, 0x0032)} if dated else set())
    taken.update({(0x0020, 0x0012)} if numbered else set())

    every = sorted({t for f in frames for t in f})
    for t in every:
        if t[0] == 0x0002 or t in {(0x0008, 0x0016), (0x0008, 0x0018)}:
            continue
        values = [f.get(t) for f in frames]
        if t in taken and (t not in TOP_LEVEL or all(v == values[0] for v in values)):
            continue
        if all(v is not None and v == values[0] for v in values):
            out.extend((nest([(SHARED, 1), (UNASSIGNED_SHARED, 1)], k), v) for k, v in values[0])
        else:
            for number, recs in enumerate(values, 1):
                out.extend((nest([(PER_FRAME, number), (UNASSIGNED_PER_FRAME, 1)], k), v) for k, v in recs or [])
    return sorted(out)


def explicit_copy(src: str, dst: str) -> int:
    """Copy the series to dst in Explicit VR Little Endian, the only syntax the parser reads; the files rewritten."""
    os.makedirs(dst, exist_ok=True)
    rewritten = 0
    for name in sorted(os.listdir(src)):
        ds = pydicom.dcmread(os.path.join(src, name))
        if ds.file_meta.TransferSyntaxUID == ExplicitVRLittleEndian:
            shutil.copyfile(os.path.join(src, name), os.path.join(dst, name))
            continue
        ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
        ds.save_as(os.path.join(dst, name), enforce_file_format=True)
        rewritten += 1
    return rewritten


def expected_pixels(path: str) -> int:
    ds = pydicom.dcmread(path, stop_before_pixels=True)
    return ds.Rows * ds.Columns * ds.SamplesPerPixel * ds.BitsAllocated // 8 * int(ds.get("NumberOfFrames") or 1)


def run_parser(parser: str, files: list, tree: str) -> None:
    shutil.rmtree(tree, ignore_errors=True)
    os.makedirs(tree)
    # glibc zero-fills malloc: the parser's first mkdir reads its path unterminated (../README.md §The parser's own output)
    env = {**os.environ, "MALLOC_PERTURB_": "255"}
    for path in files:
        done = subprocess.run([parser, path], cwd=tree, capture_output=True, env=env)
        if done.returncode != 0:
            raise SystemExit(f"{path}: the parser exited {done.returncode}: {done.stderr[-300:]!r}")


def survey(tree: str) -> dict:
    """Every file and directory the parser wrote, by kind, with bytes and on-disk allocation."""
    kinds, groups, instances = {}, [], {}
    for folder, dirs, names in os.walk(tree):
        rel = os.path.relpath(folder, tree)
        kinds.setdefault("directory", [0, 0, 0])
        kinds["directory"][0] += 1
        kinds["directory"][2] += os.lstat(folder).st_blocks * 512
        for name in names:
            path = os.path.join(folder, name)
            st = os.lstat(path)
            marker = name.split(".", 1)[0]
            if os.path.basename(folder) in FRAME_DIRS:
                kind = "frame"
            elif marker in MARKERS and "." in name:
                kind = MARKERS[marker]
            else:
                kind = name
            entry = kinds.setdefault(kind, [0, 0, 0])
            entry[0] += 1
            entry[1] += st.st_size
            entry[2] += st.st_blocks * 512
            if kind in ("exam", "series", "instance", "private"):
                with open(path, "rb") as fh:
                    data = fh.read()
                groups.append((os.path.join(rel, name), kind, data, name.split(".", 1)[1] == blake3.blake3(data).hexdigest()))
                if kind in ("instance", "private"):
                    instances.setdefault(rel, {"groups": {"instance": [], "private": []}})["groups"][kind] = records(data)
    return {"kinds": {k: dict(zip(("files", "bytes", "allocated"), v)) for k, v in sorted(kinds.items())},
            "groups": groups, "instances": [instances[k] for k in sorted(instances)]}


def measure(series: dict, data: str, parser: str, out: str, rounds: int) -> dict:
    name = series["name"]
    source = os.path.join(out, name + ".explicit")
    rewritten = explicit_copy(os.path.join(data, name), source)
    files = [os.path.join(source, f) for f in sorted(os.listdir(source))]
    tree = os.path.join(out, name)
    run_parser(parser, files, tree)
    seen = survey(tree)
    instances = seen["instances"]
    level_bytes = {level: [len(d) for _, k, d, _ in seen["groups"] if k == level]
                   for level in ("exam", "series", "instance", "private")}
    group_files = [(path, d) for path, _, d, _ in seen["groups"]]
    metadata = sum(len(d) for _, d in group_files)
    stream = split.tar_stream(group_files)
    pixels = seen["kinds"].get("frame", {}).get("bytes", 0)
    rows = sum(level_bytes["instance"]) + sum(level_bytes["private"])
    blob = b"".join(d for _, k, d, _ in sorted(seen["groups"]) if k in ("instance", "private"))
    masked_instances = [{"groups": {lv: masked_group(inst["groups"][lv]) for lv in ("instance", "private")}}
                        for inst in instances]
    rep = {lv: split.repetition(instances, lv) for lv in ("instance", "private")}
    rep_masked = {lv: split.repetition(masked_instances, lv) for lv in ("instance", "private")}
    row = {
        "series": name, "modality": series["modality"], "instances": len(instances), "rewritten_explicit": rewritten,
        "kinds": seen["kinds"],
        "group_hash_matches_name": sum(ok for *_, ok in seen["groups"]), "group_files": len(seen["groups"]),
        "bytes": {"exam": level_bytes["exam"], "series": level_bytes["series"],
                  "instance": sum(level_bytes["instance"]), "instance_median": statistics.median(level_bytes["instance"]),
                  "private": sum(level_bytes["private"]), "private_median": statistics.median(level_bytes["private"] or [0]),
                  "metadata": metadata, "tar": len(stream), "pixels_stored": pixels,
                  "pixels_expected": sum(expected_pixels(f) for f in files), "pixels_htj2k": HTJ2K_BYTES.get(name)},
        "nested_records": sum(len(k) > 8 for inst in instances for lv in ("instance", "private")
                              for k, _ in inst["groups"][lv]),
        "zstd": split.zstd_arms(group_files, stream, rounds),
        "repetition": rep, "repetition_masked": rep_masked,
        "layouts": {"row_per_group": rows, "blob_per_series": len(blob),
                    "blob_per_series_zstd3": len(zstandard.ZstdCompressor(level=3).compress(blob)),
                    "shared_plus_per_instance": sum(rep[lv]["shared_plus_per_instance"] for lv in rep)},
    }
    if series["modality"] in LEGACY_CONVERTED:
        for label, keyed in (("converted_enhanced", lambda k: k), ("converted_enhanced_masked", masked)):
            recs = converted_enhanced(instances, series["modality"], keyed)
            raw = b"".join(split.record(k, v) for k, v in recs)
            assert records(raw) == recs
            row["layouts"][label] = len(raw)
            row["layouts"][label + "_zstd3"] = len(zstandard.ZstdCompressor(level=3).compress(raw))
    return row


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("data")
    ap.add_argument("parser")
    ap.add_argument("out")
    ap.add_argument("names", nargs="*")
    ap.add_argument("--rounds", type=int, default=15)
    args = ap.parse_args()
    manifest = json.load(open(os.path.join(HERE, "..", "repetition", "series.json")))
    for series in manifest["series"]:
        if not args.names or series["name"] in args.names:
            row = measure(series, args.data, os.path.abspath(args.parser), args.out, args.rounds)
            print(json.dumps(row), flush=True)


if __name__ == "__main__":
    main()
