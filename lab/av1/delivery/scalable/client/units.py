#!/usr/bin/env python3
"""make_frames.sh's steps on grey frames and AV1 streams.

  units.py y4m OUT.y4m BITS F.pnm ...         PNMs as a 4:2:0 Y4M, chroma neutral (--monochrome drops it)
  units.py split S.IVF BASE.y4m DIR           one file per temporal unit; the base's checksum beside it
  units.py drop-top IN.av1 OUT.av1            a unit without the OBUs of spatial layers above 0
"""
import hashlib
import struct
import sys
from pathlib import Path

import numpy as np


def read_pnm(path):
    with open(path, "rb") as fh:
        fh.readline()
        w, h = map(int, fh.readline().split())
        maxval = int(fh.readline())
        return np.frombuffer(fh.read(), ">u2" if maxval > 255 else "u1").reshape(h, w)


def y4m(out, bits, pnms):
    frames = [read_pnm(p) for p in pnms]
    h, w = frames[0].shape
    dt = "u1" if bits == 8 else "<u2"
    neutral = np.full((h // 2, w // 2), 1 << (bits - 1), dt).tobytes()
    with open(out, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{w} H{h} F25:1 Ip A1:1 C420{'' if bits == 8 else f'p{bits}'}\n".encode())
        for f in frames:
            fh.write(b"FRAME\n" + f.astype(dt).tobytes() + neutral * 2)


def ivf_units(raw):
    """The stream's temporal units: svc_encoder_rtc writes each layer as its own IVF frame, one timestamp a unit."""
    units, pos = {}, struct.unpack_from("<H", raw, 6)[0]
    while pos < len(raw):
        n, stamp = struct.unpack_from("<IQ", raw, pos)
        units[stamp] = units.get(stamp, b"") + raw[pos + 12: pos + 12 + n]
        pos += 12 + n
    return [units[k] for k in sorted(units)]


def y4m_luma(path):
    """Each frame's luma as the contract's bytes: one byte a sample, or two little-endian above 8 bits."""
    raw = Path(path).read_bytes()
    head, rest = raw.split(b"\n", 1)
    tags = {t[:1]: t[1:].decode() for t in head.split()[1:]}
    w, h, c = int(tags[b"W"]), int(tags[b"H"]), tags[b"C"]
    bpp = 1 if c in ("mono", "420", "420jpeg") else 2
    chroma = 0 if c.startswith("mono") else 2 * ((w + 1) // 2) * ((h + 1) // 2)
    frames, pos = [], 0
    while pos < len(rest):
        pos = rest.index(b"\n", pos) + 1
        frames.append(rest[pos: pos + w * h * bpp])
        pos += (w * h + chroma) * bpp
    return frames


def split(ivf, base, out):
    units, bases = ivf_units(Path(ivf).read_bytes()), y4m_luma(base)
    assert len(units) == len(bases), f"{len(units)} units, {len(bases)} base pictures"
    for i, (u, b) in enumerate(zip(units, bases)):
        Path(out, f"{i:03d}.av1").write_bytes(u)
        Path(out, f"{i:03d}.preview.sha256").write_text(hashlib.sha256(b).hexdigest())


def leb128(buf, pos):
    v, k = 0, 0
    while True:
        b = buf[pos + k]
        v |= (b & 0x7F) << (7 * k)
        k += 1
        if not b & 0x80:
            return v, k


def drop_top(src, dst):
    buf, pos, kept = Path(src).read_bytes(), 0, b""
    while pos < len(buf):
        head = buf[pos]
        ext = head >> 2 & 1
        assert head >> 1 & 1, "an OBU without a size field"
        size, k = leb128(buf, pos + 1 + ext)
        end = pos + 1 + ext + k + size
        if not (ext and buf[pos + 1] >> 3 & 3):
            kept += buf[pos:end]
        pos = end
    assert len(kept) < len(buf), "no OBU above spatial layer 0"
    Path(dst).write_bytes(kept)


if __name__ == "__main__":
    cmd, *a = sys.argv[1:]
    if cmd == "y4m":
        y4m(a[0], int(a[1]), a[2:])
    elif cmd == "split":
        split(*a)
    elif cmd == "drop-top":
        drop_top(*a)
