# Matroska and WebM

*Theory, 2026-10-14, read from sources (§10), with three points settled on a real file in
[`guide.md`](guide.md) §6: where `CueRelativePosition` counts from, ffmpeg's cluster per frame, and what ffprobe's
`pos` means. A few long sections of RFC 9559 could not be read word for word; what rests on them is marked.*

## Contents

1. [In one paragraph](#1-in-one-paragraph)
2. [EBML: the encoding underneath](#2-ebml-the-encoding-underneath)
3. [Structure](#3-structure)
4. [The codecs it carries](#4-the-codecs-it-carries)
5. [Finding frame i](#5-finding-frame-i)
6. [Metadata](#6-metadata)
7. [Throughput and latency](#7-throughput-and-latency)
8. [WebM, DASH and Media Source Extensions](#8-webm-dash-and-media-source-extensions)
9. [Playback, tools, licence](#9-playback-tools-licence)
10. [For wt-pacs](#10-for-wt-pacs)
11. [Sources](#11-sources)

## 1. In one paragraph

Matroska (`.mkv`, IETF RFC 9559, October 2024) is a container written in **EBML** (RFC 8794), a binary XML: every
element is an ID, a size and a body, and masters hold children. Frames live in **Blocks** grouped into
**Clusters**; an index called **Cues** points at them. **WebM** is a restricted Matroska (DocType `webm`; video VP8,
VP9, AV1; audio Vorbis, Opus) that browsers have played for a decade. Matroska is royalty-free, its reference
libraries are LGPL and BSD, and the archive world uses it: FFV1 in Matroska is a preferred format in the Library of
Congress's Recommended Formats Statement.

## 2. EBML: the encoding underneath

* **A variable-size integer (VINT)** spends its leading zero bits on its own length: `1xxxxxxx` is one byte with 7
  data bits, `01xxxxxx …` two bytes with 14, up to eight bytes. A size of up to 126 fits one byte, up to 16 382 two.
* **An element ID** is a VINT whose marker bit is kept (so `0x1F43B675` is the Cluster ID as written), 1–4 bytes in
  Matroska. **A size** is a VINT without the marker and need not be the shortest form, so muxers write 8-byte sizes
  and patch them later.
* **Unknown size** (all data bits 1) is allowed for Segment and Cluster: such an element ends where the parser meets
  an element that cannot be its child. A reader cannot skip it; it must walk every child header. Live writers use
  it because they cannot seek back to fill a size in.
* **CRC-32** (`0xBF`, 6 bytes on disk) may open any master and covers the rest of that master's data. **Void**
  (`0xEC`) is ignored padding, used to reserve space for an index written later.

## 3. Structure

```text
EBML header           DocType "matroska" or "webm", versions
Segment               the file's content; positions inside it count from its data's first byte
├ SeekHead            where the other top-level elements are
├ Info                timestamp scale (default 1 ms), duration
├ Tracks              per track: number, CodecID, CodecPrivate, video size and colour
├ Tags, Attachments, Chapters
├ Cluster …           Timestamp, then Blocks
│ └ SimpleBlock       A3 · size · track (VINT) · timestamp (int16, relative to the cluster) · flags · frame
└ Cues                CuePoint … each: CueTime, CueTrackPositions (CueTrack, CueClusterPosition, CueRelativePosition)
```

* **A SimpleBlock** with a one-byte track number has a **4-byte header** before the frame; the flags carry
  *keyframe*, *invisible*, *discardable* and the lacing mode. A **BlockGroup** wraps a Block with extras
  (references, duration, BlockAdditions); a BlockGroup's block counts as a keyframe when it has no `ReferenceBlock`.
* **The 16-bit relative timestamp** caps a cluster at ±32 767 ticks of the timestamp scale (±32.8 s at 1 ms).
* **Lacing** packs several frames into one block behind a lace header (Xiph, EBML or fixed sizes). It exists to
  save bytes on tiny audio frames; a laced frame has no position of its own in the Cues. For images: never.

## 4. The codecs it carries

Codec IDs and their rules are in a separate IETF draft (draft-ietf-cellar-codec-20, August 2026, still a draft).

**AV1 (`V_AV1`)**, from the AV1-in-Matroska mapping:

* `CodecPrivate` is the same `av1C` record as MP4's ([`iso-bmff.md`](iso-bmff.md) §4): profile, level, bit depth,
  `monochrome`, subsampling, and optionally the sequence header.
* **A block is one temporal unit** of low-overhead OBUs; temporal delimiters, padding and redundant frame headers
  *should not* be stored (a demuxer rebuilding a raw stream should put the delimiter back). The guide's files show
  it: 4 465-byte frames against IVF's 4 467.
* **A block may be flagged key only if its first frame is a `KEY_FRAME` and it carries a sequence header.**
* **Only one sequence header per Segment**: every frame in a file must share it, so a series that changes bit depth
  or size would need separate files.
* Nothing restricts monochrome, bit depth or lossless: the mapping signals what the stream is. AV1's own profiles
  still apply (12-bit grey is Professional).

**JPEG 2000 (`V_JPEG2000`)** is in the draft registry: "each Matroska frame corresponds to a JPEG 2000 image", no
`CodecPrivate`. It does not say whether a frame is a bare codestream or a JP2 file, and does not mention HTJ2K; we
would define our own convention. ffmpeg maps it to its JPEG 2000 decoder.

**FFV1 (`V_FFV1`)**, RFC 9043 (informational, 2021): lossless, intra-only when `intra=1`, grey allowed, depth up to
16 bits, slices for parallel decoding, and a **CRC-32 per slice** in version 3. It is the archive world's lossless
video codec. No browser decodes it, and how it compresses CT or MR against HTJ2K is unknown; it is noted here as the
lossless codec Matroska is known for, not as a candidate.

**`V_UNCOMPRESSED`** describes its pixel layout with `UncompressedFourCC`; whether a 16-bit grey code is registered
was not checked.

## 5. Finding frame i

**The index gives the position, not the length.** In an all-intra track every frame is a keyframe, and the
specification says each video keyframe *should* have a CuePoint, so muxers write one per frame: mkvmerge's default
`--cues iframes` indexes every block without references, and ffmpeg wrote 160 CuePoints for 160 frames, each with a
`CueRelativePosition`. Resolving one, checked on the guide's file:

```text
block element = segment data start + CueClusterPosition + the cluster's own header (ID + size)
              + CueRelativePosition                       (counted from the cluster's data, verified on cuesfront.mkv)
frame         = block element + 1 (ID A3) + the size VINT + 4 (block header)
length        = the SimpleBlock's size − 4
```

The cluster header length and the block size are **in the file, not in the Cues**. So to build a `.sbnd`-style
`(offset, length)` table at open a reader either reads the Cues and then a few bytes at every block, or walks every
cluster and block header once from the start (what ffprobe does). After that, a frame is **one lookup and one
read**, and its bytes are contiguous, provided the file has no lacing, no `ContentEncodings` (header stripping or
compression change the stored bytes) and no encryption.

**What ffprobe reports**: its packet `pos` for Matroska is the SimpleBlock's body, so the frame starts 4 bytes later
(the guide's `frame_table.py` checks this by hash).

**Cues at the front or the end.** A writer only knows the Cues once every cluster is written, so by default they go
at the end and a SeekHead at the front points to them. ffmpeg's `-cues_to_front 1` rewrites the file to put them
first; `-reserve_index_space N` leaves a Void for them; libwebm has `CopyAndMoveCuesBeforeClusters`. The WebM
guidelines recommend the front ("Seeking will be disabled if the webm file does not have a key frame Cues element").
For a server that opens a file once and keeps the table, the difference is one read at open.

**Without Cues**, a reader hops cluster to cluster by their sizes (one small read per cluster) and walks blocks
inside; with unknown-size clusters it must read every block header.

## 6. Metadata

* **Tags**: name/value pairs scoped to the file, a track, a chapter or an attachment; nothing finer than a track.
* **Attachments**: whole files with a media type, the natural home for our metadata JSON or a digest list. **Not
  allowed in WebM.**
* **BlockAdditions**: per-block side data (a `BlockMore` with an ID ≥ 2, declared on the track). A per-frame digest
  fits there, at the price of a BlockGroup instead of a SimpleBlock, about 46 B per frame for a 32-byte digest by
  the research notes' arithmetic; the frame stays contiguous. WebM allows them.
* Private elements are legal and skipped by every other reader.

## 7. Throughput and latency

* **One frame per SimpleBlock, `FlagLacing = 0`, no `ContentEncodings`**: the frame is one contiguous range.
* **A CuePoint per frame, with `CueRelativePosition`, Cues at the front.** Then build the full table at open and
  keep it, as for `.sbnd`.
* **Cluster policy decides most of the bytes.** ffmpeg's muxer starts a new cluster "after 4k and on a keyframe"
  (its source comment), so intra frames over 4 KiB get **a cluster each**: the guide's 160 frames made 159 clusters,
  and each cluster carried a CRC-32 (`write_crc32` defaults to 1). That cost 41.9 B per frame, about 19 of them the
  Cue entry. mkvmerge packs up to 65 535 blocks or 5 s per cluster; fewer clusters and no CRC bring the estimate to
  30–35 B per frame. Against frames of 50–500 KB this is under 0.1 %.
* **CRC-32 is per cluster**, so with many frames per cluster checking one frame's CRC means reading the whole
  cluster. Our own per-frame digest does not have that problem.
* **Timestamps as indices**: a constant default duration makes frame i's time a pure function of i, so the server
  never searches by time.

## 8. WebM, DASH and Media Source Extensions

* **WebM DASH**: an initialisation segment (header, Info, Tracks; no Clusters or Cues), then media segments of whole
  clusters, each starting with a key block. The Cues serve as the byte-range index (`@indexRange`), at cluster
  granularity.
* **The MSE WebM byte stream format** (W3C note, 2024): **a media segment is one Cluster**, and a random-access point
  is a keyframe SimpleBlock. A file with a cluster per frame, like ffmpeg's, makes **every frame appendable on its
  own** to a SourceBuffer. AV1 is not in that note's codec table, but Chromium accepts `video/webm; codecs="av01…"`
  (it answered yes in the guide's Chromium 141).

## 9. Playback, tools, licence

* **Browsers.** WebM plays everywhere, Safari included (macOS Safari 16, iOS 17.4; caniuse). **Matroska itself is
  newer**: Chromium's current source registers `video/matroska` and `video/x-matroska` with VP8, VP9 and AV1, and
  Firefox 145 "added Matroska support for … AVC, HEVC, VP8, VP9, AV1". Which Chrome release first shipped it was not
  found. So "browsers don't play .mkv" is out of date. But **Firefox drops monochrome AV1 pictures** in its dav1d
  wrapper ([`iso-bmff.md`](iso-bmff.md) §8), and nothing plays JPEG 2000 or FFV1.
* **Tools.** MKVToolNix (`mkvinfo -v` with positions, `mkvmerge -J`, `mkvextract`, `mkvpropedit`), ffprobe,
  libwebm, libebml/libmatroska, GStreamer. Rust: `matroska-demuxer` (seeks with the Cues but does not expose them or
  byte offsets), `webm-iterable`/`ebml-iterable` (element level, enough to build our own table), `matroska`
  (metadata only), `webm` (libwebm wrapper). The guide's `ebml_walk.py` is 30 lines; a reader that builds a frame
  table needs a few hundred in any language.
* **Licence.** RFC 8794 and RFC 9559 are IETF standards track and free to read and implement; the codec registry
  is still a draft.

## 10. For wt-pacs

* **Matroska can hold exactly our layout** (one keyframe SimpleBlock per frame, a Cue per frame, the metadata JSON
  as an Attachment) and serve at one read per frame, **but it does not hand over the frame table**: the lengths have
  to be gathered at open, one small read per frame or a walk of the file. `.sbnd`'s open is one read of its table.
  *Predicted from the structure, not measured.*
* The old local note's reading, "Cues usually per keyframe or per cluster, sizes in variable-length block headers,
  parse once at open, then serving is equal", holds. What it missed: in an all-intra track the Cues *are* per frame,
  so the offsets are free and only the lengths cost.
* **AV1 changes in the bytes**: the temporal delimiter is gone (a digest over stored bytes must be computed after
  muxing, or the delimiter put back), every frame must carry the sequence header to be a keyframe, and one sequence
  header per file. Our 16-byte header cannot sit inside a block; our two streams per frame would be two tracks or a
  BlockAddition.
* **HTJ2K**: a draft codec ID with no defined framing; we would be writing the convention ourselves.
* **What it offers that MP4 does not**: an IETF standard free to read, Attachments for arbitrary files, the
  archive community's FFV1. What MP4 offers that it does not: a per-frame size table in the index itself.

## 11. Sources

* RFC 8794, EBML: https://www.rfc-editor.org/rfc/rfc8794.html
* RFC 9559, Matroska: https://www.rfc-editor.org/rfc/rfc9559.html
* matroska.org technical notes (blocks, lacing) and Cues recommendations: https://www.matroska.org/technical/notes.html,
  https://www.matroska.org/technical/cues.html, https://www.matroska.org/technical/basics.html
* Codec mappings, draft-ietf-cellar-codec-20: https://datatracker.ietf.org/doc/html/draft-ietf-cellar-codec-20
* AV1 in Matroska: https://github.com/ietf-wg-cellar/matroska-specification/blob/master/codec/av1.md
* RFC 9043, FFV1: https://www.rfc-editor.org/rfc/rfc9043.html
* WebM container guidelines: https://www.webmproject.org/docs/container/
* WebM DASH: http://wiki.webmproject.org/adaptive-streaming/webm-dash-specification
* W3C, WebM Byte Stream Format for MSE: https://www.w3.org/TR/mse-byte-stream-format-webm/
* MKVToolNix, mkvmerge: https://mkvtoolnix.download/doc/mkvmerge.html
* FFmpeg: `libavformat/matroska.h`, `matroskaenc.c` (https://github.com/FFmpeg/FFmpeg); the cluster rule's diff:
  https://ffmpeg.org/pipermail/ffmpeg-devel/2019-April/242053.html; muxer options:
  https://ffmpeg.org/pipermail/ffmpeg-cvslog/2024-April/142648.html
* libwebm: https://github.com/webmproject/libwebm
* Chromium `media/base/mime_util_internal.cc`: https://source.chromium.org
* Firefox 145 release notes: https://www.firefox.com/en-US/firefox/145.0/releasenotes/
* caniuse, WebM: https://caniuse.com/webm
* Library of Congress, Matroska: https://www.loc.gov/preservation/digital/formats/fdd/fdd000342.shtml
* Rust: https://docs.rs/matroska-demuxer, https://github.com/austinleroy/webm-iterable,
  https://github.com/tuffy/matroska, https://github.com/DiamondLovesYou/rust-webm
