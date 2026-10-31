#!/usr/bin/env python3
"""The key-parse protocol's frames: the DBT runs at G = 1 and G = 8 as payloads.py writes them, row WCLAT's real
intra streams as payloads, each frame's XXH3-64 for the decoder worker's check, and every mutation of the protocol
(docs/decode/README.md §Safety without the flush) as payload files beside a list of cases.

usage: make_frames.py BUILD FRAMES DATA    — FRAMES is payloads.py's OUT; README.md here
"""
import hashlib
import json
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import xxhash

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parents[3] / "ingest/coded-frames"))
sys.path.insert(0, str(HERE.parents[1] / "bytes/frame-groups"))
sys.path.insert(0, str(HERE.parent / "latency"))
import ingest  # noqa: E402
import make_streams  # noqa: E402
import size  # noqa: E402
from gop import aom_args, run_of  # noqa: E402

OBU_TD, OBU_SEQ, OBU_FRAME_HEADER, OBU_TILE_GROUP, OBU_FRAME = 2, 1, 3, 4, 6
DBT = ("dbts_a1", "dbts_b1", "dbts_c1")
# Each DBT run's foreign payload: another system's, so another sequence header.
FOREIGN = {"dbts_a1": "dbts_c1", "dbts_b1": "dbts_a1", "dbts_c1": "dbts_a1", "us_liver": "rf_fluoro_intra_t1"}
WCLAT = [("rf_fluoro", "mono", 10, t) for t in (1, 2, 4)] + [("us_liver", "444", 8, t) for t in (1, 2, 4)]


def leb128(n):
    out = bytearray()
    while True:
        out.append((n & 127) | (128 if n > 127 else 0))
        n >>= 7
        if not n:
            return bytes(out)


def obus(unit):
    """[(type, start, payload start, end)]: every OBU of a unit, each with a size field."""
    out, at = [], 0
    while at < len(unit):
        header = unit[at]
        p = at + 1 + ((header >> 2) & 1)
        size, shift = 0, 0
        while True:
            b = unit[p]
            p += 1
            size |= (b & 127) << shift
            shift += 7
            if not b & 128:
                break
        out.append(((header >> 3) & 15, at, p, p + size))
        at = p + size
    return out


def frame_obu(unit):
    return next(o for o in obus(unit) if o[0] in (OBU_FRAME_HEADER, OBU_FRAME))


def frame_bits(unit, f):
    """The frame header's first byte — show_existing_frame, frame_type, show_frame (AV1 §5.9.2) — changed by f."""
    _, _, p, _ = frame_obu(unit)
    out = bytearray(unit)
    out[p] = f(out[p])
    return bytes(out)


def with_extension(unit):
    """The frame OBU with an extension byte, temporal and spatial id 0."""
    _, start, p, end = frame_obu(unit)
    return unit[:start] + bytes([unit[start] | 4, 0]) + unit[start + 1:end] + unit[end:]


