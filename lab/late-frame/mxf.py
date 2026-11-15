#!/usr/bin/env python3
"""Late frames appended in place to a frame-wrapped MXF OP1a file, at the byte level.

usage: mxf.py walk FILE
       mxf.py append FILE [--fsync] CODESTREAM...      prints {"read", "written", "wall_ns"}

Two layouts bmx 1.6 writes, and no other:
  footer  `raw2bmx --min-part`: header partition with every frame, footer with the whole index.
  body    `raw2bmx --part P --body-part`: each body partition opens with the index segment of
          the partition before it; the footer holds the last one's.
The append is SMPTE ST 377-1's: cut the footer and RIP, add the frames, write a new footer and
RIP, patch every partition pack's FooterPartition and each Duration in place.
"""
import json
import os
import struct
import sys
import time
import uuid

PARTITION = bytes.fromhex("060e2b34020501010d01020101")
RIP = bytes.fromhex("060e2b34020501010d01020101110100")
INDEX = bytes.fromhex("060e2b34025301010d01020101100100")
PICTURE = bytes.fromhex("060e2b34010201010d010301")
LOCAL_SET = bytes.fromhex("060e2b340253")
DURATION_TAGS = (0x0202, 0x3002)  # StructuralComponent Duration, FileDescriptor ContainerDuration
PACK = ">HHIQQQQQIQI16s"  # ST 377-1 §7.1, up to the essence container batch
FOOTER_FIELD = 24  # FooterPartition's offset in a partition pack's value


def ber(n, width):
    return bytes([0x80 | (width - 1)]) + n.to_bytes(width - 1, "big")


def read_ber(buf, pos):
    if buf[pos] < 0x80:
        return buf[pos], pos + 1
    n = buf[pos] & 0x7F
    return int.from_bytes(buf[pos + 1:pos + 1 + n], "big"), pos + 1 + n


class File:
    """Positioned reads that count their bytes."""

    def __init__(self, fh):
        self.fh, self.read = fh, 0

    def at(self, pos, n):
        self.fh.seek(pos)
        self.read += n
        return self.fh.read(n)

    def klv(self, pos):
        """(key, value offset, value length) of the KLV at pos."""
        head = self.at(pos, 25)
        length, vpos = read_ber(head, 16)
        self.read -= 25 - vpos
        return head[:16], pos + vpos, length


class Pack:
    def __init__(self, key, value):
        self.key = bytes(key)
        self.fields = list(struct.unpack_from(PACK, value))
        self.tail = value[struct.calcsize(PACK):]

    this = property(lambda s: s.fields[3], lambda s, v: s.fields.__setitem__(3, v))
    previous = property(lambda s: s.fields[4], lambda s, v: s.fields.__setitem__(4, v))
    footer = property(lambda s: s.fields[5], lambda s, v: s.fields.__setitem__(5, v))
    header_bytes = property(lambda s: s.fields[6])
    index_bytes = property(lambda s: s.fields[7], lambda s, v: s.fields.__setitem__(7, v))
    body_offset = property(lambda s: s.fields[9], lambda s, v: s.fields.__setitem__(9, v))
    body_sid = property(lambda s: s.fields[10])

    def encode(self, width):
        value = struct.pack(PACK, *self.fields) + self.tail
        return self.key + ber(len(value), width) + value


def local_set(value):
    pos = 0
    while pos + 4 <= len(value):
        tag, length = struct.unpack_from(">HH", value, pos)
        yield tag, pos + 4, length
        pos += 4 + length


class Index:
    """A VBE index table segment (ST 377-1 §11.2), 11-byte entries and no slices."""

    def __init__(self, value):
        self.items = {tag: value[at:at + n] for tag, at, n in local_set(value)}
        count, size = struct.unpack(">II", self.items[0x3F0A][:8])
        if size != 11:
            raise SystemExit(f"{size}-byte index entries: not a layout this appender knows")
        raw = self.items[0x3F0A][8:]
        self.entries = [struct.unpack_from(">bbBQ", raw, i * 11) for i in range(count)]
        self.start = struct.unpack(">q", self.items[0x3F0C])[0]

    def encode(self, start, entries, width):
        items = dict(self.items)
        items[0x3C0A] = uuid.uuid4().bytes
        items[0x3F0C] = struct.pack(">q", start)
        items[0x3F0D] = struct.pack(">q", len(entries))
        items[0x3F0A] = struct.pack(">II", len(entries), 11) + b"".join(struct.pack(">bbBQ", *e) for e in entries)
        value = b"".join(struct.pack(">HH", t, len(v)) + v for t, v in items.items())
        return INDEX + ber(len(value), width) + value


def read_pack(f, pos):
    key, vpos, length = f.klv(pos)
    return Pack(key, f.at(vpos, length)), vpos - pos - 16, vpos + length


def first_klv_after(f, pos, want, stop):
    while pos < stop:
        key, vpos, length = f.klv(pos)
        if key[:len(want)] == want:
            return pos, key, vpos, length
        pos = vpos + length
    raise SystemExit(f"no {want.hex()} KLV before {stop}")


