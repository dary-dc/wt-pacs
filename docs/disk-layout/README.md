# Disk layout: the `.sbnd` today

One series, one file, written once and read by one server process. This is the layout the code builds and reads,
exactly; the draft that replaces it is [`target.md`](target.md). Every line reference is to
`common/series-bundle/src/` unless it names another file.

```text
 offset 0                16              16 + 12·N           data_base
 ┌──────────────────────┬────────────────┬───────────────────┬───────────┬───────────┬─────┬─────────────┐
 │ header 16 B          │ index 12 B × N │ metadata JSON     │ frame 0   │ frame 1   │  …  │ frame N − 1 │
 │ "SBND" ver mlen N    │ offset │ len   │ (UTF-8, mlen B)   │           │           │     │             │
 └──────────────────────┴────────────────┴───────────────────┴───────────┴───────────┴─────┴─────────────┘
  └──── the prefix: read once at open, two preads ────────────┘ └── back to back, display order, unaligned ──┘
```

## The bytes

All integers little-endian.

| Field | Size | Value | Where |
| --- | ---: | --- | --- |
| magic | 4 B | `"SBND"` | `format.rs:8` |
| version | u32 | `1`; any other is refused at open | `format.rs:9`, `:30–33` |
| metadata length | u32 | bytes of the JSON that follows the index | `format.rs:34` |
| frame count | u32 | N | `format.rs:35` |
| index entry × N | 12 B | offset u64 (from the start of the file) · length u32 | `format.rs:12`, `:44–58` |
| metadata | `mlen` B | the series' `metadata.json`, verbatim | `format.rs:61–63` |
| frames | Σ lengths | the coded frames, back to back | `writer.rs:62–77` |

* **The index has a fixed stride.** Entry *i* is at `16 + 12·i`; the frame number is the entry's position, and no
  entry names its frame.
* **Frames are in display order and unaligned.** The writer lays frame *i* right after frame *i − 1*
  (`writer.rs:51–56`); nothing pads a frame to a sector or a page.
* **An entry is checked at open, not when served.** One that points before `data_base` or past the end of the file,
  or a frame over the client's limit (`MAX_CODESTREAM_LEN`, [`../WIRE.md`](../WIRE.md#the-envelope)), refuses the
  whole file, naming the frame (`format.rs:48–57`, `:73–79`).
* **No hash, no codec, no UIDs in the binary part.** The codec, the display attributes and the per-frame samples
  digest are all in the metadata JSON ([`../FIXTURES.md`](../FIXTURES.md) §Frame digests, §From DICOM); nothing
  hashes the coded bytes.

## The metadata, twice

Ingest writes the same JSON in two places: inside the file, and as a sidecar beside it.

| Copy | Written by | Read by |
| --- | --- | --- |
| embedded, after the index | `BundleWriter::create` (`writer.rs:58`) | **nobody**: the parser returns it (`format.rs:61`), `FrameStore::open` keeps only the index (`server/src/media/frame_store.rs:44–49`) |
| sidecar `OUT.metadata.json` | `from_dicom.py`, once `pack-series` has written the bundle (`ingest/from-dicom/from_dicom.py:60–65`) | **the page**, as `/series/metadata`: nginx aliases it (`deploy/nginx/wt-pacs.conf.template:46–49`), `dev-server.py` serves it (`server/dev-server.py:32–33`) |

The server reads neither. The site's compiled ingest (`ingest/from-parser`) embeds the JSON and writes no sidecar
(`ingest/from-parser/src/main.rs:114`), so its output needs one made before a page can open it.

## The writer

`BundleWriter` (`writer.rs:10–101`) needs **every frame's length before the first byte**: the index is written
first and cannot be corrected, so a frame of another length than declared, or a file finished short of its count,
is refused (`writer.rs:67–73`, `:80–86`). Hence the pack cannot stream while frames are still being coded
(queue row 163).