def flipped(unit):
    _, _, p, end = frame_obu(unit)
    out = bytearray(unit)
    out[(p + end) // 2] ^= 0xFF
    return bytes(out)


def sequence_header(unit):
    return next(unit[p:e] for t, _, p, e in obus(unit) if t == OBU_SEQ)


def read_payload(path):
    b = path.read_bytes()
    head = b[:16]
    (n,) = struct.unpack_from("<I", b, 16)
    frame = b[20:20 + n]
    if not head[3]:
        return head, frame, None
    (t,) = struct.unpack_from("<I", frame, 0)
    return head, frame[4:4 + t], frame[4 + t:]


def write_payload(path, head, top, low):
    frame = struct.pack("<I", len(top)) + top + low if low is not None else top
    path.write_bytes(head + struct.pack("<I", len(frame)) + frame)


def encode_one(build, y4m_frames, args, write):
    """The first frame of `y4m_frames` coded with `args`: its temporal unit. One frame alone is coded as a still picture."""
    with tempfile.TemporaryDirectory() as tmp:
        y4m, ivf = Path(tmp) / "in.y4m", Path(tmp) / "out.ivf"
        write(y4m, y4m_frames)
        subprocess.run([build / f"aom-{size.AOM}/bin/aomenc", "-q", "--ivf", "-o", ivf, f"--limit={len(y4m_frames)}", *args, y4m],
                       check=True, capture_output=True)
        return size.ivf_units(ivf)[0]


def dbt_coder(build, data, name):
    """The top stream's coder of a DBT run, a frame as gop.py codes it in a group of G, and the run's first frame."""
    s = size.Set(data / name)
    header, streams = ingest.plan(s, "optimized")
    depth, layout, plane = streams[0]
    write = lambda y4m, frames: ingest.write_y4m(y4m, frames, depth, layout)  # noqa: E731
    args = lambda g: aom_args("good:6", "optimized", depth, layout, g, False)  # noqa: E731
    frames = lambda i, g: [plane(i)] if g == 1 else [plane(i), plane(i + 1)]  # noqa: E731
    return s, (lambda i, g, extra=(): encode_one(build, frames(i, g), [*args(g), *extra], write)), run_of(s, 16)[0]


def wclat_coder(build, frames, layout, bits, tiles):
    args = ["--lossless=1", "--cpu-used=0", f"--bit-depth={bits}", f"--input-bit-depth={bits}",
            f"--profile={make_streams.profile(layout)}", f"--tile-columns={tiles.bit_length() - 1}", "--kf-max-dist=0",
            *(["--monochrome"] if layout == "mono" else ["--matrix-coefficients=identity"])]
    write = lambda y4m, fs: make_streams.write_y4m(y4m, fs, layout, bits)  # noqa: E731
    return lambda i, extra=(): encode_one(build, [frames[i]], [*args, *extra], write)


def mutations(out, name, g, files, encode, other_index):
    """Every mutation of the protocol at G = g, the top unit changed and the low kept: [case], each a list of
    sends {file, index, key} and the index whose unit is the mutation: frames 0, 8, 9 at G = 1, 0 … 15 at G = 8.
    A unit coded alone is a still picture, whose frame header has no frame_type to change: those come from G = 8's key."""
    d = out / name / "m"
    d.mkdir(parents=True, exist_ok=True)
    at = 8
    head, key, low = read_payload(files(g, at))
    full = read_payload(files(8, at))[1]
    delta = read_payload(files(8, at + 1))[1]
    seq = sequence_header(key)
    same = encode(other_index, g)
    tiled = encode(at, g, ("--tile-columns=1", "--num-tile-groups=2"))
    tile_groups = [o for o in obus(tiled) if o[0] == OBU_TILE_GROUP]
    if not tile_groups:
        sys.exit(f"{name}: no second tile group to drop")
    _, cut, _, _ = tile_groups[-1]
    fe = frame_obu(key)[3]
    units = {
        "delta": delta,
        "intra-only": frame_bits(full, lambda b: b | 0x40),
        "show-existing": frame_bits(full, lambda b: b | 0x80),
        "unshown": frame_bits(full, lambda b: b & ~0x10),
        "cut": key[:-8],
        "two-tile-groups": tiled,
        "last-tile-group-dropped": tiled[:cut],
        "tile-byte": flipped(key),
        "delimiter": bytes([OBU_TD << 3 | 2, 0]),
        "same-sequence-header": same,
        "extension": with_extension(key),
    }
    if sequence_header(full)[0] & 8 or fe != len(key) or obus(key)[-1][0] != OBU_FRAME:
        sys.exit(f"{name}: G = 8's key is a still picture, or a key unit does not end in its one frame OBU")
    for k, unit in units.items():
        write_payload(d / f"{k}.g{g}", head, unit, low)
    group = lambda: [dict(file=f"{i:03d}.g{g}", index=i, key=i % g == 0) for i in ((0, 8, 9) if g == 1 else range(16))]  # noqa: E731
    cases = []
    slot = 1 if g == 1 else at
    for k in units:
        sends = group()
        sends[slot] = dict(file=f"m/{k}.g{g}", index=at, key=True)
        cases.append(dict(name=k, g=g, at=at, sends=sends, control=k == "two-tile-groups",
                          same_sequence_header=sequence_header(units[k]) == seq if k in ("same-sequence-header", "two-tile-groups") else None))
    foreign = group()
    foreign[slot] = dict(file=f"../{FOREIGN[name]}/{0:03d}.g1", index=at, key=True)
    cases.append(dict(name="foreign-sequence-header", g=g, at=at, sends=foreign, control=False))
    swapped = group()
    a, b = (1, 2) if g == 1 else (at + 1, at + 2)
    swapped[a], swapped[b] = dict(swapped[b], index=swapped[a]["index"]), dict(swapped[a], index=swapped[b]["index"])
    cases.append(dict(name="swapped", g=g, at=swapped[a]["index"], sends=swapped, control=False))
    return cases


def main():
    build, out, data = (Path(a).resolve() for a in sys.argv[1:4])
    manifest = json.loads((out / "manifest.json").read_text())
    for entry in manifest:
        s = size.Set(data / entry["name"])
        entry["digests"] = [xxhash.xxh3_64_hexdigest((data / s.name / f"{entry['first'] + i:03d}.raw").read_bytes())
                            for i in range(len(entry["frames"]))]
    for kind, layout, bits, tiles in WCLAT:
        frames = make_streams.real(data, kind)
        name = f"{kind}_intra_t{tiles}"
        coder = wclat_coder(build, frames, layout, bits, tiles)
        done = out / name / f"{len(frames) - 1:03d}.g1"
        coded = [read_payload(out / name / f"{i:03d}.g1")[1] if done.exists() else coder(i) for i in range(len(frames))]
        planes = [np.stack([f[2], f[0], f[1]], -1) if layout == "444" else f[0] for f in frames]
        stored = [np.ascontiguousarray(p.astype("u1" if bits == 8 else "<u2")).tobytes() for p in planes]
        head = struct.pack("<BBBBB3xII", 1, bits, bits, 0, 0, 0, 1)
        (out / name).mkdir(parents=True, exist_ok=True)
        for i, unit in enumerate(coded):
            write_payload(out / name / f"{i:03d}.g1", head, unit, None)
        manifest.append(dict(name=name, first=0, groups=[1], frames=[dict(truth=hashlib.sha256(b).hexdigest()) for b in stored],
                             digests=[xxhash.xxh3_64_hexdigest(b) for b in stored]))
        print(f"{name}: {len(coded)} frames, {sum(map(len, coded))} B", flush=True)
    for entry in manifest:
        if entry["name"] in DBT:
            s, encode, first = dbt_coder(build, data, entry["name"])
            files = lambda g, i, n=entry["name"]: out / n / f"{i:03d}.g{g}"  # noqa: E731
            # A slice outside the run, coded alone: another picture under the same sequence header.
            entry["cases"] = [c for g in (1, 8) for c in mutations(out, entry["name"], g, files,
                                                                   lambda i, g, extra=(), f=first: encode(f + i, g, extra), -1)]
            print(f"{entry['name']}: {len(entry['cases'])} cases", flush=True)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")


if __name__ == "__main__":
    main()
