#!/usr/bin/env python3
"""Late samples spliced into a one-track MP4, at the byte level, as each layout allows.

usage: mp4.py splice FILE AT REMOVE [--fsync] SAMPLE...   prints {"read", "written", "dead", "wall_ns"}
       mp4.py dump FILE OUTDIR                             one file a sample, `NNNNN.k` for a sync sample

`splice` replaces samples AT..AT+REMOVE-1 with SAMPLE...: an insert is REMOVE 0, a re-encoded
group REMOVE its old length. A sample's name ending `.k` makes it a sync sample. By layout:
  moov at the end   in place: the new samples go at the end of the mdat, a new moov after them.
                    The sample table places them; replaced samples stay as dead bytes.
  moov at the front a new file renamed over the old: the moov grows, so every byte after it moves.
  fragmented        at the end, in place: one moof and mdat, then a new mfra. Anywhere else, a
                    new file: fragments are in decode order, so every later one is rewritten.
Only what FFmpeg 6.1's mov muxer writes for one AV1 track is known: no ctts, one sample entry.
"""
import json
import os
import struct
import sys
import time
from pathlib import Path

CONTAINERS = {b"moov", b"trak", b"mdia", b"minf", b"stbl", b"edts", b"moof", b"traf", b"mfra"}
SYNC, NON_SYNC = 0x02000000, 0x01010000  # trun sample_flags: depends on no other, or on others
KNOWN_STBL = {b"stsd", b"stts", b"stss", b"stsc", b"stsz", b"stco", b"co64"}


class Box:
    def __init__(self, kind, payload=b"", children=None):
        self.kind, self.payload, self.children = kind, payload, children

    def encode(self):
        body = b"".join(c.encode() for c in self.children) if self.children is not None else self.payload
        return struct.pack(">I4s", 8 + len(body), self.kind) + body

    def find(self, *path):
        box = self
        for kind in path:
            box = next(c for c in box.children if c.kind == kind)
        return box

    def has(self, kind):
        return any(c.kind == kind for c in self.children)


def parse(buf, pos=0, end=None):
    end = len(buf) if end is None else end
    out = []
    while pos < end:
        size, kind = struct.unpack_from(">I4s", buf, pos)
        head = 8
        if size == 1:
            size, head = struct.unpack_from(">Q", buf, pos + 8)[0], 16
        body = buf[pos + head:pos + size]
        out.append(Box(kind, children=parse(body)) if kind in CONTAINERS else Box(kind, bytes(body)))
        pos += size
    return out


def top_level(fh):
    """(kind, offset, size, header length) of each top-level box, reading only headers."""
    size, pos, out = fh.seek(0, os.SEEK_END), 0, []
    while pos < size:
        fh.seek(pos)
        n, kind = struct.unpack(">I4s", fh.read(8))
        head = 8
        if n == 1:
            n, head = struct.unpack(">Q", fh.read(8))[0], 16
        elif n == 0:
            n = size - pos
        out.append((kind, pos, n, head))
        pos += n
    return out


def u32s(payload, at, n):
    return list(struct.unpack_from(f">{n}I", payload, at))


