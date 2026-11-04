"""T.800 packets for one tile, one component, one precinct per resolution: tag trees, packet headers (B.10), and
their parse, which reads only the bytes. Code-block coding passes are grouped into HT segments as T.814 B.2 sets
them; layers/README.md.
"""
import struct


class BitWriter:
    """B.10.1: bits MSB first; after a 0xFF byte the next carries 7."""

    def __init__(self):
        self.out, self.acc, self.n, self.room = bytearray(), 0, 0, 8

    def bit(self, b):
        self.acc = (self.acc << 1) | b
        self.n += 1
        if self.n == self.room:
            self._byte()

    def bits(self, v, k):
        for i in range(k - 1, -1, -1):
            self.bit((v >> i) & 1)

    def _byte(self):
        self.out.append(self.acc)
        self.room = 7 if self.acc == 0xFF else 8
        self.acc, self.n = 0, 0

    def done(self):
        if self.n:
            self.acc <<= self.room - self.n
            self._byte()
        if self.out and self.out[-1] == 0xFF:
            self.out.append(0)
        return bytes(self.out)


class BitReader:
    def __init__(self, data, pos):
        self.data, self.pos, self.acc, self.n, self.last = data, pos, 0, 0, 0

    def bit(self):
        if self.n == 0:
            self.acc = self.data[self.pos]
            self.n = 7 if self.last == 0xFF else 8
            self.last = self.acc
            self.pos += 1
        self.n -= 1
        return (self.acc >> self.n) & 1

    def bits(self, k):
        v = 0
        for _ in range(k):
            v = (v << 1) | self.bit()
        return v

    def end(self):
        """The header's last byte; a 0xFF one is followed by a stuffed zero byte."""
        if self.last == 0xFF:
            self.pos += 1
        return self.pos


