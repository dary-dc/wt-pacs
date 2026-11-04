#!/usr/bin/env python3
"""Every arm's entries for the total-time rig ported here (run.mjs), from split-rule's shipped payloads: HTJ2K, `k2`
and `k2-aa` (the shipped payload), `tf-frame` (the same bundle, cut by ./transport.js) and `tf-series` (entry i the
top-only payload of slice i, entry F + i its low-only payload). A head set, SET-head, holds the first HEAD slices.
Nothing is re-encoded: both cut payloads are the shipped payload's bytes, and rejoined they are it, byte for byte.

usage: make_frames.py SHIPPED OUT SET_DIR ... [--head 8]   — lab/av1/delivery/top-first/README.md
"""
import argparse
import hashlib
import json
import os
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
from size import Set  # noqa: E402

HEADER = 16
WORKER = "/lab/av1/delivery/top-first/decoder.js"
TRANSPORT = "/lab/av1/delivery/top-first/transport.js"


def cut(p):
    """(top-only payload, low-only payload) of a shipped split payload: payload-format.md's one-frame layout."""
    version, bits, depth, split, flags = p[:5]
    offset, count = struct.unpack_from("<II", p, 8)
    frame_len, top_len = struct.unpack_from("<II", p, HEADER)
    if version != 1 or count != 1 or not split or HEADER + 4 + frame_len != len(p):
        sys.exit("not a one-frame split payload")
    top = p[HEADER + 8:HEADER + 8 + top_len]
    low = p[HEADER + 8 + top_len:]
    one = lambda b, d, unit: struct.pack("<BBBBB3xII", 1, b, d, 0, flags, offset, 1) + struct.pack("<I", len(unit)) + unit  # noqa: E731
    return one(bits - split, depth, top), one(8, 8, low), split


def join(top_payload, low_payload, split):
    """The shipped payload rebuilt from the two cut ones, as the tf-series worker rebuilds it."""
    head = bytearray(top_payload[:HEADER])
    head[1] += split
    head[3] = split
    top, low = top_payload[HEADER + 4:], low_payload[HEADER + 4:]
    return bytes(head) + struct.pack("<II", 4 + len(top) + len(low), len(top)) + top + low


def preview_truth(s, i, k):
    """SHA-256 of (source ≫ k) ≪ k as the page holds it: 16-bit little-endian samples, as the exact frame's truth."""
    px = s.frame(i)
    if hashlib.sha256(px.tobytes()).hexdigest() != s.truth[i]:
        sys.exit(f"{s.name} {i}: the source's bytes are not its checksum's layout")
    return hashlib.sha256(((px >> k) << k).astype("<u2").tobytes()).hexdigest()


def write(src, shipped, dst, n, s):
    dst.mkdir(parents=True, exist_ok=True)
    tops, lows, truth, split = [], [], [], None
    for i in range(n):
        for ext in ("htj2k", "k2.av1"):
            if not (dst / f"{i:03d}.{ext}").exists():
                os.link(shipped / f"{i:03d}.{ext}", dst / f"{i:03d}.{ext}")
        p = (shipped / f"{i:03d}.k2.av1").read_bytes()
        top, low, split = cut(p)
        if join(top, low, split) != p:
            sys.exit(f"{s.name} {i}: the cut payloads do not rejoin to the shipped one")
        tops.append(top)
        lows.append(low)
        truth.append(preview_truth(s, i, split))
    for i, unit in enumerate(tops + lows):
        (dst / f"{i:03d}.tfs.av1").write_bytes(unit)
    size = lambda ext: sum((dst / f"{i:03d}.{ext}").stat().st_size for i in range(n))  # noqa: E731
    layered = dict(layers=2, exactAt=n, worker=WORKER, split=split, previewTruth=truth)
    entry = dict(name=dst.name, frames=n, width=s.w, height=s.h, bits=s.stored, truth=s.truth[:n], variants={
        "htj2k": {}, "k2": {"ext": "k2.av1"}, "k2-aa": {"ext": "k2.av1"},
        "tf-frame": dict(layered, ext="k2.av1", mode="tf-frame", serverEntries=n, transport=f"{TRANSPORT}?frames={n}"),
        "tf-series": dict(layered, ext="tfs.av1", mode="tf-series"),
    }, bytes={"htj2k": size("htj2k"), "k2": size("k2.av1"), "tf-series": sum(map(len, tops + lows))})
    (dst / "variants.json").write_text(json.dumps(entry, indent=1))
    print(dst.name, ", ".join(f"{k} {v} B" for k, v in entry["bytes"].items()), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("shipped", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", type=Path, nargs="+")
    ap.add_argument("--head", type=int, default=8)
    a = ap.parse_args()
    for d in a.sets:
        s = Set(d)
        write(d, a.shipped / s.name, a.out / s.name, s.n, s)
        write(d, a.shipped / s.name, a.out / f"{s.name}-head", a.head, s)


if __name__ == "__main__":
    main()