It writes **`NAME.partial`** (`writer.rs:32–35`) and, in `finish`, flushes its buffer and renames the file over
`NAME` (`:87–89`); a writer dropped unfinished removes its partial (`:95–101`). So a failed pack leaves nothing at
the name, and a server holding the old bundle open keeps reading the old file, never a rewrite under its index.
`from_dicom.py` writes the sidecar only after the pack succeeds. *Corrected 2026-10-16 (row 269): until then it wrote
to the final name, so a pack that failed left a short file there, and the sidecar, while both ingests said "nothing
written".* A crash mid-pack leaves at most a `.partial`, which no server opens. There is still no `fsync`: a power
loss after the pack can leave the full length with blocks never written, which nothing detects, as no hash covers
the coded bytes.

### Why its files read slower on a hit (row 168: theory; measured by row 172, §Measured below)

Row 160 found a `.sbnd` from `pack-series` 24–31 % slower on warm hits than the same bytes rewritten in 1 MiB
writes, at 32–41 kB frames ([`containers.md`](containers.md) §Measured). Sources are Linux **v6.18.44** (the host's
kernel) and Rust **1.97.0**'s `std`, fetched 2026-10-13 from their GitHub tags (`gregkh/linux`, `rust-lang/rust`);
SHA-256, first 16 hex: `mm/filemap.c` 2bd1223972411197, `mm/readahead.c` 25f3c0da49787109, `mm/fadvise.c`
f05ef1386bb5d24b, `include/linux/pagemap.h` 44f347f4fbd947e1, `include/linux/pagevec.h` b5ab95c07fdc938a,
`fs/ext4/inode.c` 25532a313138ab13, `fs/iomap/buffered-io.c` 68a74357e7bb7a17, `fs/overlayfs/file.c`
d1e1f9170c54a3b1, `library/std/src/io/buffered/bufwriter.rs` bfb94a39508dc287, `library/std/src/sys/io/mod.rs`
a6c3fcc9355d143e.

**What `pack-series` writes.** Its `BufWriter` holds 8 KiB (`DEFAULT_BUF_SIZE`, `library/std/src/sys/io/mod.rs:72`),
and a `write_all` at least that long bypasses it (`bufwriter.rs:420–429`). So the prefix goes out in 8 KiB writes, and
**every frame of 8 KiB or more is one `write(2)` of its own length**, at whatever offset the previous frame ended.
"Written in 8 KiB writes" is true of the prefix and of frames under 8 KiB only.

**The mechanism: a write sizes the page-cache folios it creates.** A hit never touches the disk or the extent tree:
`filemap_read` takes the cached folios in batches of 31 (`mm/filemap.c:2404–2435`, `pagevec.h:15`) and pays per
folio a reference get and put, an xarray step and an accessed mark, then copies (`:2780–2822`). The folio sizes are
set when the folio is created. On a write, `generic_perform_write` asks for one folio covering the rest of the write
(`mm/filemap.c:4257–4266`); `write_begin_get_folio` turns that length into an order (`include/linux/pagemap.h:725–733`,
`:774–786`), cut to the page index's alignment and the mapping's maximum (`mm/filemap.c:2006–2010`), and a page that
already holds the previous frame's tail is reused as it is. **ext4 enables large folios for regular files since v6.16**
(`ext4_should_enable_large_folio`, `fs/ext4/inode.c:5165–5196`; absent at v6.15), up to 2 MiB with 4 KiB blocks, and
its delayed-allocation `write_begin` sizes folios the same way (`:3156`). XFS has large folios since v5.17 and sizes
them by the write's length through iomap since v6.6 (`fs/iomap/buffered-io.c:658` at v6.18.44; absent at v6.5).

Replaying each writer's `write` calls through those rules (`python3 docs/disk-layout/folio_model.py`, synthetic frame
sizes, (D)) gives the folios one frame read spans:

| writer | 32–41 kB, 335 frames | 150–170 kB, 100 | 470–510 kB, 29 |
| --- | ---: | ---: | ---: |
| `pack-series` (8 KiB `BufWriter`) | 5.1 | 7.2 | 9.0 |
| 1 MiB `BufWriter` (row 160's own packers) | 1.3 | 2.5 | 5.4 |
| `dd bs=8K` | 5.4 | 20.6 | 61.2 |
| `dd bs=1M` | 1.0 | 1.2 | 1.6 |
| 4 KiB folios (any writer before ext4 v6.16; `WILLNEED`, below) | 9.9 | 40.1 | 121.4 |

This fits all three of row 160's small-frame readings — `pack-series` ≈ `dd bs=8K` (5.1 and 5.4 folios, "rewriting v2
in 8 KiB undoes it"), both slower than `dd bs=1M` (1.0), and the 1 MiB-buffered arms close to it (1.3) — but it was
fitted after them, so it is a hypothesis, not a finding. At row 160's hit p50 of 2.3–5.5 µs, 24–31 % over ~4 extra
folios puts a folio at roughly 150–300 ns (D); at 160 and 500 kB the same cost is 6–9 % of the 15–29 µs hit, under
row 160's 30 % resolution, which would be why only the small frames stood out.

**The other candidates, and why each is weaker.**

* *Extent fragmentation, delayed allocation:* they shape the blocks, which only a read from the device sees; a hit
  maps no blocks. They cannot explain a hit gap. `fallocate` and `filefrag -v` tell them apart from folios.
* *Readahead:* a hit triggers none. But it decides the folios **after** reclaim: a blocking read's readahead starts at
  order 0 and grows by 2 orders a window (`mm/readahead.c:624`, `:689`) up to the window's size (`:486–487`), 128 KiB
  at the host's `read_ahead_kb`; `POSIX_FADV_WILLNEED`, which the fill's `advise_ahead` issues
  (`server/src/media/frame_store.rs:134`), goes through `force_page_cache_ra` to `page_cache_ra_unbounded`, which
  allocates every folio at the minimum order, 4 KiB (`mm/fadvise.c:96–106`, `mm/readahead.c:275–276`). One such call
  also reads at most `max(io_pages, ra_pages)` pages (`:351–352`), 1.25 MiB on this host (`max_sectors_kb` 1280), so
  the first 4 MiB `FILL_WINDOW` advice is cut to 1.25 MiB. Both are the read path's (`../adr/disk-access.md`), not the
  writer's.
* *The container's overlay:* overlayfs hands a read to the real file (`fs/overlayfs/file.c:337–341`), whose mapping
  holds the folios; it adds a step per read, the same for every writer. Row 160's host was ext4 on `/dev/vda`, no
  overlay.

**Would production see it.** Only while the folios the writer made are the ones cached: from the pack until reclaim,
and only on a kernel and filesystem with large folios (ext4 ≥ v6.16, XFS ≥ v6.6); below those every folio is 4 KiB
whatever the writer. A recently ingested study read on the host that packed it is that case. After reclaim the folios
are the read path's, and a cache warmed by the fill's own `WILLNEED` would be all 4 KiB — about twice `pack-series`'
count per small frame. Either way the cost is small against the product: ~1 µs a 32–41 kB frame (D) against a frame's
server CPU, which is mostly per-datagram QUIC work (~675 µs at 250 kB, `../adr/disk-access.md` §8). Net if adopted —
code alone — but a gain in server CPU, not in fill time at the target's links.

**The fixes, smallest first.** Bytes are identical in every one.

| fix | code | folios a 32–41 kB frame (D) | note |
| --- | --- | ---: | --- |
| F1: `BufWriter::with_capacity(1 << 20, …)` | one line | 1.3 | frames under 1 MiB coalesce; offsets still unaligned |
| F2: write the file in 1 MiB-aligned 1 MiB pieces (split frames across writes) | ~10 lines | 1.0 | `dd bs=1M`'s layout |
| F3: one `write` per frame | none | 5.1 | what `pack-series` already does for frames ≥ 8 KiB |
| F4: `fallocate` to the final size first | a few lines | 5.1 | changes extents, not folios: predicted no effect on hits |
| F5: copy at publish | a second write | depends on the copier's write size | no smaller than F1 |

Row 164's draft target (`.partial` → `fsync` → `rename`, [`target.md`](target.md)) changes none of them: the folios
belong to the inode, which `rename` keeps, and writeback cleans folios without resizing them (reasoned, no line cited).

### Protocol for the measuring row (run by row 172)

Given to a separate session with nothing above this heading.

* **Arms, differing in the writer alone**, each a `.sbnd` of the same bytes (SHA-256 equal to A0's, else the arm is
  void), read by the shipped `TileReader` and `FillReader` unchanged: **A0** `pack-series` today; **A0′** the same,
  another file (A/A control: its p90 \|A0′/A0 − 1\| is the resolution); **A1** `pack-series` with a 1 MiB `BufWriter`;
  **A2** A0's bytes rewritten in aligned 1 MiB writes (`dd bs=1M`); **A3** `fallocate` to the final size, then
  `pack-series`; **A4** A0's bytes rewritten with `dd bs=8K`; **A5** written with `O_DIRECT` (nothing cached), then
  warmed by one sequential read in 128 KiB blocks; **A6** written with `O_DIRECT`, then warmed by `POSIX_FADV_WILLNEED`
  over the file in 1 MiB pieces, as the fill advises. A5 and A6 stand for production after reclaim without evicting
  anything.
* **Cells:** `pt15_cptac` and `mr9_ispy2` (32–41 kB), `ct_lidc` (160 kB), `dbt12_ea1141` (500 kB), HTJ2K, and AV1 on
  `pt15_cptac` as a check; ingest's coded frames as in row 160. Hit through `RWF_NOWAIT`, miss forced through
  `force_pool_reads`, never by page-cache eviction. Hit p50 and p99, forced-miss p50, fill hit and fill miss, CPU per
  GB, pack wall time. **16 rounds**, the arms' order by `lab/scripts/order.py`, every arm's settings printed.
* **Filesystems:** the host's (record kernel, filesystem, mount options, `read_ahead_kb`, `max_sectors_kb`), a loop
  ext4 image mounted with defaults, the same image mounted `-o data=journal` (which turns large folios off,
  `fs/ext4/inode.c:5171`), and an XFS image if `mkfs.xfs` can be had pinned.
* **Instruments:** folios per frame from `/proc/self/pagemap` and `/proc/kpageflags` (compound head and tail bits) over
  a read-only mapping of each arm after it is written or warmed, and again after the last round (must be unchanged);
  extents from `filefrag -v`. Exactness: every frame read checked against its coded bytes' XXH3-64, every arm's frames
  decoded once against ingest's samples digest; `--mutate shift|short` must fail it.
* **Predictions** (per 32–41 kB frame): folios A0 ≈ A3 ≈ 5, A4 ≈ 5.4, A1 ≈ 1.3, A2 ≈ 1.0, A5 ≈ 1–2, A6 ≈ 9.9; hit p50
  ordered A2 ≤ A1 ≈ A5 < A0 ≈ A3 ≈ A4 < A6, about 150–300 ns a folio; gaps at 160 and 500 kB shrink below the
  resolution; forced miss and pack time tie; on `data=journal` every arm ties at ≈ 9.9 folios; extents alike or not,
  without effect on hits.
* **Decision rule.** *(a) Mechanism:* folios is confirmed if the counted folios match the predictions within 20 %, the
  hit ranking follows them, and the `data=journal` arms tie; it is rejected if arms with equal folio counts differ
  beyond the resolution, or the gap stands under `data=journal`. *(b) F1 is adopted* if A1 beats A0 on hit p50 at
  32–41 kB beyond the resolution with ≥ 80 % sign agreement across rounds, and is worse on no metric beyond it. *(c) F2
  instead* only if A2 beats A1 the same way. *(d)* If A6 is slower than A0 beyond the resolution, the fill's `WILLNEED`
  is the larger lever, and the read path's owner gets a theory row for it; nothing in the read path changes in this
  row. *(e)* A tie in (b) closes the writer as not worth a line.

### Measured (row 172)

Run by a session given only the protocol; it read §Why after the numbers were in. Host: a 4-vCPU cloud VM, Linux
6.18.44, 15 GiB, one reader process at a time, so the host does not saturate and nothing is claimed about load. Rust
1.97.0 release builds. Driver, lab writer, folio counter and summary: `lab/container-bench/writer.py`,
`src/bin/writer_bench.rs`, `writer_summary.py` ([`../../lab/container-bench/README.md`](../../lab/container-bench/README.md)).

* **Arms as specified.** A1 and A3 come from a lab copy of `BundleWriter::create`'s writes; at an 8 KiB buffer its
  `write(2)` sequence equals `pack-series`' under `strace` on three cells (337, 101 and 337 calls, sizes in order),
  and the check fails at 1 MiB (11 calls). All 160 arms are SHA-256-equal to their A0: none void. Cells: `pt15_cptac`
  HTJ2K (median frame 32 kB, 335 frames), `mr9_ispy2` (41 kB, 34), `pt15_cptac` AV1 (35 kB, `--split 3`), `ct_lidc`
  (163 kB, 100), `dbt12_ea1141` (503 kB, 29); ingest's coded frames, every one exact.
* **Filesystems:** the host's ext4 on `/dev/vda` (`rw,relatime,discard,…`, `read_ahead_kb` 128, `max_sectors_kb`
  4096), and 2 GiB loop images (`read_ahead_kb` 2560, `max_sectors_kb` 1280): ext4 with defaults, ext4
  `data=journal` (the mount adds `nodelalloc`), XFS from xfsprogs 6.6.0-1ubuntu2.1 (Ubuntu's archive; `.deb`
  SHA-256 `2da65187043b2f87…`).
