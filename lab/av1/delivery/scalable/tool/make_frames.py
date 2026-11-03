#!/usr/bin/env python3
"""Stage 2's entries for the total-time rig: HTJ2K (twice, the A/A arm), HTJ2K's half-size prefix first, the shipped
payload, and each alone and predicted shape layer-major — entry i < F frame i's base unit from shapes.py's coding,
entry exactAt + i (the next multiple of the group after F) its shipped payload, or its whole scalable unit as a
payload. HTJ2K and its prefix are lab/av1/decode/resolution-level's: its make_frames.py runs first when OUT holds no
set yet, then prefix.mjs on OUT, then this again.
A base unit's truth is the hash of native dav1d's decode of the bases at operating point 1.

usage: make_frames.py BUILD SHIPPED WORK OUT SET_DIR ... --alone SHAPE[=NAME],… --predicted SHAPE[=NAME],…
       [--lossy-base SHAPE=NAME,…] [--lossy-middle SHAPE=NAME,…]   — lab/av1/delivery/scalable/tool/README.md
"""
import argparse
import hashlib
import json
import shutil
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
LAB = HERE.parents[2]
sys.path.insert(0, str(HERE.parent / "client"))
sys.path.insert(0, str(HERE.parent / "encoder"))
sys.path.insert(0, str(LAB))
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(LAB.parent / "ingest/coded-frames"))
import svc  # noqa: E402
from size import Set  # noqa: E402
import ingest  # noqa: E402
from shapes import payload_parts  # noqa: E402
from units import drop_top, ivf_units  # noqa: E402

# Long sides 1785, 3328 and 2513 all take resolution level 1 (half size) at this screen.
SCREEN = 850
KEY = 8


def bases(build, stream, work, n, oppoint=1):
    """A lower layer's units and the hash of native dav1d's decode of them at their operating point."""
    units = ivf_units(stream.read_bytes())
    if len(units) != n:
        sys.exit(f"{stream}: {len(units)} base units, {n} frames")
    (work / "bases.obu").write_bytes(b"".join(units))
    subprocess.run([build / "dav1d/bin/dav1d", "-q", "-i", work / "bases.obu", "-o", work / "b.y4m", "--alllayers", "0",
                    "--oppoint", str(oppoint)], check=True, capture_output=True, env={"LD_LIBRARY_PATH": str(build / "dav1d/lib")})
    truth = [hashlib.sha256(p[0].tobytes()).hexdigest() for p in svc.read_y4m(work / "b.y4m")]
    (work / "b.y4m").unlink()
    return units, truth


def payload(bits, top, low):
    """payload-format.md's one-frame payload: a 10-bit top, split 2 with its low unit when there is one."""
    split = 2 if low is not None else 0
    frame = struct.pack("<I", len(top)) + top + low if split else top
    return struct.pack("<BBBBB3xII", 1, bits, 10, split, 0, 0, 1) + struct.pack("<I", len(frame)) + frame


def padded(s, i):
    """svc_encoder_rtc refuses odd sizes: an odd edge replicated once, as lab/av1/delivery/bases-first codes it."""
    return np.pad(s.frame(i), ((0, s.h % 2), (0, s.w % 2), (0, 0)), mode="edge")


def predicted_low(build, s, dst, tmp, coding):
    """The low units under a predicted top, and the exact frames' truth when the top is padded (None: the series')."""
    if coding != "split":
        return [None] * s.n, None
    if not (s.h % 2 or s.w % 2):
        return [payload_parts(dst / f"{i:03d}.k2.av1")[1] for i in range(s.n)], None
    low = [ingest.encode(build, tmp, padded(s, i).astype(np.int32) & 3, 8, "400", "allintra:7", "optimized") for i in range(s.n)]
    return low, [hashlib.sha256(padded(s, i).tobytes()).hexdigest() for i in range(s.n)]


def write_layer_major(dst, name, bases_, exact, exact_at, middles=(), middle_at=None):
    """Entry i the base, entry middle_at + i the middle, entry exact_at + i the exact payload, one-byte fillers
    between; the bytes a fill asks."""
    layers = [(0, bases_), (middle_at, middles), (exact_at, exact)]
    entries = {at + i: unit for at, units in layers if units for i, unit in enumerate(units)}
    for i in range(max(entries) + 1):
        (dst / f"{i:03d}.{name}").write_bytes(entries.get(i, b"\0"))
    return sum(map(len, entries.values()))


def named(arg):
    """SHAPE or SHAPE=NAME, each comma-separated: (shape, variant name or None)."""
    return [tuple(x.split("=")) if "=" in x else (x, None) for x in arg.split(",")] if arg else []


def prefix_check(stream, units, above, tmp, what):
    for i, unit in enumerate(ivf_units(stream.read_bytes())):
        (tmp / "u.obu").write_bytes(unit)
        drop_top(tmp / "u.obu", tmp / "b.obu", above)
        if (tmp / "b.obu").read_bytes() != units[i]:
            sys.exit(f"{stream} {i}: the unit's prefix is not the encoder's {what} unit")