class Track:
    """The sample table of the moov's one track, flattened to one row a sample."""

    def __init__(self, moov):
        self.moov = moov
        stbl = moov.find(b"trak", b"mdia", b"minf", b"stbl")
        unknown = {c.kind for c in stbl.children} - KNOWN_STBL
        if unknown:
            raise SystemExit(f"stbl holds {unknown}: not a layout this splicer knows")
        stsz = stbl.find(b"stsz").payload
        fixed, count = struct.unpack_from(">II", stsz, 4)
        self.sizes = [fixed] * count if fixed else u32s(stsz, 12, count)
        if stbl.has(b"co64"):
            co = stbl.find(b"co64").payload
            chunks = list(struct.unpack_from(f">{struct.unpack_from('>I', co, 4)[0]}Q", co, 8))
        else:
            co = stbl.find(b"stco").payload
            chunks = u32s(co, 8, struct.unpack_from(">I", co, 4)[0])
        stsc = stbl.find(b"stsc").payload
        runs = [u32s(stsc, 8 + 12 * i, 3) for i in range(struct.unpack_from(">I", stsc, 4)[0])]
        self.offsets = []
        for i, (first, per, desc) in enumerate(runs):
            if desc != 1:
                raise SystemExit("more than one sample entry")
            last = runs[i + 1][0] - 1 if i + 1 < len(runs) else len(chunks)
            for chunk in range(first, last + 1):
                at = chunks[chunk - 1]
                for _ in range(per):
                    self.offsets.append(at)
                    at += self.sizes[len(self.offsets) - 1]
        stts = stbl.find(b"stts").payload
        self.deltas = []
        for i in range(struct.unpack_from(">I", stts, 4)[0]):
            n, delta = struct.unpack_from(">II", stts, 8 + 8 * i)
            self.deltas += [delta] * n
        if stbl.has(b"stss"):
            stss = stbl.find(b"stss").payload
            keys = set(u32s(stss, 8, struct.unpack_from(">I", stss, 4)[0]))
            self.sync = [i + 1 in keys for i in range(count)]
        else:
            self.sync = [True] * count

    def encode(self, wide):
        """The moov for the current rows: contiguous samples share a chunk."""
        stbl = self.moov.find(b"trak", b"mdia", b"minf", b"stbl")
        chunks, per_chunk = [], []
        for i, (at, size) in enumerate(zip(self.offsets, self.sizes)):
            if i and at == self.offsets[i - 1] + self.sizes[i - 1]:
                per_chunk[-1] += 1
            else:
                chunks.append(at)
                per_chunk.append(1)
        stsc = [(i + 1, n) for i, n in enumerate(per_chunk) if i == 0 or n != per_chunk[i - 1]]
        stts = []
        for d in self.deltas:
            if stts and stts[-1][1] == d:
                stts[-1][0] += 1
            else:
                stts.append([1, d])
        boxes = {
            b"stts": struct.pack(">II", 0, len(stts)) + b"".join(struct.pack(">II", *r) for r in stts),
            b"stsc": struct.pack(">II", 0, len(stsc)) + b"".join(struct.pack(">III", c, n, 1) for c, n in stsc),
            b"stsz": struct.pack(">III", 0, 0, len(self.sizes)) + struct.pack(f">{len(self.sizes)}I", *self.sizes),
        }
        boxes[b"co64" if wide else b"stco"] = struct.pack(">II", 0, len(chunks)) + struct.pack(
            f">{len(chunks)}{'Q' if wide else 'I'}", *chunks)
        keys = [i + 1 for i, s in enumerate(self.sync) if s]
        if len(keys) < len(self.sync):
            boxes[b"stss"] = struct.pack(">II", 0, len(keys)) + struct.pack(f">{len(keys)}I", *keys)
        order = [b"stsd", b"stts", b"stss", b"stsc", b"stsz", b"co64" if wide else b"stco"]
        stbl.children = [stbl.find(b"stsd")] + [Box(k, boxes[k]) for k in order[1:] if k in boxes]
        self.set_durations(sum(self.deltas))
        return self.moov.encode()

    def set_durations(self, media):
        mdhd = self.moov.find(b"trak", b"mdia", b"mdhd")
        mvhd = self.moov.find(b"mvhd")
        movie_scale = struct.unpack_from(">I", mvhd.payload, 20 if mvhd.payload[0] else 12)[0]
        media_scale = struct.unpack_from(">I", mdhd.payload, 20 if mdhd.payload[0] else 12)[0]
        movie = media * movie_scale // media_scale
        set_field(mdhd, 24, 16, media)
        set_field(mvhd, 24, 16, movie)
        set_field(self.moov.find(b"trak", b"tkhd"), 28, 20, movie)
        trak = self.moov.find(b"trak")
        if trak.has(b"edts"):
            elst = trak.find(b"edts", b"elst")
            if struct.unpack_from(">I", elst.payload, 4)[0] != 1:
                raise SystemExit("an edit list of more than one entry")
            set_field(elst, 8, 8, movie)