* **16 rounds**, arms in `lab/scripts/order.py`'s order inside each cell, 4 000 asks a tile cell, 256 MiB a fill
  cell. Pack time: 16 more rounds, each arm written to a scratch name and removed (no A/A arm there).
* **Exact:** 47.3 M reads checked by XXH3-64 against the coded bytes, 0 inexact; all 160 arms' 26 656 frames
  through the fill reader decoded against ingest's sample digests, 0 inexact; `--mutate shift|short` fails all
  19 095 reads of a cell; the folio counter's layout check (each folio starts on its own size and is tails to its
  end) fails with `--mutate`, which reads compound heads as plain pages. Recounted after the last round: 0 of 160
  arms' folios changed.

**Folios per frame, counted** (host; loop ext4 the same but A5; XFS within 0.3 but A2 at 1.07–1.90):

| cell | A0, A0′, A3 | A1 | A2 | A4 | A5 | A6 | predicted A0 / A1 / A2 / A4 / A6 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `pt15_cptac` HTJ2K, 32 kB | 4.86 | 1.27 | 1.04 | 4.79 | 1.35 | 8.58 | 5.1 / 1.3 / 1.0 / 5.4 / 9.9 |
| `mr9_ispy2`, 41 kB | 5.26 | 1.38 | 1.15 | 5.91 | 2.53 | 10.79 | same |
| `pt15_cptac` AV1, 35 kB | 4.96 | 1.30 | 1.04 | 5.16 | 1.37 | 9.33 | same |
| `ct_lidc`, 163 kB | 7.26 | 2.46 | 1.19 | 20.98 | 2.65 | 40.95 | 7.2 / 2.5 / 1.2 / 20.6 / 40.1 |
| `dbt12_ea1141`, 503 kB | 9.00 | 5.45 | 1.62 | 61.93 | 6.24 | 122.86 | 9.0 / 5.4 / 1.6 / 61.2 / 121.4 |

