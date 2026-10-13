"""Folios a frame read touches, by how the file was written: a model of Linux v6.18.44's page cache.

Derivation for docs/disk-layout/README.md §The writer (row 168), not a measurement. It replays the writes each
writer issues through generic_perform_write and __filemap_get_folio's folio sizing, then counts the folios each
frame's span overlaps. Frame sizes are synthetic (seeded); the metadata length is a typical one.

    python3 docs/disk-layout/folio_model.py
"""

import random

PAGE = 4096
MAX_ORDER = 9  # ext4: umin(MAX_PAGECACHE_ORDER, 11 + blkbits - PAGE_SHIFT), x86-64 4 KiB pages


class Cache:
    def __init__(self, max_order=MAX_ORDER):
        self.max_order = max_order
        self.start_of = {}  # page index -> first page index of the folio holding it

    def folio_at(self, index):
        return self.start_of.get(index)

    def add(self, index, order):
        for p in range(index, index + (1 << order)):
            assert p not in self.start_of
            self.start_of[p] = index

    def folio_end(self, index):
        start = self.start_of[index]
        end = index
        while self.start_of.get(end) == start:
            end += 1
        return end

    def write(self, pos, length):
        """generic_perform_write (mm/filemap.c:4238) with __filemap_get_folio's sizing (:2006-2010)."""
        while length:
            chunk = PAGE << self.max_order
            offset = pos & (chunk - 1)
            nbytes = min(chunk - offset, length)
            index = pos // PAGE
            if self.folio_at(index) is None:
                shift = nbytes.bit_length() - 1  # filemap_get_order (include/linux/pagemap.h:725)
                order = min(shift - 12 if shift > 12 else 0, self.max_order)
                if index & ((1 << order) - 1):
                    order = (index & -index).bit_length() - 1
                self.add(index, order)
            end = self.folio_end(index) * PAGE
            done = min(nbytes, end - pos)
            pos += done
            length -= done

    def folios_in(self, pos, length):
        first, last = pos // PAGE, (pos + length - 1) // PAGE
        return len({self.start_of[p] for p in range(first, last + 1)})


class BufWriter:
    """Rust 1.97 std BufWriter::write_all (library/std/src/io/buffered/bufwriter.rs:414-440, :548-560)."""

    def __init__(self, cache, capacity):
        self.cache, self.cap, self.pos, self.buf = cache, capacity, 0, 0

    def flush(self):
        if self.buf:
            self.cache.write(self.pos, self.buf)
            self.pos += self.buf
            self.buf = 0

    def write_all(self, n):
        spare = self.cap - self.buf
        if n < spare:
            self.buf += n
            return
        if n > spare:
            self.flush()
        if n >= self.cap:
            self.flush()
            self.cache.write(self.pos, n)
            self.pos += n
        else:
            self.buf += n


def layout(frames, metadata):
    prefix = [4, 4, 4, 4] + [8, 4] * len(frames) + [metadata]
    return prefix, sum(prefix)


def via_bufwriter(frames, metadata, capacity):
    cache = Cache()
    w = BufWriter(cache, capacity)
    prefix, _ = layout(frames, metadata)
    for n in prefix + frames:
        w.write_all(n)
    w.flush()
    return cache


def via_fixed(frames, metadata, block, max_order=MAX_ORDER):
    """dd bs=block: every write block-aligned and block long but the last."""
    cache = Cache(max_order)
    total = layout(frames, metadata)[1] + sum(frames)
    for pos in range(0, total, block):
        cache.write(pos, min(block, total - pos))
    return cache


def mean_folios(cache, frames, metadata):
    pos, counts = layout(frames, metadata)[1], []
    for n in frames:
        counts.append(cache.folios_in(pos, n))
        pos += n
    return sum(counts) / len(counts)


def main():
    rng = random.Random(168)
    sets = {
        "32-41 kB, 335 frames": [rng.randint(32_000, 41_000) for _ in range(335)],
        "150-170 kB, 100 frames": [rng.randint(150_000, 170_000) for _ in range(100)],
        "470-510 kB, 29 frames": [rng.randint(470_000, 510_000) for _ in range(29)],
    }
    metadata = 3_000
    writers = {
        "pack-series (BufWriter 8 KiB)": lambda f: via_bufwriter(f, metadata, 8 << 10),
        "BufWriter 1 MiB (row 160's packers)": lambda f: via_bufwriter(f, metadata, 1 << 20),
        "dd bs=8K": lambda f: via_fixed(f, metadata, 8 << 10),
        "dd bs=1M": lambda f: via_fixed(f, metadata, 1 << 20),
        "4 KiB folios, any writer": lambda f: via_fixed(f, metadata, 1 << 20, max_order=0),
    }
    print("| writer | " + " | ".join(sets) + " |")
    print("| --- |" + " ---: |" * len(sets))
    for name, make in writers.items():
        row = [f"{mean_folios(make(f), f, metadata):.1f}" for f in sets.values()]
        print(f"| {name} | " + " | ".join(row) + " |")


if __name__ == "__main__":
    main()