def append(path, codestreams, fsync):
    late = [open(c, "rb").read() for c in codestreams]
    start = time.perf_counter_ns()
    with open(path, "r+b") as fh:
        f = File(fh)
        size = fh.seek(0, os.SEEK_END)
        rip_len = struct.unpack(">I", f.at(size - 4, 4))[0]
        rip = f.at(size - rip_len, rip_len)
        pairs = [struct.unpack_from(">IQ", rip, at) for at in range(20, rip_len - 4, 12)]
        footer_at = pairs[-1][1]
        footer, width, after_footer = read_pack(f, footer_at)
        seg_at, _, vpos, length = first_klv_after(f, after_footer, INDEX, size)
        old_segment = f.at(seg_at, vpos - seg_at + length)
        segment = Index(old_segment[vpos - seg_at:])
        duration = segment.start + len(segment.entries)

        essence_at = pairs[-2][1]
        essence, _, after_pack = read_pack(f, essence_at)
        first, picture_key, _, _ = first_klv_after(f, after_pack + essence.header_bytes, PICTURE, footer_at)
        flags, last_offset = segment.entries[-1][2], segment.entries[-1][3]
        _, last_vpos, last_len = f.klv(first + last_offset - essence.body_offset)
        essence_end = last_vpos + last_len
        if essence_end != footer_at:
            raise SystemExit(f"essence ends at {essence_end}, the footer is at {footer_at}: fill or a layout unknown")
        element_width = last_vpos - (first + last_offset - essence.body_offset) - 16
        stream_end = essence.body_offset + essence_end - first

        elements, entries, offset = bytearray(), [], 0
        for frame in late:
            entries.append((0, 0, flags, offset))
            element = picture_key + ber(len(frame), element_width) + frame
            elements += element
            offset += len(element)

        out = bytearray()
        if len(pairs) == 2:
            new_segment = segment.encode(0, segment.entries + [(a, b, c, stream_end + d) for a, b, c, d in entries], width)
            out += elements
            footer.this = footer.footer = footer_at + len(out)
            new_pairs = pairs[:-1] + [(pairs[-1][0], footer.this)]
        else:
            body = Pack(essence.key, struct.pack(PACK, *essence.fields) + essence.tail)
            body.this, body.previous, body.body_offset = footer_at, essence_at, stream_end
            body.index_bytes = len(old_segment)
            body_bytes = body.encode(width)
            footer.previous = footer_at
            footer.this = footer.footer = body.footer = footer_at + len(body_bytes) + len(old_segment) + len(elements)
            out += body.encode(width) + old_segment + elements
            new_segment = segment.encode(duration, [(a, b, c, stream_end + d) for a, b, c, d in entries], width)
            new_pairs = pairs[:-1] + [(essence.body_sid, footer_at), (pairs[-1][0], footer.this)]
        footer.index_bytes = len(new_segment)
        out += footer.encode(width) + new_segment
        rip_value = b"".join(struct.pack(">IQ", sid, at) for sid, at in new_pairs)
        rip_total = 16 + width + len(rip_value) + 4
        out += RIP + ber(len(rip_value) + 4, width) + rip_value + struct.pack(">I", rip_total)

        fh.truncate(footer_at)
        fh.seek(footer_at)
        fh.write(out)
        written = len(out)
        for _, at in pairs[:-1]:
            _, vpos, _ = f.klv(at)
            fh.seek(vpos + FOOTER_FIELD)
            fh.write(struct.pack(">Q", footer.this))
            written += 8
        written += patch_durations(f, duration, duration + len(late))
        if fsync:
            fh.flush()
            os.fsync(fh.fileno())
    wall = time.perf_counter_ns() - start
    print(json.dumps({"read": f.read, "written": written, "wall_ns": wall}))


def patch_durations(f, old, new):
    """Every 8-byte Duration and ContainerDuration in the header metadata that reads `old`."""
    header, _, after = read_pack(f, 0)
    metadata = f.at(after, header.header_bytes)
    pos, written = 0, 0
    while pos < len(metadata):
        key = metadata[pos:pos + 16]
        length, vpos = read_ber(metadata, pos + 16)
        if key[:6] == LOCAL_SET:
            for tag, at, n in local_set(metadata[vpos:vpos + length]):
                value = metadata[vpos + at:vpos + at + n]
                if tag in DURATION_TAGS and n == 8 and struct.unpack(">q", value)[0] == old:
                    f.fh.seek(after + vpos + at)
                    f.fh.write(struct.pack(">q", new))
                    written += 8
        pos = vpos + length
    return written


def walk(path):
    with open(path, "rb") as fh:
        f = File(fh)
        size = fh.seek(0, os.SEEK_END)
        pos, frames = 0, 0
        while pos < size:
            key, vpos, length = f.klv(pos)
            if key[:13] == PARTITION and key[13] in (2, 3, 4):
                p = Pack(key, f.at(vpos, length))
                print(f"{pos:>11} {['header', 'body', 'footer'][key[13] - 2]:6} prev {p.previous} "
                      f"footer {p.footer} header {p.header_bytes} index {p.index_bytes} body_offset {p.body_offset}")
            elif key == INDEX:
                seg = Index(f.at(vpos, length))
                print(f"{pos:>11}   index start {seg.start} entries {len(seg.entries)}")
            elif key[:12] == PICTURE:
                frames += 1
            pos = vpos + length
        print(f"{size} bytes, {frames} picture elements")


if __name__ == "__main__":
    if sys.argv[1] == "walk":
        walk(sys.argv[2])
    elif sys.argv[1] == "append":
        fsync = sys.argv[3] == "--fsync"
        append(sys.argv[2], sys.argv[4 if fsync else 3:], fsync)
    else:
        sys.exit(__doc__)
