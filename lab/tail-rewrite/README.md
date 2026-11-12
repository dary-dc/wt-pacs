# A late frame merged by rewriting only the tail

A late frame lands at its display position in a `.sbnd`. Today's merge writes the whole series again to a staged file
and renames it over the old one ([`../late-frame/README.md`](../late-frame/README.md)). This directory asks whether the
merge can write only the frames from the insertion point to the end and still publish by rename, keep the frames
contiguous in display order and keep no old index. It reports; it decides nothing.

**The candidate.** Clone the published file into the staging directory (`FICLONE`: the clone shares the old file's
extents, no data copied), rewrite in the clone from the insertion point to the end, read back what was rewritten,
`rename` over the old name. The frames before the point keep their offsets, so their extents stay shared. On a
filesystem without reflinks the clone fails and the prefix is copied (`copy_file_range`), which is a full rewrite.

**Two places for the index**, both layout 0 of the [target](../../docs/disk-layout/target.md) (28 B entries):

* **front, with reserved slack**: header (152 B: the target's 148 B and a `u32` capacity C), C entries of which N are
  used, then the frames. A merge that fits in C rewrites header, index and tail; one that does not is a full rewrite
  with a new C.
* **end**: the target's 148 B header, the frames, then N entries at `size − N·28`. A reader `stat`s, reads the header
  and then the index: two `pread`s, as today. A merge rewrites the header (N), the tail and the index after it.

## Pre-registered, 2026-10-26, before any cell ran

F ≈ 264 kB, the HTJ2K frame [#179](../late-frame/README.md) measured; S = N·F (69 MB at N = 262, 528 MB at 2 000).
One late frame, at the end, the middle (N/2) or the start (0). XFS with `reflink=1` and ext4, each on a loop device.

| arm | written | read (old file + read-back) | warm, N = 2 000 |
| --- | --- | --- | --- |
| full rewrite, either index, either filesystem | S + F + index | S + (S + F) | 0.5–1 s: the host's page-cache copy (#179) |
| XFS tail, end | F + index + two CoW'd 4 KiB blocks (header, the block holding the point) | index + (F + index) | < 20 ms; < 50 ms with `fsync` |
| XFS tail, middle | S/2 + F + index | S/2 + (S/2 + F) | about half the full rewrite |
| XFS tail, start | S + F + index | as the full rewrite | as the full rewrite: nothing is shared |
| ext4 tail (no reflink: `copy_file_range` of the prefix) | S + F + index, at every position | S + (S + F): the copied prefix must be read back too | within 1.5× of the full rewrite |

* **The two index placements tie** in bytes and time: they differ by the slack (C − N)·28 B and by where the index
  is written. The front one adds a full rewrite every time the slack runs out.
* **The device sees what the arm says**: on XFS the loop device's sectors written track the arm's bytes, plus
  metadata (the refcount tree, the log) under 1 MB; no hidden copy.
* **Every tail output is byte for byte the full rewrite's output** on both filesystems, and a reader holding the old
  file open reads the old frames after the rename (a clone's writes are copy-on-write).
* **`FICLONE` itself** costs < 5 ms at 528 MB: extent metadata, not data.

**Arithmetic, to be stated, not measured: layout 1.** Entries are band-major, so a late frame's band 0 lands inside
band 0's run and every band-1 and band-2 byte after it moves. The tail is then at least bands 1 and 2, ~93 % of S,
wherever the frame lands: the tail rewrite saves at most band 0's prefix, ≤ 7 %. Only a gap reserved after each band's
run would bring it back to the layout-0 numbers.

## Against the numbers

The numbers are in [`../../docs/disk-layout/containers.md`](../../docs/disk-layout/containers.md) §Measured: rewriting
only the tail. The frames are synthetic (264 kB ± 20 %, random bytes): only their lengths matter to the I/O.

* **XFS tail at the end: F + index + two blocks; < 20 ms warm, < 50 ms `fsync`'d** — held: 342 kB at N = 2 000,
  2.9–3.0 ms warm, 6.7–7.3 ms `fsync`'d (2.5–7.9 ms over runs).
* **XFS tail in the middle: S/2 + F, about half the full rewrite** — held in bytes (264.4 of 529.4 MB); in time
  0.37–0.41× warm and 0.62–0.67× `fsync`'d.
* **XFS tail at the start: as the full rewrite** — held in bytes, **not in time**: 1.6× the full rewrite `fsync`'d
  (3.7–3.8 s against 2.3 s), 0.86–1.5× warm. Every block it writes overwrites a shared extent, so each pays
  copy-on-write. A merge with no shared prefix should not clone.
* **ext4: S + F at every position, within 1.5× of the full rewrite** — held: the same bytes written to the byte and
  0.93–1.07× warm, 0.99–1.14× `fsync`'d, except one cell: index at the end, frame at the start, `fsync`'d, 4.25 s
  (rounds 2–4 at 4.25–4.29 s, rounds 0–1 at 2.26 and 3.21 s). That arm copies nothing at the start, so it is the full
  rewrite's work; the slow rounds are not explained. It reads more: the
  copied prefix is read by `copy_file_range` and again to check it.
* **The two index places tie** — held: within 2 kB and within each other's run-to-run range everywhere.
* **The device sees what the arm says, metadata < 1 MB** — held: XFS's loop device wrote the arm's bytes plus
  7–213 kB (median 14 kB), the full rewrite plus 5–209 kB.
* **Byte for byte the full rewrite, the old file unchanged under a reader** — held, all 24 (filesystem × N × position
  × index place); on XFS the published file shares exactly the blocks below the point with the old one (FIEMAP).
* **`FICLONE` < 5 ms at 528 MB** — held: 0.03–0.1 ms; these files have a handful of extents.

Five breakages, each caught (`mutate.txt`): the late frame a byte off and a corrupted byte (by the read-back), the
header not rewritten (identity), the clone skipped (the read-back of the prefix), the tail written into the published
file instead of a clone (identity and the open reader).

## Reproduce

Run as root (loop devices and mounts): xfsprogs and e2fsprogs, Rust, Python 3, `filefrag` (e2fsprogs).

```bash
W=/var/tmp/tail-rewrite                       # any directory with 13 GiB free
lab/tail-rewrite/mounts.sh $W/fs              # XFS reflink=1 and ext4 on loop devices
(cd lab/tail-rewrite/merge && cargo build --release)
python3 lab/tail-rewrite/run.py $W/fs $W/out 5   # checks, breakages, every cell interleaved, the host
python3 lab/tail-rewrite/summary.py $W/out
```

| file | what |
| --- | --- |
| `merge/` | `tail-merge`: packs a synthetic layout-0 series with either index place, and merges one late frame by full rewrite or by tail rewrite of a `FICLONE`d clone (`copy_file_range` of the prefix where the clone is refused); stages in `incoming/`, reads back what it wrote (`O_DIRECT` when durable), renames |
| `mounts.sh` | the two filesystems, each a 6 GiB image on a loop device with direct I/O to its image |
| `run.py` | the checks, the breakages, every cell in a Williams order (`lab/order.mjs`'s square), the host's rates |
| `summary.py` | the medians |
| `rows.jsonl`, `checks.jsonl`, `host.jsonl`, `mutate.txt` | this run's rows, 2026-10-26 |

`checks.jsonl` is from a second pass after the campaign: the first read `shared` after closing the old file, when
XFS may already have stopped sharing its extents (0 in 7 of 12 XFS rows); `identical` and `old_unchanged` held in both.
