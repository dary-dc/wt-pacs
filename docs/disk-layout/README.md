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
| frames | Σ lengths | the coded frames, back to back | `writer.rs:52–67` |

* **The index has a fixed stride.** Entry *i* is at `16 + 12·i`; the frame number is the entry's position, and no
  entry names its frame.
* **Frames are in display order and unaligned.** The writer lays frame *i* right after frame *i − 1*
  (`writer.rs:36–41`); nothing pads a frame to a sector or a page.
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
| embedded, after the index | `BundleWriter::create` (`writer.rs:43`) | **nobody**: the parser returns it (`format.rs:61`), `FrameStore::open` keeps only the index (`server/src/media/frame_store.rs:44–49`) |
| sidecar `OUT.metadata.json` | `from_dicom.py` (`ingest/from-dicom/from_dicom.py:57–58`), the input to `pack-series` | **the page**, as `/series/metadata`: nginx aliases it (`deploy/nginx/wt-pacs.conf.template:46–49`), `dev-server.py` serves it (`server/dev-server.py:32–33`) |

The server reads neither. The site's compiled ingest (`ingest/from-parser`) embeds the JSON and writes no sidecar
(`ingest/from-parser/src/main.rs:114`), so its output needs one made before a page can open it.

## The writer

`BundleWriter` (`writer.rs:16–79`) needs **every frame's length before the first byte**: the index is written
first and cannot be corrected, so a frame of another length than declared, or a file finished short of its count,
is refused (`writer.rs:57–63`, `:70–76`). Hence the pack cannot stream while frames are still being coded
(queue row 163).

It writes **to the final name** (`File::create(path)`, `writer.rs:28`) and ends with a `flush` of its buffer
(`writer.rs:77`): no temporary name, no `fsync`, no `rename`. A crash mid-pack leaves a short file under the name a server opens; it is
refused at open, because its last entry points past the end. A power loss after the pack can leave the full length
with blocks never written, which nothing detects: no hash covers the coded bytes.

### Why its files read slower on a hit (row 168: theory, not measured)

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

### Protocol for the measuring row (*proposed*)

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
