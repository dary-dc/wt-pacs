# ISO BMFF: MP4, fragmented MP4, CMAF, HEIF and AVIF

*Theory, 2026-10-14. Read from sources (§9); the ISO texts themselves are paywalled, so box layouts are read from
documents that reproduce them (Apple's QuickTime docs, 3GPP TS 26.244, MS-SSTR) and marked where only memory backs
them. The sizes quoted from a real file are [`guide.md`](guide.md)'s.*

## Contents

1. [In one paragraph](#1-in-one-paragraph)
2. [Structure](#2-structure)
3. [Finding frame i](#3-finding-frame-i)
4. [The codecs it carries](#4-the-codecs-it-carries)
5. [HEIF and AVIF: stills in the same boxes](#5-heif-and-avif-stills-in-the-same-boxes)
6. [Metadata](#6-metadata)
7. [Throughput and latency](#7-throughput-and-latency)
8. [Playback, tools, licence](#8-playback-tools-licence)
9. [For wt-pacs](#9-for-wt-pacs)
10. [Sources](#10-sources)

## 1. In one paragraph

ISO/IEC 14496-12, the ISO base media file format, is a tree of **boxes**, each a size, a four-letter type and a
body. MP4 (14496-14), 3GP, MPEG-DASH and CMAF segments, HEIF and AVIF images and Motion JPEG 2000 are all profiles
of it, which is why one parser and one set of tools (ffprobe, MP4Box, Bento4, mp4box.js) open all of them. It
describes media as **tracks** of timed **samples**, and keeps a per-sample index of sizes and offsets in a box
called `moov`, separate from the media bytes in `mdat`. The current edition is the eighth, 14496-12:2026.

## 2. Structure

**A box** is `size` (u32, big-endian, header included) and `type` (four characters). `size = 1` means a 64-bit
size follows; `size = 0` means "to the end of the file". A **full box** adds a version byte and 24 bits of flags.
Unknown boxes are skipped by their size, which is how the format extends without breaking old readers; a `uuid`
box carries a 16-byte private type for vendor data.

**A file**, top level:

* `ftyp`: the brands the file conforms to (`isom`, `iso6`, `av01`, `cmfc`, `avif`…), a contract with the reader.
* `moov`: the movie. One `trak` per track, and in each, down `mdia` → `minf` → `stbl`, the **sample table**.
* `mdat`: the media bytes. Samples are addressed by **absolute file offsets**, not offsets into `mdat`, so the
  bytes may sit anywhere, padding between them included.

**The sample table** (`stbl`), the part that matters to a frame server:

| box | holds | per frame |
| --- | --- | --- |
| `stsd` | the sample entry: codec and its configuration (`av01` + `av1C` for AV1) | — |
| `stts` | decode durations, run-length coded | — (one entry when constant) |
| `stss` | which samples are sync (key) frames; **absent means every sample is** | — for all-intra |
| `stsc` | samples → chunks, run-length coded | — |
| `stsz` | each sample's size (or one size for all) | 4 B |
| `stco` / `co64` | each **chunk's** file offset, 32 or 64 bits | 4 or 8 B per chunk |
| `ctts` | composition offsets (B-frames) | **forbidden for AV1** |

A **chunk** is a run of samples stored back to back. A writer chooses how many samples go in each.

## 3. Finding frame i

Three tables are combined: `stsc` finds the chunk holding frame i and that chunk's first frame; `stco` gives the
chunk's offset; `stsz` gives the sizes, so the offset of frame i is its chunk's offset plus the sizes of the frames
before it in the chunk. Two writer choices make that as cheap as `.sbnd`:

* **One sample per chunk**: `stsc` is a single entry, and frame i is `stco[i]` (or `co64[i]`) and `stsz[i]`, two
  parallel arrays: 8 B per frame with 32-bit offsets, 12 B with 64-bit ones, which is `.sbnd`'s table split in two.
* **One chunk for everything**, what ffmpeg wrote in the guide (all 160 frames, one `stco` entry): 4 B per frame,
  and a running sum of `stsz` computed once at open.

Either way, after the index is parsed once, a frame is **one lookup and one read**, and its bytes are contiguous
([`guide.md`](guide.md) §5 shows both). The difference from `.sbnd` is at open: a box tree to walk instead of a
fixed header, and, by default, the index after the media.

**`moov` at the front or the end.** A writer only knows the offsets once the media is written, so `moov` lands at
the end unless the file is rewritten: ffmpeg's `-movflags +faststart` does a second pass that moves it to the front
and rewrites every offset. For files written once at ingest it costs nothing at serve time and makes the index one
read from offset 0. A plain MP4 interrupted while being written is unreadable (no `moov` yet); a fragmented one
survives up to its last fragment.

### Fragmented MP4 and CMAF

A **fragmented MP4** starts with a `moov` whose sample tables are empty and that announces fragments (`mvex`, with
per-track defaults in `trex`), then repeats **`moof` + `mdat`** pairs. Each `moof` describes only its own samples:
`tfhd` (track, defaults, usually *default-base-is-moof*), `tfdt` (the fragment's start time), `trun` (count, a data
offset, and per sample any of duration, size, flags, composition offset).

* There is **no global per-frame table**. Random access needs `sidx` (a segment index: one 12-byte reference per
  fragment, its byte size and duration), or `mfra`/`tfra` at the end (time → `moof` offset), or a walk of `moof`
  headers.
* With **one frame per fragment**, each `sidx` reference *is* frame i's byte range, and the range is self-contained:
  `moof` + `mdat`, appendable straight into Media Source Extensions. The guide's file with ffmpeg's
  `frag_every_frame` paid 131 B per frame: a 104 B `moof`, an 8 B `mdat` header and a 19 B `tfra` entry. With K frames
  per fragment the cost falls to roughly 96/K + 4 B per frame, but a lookup then parses a `moof`.

**CMAF** (ISO/IEC 23000-19) is fragmented MP4 under rules, so one file serves both DASH and HLS: a header (`ftyp` +
`moov` with one track and `mvex`), then fragments with `tfdt` in every `traf` and moof-relative offsets. It names
three units: a **chunk** (one `moof` + `mdat`), a **fragment** (one or more chunks, starting at a key frame) and a
**segment** (one or more fragments, the unit a URL or byte range addresses). Low-latency DASH and HLS send chunks as
they are made. An IETF draft maps CMAF onto Media over QUIC (draft-ietf-moq-cmsf-01): each MoQ object carries whole
CMAF chunks of one track, and the header travels in the catalogue; it is the closest standard to "fMP4 over
WebTransport".

## 4. The codecs it carries

**AV1** (AOM, *AV1 Codec ISO Media File Format Binding* v1.3.0):

* Sample entry `av01` with one `av1C`: four bytes mirroring the sequence header's profile, level, tier, bit depth,
  `monochrome` and chroma subsampling, then optionally the sequence header itself.
* **One sample is one temporal unit**, as low-overhead OBUs with size fields. Temporal delimiters, padding and
  redundant frame headers *should not* be stored (so muxers drop the 2-byte delimiter, as the guide saw); tile list
  OBUs *must not*; `ctts` *must not*.
* A sync sample starts with a key frame and carries a sequence header. In an all-intra stream every sample is sync,
  so `stss` is left out.
* **No restriction on monochrome, 12-bit or lossless**: the binding signals what the AV1 stream is. The limits are
  AV1's own profiles: 8- and 10-bit grey are **Main** (profile 0); **12-bit needs Professional** (profile 2), and
  High (profile 1) cannot be monochrome.
* The **codecs string** `av01.P.LLT.DD.M.CCC.cp.tc.mc.F` is defined here (§5); the product already builds it from
  each keyframe's sequence header (`docs/av1/payload-format.md` at `e8f6374` on `claude/av1-unified`).
* **The sample is byte for byte a WebCodecs chunk**: the WebCodecs AV1 registration takes the same low-overhead
  OBUs and no `description`. Moving an AV1 frame between MP4 and WebCodecs needs no rewriting.

**JPEG 2000 and HTJ2K.** Two mappings exist: **Motion JPEG 2000** (ISO/IEC 15444-3, brand `mjp2`), a track of
independent codestreams, little used outside archives; and **JPEG 2000 in HEIF** (ISO/IEC 15444-16:2021, brands
`j2ki` and `j2is`, item type `j2k1`). **No HTJ2K-specific brand is registered** at the MP4 registration authority;
HTJ2K keeps Part 1's codestream syntax, so carrying it in a `j2k1` item looks possible, but whether a 15444-16 reader
must accept a Part 15 codestream is not confirmed, and the Library of Congress notes a revision of 15444-16 "to
support all JPEG 2000 code-streams including HTJ2K" is under way. No browser decodes any of them.

**Uncompressed** (ISO/IEC 23001-17:2024, sample entry `uncv`, item `unci`): component type 0 is *monochrome*, and a
component's depth runs from 1 to 256 bits, so **16-bit grey is expressible** (one unsigned 16-bit monochrome
component; read from libheif's implementation of the tables, not the ISO text). Amendment 2 (2025) adds generic
lossless compression of such samples. Every registered `uncv` profile is YUV or RGB; grey uses the general form.

**HEVC and AVC** (ISO/IEC 14496-15) are length-prefixed NAL units; HEVC's range extensions have monochrome 12- and
16-bit profiles and a lossless mode on paper, but no browser or common hardware decoder goes past Main 10 4:2:0
(not verified in depth here; [`hardware-decode.md`](hardware-decode.md) has what was).

## 5. HEIF and AVIF: stills in the same boxes

**HEIF** (ISO/IEC 23008-12) stores **items** (untimed images described in a `meta` box) or **image sequences**
(tracks with handler `pict`). Its item location box, **`iloc`, gives each item one or more (offset, length)
extents**, so a collection of images is literally a per-image offset-and-length table, at the price of an item info
entry and property associations per item. Item IDs above 65 535 need version 2 boxes (field widths not read in the
text). A `grid` item tiles a big image from equal coded tiles. **MIAF** (23000-22) is HEIF's interoperability profile.

**AVIF** (AOM, v1.2.0, October 2025) is HEIF with AV1. An image item is one AV1 key frame; an image sequence
(`avis`) is an AV1 track; the brand `avio` marks intra-only sequences. Its profiles stop short of us: **Baseline
(`MA1B`) is AV1 Main and Advanced (`MA1A`) is High, so 12-bit grey (Professional) is valid AVIF but in neither
profile.** Version 1.2.0 adds the **Sample Transform** derived item (`sato`): integer expressions over other items,
with a worked example building a 16-bit image as `256·a + b` from an 8-bit lossless "prefix" item and an 8-bit
"suffix" item. That is our top-and-low-bits split, standardised, for **still images only** (not sequences).

In a browser, `<img>` shows AVIF at 8 bits per channel: Chromium (CrabbyAvif with dav1d) renders high bit depth to
8-bit RGB unless an option for half-float is on; Firefox keeps the bit depth internally and handles monochrome.
Neither hands the samples to the page, so diagnostic use still means decoding in the page.

## 6. Metadata

Where our per-frame digests, DICOM UIDs and metadata JSON could live, all ignored by readers that do not know them:

| mechanism | scope | fits |
| --- | --- | --- |
| `udta`, `meta` (with an XML or a `mime` item, e.g. JSON) | file or track | the metadata JSON, study and series UIDs |
| `uuid` box | anywhere | private data, skipped by everyone else |
| sample groups (`sbgp`/`sgpd`) | runs of samples | "frames 0–99 belong to instance X" |
| sample auxiliary information (`saiz`/`saio`), a private type | **per sample** | an 8-byte XXH3 per frame |
| a timed metadata track, linked with `tref 'cdsc'` | per sample, time-aligned | the same, as its own track |

The last three rows' field details are from memory of 14496-12, not read. Whether `ffmpeg -c copy` keeps unknown
boxes is not checked.

## 7. Throughput and latency

What a writer can choose, for serving single frames:

* **Index at the front** (`+faststart`) and parsed once at open, kept in memory as `.sbnd`'s table is.
* **One sample per chunk** for a direct `stco[i]` + `stsz[i]` lookup, or one chunk and a prefix sum at open.
* **`stco` under 4 GiB, `co64` above** (4 B per frame saved).
* **Page alignment is free**: offsets are absolute and gaps are legal, so a writer may pad each frame to 4 KiB for
  aligned direct reads without leaving the standard ([`../adr/disk-access.md`](../adr/disk-access.md) is where our
  read path's alignment matters).
* **Two streams per frame** (our split): two tracks interleaved per frame keep "both halves of frame i" one
  contiguous range; or one track whose sample is both halves, described with sub-sample information (`subs`, not
  read).
* **Fragments only for a reason**: one frame per fragment makes every frame a self-contained `moof` + `mdat`
  (about 100–130 B each), which is what MSE needs; it buys nothing for a server reading by offset.

Bytes are not the difference: 4–12 B per frame flat, about 130 B fragmented, against frames of 50–500 KB.

## 8. Playback, tools, licence

* **Media Source Extensions** take only fragmented MP4: the W3C byte stream format makes non-empty sample tables
  and a missing `mvex` errors, and Chromium enforces it. A flat MP4 plays in a `<video>` element by URL but cannot
  be appended.
* **AV1 monochrome**: Chromium's `av1C` parser reads only the profile and its codec-string parser accepts 12-bit and
  monochrome, so Chromium takes our streams at the container level (and played the guide's 10-bit grey).
  **Firefox's dav1d wrapper skips I400 (monochrome) pictures** ("No chroma data to construct an image"), so
  monochrome AV1 does not display in Firefox's `<video>`, and the product's own probes found Firefox WebCodecs
  failing every grey layout (`docs/codecs/README.md` at `e8f6374` on `claude/av1-unified`). Safari not checked.
* **WebCodecs needs no container**: the explainer lists muxing and demuxing as a non-goal. The product already
  hands the decoder bare temporal units.
* **Tools**: ffprobe, GPAC's MP4Box (`-info`, `-diso`), Bento4 (`mp4dump`, `mp4info`), mp4box.js in the browser,
  libheif for HEIF and `uncv`. Rust: `mp4` (no release since 2023), `mp4parse` (Firefox's, read-only), and the
  actively released `re_mp4` (Rerun's, built for WebCodecs players) and `mp4-atom` (typed box read and write).
  Reading a sample table needs a few hundred lines and no crate.
* **Licence: what is paid is the document, not the right to implement it.** ISO sells the text: 14496-12 is in its
  8th edition (2026), and IEC sells the 7th (2022) at CHF 67. ISO's page for the 8th shows "CHF 0" beside its cart,
  read 2026-10-16; whether that means free or is a display artefact was not confirmed. The 2005, 2008, 2012 and 2015 editions were
  free on ISO's Publicly Available Standards list (the Library of Congress links them); whether any still are was not
  confirmed, ISO's list being unreachable from here. 14496-14 (the `.mp4` brand) is paid; HEIF's 2017 edition was free.
  The right to implement is a patent question, not a purchase: holders declare patents to ISO under the
  ISO/IEC/ITU common patent policy. What an
  AV1 writer needs beyond the boxes is free: the AOM binding (`av01`, `av1C`), the MP4RA registry and MPEG's
  conformance files. ffmpeg, GPAC and mp4box.js are open implementations.
* **Patents**: "No patent pool for the container itself was found" was wrong (corrected 2026-10-16). MPEG LA launched
  an **MPEG-4 Systems** pool in 2003 whose announcement covered "the MP4 format for data packaging" (press report of
  the announcement; the licence text was not read), now administered by Via LA per the Library of Congress. Whether
  it still holds live patents was not found. Codec royalties are separate (AV1 is AOM royalty-free; HEVC and AVC have
  pools).

## 9. For wt-pacs

* **MP4 has the property our server needs.** A faststart MP4 with one sample per chunk is `.sbnd`'s frame table in
  standard syntax: same bytes per frame, same lookup, same single read. The predicted serve-time difference is
  none; the difference is at open (a box tree to parse) and in tooling. *Predicted, not measured.*
* **For AV1 it is the natural standard home**: an `av01` sample is a WebCodecs chunk, the codecs string is defined
  here, and every tool reads it. What has no standard place: our 16-byte payload header (the depth, split and offset
  would go in sample auxiliary information, a sample group, or the track if constant), and the split itself (two
  tracks or sub-samples; AVIF's `sato` covers stills only).
* **For HTJ2K it adds tooling, not playback**: the mappings exist (MJ2, 15444-16) but nothing plays them.
* **Fragmented MP4 only if `<video>` or MSE becomes a goal**, and [`hardware-decode.md`](hardware-decode.md) is why
  that path cannot carry diagnostic frames.
* **Precision of the old local note**: "MP4 has stsz and stco, in effect our index in another syntax" holds; it
  holds exactly only with one sample per chunk, and otherwise after a prefix sum at open.

## 10. Sources

* ISO/IEC 14496-12:2026: https://www.iso.org/standard/85596.html; the 2022 edition at IEC:
  https://webstore.iec.ch/en/publication/74007; the free editions, listed by the Library of Congress:
  https://www.loc.gov/preservation/digital/formats/fdd/fdd000079.shtml; 14496-14 and the MPEG-4 Systems licence:
  https://www.loc.gov/preservation/digital/formats/fdd/fdd000155.shtml
* ISO and patents: https://www.iso.org/iso-standards-and-patents.html
* MPEG LA's MPEG-4 Systems pool, 2003 (press): https://internetnews.com/it-management/mpeg-4-systems-license-released
* MPEG file format conformance files: https://github.com/MPEGGroup/FileFormatConformance

* ISO/IEC 14496-12:2026, preview (contents and foreword):
  https://webstore.ansi.org/preview-pages/ISO/preview_ISO+IEC+14496-12-2026.pdf
* Apple, QuickTime File Format (the same box model): https://developer.apple.com/documentation/quicktime-file-format
  — atoms, chunk offset, sample-to-chunk, sample size, using sample atoms.
* 3GPP TS 26.244 §13.4, the segment index box: https://www.itecspec.com/3gpp/26.244/s/13.4
* Microsoft MS-SSTR, the track fragment run box:
  https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-sstr/6d796f37-b4f0-475f-becd-13f1c86c2d1f
* FFmpeg formats documentation, the mov/mp4 muxer: https://ffmpeg.org/ffmpeg-formats.html
* MP4 registration authority, brands and codecs: https://mp4ra.org/registered-types/brands,
  https://mp4ra.org/registered-types/codecs, https://mp4ra.org/registered-types/uncv-profiles
* CMAF rules as quoted by the Unified Streaming validator:
  https://validator.unified-streaming.com/docs/available_suites/cmaf-recommendations.html
* IETF draft-ietf-moq-cmsf: https://datatracker.ietf.org/doc/html/draft-ietf-moq-cmsf/
* AOM, AV1 Codec ISO Media File Format Binding v1.3.0: https://aomediacodec.github.io/av1-isobmff/
* AOM, AV1 bitstream specification (colour config, profiles): https://aomediacodec.github.io/av1-spec/
* AOM, AV1 Image File Format v1.2.0: https://aomediacodec.github.io/av1-avif/
* W3C, ISO BMFF Byte Stream Format for MSE: https://www.w3.org/TR/mse-byte-stream-format-isobmff/
* W3C, WebCodecs, its explainer and the AV1 registration: https://www.w3.org/TR/webcodecs/,
  https://github.com/w3c/webcodecs/blob/main/explainer.md, https://www.w3.org/TR/webcodecs-av1-codec-registration/
* Chromium source: `media/formats/mp4/box_definitions.cc`, `media/base/video_codec_string_parsers.cc`,
  `third_party/blink/renderer/platform/image-decoders/avif/avif_image_decoder.cc` (https://source.chromium.org)
* Firefox source: `dom/media/platforms/agnostic/DAV1DDecoder.cpp`, `image/decoders/nsAVIFDecoder.cpp`
  (https://github.com/mozilla-firefox/firefox)
* libheif, the 23001-17 tables: https://github.com/strukturag/libheif (`heif_components.h`, `unc_boxes.h`)
* Library of Congress format descriptions: Motion JPEG 2000
  https://www.loc.gov/preservation/digital/formats/fdd/fdd000127.shtml, HTJ2K
  https://www.loc.gov/preservation/digital/formats/fdd/fdd000565.shtml
* ISO/IEC 15444-16:2021 abstract: https://iteh.es/catalog/standards/iso/91e62eb3-7b35-4a50-89ba-fbdf2b3c7831/iso-iec-15444-16-2021
* ISO/IEC 23001-17 Amd 2:2025: https://www.iso.org/standard/89120.html
* Rust crates: https://github.com/alfg/mp4-rust, https://github.com/mozilla/mp4parse-rust,
  https://github.com/rerun-io/re_mp4, https://github.com/kixelated/mp4-atom