Every arm under `data=journal` counts A6's column: 4 KiB folios only. A5 on the loops: 1.38–5.66, 4.15 on `mr9_ispy2`.
Extents: 1 a file on the host, 1–6 under `data=journal`.

**Hit p50**, median of the 16 per-round ratios to A0 (share of rounds A0 lost); *res.* is the resolution, the p90
of \|A0′/A0 − 1\| over the rounds; bold is beyond it:

| filesystem, cell | A0 | res. | A0′ | A1 | A2 | A3 | A4 | A5 | A6 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| host ext4, `pt15_cptac` HTJ2K | 4.10 µs | 0.49 | 0.99 (50) | 0.62 (100) | 0.59 (100) | 0.94 (56) | 1.15 (25) | 0.74 (94) | 1.41 (0) |
| host ext4, `mr9_ispy2` | 2.66 µs | 0.25 | 0.97 (75) | 0.77 (94) | 0.75 (88) | 0.99 (56) | 1.07 (25) | 0.85 (69) | 1.25 (12) |
| host ext4, `pt15_cptac` AV1 | 4.72 µs | 0.41 | 1.01 (44) | 0.69 (94) | 0.73 (94) | 1.10 (44) | 1.06 (38) | 0.87 (88) | 1.11 (31) |
| host ext4, `ct_lidc` | 16.17 µs | 0.35 | 1.11 (19) | 0.95 (56) | 0.83 (88) | 1.04 (44) | **1.58 (0)** | 0.99 (50) | **2.02 (0)** |
| host ext4, `dbt12_ea1141` | 52.46 µs | 0.31 | 1.02 (50) | 1.05 (44) | 0.90 (81) | 1.01 (50) | **1.44 (0)** | 0.98 (50) | **1.99 (0)** |
| loop ext4, `pt15_cptac` HTJ2K | 4.02 µs | 0.38 | 0.99 (56) | 0.70 (94) | 0.70 (100) | 0.92 (62) | 1.05 (38) | 0.67 (81) | 1.11 (31) |
| loop ext4, `mr9_ispy2` | 2.43 µs | 0.47 | 1.01 (44) | 0.80 (81) | 0.79 (88) | 0.96 (62) | 1.16 (25) | 0.92 (69) | 1.18 (12) |
| loop ext4, `pt15_cptac` AV1 | 4.33 µs | 0.68 | 1.03 (50) | 0.83 (75) | 0.83 (81) | 1.06 (44) | 0.97 (62) | 0.92 (62) | 1.67 (0) |
| loop ext4, `ct_lidc` | 21.32 µs | 0.26 | 0.95 (56) | 0.93 (75) | 0.88 (81) | 0.93 (62) | 1.18 (12) | 0.76 (88) | 1.15 (19) |
| loop ext4, `dbt12_ea1141` | 51.61 µs | 0.22 | 0.96 (62) | 0.94 (56) | 0.86 (69) | 0.96 (69) | **1.33 (0)** | 0.99 (50) | **1.43 (12)** |
| loop XFS, `pt15_cptac` HTJ2K | 2.88 µs | 0.43 | 1.06 (38) | 0.93 (69) | 1.00 (50) | 1.02 (44) | 0.97 (56) | 0.97 (56) | 1.07 (38) |
| loop XFS, `mr9_ispy2` | 2.08 µs | 0.26 | 1.06 (31) | 0.93 (62) | 0.92 (62) | 1.02 (44) | 1.01 (44) | 1.02 (38) | 1.07 (25) |
| loop XFS, `pt15_cptac` AV1 | 3.06 µs | 0.63 | 1.09 (31) | 0.86 (69) | 1.05 (38) | 1.02 (44) | 0.99 (50) | 0.89 (69) | 1.06 (38) |
| loop XFS, `ct_lidc` | 14.42 µs | 0.54 | 1.04 (38) | 1.07 (44) | 0.90 (62) | 1.02 (44) | 1.11 (25) | 0.90 (75) | 1.03 (50) |
| loop XFS, `dbt12_ea1141` | 52.20 µs | 0.32 | 0.97 (56) | 0.89 (69) | 0.96 (56) | 0.97 (56) | 1.15 (38) | 0.92 (75) | 1.22 (6) |
| `data=journal`, `pt15_cptac` HTJ2K | 4.36 µs | 0.48 | 0.85 (94) | 0.73 (94) | 0.83 (88) | 0.84 (69) | 0.75 (100) | 0.69 (100) | 0.76 (88) |
| `data=journal`, `mr9_ispy2` | 3.11 µs | 0.43 | 0.92 (62) | 0.91 (81) | 0.92 (81) | 0.97 (69) | 0.87 (69) | 0.76 (81) | 0.75 (62) |
| `data=journal`, `pt15_cptac` AV1 | 3.38 µs | 0.57 | 1.03 (44) | 1.00 (50) | 1.16 (25) | 1.09 (38) | 1.10 (44) | 1.04 (44) | 1.08 (38) |
| `data=journal`, `ct_lidc` | 20.00 µs | 0.50 | 0.92 (75) | 0.93 (81) | 0.93 (69) | 0.91 (62) | 0.92 (69) | 0.87 (62) | 0.82 (88) |
| `data=journal`, `dbt12_ea1141` | 49.68 µs | 0.33 | 0.98 (50) | 1.10 (25) | 0.97 (56) | 0.97 (69) | 1.01 (44) | 0.96 (56) | 0.97 (62) |

