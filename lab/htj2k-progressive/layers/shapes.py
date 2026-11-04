#!/usr/bin/env python3
"""The lab writer for HTJ2K quality layers: one frame coded as the served profile codes it (reversible 5/3, five
levels, 64x64 HT code-blocks, one precinct per resolution) in one of three shapes.

today      one layer, RPCL: must equal ojph_compress's codestream byte for byte.
oneset     two layers, LRCP: layer 1 each block's HT cleanup at bit-plane 1, layer 2 its SigProp and MagRef at 0;
           a block whose plane-0 bits SigProp cannot all reach is coded whole in layer 1.
twosets P  two layers, LRCP: layer 1 each block's cleanup at bit-plane P, layer 2 a second HT set, the lossless
           cleanup at plane 0 (today's block bytes), after empty sets for the planes between (T.814 B.3 NOTE 2).

Each layer is its own tile-part, so a layer prefix is the main header, the first tile-parts, and an EOC.
`single` rewrites a parsed prefix as the one-layer codestream an unpatched OpenJPH decodes: per block, the last
HT set present, earlier sets turned into placeholder passes. layers/README.md.

usage: shapes.py SHAPE IN.pgm REF.j2c OUT.j2c [P]     REF is ojph_compress's codestream of the same frame
"""
import ctypes
import struct
import sys
from pathlib import Path

import numpy as np

from codestream import Block, marker, read_packet, write_packet

LIB = ctypes.CDLL(str(Path(__file__).resolve().parents[2] / ".openjph-build/layers/libhtblock.so"))
LEVELS, CB = 5, 64
SOC, SOT, SOD, EOC = b"\xff\x4f", 0xFF90, b"\xff\x93", b"\xff\xd9"


def split(x):
    """One 5/3 analysis level along axis 0 (T.800 F.4.8.2, whole-sample symmetric extension): low, high."""
    n = x.shape[0]
    if n == 1:
        return x.copy(), x[:0].copy()
    ext = np.concatenate([x, x[n - 2:n - 1]])
    high = x[1::2] - ((ext[0:n - 1:2] + ext[2:n + 1:2]) >> 1)
    pad = np.concatenate([high[:1], high, high[-1:]])
    k = (n + 1) // 2
    return x[0::2] + ((pad[0:k] + pad[1:k + 1] + 2) >> 2), high