def set_field(box, v1_at, v0_at, value):
    """A duration: 8 bytes at v1_at in a version-1 box, 4 bytes at v0_at in version 0."""
    p = bytearray(box.payload)
    if p[0]:
        p[v1_at:v1_at + 8] = struct.pack(">Q", value)
    else:
        p[v0_at:v0_at + 4] = struct.pack(">I", value)
    box.payload = bytes(p)


class Counter:
    def __init__(self, fh):
        self.fh, self.read = fh, 0

    def at(self, pos, n):
        self.fh.seek(pos)
        self.read += n
        return self.fh.read(n)


def splice_flat(path, at, remove, late, fsync):
    with open(path, "r+b") as fh:
        f = Counter(fh)
        boxes = top_level(fh)
        kinds = [b[0] for b in boxes]
        moov_box = boxes[kinds.index(b"moov")]
        mdat_box = boxes[kinds.index(b"mdat")]
        moov = parse(f.at(moov_box[1], moov_box[2]))[0]
        track = Track(moov)
        delta = track.deltas[-1]
        dead = sum(track.sizes[at:at + remove])
        if moov_box[1] > mdat_box[1]:
            return moov_at_end(f, track, boxes, moov_box, mdat_box, at, remove, late, delta, dead, fsync)
        return moov_at_front(f, path, track, boxes, moov_box, mdat_box, at, remove, late, delta, fsync)


def moov_at_end(f, track, boxes, moov_box, mdat_box, at, remove, late, delta, dead, fsync):
    if boxes[-1] != moov_box or boxes[-2] != mdat_box:
        raise SystemExit("the moov is not the last box after the mdat")
    fh, end = f.fh, moov_box[1]
    offsets, pos = [], end
    for _, data in late:
        offsets.append(pos)
        pos += len(data)
    track.offsets[at:at + remove] = offsets
    track.sizes[at:at + remove] = [len(d) for _, d in late]
    track.sync[at:at + remove] = [s for s, _ in late]
    track.deltas[at:at + remove] = [delta] * len(late)
    moov = track.encode(wide=pos > 0xFFFFFFFF)
    fh.truncate(end)
    fh.seek(end)
    fh.write(b"".join(d for _, d in late))
    mdat_size = pos - mdat_box[1]
    if mdat_box[3] == 16:
        fh.seek(mdat_box[1] + 8)
        fh.write(struct.pack(">Q", mdat_size))
    elif mdat_size > 0xFFFFFFFF:
        raise SystemExit("the mdat outgrows its 32-bit size")
    else:
        fh.seek(mdat_box[1])
        fh.write(struct.pack(">I", mdat_size))
    fh.seek(pos)
    fh.write(moov)
    if fsync:
        fh.flush()
        os.fsync(fh.fileno())
    written = pos - end + (8 if mdat_box[3] == 16 else 4) + len(moov)
    return f.read, written, dead


def moov_at_front(f, path, track, boxes, moov_box, mdat_box, at, remove, late, delta, fsync):
    """Every sample copied in display order into a new file: nothing is left dead."""
    head = [b for b in boxes if b[1] < moov_box[1]]
    prefix = b"".join(f.at(b[1], b[2]) for b in head)
    sources = [(o, s) for o, s in zip(track.offsets, track.sizes)]
    sources[at:at + remove] = [(None, d) for _, d in late]
    track.sizes[at:at + remove] = [len(d) for _, d in late]
    track.sync[at:at + remove] = [s for s, _ in late]
    track.deltas[at:at + remove] = [delta] * len(late)
    payload = sum(track.sizes)
    wide = len(prefix) + moov_box[2] + payload + 16 > 0xFFFFFFFF
    mdat_head = 16 if wide else 8
    place(track, 0)
    pos = len(prefix) + len(track.encode(wide)) + mdat_head
    place(track, pos)
    moov = track.encode(wide)
    partial = Path(str(path) + ".partial")
    with open(partial, "wb") as out:
        out.write(prefix + moov)
        out.write(struct.pack(">I4sQ", 1, b"mdat", 16 + payload) if wide else struct.pack(">I4s", 8 + payload, b"mdat"))
        for offset, src in sources:
            out.write(src if offset is None else f.at(offset, src))
        written = out.tell()
        if fsync:
            out.flush()
            os.fsync(out.fileno())
    publish(partial, path, fsync)
    return f.read, written, 0