The other metrics, same reading; **beyond the resolution** only: A6 on the host's `ct_lidc` and `dbt12_ea1141` — hit
p99 ×1.60 and ×1.66, forced-miss p50 ×1.31 and ×1.50, fill hit ×0.68 and ×0.64 frames/s, fill CPU per GB ×1.49 and
×1.56 on a hit and ×1.26 and ×1.42 on a miss, fill miss ×0.66 on `dbt12_ea1141`; on loop ext4 fill-miss CPU ×1.19
(`dbt12_ea1141`), fill hit ×0.83 and its CPU ×1.21 (`mr9_ispy2`), hit p99 ×2.59 (`pt15_cptac` AV1). A4 on the host's
`ct_lidc` fill hit ×0.80, its `dbt12_ea1141` forced miss ×1.21 and fill CPU ×1.27 hit, ×1.17 miss; on loop ext4's
`dbt12_ea1141` hit p99 ×1.27 and fill-miss CPU ×1.17. A2's fill hit on `mr9_ispy2` ×1.33 (host) and ×1.20 (loop ext4),
its fill-hit CPU ×0.86 on loop ext4's `pt15_cptac` AV1. A1 is beyond it on no metric in any cell, better or worse; its
fill hit at 32–41 kB is ×1.10–1.22 on host and loop ext4 (75–100 % of rounds), within 0.15–0.25. XFS separates no arm
on any metric. **Pack wall time**, medians: A0 3.4–11.3 ms a cell off `data=journal`, 4.5–33.7 ms on it; A1 −0.3 to
+3.2 ms (−2 to +35 %) against A0 off `data=journal`, A3 −1.5 to +6.0 ms; A6's `WILLNEED` warm 226–255 ms, A5's 3–21 ms
— no A/A arm, so none of this is called.

