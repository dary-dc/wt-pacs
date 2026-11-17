# AV1 in a phone's hardware: the chips, their limits, and our frames

*Queue row AV1-HW-CHIPS, 2026-11-17 (`claude/work-ledger:docs/queue-client-2026-11-14.md`). Theory and sources; nothing
run on a device. It answers, per phone SoC family: AV1 in hardware yes or no, the largest level, the profiles, the
bit depths, 4:0:0 and the largest frame; how our frames map to AV1's levels; and what is left if level 4.1 is the
ceiling. It extends [`av1-hardware-unchecked.md`](av1-hardware-unchecked.md) §5 and
`claude/hw-decode:docs/decode/hardware.md` §15, and corrects one of their open points in §2.*

Labels as in [`README.md`](README.md): **(S)** a source quoted verbatim, listed in §7 with its revision; **(R)** a
result of this repository; **(D)** derived; **(T)** theory, not measured. Fixtures and limits: §8.

## 1. What it shows

* **The only vendor with a published size limit is Google's Tensor**, and it is not a level: every Pixel from
  Tensor to Tensor G4 declares `c2.google.av1.decoder` with `<Limit name="size" min="96x96" max="3840x2160" />`,
  `block-count` up to 32 400 blocks of 16 × 16, and `can-swap-width-height` (S2). So a frame fits when its short side is
  ≤ 2160, its long side ≤ 3840 and it has ≤ 32 400 blocks. **18 of the 19 DBT volumes fit, `dbts_b1` does not**
  (2560 × 3328: its short side is 2560, and it is 33 280 blocks) (D, §3).
* **No other vendor document read names a level, a size per codec, 4:0:0 or a bit depth per codec**, except
  MediaTek's Dimensity 9400 ("8K60, 10-bit Video Decode (HEVC/AVC/VP9/AV1)", S5), which implies level 6.1 at 10 bits
  if read per codec (D). Qualcomm's "8K HDR video playback @ 60 FPS" is not per codec: the 8s Gen 4's brief says it
  and also "Video decode up to 4K at 60 FPS (native decode support VP9 and AV1 formats)" (S4).
* **Android promises little.** Its CDD asks a hardware AV1 decoder for HD 1080p (§5.3.9 [C-2-2]) and, of media
  performance class V, "Main 10, Level 4.1" (S3). Its API has no monochrome AV1 profile: "AV1 Main profile 4:2:0
  8-bit" and "… 10-bit" (S6). So **4:0:0 is nowhere promised**, and the coded form for hardware is 4:2:0 with
  constant chroma (R, +0.01–0.12 % bytes at 8 bits).
* **The Galaxy S23's SoC is now sourced**: Samsung names it "the brand-new Snapdragon® 8 Gen 2 Mobile Platform for
  Galaxy" (S7). Whether it has an AV1 decoder is still not settled by Qualcomm's own brief, which lists "H.265 and
  VP9" (R, `hardware.md` §15). The phone answers it (§6).
* **Chromium on Android enforces both the size and the level before it picks a hardware decoder** (S8): it skips a
  decoder whose `coded_size_max` is smaller than the frame in either dimension, or whose level is below the
  stream's. Our streams carry the level libaom writes by picture size (R, row CODECSTR), 5.x for 8 of 19 volumes (§3).
  *Corrected 2026-11-17 (PR 397 §AV1 chips review, blocker 1): this read "5.x for 9 of 19 volumes".*
* **If 4.1 is the ceiling, the frame must be split into separate streams.** AV1 has no sub-picture: tiles and
  super-resolution do not lower the level, because the level bounds `UpscaledWidth * FrameHeight` of the whole frame
  (S1). Strips coded as independent sequences fit level 4.1: four for `dbts_b1`, two or three for the other seven
  5.x volumes (D, §4). *Corrected 2026-11-17 (blocker 1): this read "the other eight".* Their byte cost and their seams are unmeasured: a cloud byte cell is pre-registered in §4.3.

## 2. The chips

One row per SoC family a phone in reach is likely to carry. "Not stated" means no vendor document read states it.