def tree_levels(w, h):
    dims = [(w, h)]
    while dims[-1] != (1, 1):
        w, h = dims[-1]
        dims.append(((w + 1) // 2, (h + 1) // 2))
    return dims


class TagTree:
    """B.10.2, leaves the code-blocks of one sub-band's precinct in raster order."""

    def __init__(self, w, h, values=None):
        self.dims = tree_levels(w, h)
        self.value = [[0] * (a * b) for a, b in self.dims]
        self.low = [[0] * (a * b) for a, b in self.dims]
        self.known = [[False] * (a * b) for a, b in self.dims]
        if values is not None:
            self.value[0] = list(values)
            for lv in range(1, len(self.dims)):
                pw, ph = self.dims[lv - 1]
                w, _ = self.dims[lv]
                v = self.value[lv]
                for i in range(len(v)):
                    v[i] = 1 << 30
                for y in range(ph):
                    for x in range(pw):
                        j = (y // 2) * w + x // 2
                        v[j] = min(v[j], self.value[lv - 1][y * pw + x])

    def path(self, i):
        w0 = self.dims[0][0]
        x, y = i % w0, i // w0
        out = []
        for lv, (w, _) in enumerate(self.dims):
            out.append((lv, (y >> lv) * w + (x >> lv)))
        return out[::-1]

    def encode(self, bw, i, threshold):
        low = 0
        for lv, j in self.path(i):
            low = max(low, self.low[lv][j])
            while low < threshold:
                if low >= self.value[lv][j]:
                    if not self.known[lv][j]:
                        bw.bit(1)
                        self.known[lv][j] = True
                    break
                bw.bit(0)
                low += 1
            self.low[lv][j] = low

    def decode(self, br, i, threshold):
        """True once the leaf's value is known to be below threshold; the value is then self.value[0][i]."""
        low = 0
        for lv, j in self.path(i):
            low = max(low, self.low[lv][j])
            while low < threshold and not self.known[lv][j]:
                if br.bit():
                    self.known[lv][j] = True
                    self.value[lv][j] = low
                else:
                    low += 1
            self.low[lv][j] = low
        return self.known[0][i] and self.value[0][i] < threshold


def passes_code(bw, n):
    """B.10.6."""
    if n == 1:
        bw.bit(0)
    elif n == 2:
        bw.bits(0b10, 2)
    elif n <= 5:
        bw.bits(0b11, 2), bw.bits(n - 3, 2)
    elif n <= 36:
        bw.bits(0b1111, 4), bw.bits(n - 6, 5)
    else:
        bw.bits(0b111111111, 9), bw.bits(n - 37, 7)


def passes_read(br):
    if not br.bit():
        return 1
    if not br.bit():
        return 2
    v = br.bits(2)
    if v < 3:
        return 3 + v
    v = br.bits(5)
    if v < 31:
        return 6 + v
    return 37 + br.bits(7)


def ht_segments(first, n):
    """Passes first .. first+n-1 (0-based, after any placeholder passes) cut at T.814 B.2's set T: each cleanup
    its own segment, each SigProp and MagRef pair one; the last cut at the packet's last pass (B.3)."""
    out, k = [], first
    while k < first + n:
        end = k if k % 3 == 0 else (k // 3) * 3 + 2
        end = min(end, first + n - 1)
        out.append(end - k + 1)
        k = end + 1
    return out


class Block:
    """One code-block's contributions: per layer None, or (Z if first, [(passes, bytes)] in segment order)."""

    def __init__(self, layers, zero_planes=None, placeholders=0):
        self.layers, self.zero_planes, self.placeholders = layers, zero_planes, placeholders


def write_packet(bands, layer, state):
    """One packet: bands is a list of (blocks, w, h) in the resolution's sub-band order; state carries each
    block's inclusion, Lblock and passes so far, and each sub-band's two tag trees."""
    bw = BitWriter()
    body = bytearray()
    if not any(b.layers[layer] for blocks, _, _ in bands for b in blocks):
        bw.bit(0)
        return bw.done()
    bw.bit(1)
    for bi, (blocks, w, h) in enumerate(bands):
        if (bi, "inc") not in state:
            first = [next((ly for ly, c in enumerate(b.layers) if c), 1 << 20) for b in blocks]
            state[bi, "inc"] = TagTree(w, h, first)
            state[bi, "zero"] = TagTree(w, h, [b.zero_planes or 0 for b in blocks])
        for i, b in enumerate(blocks):
            st = state.setdefault((bi, i), {"in": False, "lblock": 3, "passes": 0})
            segs = b.layers[layer]
            if not st["in"]:
                state[bi, "inc"].encode(bw, i, layer + 1)
            else:
                bw.bit(1 if segs else 0)
            if not segs:
                continue
            if not st["in"]:
                tree = state[bi, "zero"]
                tree.encode(bw, i, b.zero_planes + 1)
                st["in"] = True
            n = sum(p for p, _ in segs)
            passes_code(bw, n)
            need = 0
            for p, data in segs:
                need = max(need, len(data).bit_length() - (p.bit_length() - 1) - st["lblock"])
            for _ in range(need):
                bw.bit(1)
            bw.bit(0)
            st["lblock"] += need
            for p, data in segs:
                bw.bits(len(data), st["lblock"] + p.bit_length() - 1)
                body += data
            st["passes"] += n
    return bw.done() + bytes(body)


def read_packet(data, pos, bands, layer, state):
    """The parse of write_packet: per block, (Z if first) and [(passes, bytes)] cut as ht_segments cuts them."""
    br = BitReader(data, pos)
    got = {}
    if not br.bit():
        return br.end(), got
    for bi, (w, h) in enumerate(bands):
        if (bi, "inc") not in state:
            state[bi, "inc"], state[bi, "zero"] = TagTree(w, h), TagTree(w, h)
        for i in range(w * h):
            st = state.setdefault((bi, i), {"in": False, "lblock": 3, "passes": 0})
            if not st["in"]:
                inc = state[bi, "inc"].decode(br, i, layer + 1)
            else:
                inc = br.bit() == 1
            if not inc:
                continue
            z = None
            if not st["in"]:
                tree, t = state[bi, "zero"], 1
                while not tree.decode(br, i, t):
                    t += 1
                z = tree.value[0][i]
                st["in"] = True
            n = passes_read(br)
            while br.bit():
                st["lblock"] += 1
            segs = ht_segments(st["passes"], n)
            lens = [br.bits(st["lblock"] + p.bit_length() - 1) for p in segs]
            st["passes"] += n
            got[bi, i] = (z, list(zip(segs, lens)))
    pos = br.end()
    out = {}
    for key in sorted(got, key=lambda k: k):
        z, segs = got[key]
        cut = []
        for p, n in segs:
            cut.append((p, data[pos:pos + n]))
            pos += n
        out[key] = (z, cut)
    return pos, out


def marker(code, body):
    return struct.pack(">HH", code, len(body) + 2) + body