def merge(low, high, n):
    """The inverse of split (F.3.8.1)."""
    if n == 1:
        return low.copy()
    k = (n + 1) // 2
    pad = np.concatenate([high[:1], high, high[-1:]])
    even = low - ((pad[0:k] + pad[1:k + 1] + 2) >> 2)
    ext = np.concatenate([even, even[-1:]]) if n % 2 == 0 else even
    out = np.empty((n,) + low.shape[1:], np.int64)
    out[0::2] = even
    out[1::2] = high + ((ext[0:n // 2] + ext[1:n // 2 + 1]) >> 1)
    return out


def analyse(img):
    """Sub-bands by resolution: [[LL5], [HL5, LH5, HH5], ..., [HL1, LH1, HH1]]; vertical then horizontal (F.4.2)."""
    out, ll = [], img.astype(np.int64)
    for _ in range(LEVELS):
        lo, hi = split(ll)
        ll_, hl = (a.T for a in split(lo.T))
        lh, hh = (a.T for a in split(hi.T))
        out.append([hl, lh, hh])
        ll = ll_
    return [[ll]] + out[::-1]


def synthesise(res, h, w):
    shapes = [(h, w)]
    for _ in range(LEVELS):
        shapes.append(((shapes[-1][0] + 1) // 2, (shapes[-1][1] + 1) // 2))
    ll = res[0][0]
    for r in range(1, LEVELS + 1):
        hh_, ww = shapes[LEVELS - r]
        hl, lh, hh = res[r]
        lo = merge(ll.T, hl.T, ww).T
        hi = merge(lh.T, hh.T, ww).T
        ll = merge(lo, hi, hh_)
    return ll


class Header:
    """The main header ojph_compress wrote for this frame: SIZ, CAP, COD, QCD, and what the writer needs of them."""

    def __init__(self, ref):
        pos, self.segs = 2, []
        while ref[pos:pos + 2] != struct.pack(">H", SOT):
            code, n = struct.unpack(">HH", ref[pos:pos + 4])
            self.segs.append([code, bytearray(ref[pos + 4:pos + 2 + n])])
            pos += 2 + n
        siz = self.seg(0xFF51)
        self.w, self.h = struct.unpack(">II", siz[2:10])
        assert struct.unpack(">H", siz[34:36])[0] == 1, "one component"
        ssiz = siz[36]
        self.signed, self.bits = bool(ssiz & 0x80), (ssiz & 0x7F) + 1
        cod = self.seg(0xFF52)
        assert cod[0] == 0 and cod[5] == LEVELS and cod[6:8] == b"\x04\x04" and cod[8] == 0x40 and cod[9] == 1
        qcd = self.seg(0xFF5C)
        assert qcd[0] & 0x1F == 0, "reversible"
        guard = qcd[0] >> 5
        self.kmax = [guard + (e >> 3) - 1 for e in qcd[1:]]

    def seg(self, code):
        return next(b for c, b in self.segs if c == code)

    def bytes(self, layers, order, multi_ht=False):
        out = bytearray(SOC)
        for code, body in self.segs:
            body = bytearray(body)
            if code == 0xFF52:
                body[1], body[2:4] = order, struct.pack(">H", layers)
            if code == 0xFF50 and multi_ht:
                body[-2:] = struct.pack(">H", struct.unpack(">H", body[-2:])[0] | 1 << 13)
            out += marker(code, bytes(body))
        return bytes(out)


def kmax_of(hdr, r, b):
    return hdr.kmax[0 if r == 0 else 3 * (r - 1) + 1 + b]


def blocks_of(band):
    h, w = band.shape
    nx, ny = -(-w // CB), -(-h // CB)
    return [band[y * CB:(y + 1) * CB, x * CB:(x + 1) * CB] for y in range(ny) for x in range(nx)], nx, ny


def ht(c, kmax, plane, refine):
    """(cleanup bytes, refinement bytes, exact) for one block's HT set at `plane`."""
    c = np.ascontiguousarray(c, np.int32)
    out = (ctypes.c_uint8 * (1 << 18))()
    a, b = ctypes.c_int(), ctypes.c_int()
    r = LIB.ht_encode(c.ctypes.data_as(ctypes.POINTER(ctypes.c_int32)), c.shape[1], c.shape[0], kmax, plane,
                      int(refine), out, len(out), ctypes.byref(a), ctypes.byref(b))
    assert r >= 0, "ht_encode refused the block"
    raw = bytes(out[:a.value + b.value])
    return raw[:a.value], raw[a.value:], r == 1


def plan(shape, c, kmax, p=None):
    """The block's contributions to each of the two layers (one for `today`)."""
    top = int(np.abs(c).max()) if c.size else 0
    if top == 0:
        return Block([None] * (1 if shape == "today" else 2))
    lossless = ht(c, kmax, 0, False)[0]
    if shape == "today":
        return Block([[(1, lossless)]], kmax - 1)
    if shape == "oneset":
        if top >= 2 and kmax >= 2:
            cup, ref, exact = ht(c, kmax, 1, True)
            if exact and ref:
                return Block([[(1, cup)], [(2, ref)]], kmax - 2)
        return Block([[(1, lossless)], None], kmax - 1)
    if top >> p == 0 or kmax - 1 - p < 0:
        return Block([None, [(1, lossless)]], kmax - 1)
    cup = ht(c, kmax, p, False)[0]
    empty = [(2, b"")] + [(1, b""), (2, b"")] * (p - 1)
    return Block([[(1, cup)], empty + [(1, lossless)]], kmax - 1 - p)


def coded(hdr, img, shape, p=None):
    res = analyse(img.astype(np.int64) - (0 if hdr.signed else 1 << (hdr.bits - 1)))
    out = []
    for r, bands in enumerate(res):
        row = []
        for b, band in enumerate(bands):
            blocks, nx, ny = blocks_of(band)
            k = kmax_of(hdr, r, b if r else 0)
            row.append(([plan(shape, c, k, p) for c in blocks], nx, ny))
        out.append(row)
    return out


def tile_part(index, count, body):
    sot = marker(SOT, struct.pack(">HIBB", 0, 12 + 2 + len(body), index, count))
    return sot + SOD + body


def assemble(hdr, res, layers, order):
    """LRCP (order 0) or RPCL (2); with one precinct per resolution and one component, RPCL is RLCP."""
    state, packets = {}, {}
    seq = [(l, r) for l in range(layers) for r in range(LEVELS + 1)] if order == 0 else \
          [(l, r) for r in range(LEVELS + 1) for l in range(layers)]
    for l, r in seq:
        packets[l, r] = write_packet(res[r], l, state.setdefault(r, {}))
    if order == 0:
        parts = [b"".join(packets[l, r] for r in range(LEVELS + 1)) for l in range(layers)]
    else:
        parts = [b"".join(packets[l, r] for r in range(LEVELS + 1) for l in range(layers))]
    multi = any(len(b.layers) > 1 and b.layers[1] and len(b.layers[1]) > 1 for row in res for blocks, _, _ in row
                for b in blocks)
    head = hdr.bytes(layers, order, multi)
    return head + b"".join(tile_part(i, len(parts), part) for i, part in enumerate(parts)) + EOC, \
        [len(head)] + [len(tile_part(i, len(parts), part)) for i, part in enumerate(parts)]


def band_blocks(h, w):
    """Code-blocks across and down, per resolution and sub-band."""
    cdiv = lambda n: -(-n // CB)  # noqa: E731
    shapes = [(h, w)]
    for _ in range(LEVELS):
        shapes.append(((shapes[-1][0] + 1) // 2, (shapes[-1][1] + 1) // 2))
    out = [[(cdiv(shapes[LEVELS][1]), cdiv(shapes[LEVELS][0]))]]
    for r in range(1, LEVELS + 1):
        H, W = shapes[LEVELS - r]
        lh, lw, hh, hw = (H + 1) // 2, (W + 1) // 2, H // 2, W // 2
        out.append([(cdiv(hw), cdiv(lh)), (cdiv(lw), cdiv(hh)), (cdiv(hw), cdiv(hh))])
    return out


def parse(cs, hdr, layers):
    """Every block's segments per layer, read from the bytes alone (LRCP, one tile-part a layer)."""
    pos, state, blocks = 2, {}, {}
    while cs[pos:pos + 2] != struct.pack(">H", SOT):
        pos += 2 + struct.unpack(">H", cs[pos + 2:pos + 4])[0]
    dims = band_blocks(hdr.h, hdr.w)
    for l in range(layers):
        if pos >= len(cs) - 2:
            break
        assert struct.unpack(">H", cs[pos:pos + 2])[0] == SOT
        end = pos + struct.unpack(">I", cs[pos + 6:pos + 10])[0]
        pos += 12 + 2
        for r in range(LEVELS + 1):
            pos, got = read_packet(cs, pos, dims[r], l, state.setdefault(r, {}))
            for (b, i), (z, segs) in got.items():
                e = blocks.setdefault((r, b, i), {"z": None, "segs": []})
                if z is not None:
                    e["z"] = z
                e["segs"] += segs
        assert pos == end, "a tile-part's packets do not fill it"
    return blocks, dims


def last_set(e):
    """T.814 B.3: the HT set the decoder runs, (S_skip, cleanup, refinement, Z_blk), from the segments in order."""
    sets, k = [], 0
    for p, data in e["segs"]:
        if k % 3 == 0:
            sets.append([data, b"", 1])
        else:
            sets[-1][1] += data
            sets[-1][2] += p
        k += p
    best = None
    for s, (cup, ref, n) in enumerate(sets):
        if cup:
            best = (s, cup, ref, n if ref else 1)
    return best


def single(cs, hdr, layers):
    """The prefix `cs` as one layer, every block its last HT set after 3 * S_skip placeholder passes."""
    blocks, dims = parse(cs, hdr, layers)
    res = []
    for r in range(LEVELS + 1):
        row = []
        for b, (nx, ny) in enumerate(dims[r]):
            out = []
            for i in range(nx * ny):
                e = blocks.get((r, b, i))
                best = e and last_set(e)
                if not best:
                    out.append(Block([None]))
                    continue
                s, cup, ref, n = best
                segs = [(3 * s + 1, cup)] + ([(n - 1, ref)] if n > 1 else [])
                out.append(Block([segs], e["z"]))
            row.append((out, nx, ny))
        res.append(row)
    return assemble(hdr, res, 1, 0)[0]


def prefix(cs, sizes, layers):
    return cs[:sum(sizes[:1 + layers])] + EOC


def expected(hdr, img, shape, layers, p=None):
    """What a decoder reconstructs from the first `layers` layers: OpenJPH's bin-centre rule on the truncated bit-planes
    (a cleanup at plane q adds 2^(q-1) to a nonzero magnitude), every block per its plan."""
    res = analyse(img.astype(np.int64) - (0 if hdr.signed else 1 << (hdr.bits - 1)))
    for r, bands in enumerate(res):
        for b, band in enumerate(bands):
            k = kmax_of(hdr, r, b if r else 0)
            h, w = band.shape
            for y in range(0, h, CB):
                for x in range(0, w, CB):
                    c = band[y:y + CB, x:x + CB]
                    blk = plan(shape, c, k, p) if shape != "today" else None
                    q = 0
                    if blk and layers == 1 and blk.layers[0]:
                        q = k - 1 - blk.zero_planes
                    elif blk and layers == 1:
                        c[:] = 0
                        continue
                    if q:
                        m = np.abs(c) >> q
                        rec = np.where(m > 0, (m << q) | (1 << (q - 1)), 0)
                        c[:] = np.sign(c) * rec
    out = synthesise(res, hdr.h, hdr.w) + (0 if hdr.signed else 1 << (hdr.bits - 1))
    lo, hi = (-(1 << (hdr.bits - 1)), (1 << (hdr.bits - 1)) - 1) if hdr.signed else (0, (1 << hdr.bits) - 1)
    return np.clip(out, lo, hi)


def read_pgm(path):
    data = Path(path).read_bytes()
    parts, pos = [], 0
    while len(parts) < 4:
        while data[pos:pos + 1].isspace():
            pos += 1
        if data[pos:pos + 1] == b"#":
            pos = data.index(b"\n", pos)
            continue
        end = pos
        while not data[end:end + 1].isspace():
            end += 1
        parts.append(data[pos:end])
        pos = end
    w, h, top = int(parts[1]), int(parts[2]), int(parts[3])
    dt = ">u2" if top > 255 else "u1"
    return np.frombuffer(data[pos + 1:], dt, w * h).reshape(h, w)


def main():
    shape, src, ref, dst = sys.argv[1:5]
    p = int(sys.argv[5]) if len(sys.argv) > 5 else None
    hdr = Header(Path(ref).read_bytes())
    img = read_pgm(src)
    res = coded(hdr, img, shape, p)
    cs, sizes = assemble(hdr, res, 1 if shape == "today" else 2, 2 if shape == "today" else 0)
    Path(dst).write_bytes(cs)
    print(" ".join(map(str, sizes)))


if __name__ == "__main__":
    main()