| SoC family (phones) | AV1 in hardware | largest level | profiles, depths | 4:0:0 | largest frame |
| --- | --- | --- | --- | --- | --- |
| Google Tensor, G2, G3, G4 (Pixel 6 to 9; S2, S9) | **yes**: `c2.google.av1.decoder` and its `.secure` twin in the vendor's codec file | not in the file; the component reports it at run time | not in the file | not stated | **3840 × 2160, either orientation**; ≤ 32 400 blocks of 16 × 16; `performance-point-3840x2160` 60 |
| Qualcomm Snapdragon 8 Gen 2 (Galaxy S23, S7) | **not settled**: both briefs list "Hardware-accelerated H.265 and VP9 decoder" (R); a republished launch release says AV1 to 8K60 (R, `hardware.md` §15) | not stated | not stated | not stated | not stated |
| Qualcomm Snapdragon 8 Gen 3, 8 Elite (S4) | **yes**: "Hardware-accelerated H.265, VP9, AV1 decoder" | not stated | not stated | not stated | not per codec; "8K HDR video playback @ 60 FPS" (8 Elite) |
| Qualcomm Snapdragon 8s Gen 4 (S4) | **yes**: the same line, and "native decode support VP9 and AV1 formats" | not stated; 4K60 implies ≥ 5.1 (D) | not stated | not stated | "up to 4K at 60 FPS" |
| MediaTek Dimensity 9200, 9300, 8300 (S5) | **yes**: "Video Playback H.264 HEVC Vp-9 AV1"; 8300 also "4K AV1 media decoding" | not stated | not stated | not stated | not per codec (9200, 9300); 4K (8300) |
| MediaTek Dimensity 9400 (S5) | **yes** | not stated; 8K60 implies 6.1 (D) | "10-bit" | not stated | "8K60" |
| Samsung Exynos 2200 (S10) | **yes**: "the MFC includes a power efficient AV1 decoder" | not stated | not stated | not stated | not per codec ("8K videos at up to 60fps") |
| Samsung Exynos 2400 (S10) | **not stated**: the page names no decoder | — | — | — | — |
| Apple A17 Pro and later (R, `hardware.md` §5, §15) | **yes**: "a dedicated AV1 decoder"; in Safari only through `<video>`, WebCodecs AV1 software (R) | not published | not published | not published | not published |

Derivations (D, S1 Annex A, `MaxDecodeRate` and `MaxPicSize`):

* "4K at 60 FPS" is 3840 × 2160 × 60 = 497 664 000 samples a second: above level 5.0's 273 715 200, within 5.1's
  547 430 400. So a decoder that does it is at least 5.1 in rate and, at 8 294 400 samples, in size.
* "8K60" is 7680 × 4320 = 33 177 600 samples (≤ 6.x's 35 651 584), × 60 = 1 990 656 000 a second (≤ 6.1's
  2 189 721 600). Either `dbts_b1` orientation fits 7680 × 4320.
* Tensor's 3840 × 2160 at 60 meets 5.1's rate, but its frame limit is a box, not `MaxPicSize`: a frame of 5.x's
  8 912 896 samples with both sides above 2160 (`dbts_b1`) is refused (§3).