def place(track, pos):
    """Every sample back to back from pos: the moov's size depends only on that, not on pos."""
    track.offsets = []
    for size in track.sizes:
        track.offsets.append(pos)
        pos += size


def publish(partial, path, fsync):
    os.rename(partial, path)
    if fsync:
        d = os.open(Path(path).parent, os.O_RDONLY)
        os.fsync(d)
        os.close(d)


def moof(seq, track_id, base_time, samples, delta):
    """One fragment's moof: tfhd default-base-is-moof, tfdt v1, a trun of every sample's fields."""
    entries = b"".join(struct.pack(">III", delta, len(d), SYNC if s else NON_SYNC) for s, d in samples)
    def build(offset):
        trun = Box(b"trun", struct.pack(">IIi", 0x000701, len(samples), offset) + entries)
        traf = Box(b"traf", children=[Box(b"tfhd", struct.pack(">II", 0x020000, track_id)),
                                      Box(b"tfdt", struct.pack(">IQ", 0x01000000, base_time)), trun])
        return Box(b"moof", children=[Box(b"mfhd", struct.pack(">II", 0, seq)), traf]).encode()
    size = len(build(0))
    return build(size + 8) + struct.pack(">I4s", 8 + sum(len(d) for _, d in samples), b"mdat")


def mfra(track_id, entries):
    """One tfra entry a fragment: (decode time, moof offset), each its first traf, trun and sample."""
    body = b"".join(struct.pack(">QQBBB", t, at, 1, 1, 1) for t, at in entries)
    tfra = Box(b"tfra", struct.pack(">IIII", 0x01000000, track_id, 0, len(entries)) + body)
    size = 8 + len(tfra.encode()) + 16
    return Box(b"mfra", children=[tfra, Box(b"mfro", struct.pack(">II", 0, size))]).encode()


class Fragment:
    def __init__(self, at, moof_box):
        self.at = at
        traf = moof_box.find(b"traf")
        tfhd, trun = traf.find(b"tfhd").payload, traf.find(b"trun").payload
        self.track_id = struct.unpack_from(">I", tfhd, 4)[0]
        tf_flags = struct.unpack_from(">I", tfhd, 0)[0] & 0xFFFFFF
        pos, defaults = 8, {}
        for bit, name in ((0x1, "base"), (0x2, "desc"), (0x8, "duration"), (0x10, "size"), (0x20, "flags")):
            if tf_flags & bit:
                defaults[name] = struct.unpack_from(">Q" if bit == 0x1 else ">I", tfhd, pos)[0]
                pos += 8 if bit == 0x1 else 4
        tfdt = traf.find(b"tfdt").payload
        self.time = struct.unpack_from(">Q" if tfdt[0] else ">I", tfdt, 4)[0]
        flags, count = struct.unpack_from(">II", trun, 0)
        flags &= 0xFFFFFF
        pos = 8
        data_offset = 0
        if flags & 0x1:
            data_offset = struct.unpack_from(">i", trun, pos)[0]
            pos += 4
        first_flags = None
        if flags & 0x4:
            first_flags = struct.unpack_from(">I", trun, pos)[0]
            pos += 4
        self.samples = []
        offset = at + data_offset
        for i in range(count):
            row = {}
            for bit, name in ((0x100, "duration"), (0x200, "size"), (0x400, "flags"), (0x800, "cto")):
                if flags & bit:
                    row[name] = struct.unpack_from(">I", trun, pos)[0]
                    pos += 4
            sflags = row.get("flags", first_flags if i == 0 and first_flags is not None else defaults.get("flags", 0))
            size = row.get("size", defaults.get("size"))
            self.samples.append((offset, size, not (sflags >> 16) & 1, row.get("duration", defaults.get("duration"))))
            offset += size