def main():
    ap = argparse.ArgumentParser()
    for k in ("build", "shipped", "work", "out"):
        ap.add_argument(k, type=Path)
    ap.add_argument("sets", type=Path, nargs="+")
    ap.add_argument("--alone", default="two-quarter-q40")
    ap.add_argument("--predicted", default="", help="SHAPE[=NAME],…; three-full-* shapes are three layers")
    ap.add_argument("--lossy-base", default="", help="SHAPE=NAME,…: a predicted shape's bases alone, nothing exact after")
    ap.add_argument("--lossy-middle", default="", help="SHAPE=NAME,…: a three-layer shape's bases and middles alone")
    a = ap.parse_args()
    a.lossy_base, a.lossy_middle = dict(named(a.lossy_base)), dict(named(a.lossy_middle))
    build, shipped, work, out = (p.resolve() for p in (a.build, a.shipped, a.work, a.out))
    for d in a.sets:
        s = Set(d)
        dst = out / s.name
        if not (dst / "variants.json").exists():
            subprocess.run([sys.executable, LAB / "av1/decode/resolution-level/make_frames.py", build, out, d, "--frames",
                            str(s.n), "--screen", str(SCREEN)], check=True)
        entry = json.loads((dst / "variants.json").read_text())
        if entry["level"] != 1:
            sys.exit(f"{s.name}: level {entry['level']}, not half size")
        for i in range(s.n):
            shutil.copyfile(shipped / s.name / f"{i:03d}.k2.av1", dst / f"{i:03d}.k2.av1")
        entry["variants"].update({"htj2k-aa": {"codec": "htj2k"}, "k2": {"ext": "k2.av1"}})
        entry["bytes"]["k2"] = sum((dst / f"{i:03d}.k2.av1").stat().st_size for i in range(s.n))
        coding = "split" if s.stored == 12 else "whole"
        exact_at = -(-s.n // KEY) * KEY
        layout = dict(layers=2, group=KEY, exactAt=exact_at, worker="/lab/av1/delivery/scalable/tool/decoder.js")
        tmp = dst.parent / f".{s.name}-work"
        tmp.mkdir(exist_ok=True)
        ranges = lambda *layers: [[at, s.n, layer] for at, layer in layers]  # noqa: E731
        for shape, name in named(a.alone):
            name = name or f"alone-{shape}"
            units, truth = bases(build, work / s.name / f"{coding}-{shape}.ivf_0.av1", tmp, s.n)
            exact = [(dst / f"{i:03d}.k2.av1").read_bytes() for i in range(s.n)]
            entry["bytes"][name] = write_layer_major(dst, name, units, exact, exact_at)
            entry["variants"][name] = dict(layout, ext=name, previewTruth=truth)
        for shape, name in named(a.predicted):
            name = name or f"predicted-{shape}"
            stream = work / s.name / f"{coding}-{shape}.ivf"
            units, truth = bases(build, Path(f"{stream}_0.av1"), tmp, s.n, 2 if shape.startswith("three") else 1)
            whole_stream = Path(f"{stream}_{2 if shape.startswith('three') else 1}.av1")
            whole = ivf_units(whole_stream.read_bytes())
            prefix_check(whole_stream, units, 0, tmp, "base")
            low, truth_x = predicted_low(build, s, dst, tmp, coding)
            exact = [payload(s.stored, unit, lo) for unit, lo in zip(whole, low)]
            extra = {"truth": truth_x} if truth_x else {}
            if shape.startswith("three-full"):
                middle_stream = Path(f"{stream}_1.av1")
                middles, middle_truth = bases(build, middle_stream, tmp, s.n, 1)
                prefix_check(whole_stream, middles, 1, tmp, "middle")
                prefix_check(middle_stream, units, 0, tmp, "base")
                three = dict(layout, layers=3, middleAt=exact_at, exactAt=2 * exact_at, middleTruth=middle_truth)
                entry["bytes"][name] = write_layer_major(dst, name, units, exact, 2 * exact_at, middles, exact_at)
                entry["variants"][name] = dict(three, ext=name, previewTruth=truth, **extra,
                                               ranges=ranges((0, "base"), (exact_at, "middle"), (2 * exact_at, "exact")))
                lossy = a.lossy_middle.get(shape)
                if lossy:
                    entry["bytes"][lossy] = write_layer_major(dst, lossy, units, [], 2 * exact_at, middles, exact_at)
                    entry["variants"][lossy] = dict(three, ext=lossy, previewTruth=truth, lossy=True,
                                                    ranges=ranges((0, "base"), (exact_at, "middle")))
                continue
            entry["bytes"][name] = write_layer_major(dst, name, units, exact, exact_at)
            entry["variants"][name] = dict(layout, ext=name, previewTruth=truth, **extra)
            lossy = a.lossy_base.get(shape)
            if lossy:
                entry["bytes"][lossy] = write_layer_major(dst, lossy, units, [], exact_at)
                entry["variants"][lossy] = dict(layout, ext=lossy, previewTruth=truth, lossy=True, ranges=ranges((0, "base")))
        (dst / "variants.json").write_text(json.dumps(entry, indent=1))
        print(s.name, ", ".join(f"{k} {v} B" for k, v in entry["bytes"].items()), flush=True)


if __name__ == "__main__":
    main()
