#!/usr/bin/env python3
"""A fetched set written as the parser's directory output for frames: docs/ingest/contract.md.

A stand-in for the owner's C parser until phase 2 swaps it in. It writes one multi-frame instance a set, holding
the frames ingest.py reads (NNN.raw) as they are, and the attributes a frame needs to be read; the set has no
study UID, instance UID or study date, so the UIDs are made from its name and the date is absent.

usage: mirror.py SET_DIR OUT   — prints the series directory it wrote
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

import blake3

ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~"
NIBBLE = {c: i for i, c in enumerate("\0\\^-+.0123456789")}
FRAME_SUFFIX = {"MONOCHROME1": "OPC", "MONOCHROME2": "OPC", "RGB": "RGB", "PALETTE COLOR": "PLT"}


def coded(text):
    """A UID or a date as the parser names its directory."""
    n = [NIBBLE[c] for c in text]
    out = []
    for i in range(0, len(n) - 2, 3):
        v = n[i] << 8 | n[i + 1] << 4 | n[i + 2]
        out += [ALPHABET[v >> 6], ALPHABET[v & 63]]
    rest = n[len(n) - len(n) % 3:]
    if len(rest) == 1:
        out += [ALPHABET[rest[0] << 2], "0"]
    elif len(rest) == 2:
        out += [ALPHABET[(rest[0] << 2) + (rest[1] >> 2)], ALPHABET[(rest[1] & 3) << 4]]
    return "".join(out)


def ui(uid):
    return (uid + "\0" * (len(uid) % 2)).encode()


def text(value):
    return (value + " " * (len(value) % 2)).encode()


def us(value):
    return struct.pack("<H", value)


def group(records):
    """[(group, element, VR, value bytes)] as the parser writes a group file, every charset index 0."""
    return b"".join(struct.pack(">BHH2sH", 8, g, e, vr.encode(), 0) + struct.pack("<I", len(v)) + v
                    for g, e, vr, v in records)


def write_group(directory, marker, records):
    data = group(records)
    (directory / f"{marker}.{blake3.blake3(data).hexdigest()}").write_bytes(data)


def made_uid(role, name):
    return "2.25." + str(int.from_bytes(hashlib.sha256(f"{role}:{name}".encode()).digest()[:16], "big"))


def mirror(set_dir, out):
    m = json.loads((set_dir / "metadata.json").read_text())
    series = m.get("series", "")
    if not series or set(series) - set("0123456789."):
        series = made_uid("series", set_dir.name)
    study, instance = made_uid("study", set_dir.name), made_uid("instance", set_dir.name)
    bits = 8 if m["bitsStored"] <= 8 else 16
    d = out / "PbPb" / coded(ui(study).decode()) / coded(ui(series).decode()) / coded(ui(instance).decode())
    d.mkdir(parents=True)
    write_group(d.parents[1], "--", [(0x0020, 0x000D, "UI", ui(study))])
    write_group(d.parent, "---", [(0x0020, 0x000E, "UI", ui(series))])
    pixel = [(0x0028, 0x0002, "US", us(m["channels"])), (0x0028, 0x0004, "CS", text(m["photometric"]))]
    if m["channels"] == 3:
        pixel.append((0x0028, 0x0006, "US", us(0)))
    pixel += [(0x0028, 0x0008, "IS", text(str(m["frameCount"]))), (0x0028, 0x0010, "US", us(m["height"])),
              (0x0028, 0x0011, "US", us(m["width"])), (0x0028, 0x0100, "US", us(bits)),
              (0x0028, 0x0101, "US", us(m["bitsStored"])), (0x0028, 0x0102, "US", us(m["bitsStored"] - 1)),
              (0x0028, 0x0103, "US", us(1 if m["signed"] else 0))]
    write_group(d, "----", [(0x0008, 0x0018, "UI", ui(instance)), *pixel])
    suffix = FRAME_SUFFIX.get(m["photometric"])
    for i in range(m["frameCount"] if suffix else 0):
        (d / f"{i + 1:05d}.{suffix}").write_bytes((set_dir / f"{i:03d}.raw").read_bytes())
    return d.parent


if __name__ == "__main__":
    print(mirror(Path(sys.argv[1]), Path(sys.argv[2])))
