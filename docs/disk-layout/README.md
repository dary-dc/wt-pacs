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
                          read once at open (two preads)       back to back, display order, unaligned
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
