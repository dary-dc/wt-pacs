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
