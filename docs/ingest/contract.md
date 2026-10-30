# The parser's directory output, as the ingest reads it

The hand-over between the owner's C parser and the Rust ingest ([`README.md`](README.md) §1, step 2). Read from the
parser's public source on 2026-10-11 (queue row INGESTRS1); what the parser itself should change is §5 of the README,
not this file. *Corrected 2026-10-26* ([`pacs-receive-design.md`](pacs-receive-design.md) §1): the parser and the
ingest run on the **PCS's side** (the PCS is another team's); this repository's scope starts at the PACS (decided 2026-10-24), which
receives this layout's content inside a **submission package**, one per series, with the `.sbnd` the ingest writes.
This file stays the reading of the PCS's output that the package carries.

## The layout

**One parser run per SOP instance**, writing under its working directory, `/` separators:

| level | path | name |
| --- | --- | --- |
| study date | `<D>/` | the study date (0008,0020) as `YYMMDD`, coded as below, 4 characters; `PbPb` when the date is not 8 characters |
| exam | `<D>/<E>/` | the study instance UID (0020,000D), coded |
| series | `<D>/<E>/<S>/` | the series instance UID (0020,000E), coded |
| instance | `<D>/<E>/<S>/<I>/` | the SOP instance UID (0008,0018), coded |

**The coding.** Each character maps to a nibble: NUL (the UI padding) 0, `\` 1, `^` 2, `-` 3, `+` 4, `.` 5, `0`–`9`
6–15. Each three characters (12 bits) become two characters of
`0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~`, the first from the top 6 bits. A remainder of one
character becomes `alphabet[n0 << 2]` then `0`; of two, `alphabet[(n0 << 2) + (n1 >> 2)]` then
`alphabet[(n1 & 3) << 4]`. A UID's trailing NUL pad, when present, is coded with it: `1.2.3` padded is `TOMG`.

## Group files

Named `<marker>.<h>`, `<h>` the hash of the file's bytes, as hex. *Corrected 2026-10-26:* the parser read on 10-11
wrote 64 hex characters of BLAKE3-256; the PCS is to name them by **XXH3** (decided 2026-10-24/25: what the PACS
checks needs no cryptographic hash, and XXH3 is faster; its width, 64 or 128 bits, is not decided). The levels: the exam group `<D>/<E>/--.<h>`, the series group
`<D>/<E>/<S>/---.<h>`, the instance group `<D>/<E>/<S>/<I>/----.<h>`, the private group `<D>/<E>/<S>/<I>/priv.<h>`
(only when the instance has private attributes, or group 0002). An existing exam or series group file is not
rewritten.

A group file is records with no bytes between them:

| bytes | field |
| --- | --- |
| 1 | key length KL: 8 at the dataset's top level, 8 more per sequence item level |
| KL | the key; at the top level the tag as big-endian group and element (4), the VR in ASCII (2), the parser's charset index (2; 0 for anything not text in a specific character set) |
| 4 | value length VL, little endian |
| VL | the value: converted to UTF-8 when the charset index is not 0, otherwise exactly as in the DICOM file |

Group lengths (gggg,0000) and (0008,0005) are dropped; sequence and item delimiters are not written.

## Frame files

In the instance directory, `%05d` (1-based) plus `.OPC` for MONOCHROME1 and MONOCHROME2, `.RGB` for RGB, `.PLT` for
PALETTE COLOR. A frame is `rows × columns × samples per pixel × bits allocated / 8` bytes copied from the pixel data
(7FE0,0010) at `frame ×` that size, so a 12-bit-in-16 frame is its 16-bit words as stored, little endian. Number of
frames absent or 0 writes one frame. YBR_FULL, YBR_FULL_422, YBR_PARTIAL_420, YBR_ICT, YBR_RCT and XYB write no
frame.

## What the ingest reads (phase 1)

`ingest/from-parser` takes one series directory `<D>/<E>/<S>/` and writes one `.sbnd`, or nothing:

* **The frame description** from the instance group: (0028,0002) samples per pixel, (0028,0004) photometric
  interpretation, (0028,0006) planar configuration, (0028,0008) number of frames, (0028,0010) rows, (0028,0011)
  columns, (0028,0100) bits allocated, (0028,0101) bits stored, (0028,0102) high bit, (0028,0103) pixel
  representation. Nothing else is read, and no group hash is checked.
* **Refused by name:** more than one instance (their order is the parser's metadata, phase 2); planar configuration 1;
  bits allocated other than 8 or 16; a high bit other than bits stored − 1; any photometric interpretation but
  MONOCHROME1 or MONOCHROME2 with one sample, or RGB with three; a frame file of the wrong size; any frame that does
  not decode back.
* **Per frame**, as `ingest/coded-frames/ingest.py` writes it for HTJ2K: XXH3-64 of the samples as read — the raw-frame
  check and the client's frame digest at once ([`../FIXTURES.md`](../FIXTURES.md) §Frame digests) — then HTJ2K with
  OpenJPH 0.31.0 in-process, the calls `ojph_compress` makes, a signed frame shifted and its SIZ marked signed; the
  codestream decoded back in-process and its samples' XXH3-64 compared.
* **The metadata** is the keys `from_dicom.py` writes that the frame attributes decide, in its order: `frameCount`,
  `width`, `height`, `channels`, `bitsAllocated`, `bitsStored`, `highBit`, `signed`, `photometric`, `min`, `max`,
  `codec`, `digests`. The rest (modality, rescale, window, frame time) is the parser's metadata, passed through in
  phase 2.

**The stand-in.** Until phase 2, `ingest/from-parser/mirror.py` writes this layout from a set as
`lab/av1/fetch_data.py` fetches it: one multi-frame instance holding the set's frames as stored, the instance group
with the ten attributes and the SOP instance UID, the exam and series groups with their UID. A fetched set carries no
study UID, instance UID or study date, so those UIDs are made from the set's name (`2.25.` and 128 bits of its
SHA-256) and the date directory is `PbPb`.

**Kept equal.** `ingest/from-parser/same.py` runs both ingests on a set at `--jobs` 1, 2 and 4 and requires every
`.sbnd` byte-identical, or both to refuse; `same_test.py` does it on synthetic sets in the gate.

## The parser at `f36230b`, read and run on 2026-10-19

**The contract above stays the one we build against** (the owner, 2026-10-19). The parser has moved since and will
move again; the ingest follows it only when a stable, defined version is published. The next may be the `.mxf` layout
below (not confirmed). What follows is a record, so the reading is not repeated.

**How it was read.** `github.com/opendicom/DECK_WebTransport` at `f36230b3f46c` (2026-10-16), directory
`DICMele2deck`. Its CMake file needs CMake 4.2, so `ESIPFfiled` (the directory output) was built by hand with gcc from
`src/datatypes.c`, `src/main.c`, `src/capi/ESIPFfiled/capi.c`, `src/capi/uapi.c` and the committed
`thirdparty/blake3/libblake3.a`, then run on each of its 13 `Testing/*.dcm` files. Every run exited 0.

### What changed since the contract

* **Frames moved into a directory per photometric kind, with no suffix** (`e914954`, 2026-10-12):
  `<I>/G/00001` for MONOCHROME1 and MONOCHROME2, `<I>/P/…` for PALETTE COLOR, `<I>/R/…` for RGB, where the contract has
  `<I>/00001.OPC`, `.PLT`, `.RGB`. `ingest/from-parser/mirror.py` writes the contract's names, on purpose.
* **Encapsulated documents** are written whole beside the series group, named below. The contract does not list them.

### What each name means

From the code at `f36230b` and its `src/capi/ESIPFserialized/README.md`. A meaning the source does not state is marked.

| Name | Where | What it holds |
| --- | --- | --- |
| `<D>/` | top | the study date `YYMMDD`, coded (contract §The layout); `PbPb` when the date is not 8 characters |
| `<E>/`, `<S>/`, `<I>/` | under it | the study, series and SOP instance UIDs, coded |
| `--.<h>` | `<D>/<E>/` | the exam group: patient and study attributes |
| `---.<h>` | `<E>/<S>/` | the series group: series and equipment attributes |
| `----.<h>` | `<S>/<I>/` | the instance group: everything else but the frames |
| `priv.<h>` | `<S>/<I>/` | the private attributes, and group 0002 |
| `G/`, `P/`, `R/` | `<S>/<I>/` | raw frames, `%05d` from 1. `P` is palette and `R` is RGB, from the code's own `case` labels; `G`'s comment says "opacity" and the letter is not explained (grey is a guess) |
| `ps.pdf` | `<E>/<S>/` | an encapsulated PDF |
| `dc.xml`, `sc.xml`, `uc.xml`, `ot.xml` | `<E>/<S>/` | an encapsulated CDA; the two letters come from the first 160 characters of the document, and their meaning is not stated |
| `3d.stl`, `tx.obj`, `tx.mtl` | `<E>/<S>/` | encapsulated STL, OBJ and MTL |
| `serialized.bin` | the working directory | opened and left empty by this output |

`<h>` is the BLAKE3-256 of the group as written. The README describes a later layout that the code does not write yet:

| Name | What it will hold, by the README |
| --- | --- |
| `<S>/c/0001.<h>` … | each frame coded in HTJ2K, to be gathered into `mf.mxf` when the series is complete |
| `<S>/b/0001.<h>` … | each frame as PNG, to be gathered into an AV1 `mf.mp4` |
| `<I>/d/0001.<h>` | the instance's attributes, per frame or image number, or for the whole multi-frame |
| `<I>/p/0001.<h>` | the private attributes and the SOP's, the same way |
| `mf.mxf`, `mf.mp4`, `sf.jxl` | one series as an MXF of HTJ2K, an MP4 of AV1, or one JPEG XL frame |

### Sizes, measured on its test files

Bytes per file, one run per test file. These are public samples, not a hospital's series; a modality's real headers may
differ (design.md §10 lists that gap).

| File | Modality, kind | Exam | Series | Instance | Private | Frame |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| NM1 | NM, MONOCHROME2 16-bit | 413 | 455 | 1 050 | 1 307 | 524 288 |
| US1 | US, RGB 640 × 480 | 321 | 204 | 693 | — | 258 048 |
| VL1–VL6 | VL, RGB 756 × 486 | 274–286 | 138 | 624 | — | 345 000 |
| XA | XA, MONOCHROME2 | 226 | 119 | 596 | — | 2 097 152 |
| arabic, french, greek, hebrew, russian | MONOCHROME2 8-bit 512 × 512 | 202–212 | 115 | 548 | — | 262 144 |
| dscd | a CDA, no image | 457 | 374 | 843 | — | `dc.xml` 34 159 |

A study's groups are kilobytes against megabytes of frames.

### Its outputs, and which this repository reads

The parser builds nine programs (its `CMakeLists.txt`). Those that bear on the metadata's store were built by hand and
run; the rest are named with why they were not.

| Program | What it writes | State at `f36230b` |
| --- | --- | --- |
| `ESIPFfiled` | the directory output above | builds and runs |
| `KVserialized` | one key-value stream per instance (below) | builds and runs |
| `ESIPFserialized` | the groups in sequence in one file, `ESIPF.bin` | does not link: `iconAttribute` undefined (`src/capi/uapi.c` calls it; only `ESIPFfiled` defines it) |
| `dicm2decksqlite` | the SQLite output (below) | does not build |
| `dicmhtj2k` | frames coded in HTJ2K | not run: frames are coded by the Rust ingest ([`design.md`](design.md) §2) |
| `ESIPbasetags`, `canonical`, `utf8dump`, `dicm2cda` | the base tags; one canonical DICOM file; a text dump; an encapsulated CDA | not run: no metadata store reads them |

### The key-value stream (`KVserialized`)

One run per instance writes `KVserialized.bin` in the working directory: every attribute of the instance, from
(0002,0002) on, as the records of §Group files, in ascending key order, with no group split and no DECK prefix — the
instance is the file. Sequence and item delimiters are dropped; an attribute inside a sequence has a 16-byte key
(dscd's CDA). The pixel data (7FE0,0010) is one record holding every frame. Measured on the test files:

| File | Bytes | Records | Pixel data |
| --- | ---: | ---: | ---: |
| NM1 | 527 484 | 152 | 524 288 |
| US1 | 922 787 | 53 | 921 600 |
| VL1–VL6 | 1 103 253–1 103 265 | 45 | 1 102 248 |
| XA | 2 098 062 | 40 | 2 097 152 |
| arabic, french, greek, hebrew, russian | 263 005–263 015 | 39 | 262 144 |
| dscd | 35 824 | 59 | — |

* **Its RGB pixel data is whole** (US1 921 600 B), where `ESIPFfiled`'s frame file is short (§Findings).
* **Its README says the list ends with one byte, 1 for complete**; no file written here ends with it: each parses to
  its last record with nothing after.
* **It is the raw material of a key-ordered store**: prefixing each record's key with the instance's DECK prefix and
  merging the instances' streams gives a study's rows already sorted
  ([`metadata-draft.md`](metadata-draft.md) §2, C and D).

### The SQLite output

Three shapes, and none written by a build at `f36230b`:

* **`src/capi/memorysqlite/dick.sqlite`**, the empty schema that target copies into memory: tables `E`, `S`, `I`, `P`,
  each `(key BLOB PRIMARY KEY, idx, len, utf)`, one row per attribute; and `M`, one row per instance with its UIDs,
  numbers, modality and BLAKE3.
* **`doc/PACS/db/deck.db`**: tables `E`, `S`, `I`, `F`, `G`, `M`, chained by foreign keys; each level has columns taken
  out of its attributes (patient, study date, modality, rows, columns, bits…) and its whole group as a blob (`edckv`,
  `sdckv`, `idckv`, `pdckv`) with the group's BLAKE3. It holds one CT instance. Its blobs use the record format of
  §Group files.
* **`src/deck_sqlite3.c`**: the statements the converter prepares, against a third set of columns.

`doc/DECK/databases/README.md` proposes the key-value form for all three ends (the converter's SQLite, the server's
Turso, the browser's IndexedDB): `CREATE TABLE E (key BLOB PRIMARY KEY COLLATE BINARY, value BLOB) WITHOUT ROWID`.

### DECK's key, by its design document

`doc/DECK/ordered contextual-keys format.md`: a key is 8-byte groups. A prefix `sSSiIIFF` (series index, series
number, instance index, instance number, frame number; an index of 0 means the attribute is shared by every series,
instance or frame below it), then one `TTTTIIII` per enclosing sequence (its tag and item number), then `TTTTRRCC` (the
tag big-endian, the VR, the charset index). Keys in that order sort by series, instance, group, sequence and item. The
directory output drops the prefix: its path plays that role, and its keys start at the sequence groups.

### Findings for the parser's author

* **RGB frame files are short.** US1's pixel data is 921 600 B (640 × 480 × 3) and its frame file 258 048 B; VL1's is
  1 102 248 B and its frame file 345 000 B. MONOCHROME frames are full. The cause was not traced.
* **The CDA name test reads the first byte plus `c`**, not byte `c`: `*data.Vp+c == 'c'` in `cdaAttribute`.
* **`ESIPFserialized` does not link:** `iconAttribute` is undefined.
* **`KVserialized` writes no end byte**, though its README says the list ends with one.
* **`dicm2decksqlite` does not build:** its target links `dicmlib,` (with the comma) and `blake3lib`, which is not
  defined, and `memorysqlite/capi.c` includes `../../thirdparty/blake3/blake3.h`, a path that does not exist.