What the vendors' own codec files would settle and were not read: Qualcomm's and MediaTek's `media_codecs` files are
not on the Android source host (`android.googlesource.com` holds Google's devices only), and the host Qualcomm
publishes its open sources on was not reachable from here. A phone's own file and its `MediaCodecInfo` answer both (§6).

## 3. Our frames against the levels and against Tensor's box

Per volume (`docs/FIXTURES.md`, the 19 DBT volumes). Level by S1 Annex A: 4.x if `UpscaledWidth * FrameHeight` ≤
2 359 296, width ≤ 6144 and height ≤ 3456; else 5.x (≤ 8 912 896, 8192, 4352). Strips at 4.1: the fewest equal
full-width strips each ≤ 2 359 296 samples. Tensor's box: short side ≤ 2160, long side ≤ 3840, ⌈w/16⌉ × ⌈h/16⌉ ≤
32 400 (S2, S6). Frames a second at 4.1: 155 713 536 ÷ samples, the level's decode floor if one 4.1 decoder decodes
every strip in turn (D, a conformance bound, not a measurement).

| volume | stored | samples | level | strips at 4.1 | Tensor's box (blocks) | Tensor strips | frames/s at 4.1 |
| --- | --- | --: | --- | --- | --- | --: | --: |
| `dbt12_ea1141` | 614 × 1359 | 834 426 | 4.x | 1 | yes (3 315) | 1 | 186.6 |
| `dbt10_ea1141` | 678 × 1727 | 1 170 906 | 4.x | 1 | yes (4 644) | 1 | 133.0 |
| `dbt12_c` | 931 × 2124 | 1 977 444 | 4.x | 1 | yes (7 847) | 1 | 78.7 |
| `dbt10_d` | 757 × 2336 | 1 768 352 | 4.x | 1 | yes (7 008) | 1 | 88.1 |
| `dbts_a1` | 1142 × 1785 | 2 038 470 | 4.x | 1 | yes (8 064) | 1 | 76.4 |
| `dbts_a2` | 1014 × 2046 | 2 074 644 | 4.x | 1 | yes (8 192) | 1 | 75.1 |
| `dbts_a3` | 712 × 2041 | 1 453 192 | 4.x | 1 | yes (5 760) | 1 | 107.2 |
| `dbts_a4` | 1131 × 2223 | 2 514 213 | **5.x** | 2 × 1131 × 1112 | yes (9 869) | 1 | 61.9 |
| `dbts_a5` | 845 × 2241 | 1 893 645 | 4.x | 1 | yes (7 473) | 1 | 82.2 |
| `dbts_b1` | 2560 × 3328 | 8 519 680 | **5.x** | 4 × 2560 × 832 | **no** (33 280) | 2 | 18.3 |
| `dbts_b2` | 1890 × 2457 | 4 643 730 | **5.x** | 2 × 1890 × 1229 | yes (18 326) | 1 | 33.5 |
| `dbts_b3` | 1996 × 2457 | 4 904 172 | **5.x** | 3 × 1996 × 819 | yes (19 250) | 1 | 31.8 |
| `dbts_b4` | 1996 × 2457 | 4 904 172 | **5.x** | 3 × 1996 × 819 | yes (19 250) | 1 | 31.8 |
| `dbts_b5` | 1890 × 2457 | 4 643 730 | **5.x** | 2 × 1890 × 1229 | yes (18 326) | 1 | 33.5 |
| `dbts_c1` | 976 × 2513 | 2 452 688 | **5.x** | 2 × 976 × 1257 | yes (9 638) | 1 | 63.5 |
| `dbts_c2` | 757 × 2227 | 1 685 839 | 4.x | 1 | yes (6 720) | 1 | 92.4 |
| `dbts_c3` | 1147 × 2585 | 2 964 995 | **5.x** | 2 × 1147 × 1293 | yes (11 664) | 1 | 52.5 |
| `dbts_c4` | 662 × 2227 | 1 474 274 | 4.x | 1 | yes (5 880) | 1 | 105.6 |
| `dbts_c5` | 955 × 2100 | 2 005 500 | 4.x | 1 | yes (7 920) | 1 | 77.6 |

So: **11 of 19 fit level 4.x as they are; 8 need 5.x**, all of system B's, `dbts_a4`, `dbts_c1` and `dbts_c3`.
*Corrected 2026-11-17 (PR 397 §AV1 chips review, blocker 1): this read "10 of 19 fit level 4.x as they are; 9 need
5.x"; the table and the list were right, the count was not.* Every
one is a portrait frame. Under Android's CDD floor (1080p, §1) a portrait frame needs a decoder that swaps width and
height, which Tensor's declares and the CDD does not ask (D).

**How Chromium applies this** (S8, Chromium `main`; the phone's Chrome 157 not re-read). `VideoAcceleratorUtil`
builds each decoder's entry from `getSupportedWidths()` and `getSupportedHeightsFor(maxWidth)`, adds a portrait entry
when `isSizeSupported(maxHeight, maxWidth)`, and keeps the highest level per profile. `SelectMediaCodec` then skips a
decoder when "config.level() > info.level" or when the frame's width or height exceeds `coded_size_max`. On Tensor
that gives 3840 × 2160 and 2160 × 3840 (D, from S6's `isSizeSupported`: "Math.min(height, width) <=
mSmallerDimensionUpperLimit" with the limit 2160): `dbts_b1` fails both entries, `dbts_c1` passes the portrait one.
Whether Tensor's component reports level 5.x is not in its file; the phone reports it (§6).

## 4. If level 4.1 is the ceiling

### 4.1 What does not help (S1)

* **Tiles.** A tile divides a frame; the level still bounds the whole frame ("UpscaledWidth * FrameHeight is less
  than or equal to MaxPicSize"), and adds "NumTiles is less than or equal to MaxTiles" (32 at 4.x).
* **Super-resolution.** The bound is on `UpscaledWidth`, the width after upscaling, so a narrower coded frame does
  not lower the level.
* **Large-scale tile decoding** decodes "a random subset of tiles taken from a number of coded frames", but "A
  decoder is recommended to support decoding of tile list OBUs, but this is not a requirement for decoder
  conformance", its output frame is bounded by the same `MaxPicSize`, and Android's codec API has no input for a
  tile list (S6: none of its AV1 constants names one). Not a route on a phone.
* **A sub-picture.** AV1 has none: the word does not occur in the specification (S1, searched). It is VVC's tool,
  and VVC has no decoder in any browser (named only).
* **Declaring a lower level than the frame needs** makes the bitstream non-conforming, and Chromium would still check
  the frame's size (§3). **Level 31** ("the maximum parameters level") leaves the choice to the decoder: "There is
  no assurance that all pictures will be decoded" (S1). Not a route either.

### 4.2 Strips coded as separate streams (the option)

Each strip is its own AV1 sequence, coded and checked on its own, decoded by its own `VideoDecoder` (or one decoder
reconfigured), and painted side by side. Built on what the client has (T):

1. **Strip geometry**: full-width horizontal strips, as §3 (four of 2560 × 832 for `dbts_b1`; 832 = 13 × 64, so the
   seams fall on superblock rows). On Tensor's box two strips of 2560 × 1664 suffice, but they are 4 259 840 samples
   each, so 5.x again: a decoder whose ceiling is 4.1 needs four.
2. **The check**: each strip's reconstruction digest from the ingest; the decoder's output for a conforming stream
   is exact (S1 §7.2, R `README.md` §3 item 1), so each strip checks as a frame does today, and a frame passes when
   all its strips pass (D).
3. **Decoders**: Android's media performance class asks "6 instances" of hardware decode at 1080p for AV1 (S3,
   [5.1/H-1-2]: "AV1 codecs are only required to support 1080p resolution, but are still required to support 6
   instances at 1080p30fps"); Tensor declares `concurrent-instances` 16 (S2). Four strips in four decoders fit both.
4. **Rate**: at level 4.1's floor one decoder does 155 713 536 samples a second, 18.3 `dbts_b1` frames a second
   through four strips, against software's 7.4 on the phone (R, 133–135 ms). Four decoders in parallel are bounded by
   the chip, not the level (T).
5. **Software path unchanged in kind**: a strip is a smaller AV1 frame, so dav1d and WebCodecs software decode it
   as today, with four decodes a frame instead of one (T: per-frame overhead × 4, unmeasured).

Its costs (T, each unmeasured): **bytes**, since no prediction crosses a seam; **seams**, since the loop filters stop
at a strip's edge and each strip's error is independent, so a seam may show at low window widths; **four streams**
in the payload format, the ingest and the store; **memory**, four decoders' buffers. It is a change to the payload
format (`docs/av1/payload-format.md`) and is the owner's to adopt; this file only states it.

### 4.3 A cloud byte cell, pre-registered (not run by this row)

* **Question**: what do strips cost in bytes and in error at the noise rule's bar?
* **Arms**, interleaved per volume: whole frame (today's Q 8, groups of 8) against §3's strips at 4.1, the same
  encoder and settings, on the 8 volumes that need 5.x. *Corrected 2026-11-17 (blocker 1): this read "9".*
* **Prediction** (T, before any run): bytes +0.5 to +3 % for two strips and +1 to +5 % for `dbts_b1`'s four (the
  seams' superblock rows lose their above context: 3 × 2560 × 64 samples is 5.8 % of `dbts_b1`'s frame); in-window
  error within ±1 % of the whole frame's; the largest error per sample in the 8 rows either side of a seam within
  1.2× of the frame's.
* **Fixtures and limits**: the 19 DBT volumes of one dataset (EA1141), 8 of them in this cell; a 4-core cloud host
  without a GPU; bytes and error only; no time is claimed from the cloud host and no seam visibility is judged by eye.
  *Corrected 2026-11-17 (blocker 1): this read "9 of them".*

## 5. What the sources decide alone

1. **Eleven of 19 volumes fit level 4.x, eight need 5.x** (D, S1, §3). *Corrected 2026-11-17 (PR 397 §AV1 chips
   review, blocker 1): this read "Ten of 19 volumes fit level 4.x, nine need 5.x".*
2. **Android does not promise level 5.x, a portrait frame, 4:0:0 or a frame larger than 1080p** for AV1 in hardware
   (S3, S6).
3. **On every Pixel from Tensor to Tensor G4, `dbts_b1` cannot be decoded in hardware whole**; the other 18 fit the
   declared box, subject to the level the component reports (S2, S6, S8).
4. **Strips are the only way to put a 5.x frame through a 4.1 decoder** (S1 §4.1).

What only a device settles: whether the S23 has the decoder at all; each chip's reported level, sizes and profiles;
whether a portrait frame or a 4:2:0 grey frame is taken; the decode time; how many strips' decoders run at once.

## 6. What the next phone round must ask

Added as one line to `claude/phone-protocol:docs/phone-rows/next-round.md` §Decode-option cells by the round's
author, not by this row (it already carries M4, `av1-hardware-unchecked.md` §9.1). Per AV1 decoder the phone lists:

* `MediaCodecInfo`: its name, `isHardwareAccelerated()`, `profileLevels` (profile and level pairs), and
  `isSizeSupported` for every stored size of §3 in both orientations and for §3's strips;
* `VideoDecoder.isConfigSupported` with `prefer-hardware` for each volume's own codec string and for a strip's;
* the vendor's `/vendor/etc/media_codecs*.xml` AV1 entries if readable from a shell.

## 7. Sources

Fetched 2026-11-17.

* S1 AV1 Bitstream & Decoding Process Specification, `github.com/AOMediaCodec/av1-spec` at `5e04f3f75e73`:
  `annex.a.levels.md` §Levels (the level table, lines 76–92; the bitstream constraints, lines 228–246), §Decoder
  Conformance (lines 308–335, the level-31 note and the tile-list constraints); `08.decoding.process.md` §Overview,
  §General decoding process, §Large scale tile decoding process.
* S2 Android device trees, `android.googlesource.com/device/google/<soc>/+/HEAD/media_codecs_bo_c2.xml`: `gs101` at
  `fd8ae4af9041`, `gs201` at `0e10376c1e2d`, `zuma` at `ed3585cd0d6b`, `zumapro` at `54b152eac025`; each
  `c2.google.av1.decoder`: `size` 96x96–3840x2160, `block-size` 16x16, `block-count` 36–32400, `blocks-per-second`
  24–1944000, `concurrent-instances` 16, `performance-point-3840x2160` 60, `can-swap-width-height`.
* S3 Android 16 Compatibility Definition, `source.android.com/docs/compatibility/16/android-16-cdd` (page sha256
  `c3d6713c8881`): §5.3.9 AV1 [C-1-1] "MUST support Main Profile including 8-bit and 10-bit content", [C-2-1],
  [C-2-2]; §2.2.7.1 [5.1/H-1-2], [5.1/H-1-14].
* S4 Qualcomm product briefs: Snapdragon 8 Gen 3 (`Snapdragon-8-Gen-3-SM8650-Q-AB-Product-Brief.pdf`, sha256
  `a4479dc99d03`), Snapdragon 8 Elite (`Snapdragon-8-Elite-SM8750-3-AB-Product-Brief.pdf`, `f9a7b000cebe`),
  Snapdragon 8s Gen 4 (`Product-Brief-Snapdragon-8s-Gen-4.pdf`, `661479c7d04a`), under
  `qualcomm.com/content/dam/qcomm-martech/dm-assets/documents/`.
* S5 MediaTek product pages, `mediatek.com/products/smartphones-2/`: `mediatek-dimensity-9200`, `-9300`, `-9400`,
  `-8300`.
* S6 Android `frameworks/base` at `1cdfff555f4a`, `media/java/android/media/MediaCodecInfo.java`:
  `CodecProfileLevel.AV1ProfileMain8` "AV1 Main profile 4:2:0 8-bit", `AV1ProfileMain10` "AV1 Main profile 4:2:0
  10-bit"; `VideoCapabilities.isSizeSupported`, `getSupportedHeightsFor`, and `can-swap-width-height`'s handling.
* S7 Samsung Newsroom, "Take Your Passions Further With the New Samsung Galaxy S23 Series",
  `news.samsung.com/global/take-your-passions-further-with-the-new-samsung-galaxy-s23-series`.
* S8 Chromium `main` at `d154889b26ca`: `media/gpu/android/media_codec_video_decoder.cc` (`SelectMediaCodec`, the
  level and `coded_size_max` checks), `media/gpu/android/video_accelerator_util.cc`,
  `media/base/android/java/src/org/chromium/media/VideoAcceleratorUtil.java` (the decoder entries, the portrait
  entry). Chrome 157's tag was not read.
* S9 Android source, "Build Pixel kernels", `source.android.com/docs/setup/build/building-pixel-kernels` (the Pixel
  codenames); `device/google/raviole` `4128a035ae66`, `pantah` `b9712d3e5c48`, `shusky` `a3188edbe84d`, `caimito`
  `dbd5b36d68bb` (`device-<phone>.mk` includes `device/google/gs101`, `gs201`, `zuma`, `zumapro`).
* S10 Samsung Semiconductor, `semiconductor.samsung.com/processor/mobile-processor/exynos-2200/` and `exynos-2400/`.

## 8. Fixtures and limits

The 19 DBT volumes of `docs/FIXTURES.md` (one dataset, EA1141; three reconstruction systems); sizes only, no frame
coded or decoded here. Vendor pages are marketing text, not datasheets; none states a level. Chromium read at `main`,
not at the phone's Chrome 157. Qualcomm's and MediaTek's codec files were not read. No device, no GPU, no measurement.
