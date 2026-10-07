#!/usr/bin/env python3
"""A series brought to at most T bits by one of two maps, written as a set ingest.py codes, and nothing
unless every frame comes back from its remapped plane and map to the source's checksum.

  map      the 2^T-wide window holding most samples; a sample outside it is clamped to the window
           (the predictor) and its position and value go in NNN.map, deflated
  palette  v = h·2^L + l with the high parts h ranked: h's rank·2^L + l, L the largest that fits T bits;
           the ranks' table in palette.json — L = 0 would be histogram packing (split-prior-art.md, (2))

usage: remap.py SET_DIR OUT --mode map|palette [--bits T]   — lab/av1/remap/README.md
"""
import argparse
import hashlib
import json
import struct
import sys
import zlib
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import size  # noqa: E402
from levels import census_counts  # noqa: E402


def varints(xs):
    out = bytearray()
    for x in xs:
        while x >= 0x80:
            out.append(x & 0x7F | 0x80)
            x >>= 7
        out.append(x)
    return bytes(out)


def read_varints(data, n, pos=0):
    xs = []
    for _ in range(n):
        x = shift = 0
        while True:
            c = data[pos]
            pos += 1
            x |= (c & 0x7F) << shift
            shift += 7
            if c < 0x80:
                break
        xs.append(x)
    return xs, pos


def encode_map(v, low, t):
    """The clamped plane and its map: u32 runs · varint (gap, length)[runs] · u16 value[outliers], deflated."""
    plane = np.clip(v, low, low + (1 << t) - 1)
    flat, out = v.ravel(), (plane != v).ravel()
    edges = np.flatnonzero(np.diff(np.concatenate(([0], out.view(np.int8), [0]))))
    starts, ends = edges[0::2], edges[1::2]
    gaps = starts - np.concatenate(([0], ends[:-1]))
    runs = np.stack([gaps, ends - starts], 1).ravel().tolist()
    raw = struct.pack("<I", len(starts)) + varints(runs) + flat[out].astype("<u2").tobytes()
    return (plane - low).astype(np.int32), zlib.compress(raw, 9)


def decode_map(plane, low, data):
    """The inverse: the source samples, from the plane and the deflated map."""
    raw = zlib.decompress(data)
    n = struct.unpack_from("<I", raw)[0]
    runs, pos = read_varints(raw, 2 * n, 4)
    v = plane.astype(np.int32).ravel() + low
    values = np.frombuffer(raw, "<u2", offset=pos)
    at = k = 0
    for gap, length in zip(runs[0::2], runs[1::2]):
        at += gap
        v[at:at + length] = values[k:k + length]
        at, k = at + length, k + length
    return v.reshape(plane.shape)


def encode_palette(v, low_bits, rank):
    return rank[v >> low_bits] << low_bits | v & ((1 << low_bits) - 1)


def decode_palette(plane, low_bits, highs):
    return highs[plane >> low_bits].astype(np.int32) << low_bits | plane & ((1 << low_bits) - 1)


def palette_for(counts, t):
    """The largest L whose ranked high parts fit t bits, and the high parts; None if none does."""
    used = np.flatnonzero(counts)
    for low_bits in range(t, -1, -1):
        highs = np.unique(used >> low_bits)
        if len(highs) << low_bits <= 1 << t:
            return low_bits, highs
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("set_dir", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--mode", choices=["map", "palette"], required=True)
    ap.add_argument("--bits", type=int, default=12)
    a = ap.parse_args()
    s, t = size.Set(a.set_dir), a.bits
    counts = census_counts(s)
    if a.mode == "palette":
        found = palette_for(counts, t)
        if found is None:
            sys.exit(f"{s.name}: no palette of high parts fits {t} bits")
        low_bits, highs = found
        rank = np.zeros(int(highs[-1]) + 1, np.int32)
        rank[highs] = np.arange(len(highs))
    else:
        inside = np.convolve(counts, np.ones(1 << t, np.int64))[(1 << t) - 1:]
        low = int(np.argmax(inside))
    files, hi, maps = {}, 0, 0
    for i in range(s.n):
        v = s.frame(i).astype(np.int32)[..., 0] + s.offset
        if a.mode == "palette":
            plane = encode_palette(v, low_bits, rank)
            back = decode_palette(plane, low_bits, highs)
        else:
            plane, data = encode_map(v, low, t)
            back = decode_map(plane, low, data)
            files[f"{i:03d}.map"] = data
            maps += len(data)
        if back.shape != v.shape or not size.exact(s, i, back[..., None]):
            sys.exit(f"{s.name}: frame {i} does not come back from its plane and map — nothing written")
        raw = plane.astype("<u2").tobytes()
        files[f"{i:03d}.raw"] = raw
        files[f"{i:03d}.sha256"] = (hashlib.sha256(raw).hexdigest() + "\n").encode()
        hi = max(hi, int(plane.max()))
    a.out.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (a.out / name).write_bytes(data)
    meta = json.loads((a.set_dir / "metadata.json").read_text())
    meta.update(bitsStored=t, signed=False, min=0, max=hi)
    (a.out / "metadata.json").write_text(json.dumps(meta, indent=1) + "\n")
    side = dict(mode=a.mode, bits=t, source_offset=s.offset)
    if a.mode == "palette":
        side.update(low_bits=low_bits, highs=highs.tolist())
        side_bytes = 2 * len(highs)
    else:
        side.update(low=low)
        side_bytes = maps
    side["side_bytes"] = side_bytes
    (a.out / "remap.json").write_text(json.dumps(side) + "\n")
    print(json.dumps(dict(set=s.name, **{k: v for k, v in side.items() if k != "highs"},
                          levels=len(side.get("highs", [])), max=hi)))


if __name__ == "__main__":
    main()