**Against the predictions.** Folios: A0 ≈ A3 ≈ 5, A4 ≈ 5.4, A1 ≈ 1.3, A2 ≈ 1.0 and A6 ≈ 9.9 held within 20 % on every
filesystem but `data=journal`, and the model's 160 and 500 kB columns within 3 %; **A5 ≈ 1–2 did not hold on
`mr9_ispy2`** (2.53 host, 4.15 loops). Hit ranking at 32–41 kB, A2 ≤ A1 ≈ A5 < A0 ≈ A3 ≈ A4 < A6: **held on the host
and loop ext4 in the medians** (host `pt15_cptac` HTJ2K 0.59, 0.62, 0.74, 0.94, 1, 1.15, 1.41), A1's absolute median
2.88 µs against A0's 4.10, ~340 ns for each of ~3.6 folios against the predicted 150–300; **not on XFS**, where every
arm ties with the same folio counts. Gaps at 160 and 500 kB below the resolution: held for A1, A2, A3, A5; A4 and A6
grow there instead (21–124 folios a frame). Forced miss ties: held but A6 on the host's 160 and 500 kB cells and A4 on
its 500 kB. `data=journal` ties: held, every arm at 4 KiB folios and within its resolution. Extents without effect:
held (1–6, no ordering).

**The rule.**