def splice_fragmented(path, at, remove, late, fsync):
    with open(path, "r+b") as fh:
        f = Counter(fh)
        boxes = top_level(fh)
        if boxes[-1][0] != b"mfra":
            raise SystemExit("no mfra at the end: not a layout this splicer knows")
        moofs = [b for b in boxes if b[0] == b"moof"]
        _, mfra_at, mfra_size, _ = boxes[-1]
        tfra = parse(f.at(mfra_at, mfra_size))[0].find(b"tfra").payload
        n = struct.unpack_from(">I", tfra, 12)[0]
        if struct.unpack_from(">I", tfra, 8)[0] & 0x3F or n != len(moofs):
            raise SystemExit("an mfra of other than one 1-byte entry a fragment")
        entries = [struct.unpack_from(">QQ", tfra, 16 + 19 * i) for i in range(n)]
        last = Fragment(moofs[-1][1], parse(f.at(moofs[-1][1], moofs[-1][2]))[0])
        delta = last.samples[-1][3]
        end_time = last.time + sum(s[3] for s in last.samples)
        if remove or at != end_time // delta:
            return rewrite_fragments(f, path, moofs, at, remove, late, delta, fsync)
        fh.truncate(mfra_at)
        fh.seek(mfra_at)
        data = moof(len(moofs) + 1, last.track_id, end_time, late, delta) + b"".join(d for _, d in late)
        tail = mfra(last.track_id, entries + [(end_time, mfra_at)])
        fh.write(data + tail)
        if fsync:
            fh.flush()
            os.fsync(fh.fileno())
        return f.read, len(data) + len(tail), 0


def rewrite_fragments(f, path, moofs, at, remove, late, delta, fsync):
    """Fragments before the one that holds AT are copied whole; it and every later one are rebuilt."""
    frags = [Fragment(b[1], parse(f.at(b[1], b[2]))[0]) for b in moofs]
    first, seen = 0, 0
    while first + 1 < len(frags) and seen + len(frags[first].samples) <= at:
        seen += len(frags[first].samples)
        first += 1
    head_end = frags[first].at
    partial = Path(str(path) + ".partial")
    with open(partial, "wb") as out:
        pos = 0
        while pos < head_end:
            n = min(1 << 24, head_end - pos)
            out.write(f.at(pos, n))
            pos += n
        groups = [[(s[2], (s[0], s[1])) for s in fr.samples] for fr in frags[first:]]
        local = at - seen
        groups[0][local:local + remove] = [(s, (None, d)) for s, d in late]
        entries = [(fr.time, fr.at) for fr in frags[:first]]
        t, seq = frags[first].time, first + 1
        track_id = frags[0].track_id
        for group in groups:
            entries.append((t, out.tell()))
            samples = [(s, src if off is None else f.at(off, src)) for s, (off, src) in group]
            out.write(moof(seq, track_id, t, samples, delta) + b"".join(d for _, d in samples))
            t += delta * len(group)
            seq += 1
        out.write(mfra(track_id, entries))
        written = out.tell()
        if fsync:
            out.flush()
            os.fsync(out.fileno())
    publish(partial, path, fsync)
    return f.read, written, 0


def load(names):
    return [(n.endswith(".k"), Path(n).read_bytes()) for n in names]


def splice(path, at, remove, names, fsync):
    late = load(names)
    start = time.perf_counter_ns()
    with open(path, "rb") as fh:
        fragmented = any(k == b"moof" for k, *_ in top_level(fh))
    read, written, dead = (splice_fragmented if fragmented else splice_flat)(path, at, remove, late, fsync)
    wall = time.perf_counter_ns() - start
    print(json.dumps({"read": read, "written": written, "dead": dead, "wall_ns": wall}))


def dump(path, outdir):
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    with open(path, "rb") as fh:
        f = Counter(fh)
        boxes = top_level(fh)
        moov_box = next(b for b in boxes if b[0] == b"moov")
        track = Track(parse(f.at(moov_box[1], moov_box[2]))[0])
        for i, (at, size, sync) in enumerate(zip(track.offsets, track.sizes, track.sync)):
            (outdir / (f"{i:05d}" + (".k" if sync else ""))).write_bytes(f.at(at, size))


if __name__ == "__main__":
    if sys.argv[1] == "splice":
        fsync = len(sys.argv) > 5 and sys.argv[5] == "--fsync"
        splice(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[6 if fsync else 5:], fsync)
    elif sys.argv[1] == "dump":
        dump(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