* **(a) Mechanism: confirmed on ext4, not on XFS.** Counts match within 20 % (A5 on `mr9_ispy2` aside), the
  hit ranking follows them on both ext4s, and the `data=journal` arms tie; arms of equal counts (A0, A0′, A3) never
  differ beyond the resolution. On XFS the counts are the same and the hits do not part — the cost of a folio is
  not visible there; why is open.
* **(b) F1 not adopted.** A1 against A0 at 32–41 kB, hit p50: 0.62–0.77 on the host, 0.70–0.83 on loop ext4,
  0.86–0.93 on XFS, 0.73–1.00 under `data=journal`, with 75–100 % sign agreement on both ext4s — but no cell
  beyond its resolution of 0.25–0.68. The resolution is the spread of one round's ratio, against a median of 16:
  a bar the rule chose, and under it the gap does not count. Pack time has no A/A arm, so (b)'s "worse on no metric"
  was not checkable there either.
* **(c) F2 not adopted:** A2 beats A1 beyond the resolution nowhere (0.59 against 0.62 on the host).
* **(d) Fires.** A6, a cache warmed by the fill's `WILLNEED`, is slower than A0 beyond the resolution on the host's
  `ct_lidc` and `dbt12_ea1141` (hit ×2.02 and ×1.99, fill hit ×0.68 and ×0.64, CPU per GB ×1.49 and ×1.56) and on loop
  ext4's `dbt12_ea1141` (hit ×1.43): after reclaim, 41–123 folios a 160–500 kB frame against `pack-series`' 7–9.
  The fill's `WILLNEED` is the larger lever; nothing in the read path changes here. Proposed for the read path's
  owner: **WILLNEEDFOLIO** — does the fill's `POSIX_FADV_WILLNEED` (4 KiB folios, `mm/readahead.c:275–276`) cost
  hits and fill CPU on 160 kB–3 MB frames after reclaim, against a blocking `readahead(2)` or `MADV_POPULATE_READ`
  that builds large folios, with the fill's wait unchanged? Theory.
* **(e) Closes the writer as not worth a line:** (b) is a tie. `pack-series` keeps its 8 KiB `BufWriter`.

Proposed beyond the brief: **WRITERAA** — would a resolution taken on the 16-round median (A0′'s median ratio,
here 0.95–1.11) instead of one round's spread have adopted F1, and should the rule's bar be that? An owner's call,
since it re-judges a pre-stated rule. **XFSFOLIO** — why do 1 and 9 folios a frame read alike on XFS, here a loop
image on a VM?

## The reader

* **One series per server process**: `series-server --series PATH` (`server/src/main.rs:12–13`) opens one file
  (`server/src/transport/server.rs:72`).
* **At open, two `pread`s**: the 16-byte header, then the whole prefix up to `data_base`, whose length the header
  gives (`format.rs:87–110`). The index is then held in memory as `(offset, length)` pairs; a frame read is one lookup
  and one read of its span ([`../adr/disk-access.md`](../adr/disk-access.md) §1).
* **The fill's read-ahead depends on display order.** A fill serves frames in index order
  ([`../WIRE.md`](../WIRE.md) §FoD messages, `stream_frames`), and `FillReader` advises the kernel of `FILL_WINDOW`
  (4 MiB) of **bytes** past the named frame (`server/src/media/read_path.rs:26`, `:181–193`). Those bytes are the
  next frames only because the file stores frames in the order a fill walks them; any other order turns the
  advice into reads of frames nobody asked for.
