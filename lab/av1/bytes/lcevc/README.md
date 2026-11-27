# lcevc

Row LCEVC's answer: whether MPEG-5 Part 2 (LCEVC) can carry a lossy AV1 base plus an enhancement
that ends **exact**, and whether this project could ship it. The verdict lives in
[`../../../../docs/av1/README.md`](../../../../docs/av1/README.md) §Preview, the licences in
[`../../../../docs/av1/licensing.md`](../../../../docs/av1/licensing.md); this says how it was found.
**No trial ran.** *Corrected 2026-10-31:* this first said there is no open encoder to make a stream
with; MPEG's own reference encoder is free to download under BSD (§Re-checked 2026-10-31). FFmpeg
decodes LCEVC through LCEVCdec and encodes none (§Re-checked 2026-11-02).

```bash
python3 lab/av1/bytes/lcevc/reach.py   # ~10 s, exits 1 if a result moves
```

## Sources, pinned

Read, not built or run (the container refused to build the decoder):

| project | version | commit | read for |
| --- | --- | --- | --- |
| LCEVCdec (the decoder SDK) | 4.2.2 | `17804ac54db8fbb42717f3275b1e73f3c0b067d3` | licence, transforms, dequantisation, the add |
| LCEVCdecJS (the web decoder) | 1.3.0 | `50e4f35c7d82b1b1a9cca434ccca544622f38e11` | licence, how it renders |
| LCEVCdec | 4.3.1 (2026-10-27) | `e295d8438ba554bc541fb269baa9cbd567b626a8` | the re-check: the nine files below are byte-identical to 4.2.2's |
| LTM, the MPEG-5 Part 2 test model (ISO/IEC 23094-3 Amd 1 electronic insert) | 5.5 (`LTM_v5_5.zip`, 2024-09-09) | SHA-256 `62f2cfab…0fe360b` | the re-check: licence, the encoder, the decoder's fixed point |
| FFmpeg | tags `n7.1`, `n8.1`, `n9.0`; branch `release/9.1` (`47b9284`, no `n9.1` tag on 2026-11-02); `master` | `5d5a38a7e46be296eab75982c0986054f731e19e` (2026-11-02) | the FFmpeg re-check: Changelog, `configure`, the LCEVC decode hook, filter, parser, bitstream filters, muxers |

SHA-256 of the files read:

```
7eae3ef5bdd383367ec9c1ce08020aec7aa224d8ccdcb9449ccb036d899928a4  LCEVCdec src/enhancement/src/transform.c
da716acd38328c42b513bb00dced743faae8aaab4acbb283aa8b95d050724ed4  LCEVCdec src/enhancement/src/dequant.c
1e8dbea07e9414fc7446c316af139e69cb8ffbcc9c1ad7da9dce50b77e0b378f  LCEVCdec src/common/include/LCEVC/common/limit.h
c0ffcab0ee9e74aa9be6bd0ecb2bb08d65e945b2e16ab000bf29e9fcc0e6b64e  LCEVCdec src/pixel_processing/src/apply_cmdbuffer_scalar.c
24d57d1cb083924d1835e71f5d985cde30c339662fbe01dec3d04fd93c8d59a0  LCEVCdec src/enhancement/include/LCEVC/enhancement/bitstream_types.h
14358b0ecf6e7036c211c10f0f25563c94483dee7b8c7c954e09e10f3771d0af  LCEVCdec LICENSE.md
3afa5369b4fb44e18280b6e0e275971f78bc6eaf5f53553f41f2483fd8b1267e  LCEVCdec COPYING
37fabc479a9ad9855b21494d9fc3574e95c7478a61bb43166dd2cc2634eb1c25  LCEVCdecJS LICENSE
a2d12e4c1bf215204d8504578009975b3969768504a8fc7a0b6aa4f31da1dfb3  LCEVCdecJS src/queue/queue.js
```

## What the decoder does to a residual

* **Dequantisation is the identity at step width 1.** The step width is clamped to 1…32767
  (`QMinStepWidth`), and at a master step width ≤ 16 the dead zone is `sw >> 1` = 0, so a
  coefficient at step width 1 is the coded integer.
* **The inverse transforms are unnormalised Hadamards.** 2×2 (`DD`): r = H c with H the 4×4
  ±1 Hadamard, H·H = 4I. 4×4 (`DDS`): H ⊗ H, (H ⊗ H)² = 16I. The 1D-scaling variants use other ±1
  matrices with the same normaliser. So the residuals a block can take are the lattice M·Z^n, which
  holds N·Z^n with N = 4 (`DD`) or 16 (`DDS`) and nothing finer in general.
* **Residuals are added below a sample.** A pixel is lifted to a signed fixed point with f fraction
  bits — S8.7, S10.5, S12.3, S14.1 at 8, 10, 12 and 14 bits — the residual added, and the sum
  rounded back: out = p + ⌊(r + 2^(f−1)) / 2^f⌋. **14 bits is the deepest** the decoder takes;
  there is no 16-bit path.

So a sample offset d is reachable when some lattice point falls in the box 2^f·d ± 2^(f−1). With
2^f ≥ N every box of side 2^f holds a point of N·Z^n, so every offset is reachable.

Whether those fixed-point formats are what ISO/IEC 23094-2 itself specifies, or this decoder's
choice, is **not confirmed**: the standard is not freely available and was not read.
*Updated 2026-10-31:* MPEG's reference decoder (LTM 5.5) uses the same shifts, 7/5/3/1 at 8/10/12/14
bits, and adds every residual before a single rounding out (`decoder/src/Convert.cpp:105–121`,
`decoder/src/Decoder.cpp:304, 364, 426–429, 482`) — two implementations, one of them the conformance
reference, so the formats are *derived* to be the standard's; the text itself is still unread.

## Result (`reach.py`)

| depth | fraction bits | 2×2 (`DD`) | 4×4 (`DDS`) |
| --- | --- | --- | --- |
| 8 | 7 | every offset (2^f ≥ 4) | every offset (2^f ≥ 16) |
| 10 | 5 | every offset | every offset |
| 12 | 3 | every offset: 256/256 classes, exhaustive | **not proven**: 4 named patterns and 32/32 random ones reachable |
| 14 | 1 | **128/256 classes unreachable** — a single +1 in a block, `(0,0,0,1)` | **unreachable**: one sample +1, two samples +1 |

The same holds for the 1D-scaling `DD`. So an exact enhancement is possible in principle at 8 to 12
bits, with step width 1 and no dithering, and impossible in general at 14 — where this project's
13-bit CT and cone-beam would have to go. A 2×2 block at 14 bits cannot move one sample by one.

## The checks were mutated

Each mutation ran on a copy; the script's own check (expected counts) caught six of seven:

| mutation | caught by |
| --- | --- |
| one sign of H transcribed wrong | `DD` 14-bit: 0 unreachable, expected 128 |
| rounding box twice too wide (`DD`) | `DD`, `DD1D` 14-bit |
| 14 bits given 2 fraction bits | `DD`, `DD1D` 14-bit |
| `DDS` row filter V ≡ 0 mod 16 | `DDS` 12-bit one sample, random 2/32 |
| `DDS` rounding box twice too wide | `DDS` 14-bit one sample reachable |
| `DDS` match off by one | three `DDS` cases |
| `DDS` row filter V ≡ 0 mod 8 | **not caught**: no tested pattern needs a row with V ≢ 0 mod 8 |

## Why no trial

* **No encoder.** No LCEVC encoder under an open licence was found; the licensor's encoder is a
  commercial SDK. A trial would mean writing an encoder for the bitstream from the standard, which is
  not freely available. **Wrong, corrected 2026-10-31:** the MPEG reference software (LTM) carries an
  encoder under BSD and has been a free download from ISO since 2022 (below); it was not looked for.
* **The browser decoder is not an exact path.** LCEVCdecJS uploads the base from a `<video>`
  element as an 8-bit RGBA WebGL texture, applies residuals in shaders and draws to a canvas: no
  samples come back, and nothing above 8 bits or outside the browser's colour conversion survives.
  LCEVCdec's own WASM wrapper says it is "not complete yet".
* **No patent grant** comes with either decoder (below), unlike AV1's royalty-free licence.

## Re-checked 2026-10-31

The owner asked again, for lossless breast cine-like series (DBT slices, ultrasound cine, ABUS; 8–12
bits; bit-exact). Read, not built or run. Each claim: a source, or *derived*, or *unverified*.

**1. An open encoder — changed.** MPEG's reference software ships an encoder and is a free download:
ISO/IEC 23094-3 [ed-1 insert](https://standards.iso.org/iso-iec/23094/-3/ed-1/en/ReferenceSoftwareLTM/)
(`lcevc_test_model.zip`, LTM 4.1.3, 2022-09-14) and its
[Amd 1 insert](https://standards.iso.org/iso-iec/23094/-3/ed-1/en/amd/1/ReferenceSoftwareLTM/)
(`LTM_v5_5.zip`, 2024-09-09). Its `COPYING` (identical in both):

> The copyright in this software is being made available under the BSD License, included below. This
> software may be subject to other third party and contributor rights, including patent rights, and no such rights are granted

The ISO portal adds that inserts are used "in their original format without any modifications for the
purposes specified"; which governs a modified build is *unverified*. Its limits, from source (LTM 5.5,
the last resort): bases are AVC, HEVC, EVC or VVC elementary streams — the encoder opens the base as
one (`encoder/src/FileEncoder.cpp:358`) and has no YUV-base path (no `BaseCoding_YUV` under
`encoder/`), while the decoder takes a prepared YUV base (`src/ModelDecoderApp.cpp:200`). So **no AV1
base without a patch**. Its forward 2×2 transform truncates, `( … ) / 4`
(`encoder/src/TransformDD.cpp:65–69`), so at step width 1 it does not pick an exact residual
(*derived*). Step widths: "range: [1, 32767]" in the code (`src/ModelEncoderApp.cpp:164–165`),
"[4, 32767]" in its manual — they disagree; *unverified* until built. Formats `y`, `y10`, `y12`, `y14`
are offered, though its README says "either 8 bpp or 10 bpp". The licensor's encoder SDK is still
commercial, and LCEVCdec still says nothing of an encoder.

**2. A lossless mode or profile — unchanged.** The one amendment is "Amendment 1: Additional levels"
([ISO/IEC 23094-2:2021/Amd 1:2024](https://committee.iso.org/standard/86436.html), published 2024-01-22);
no second edition was found. MPEG's
[white paper](https://www.lcevc.org/wp-content/uploads/Whitepaper-on-Low-Complexity-Enhancement-Video-Coding-LCEVC-MPEG-meeting-137-January-2022.pdf)
(SC 29/AG 3 N0058, 2022-01-23) claims reach, not a mode:

> offering an efficient method of encoding residual data and providing up to mathematically
> lossless picture reconstruction.

It names no bit depth; the 14-bit result above stands against it for a base at the output size (a
base upsampled to fractional values was not modelled).

**3. Decoders that return samples — unchanged.** LCEVCdecJS is still 1.3.0 at the same commit
(`50e4f35`, its HEAD on 2026-10-31). LCEVCdec 4.3.0 (2026-10-14) and 4.3.1 (2026-10-27) are Vulkan,
Android and RISC-V work; their notes name no WASM, encoder or lossless change
([releases](https://github.com/v-novaltd/LCEVCdec/releases)), and the WASM wrapper still reads "The WASM
port of `enhancement` and `pixel_processing` functions is not complete yet" (`wrappers/wasm/README.md:3`,
4.3.1). No browser decodes LCEVC natively: at W3C's Media & Entertainment IG
([2025-11-10](https://www.w3.org/2025/11/10-me-minutes.html)) the licensor asked for a native path, the
chair answered "this group can't work on specifications, we have to focus on use cases", and WebKit's
"support in hardware is generally a requirement for us". No WebCodecs path exists (*unverified* beyond
those minutes).

**4. Licence and patents — clarified, no pool.** The licensor licenses alone, not through a pool, in
two programmes. [Video distribution](https://v-nova.com/licensing-lcevc-vdlp/):

> The Video Distribution Licensing Program grants a single, convenient license to patents essential
> to MPEG-5 LCEVC

— royalties by tier, $0 up to 1.14M monthly active video users, "Royalties for free-to-air
broadcasting are waived", early-adopter rates before 31 December 2026.
[Consumer devices](https://v-nova.com/licensing-lcevc-dlp/): "A royalty is due upon the sale of a
Consumer Device implementing MPEG-5 LCEVC" ($0.20–0.70 a unit). Whether a PACS viewer is a "Video
Distribution Service", defined as "any branded media & entertainment service", is *unverified*:
the owner would ask licensing@v-nova.com. Row 19's "royalty-bearing per service, unconfirmed" is now
confirmed from the licensor's own pages.

**5. Published lossless or medical results — none found.** Searches for LCEVC with lossless, medical,
ultrasound, tomosynthesis or radiology found no paper; the nearest is the white paper's claim above.

**6. AV1 base + LCEVC exact end to end — *derived*, not run.**

* The base is any decoded picture: the reference decoder takes a YUV base as is. An AV1 decoder's
  output is fixed by the AV1 specification (*unverified* here, not re-read), so exactness rests on
  the enhancement alone.
* Every residual — sub-layer 1, sub-layer 2, the temporal buffer — is added in the S*n*.*f* domain
  before one rounding (`Decoder.cpp` above); sums of lattice points stay on the lattice, so the
  reach table above holds with temporal prediction and both sub-layers.
* So, with the base at the output size, step width 1, no dithering, and an encoder that solves for
  coefficients rather than truncating: **exact at 8 and 10 bits** with either transform, **at 12 bits
  with the 2×2**, the 4×4 at 12 not proven, **not at 14**.
* The base may be shallower than the output — LCEVC encodes "a lower resolution (and potentially also
  lower bit depth) version" (white paper) and LTM shifts between them (`Convert.cpp:141`) — so a
  12-bit series could take a 10-bit AV1 base, which WebCodecs decodes exactly (row 13). *Derived*.
* Nothing returns exact samples in a browser (3), so "end to end" means natively, today.

### Verdict

**A trial is possible now, natively and offline, for exactness and bytes** — an open encoder exists —
but not with the encoder as shipped: it needs two patches (a YUV base, and exact coefficients at step
width 1). It is **not a product path**: no browser decoder returns samples, and the patents are
royalty-bearing under terms that may or may not reach a PACS.

### Protocol, pre-registered for a separate session

1. Pin `LTM_v5_5.zip` (SHA-256 `62f2cfab386d4ece281ff2f57ab72f5e162f23333469926a37aedc0df0fe360b`),
   LCEVCdec 4.3.1 (`e295d84`), the lab's libaom and dav1d (`lab/av1/tools/tools.sh`). Build natively.
2. Patch the LTM encoder, smallest diff, kept as a file: P1 a `yuv` base read from a decoded
   AV1 file with the enhancement as its own elementary stream; P2 at step width 1, 2×2 transform,
   choose integer coefficients whose inverse lands each sample's box (`reach.py`'s construction), and
   fail loudly where none exists.
3. Series: `dbts_a1` (12-bit DBT slices), `dbt10_ea1141` (10-bit), one plane of `us_liver` (8-bit
   cine; no open breast cine exists, `docs/FIXTURES.md`). The base: AV1 lossy at the output size at
   two quality points; for the 12-bit series also a 10-bit base.
4. Exact means every frame byte-identical to the source **from both decoders**, LTM's and LCEVCdec's;
   a disagreement between them is a finding, not a retry.
5. Predicted before running: exact at 8, 10 and 12 with the 2×2; P2 never fails at those depths.
6. Bytes: base + enhancement against single-layer lossless AV1 and HTJ2K of the same frames (bytes are
   deterministic; no timing claimed). Gain only if smaller than lossless HTJ2K.
7. Mutate: one coefficient ±1, and P2 replaced by LTM's truncation — exactness must fail in both.
8. Stop at the first hard no and record it here.

## Re-checked 2026-11-02: FFmpeg

The owner asked whether FFmpeg's recent releases change the above. Read from FFmpeg's own tree
(pinned above), not built or run. Each claim: a source, or *derived*, or *unverified*.

**What the Changelog says, verbatim, by release.**

| release | entry |
| --- | --- |
| 7.1 (`n7.1`, 2024-09-29) | "LCEVC enhancement data exporting in H.26x and MP4/ISOBMFF"; "LCEVC filter" |
| 8.1 (`n8.1`, 2026-03-16) | "LCEVC metadata bitstream filter"; "LCEVC parser"; "LCEVC enhancement layer exporting in MPEG-TS" |
| 9.0 (`n9.0`, 2026-07-22) | "LCEVC track muxing support in MP4 muxer" |
| 9.1 (`release/9.1`, not tagged on 2026-11-02) | "LCEVC payload merging bitstream filter" (`f2b3888`, "avcodec/bsf: add an LCEVC stream merging bsf") |
| `<next>` (`master`) | "LCEVC raw demuxer and muxer" (`ba7a998`, "avformat: add a raw LCEVC demuxer", 2026-10-29) |

`configure` at `master`: `--enable-liblcevc-dec    enable LCEVC decoding via liblcevc-dec [no]` and
`require_pkg_config liblcevc_dec "lcevc_dec >= 4.2.0" "LCEVC/lcevc_dec.h" LCEVC_CreateDecoder`.
*Correction to the question:* `>= 4.2.0` is `master` only (`fd6dfa6`, 2026-10-25); every release
asks less — `"lcevc_dec >= 2.0.0"` in 7.1, `"lcevc_dec >= 4.0.0"` in 8.1, 9.0 and `release/9.1`. The
bitstream filters have no section in `doc/bitstream_filters.texi`; the filter's whole entry in
`doc/filters.texi` is "Low Complexity Enhancement Video Codec filter based on liblcevc_dec".

**1. Encode or decode — decode only, through LCEVCdec.** No LCEVC encoder is registered
(`libavcodec/allcodecs.c` names none; `AV_CODEC_ID_LCEVC` exists in `codec_id.h` for stream copy),
and `configure` names no LCEVC encoding library — `liblcevc_dec` is the only one. Everything else is
bitstream plumbing: a parser, a CBS reader, `lcevc_metadata` (rewrites VUI fields and can "Delete all
filler"), `lcevc_merge` (attaches an enhancement stream's packets to the base's as
`AV_PKT_DATA_LCEVC`), MP4/MPEG-TS export and muxing, a raw muxer. Decoding is a hook in
`libavcodec/decode.c` that hands any decoder's frame carrying `AV_FRAME_DATA_LCEVC` to LCEVCdec,
unless the caller sets `AV_CODEC_EXPORT_DATA_ENHANCEMENTS` ("Do not apply picture enhancement
layers, export them instead.", `avcodec.h`); `vf_lcevc` does the same as a filter.

**2. Bit depths and output — 8 to 14 bits, samples back, natively.** The hook's `map_format`
(`libavcodec/lcevcdec.c`) takes YUV 4:2:0, 4:2:2, 4:4:4 at 8, 10, 12 and 14 bits and grey
`AV_PIX_FMT_GRAY8` … `AV_PIX_FMT_GRAY14LE` (14-bit since `3a2eae1`, "avcodec/lcevcdec: add 14bit pixel
formats", in 9.0; 8.1 maps only `YUV420P`, `YUV420P10`, `NV12`, `NV21`, `GRAY8`); base and
enhancement may differ in depth (`757cc97`, in 9.0). The filter stops at 12 (`GRAY12LE`,
`YUV444P12LE`). LCEVCdec writes into the `AVFrame`'s own planes (`LCEVC_AllocPictureExternal` over
`frame->data[i]`), so the caller gets samples in memory — the first LCEVC path seen here that does.
Its options default `{ "allow_dithering", "Allow dithering", … { .i64 = 1 } … }`; set through
`-lcevc-dec-params` (`e0e6ca1`, in `release/9.1`, not in 9.0). An exact read wants
`allow_dithering=0` (*derived*: dithering adds noise after the residuals; whether it fires on a
stream that does not signal it is *unverified*).

**3. An AV1 base — wired, not run.** libdav1d's T.35 metadata goes through
`ff_itut_t35_parse_payload_to_frame` (`libdav1d.c`), which turns the licensor's T.35 payload into
`AV_FRAME_DATA_LCEVC` (`itut35.c`), so the hook enhances an AV1 picture like any other. FATE carries
one such stream, `lcevc/L_AV1_854x480p_8bit8bit_2D_dd.mkv`, tested only by demux and remux with
`"-c:v copy"` (`tests/fate/matroska.mak`) — no decode test. *Derived*, not run.

**4. A lossless path — no.** FFmpeg adds no mode or setting; the decoder is LCEVCdec's, so the reach
table above is unchanged, and its 14-bit formats do not move the 14-bit result — that is the
residual arithmetic, not a missing format (*derived*).

**5. A browser path that returns samples — none found.** FFmpeg ships no WASM build. The best-known
one, ffmpeg.wasm (`main` `f876f90`), builds `ENV FFMPEG_VERSION=n5.1.4` — before 7.1, so before any
LCEVC code — and its Dockerfile names no LCEVC library. A WASM build with `--enable-liblcevc-dec`
would need LCEVCdec under emscripten, whose port is "not complete yet" (§Re-checked 2026-10-31, 3). Whether anyone
has built one is *unverified*.

**6. An encoder for the pre-registered trial — no; a second harness, maybe.** FFmpeg cannot make the
enhancement; the trial still needs patched LTM. What it could add (*derived*, not run): decode the
dav1d base and apply an LTM enhancement in one process, from an MP4 or TS with two tracks (or, from
`master`, a raw `.lcevc` file through `lcevc_merge`), returning 8–14-bit samples to compare. It is
LCEVCdec underneath, so it is **not** an independent third decoder for protocol step 4 — it tests
the carriage, not the arithmetic. The lab's FFmpeg is the distribution's 6.1.1, which has none of this.

**7. Licence — unchanged in kind.** `liblcevc_dec` sits in `configure`'s plain
`EXTERNAL_LIBRARY_LIST`, not the GPL or non-free lists, so an LGPL build may enable it; LCEVCdec's
BSD-3-Clause-Clear still grants no patents (§Why no trial; [`licensing.md`](../../../../docs/av1/licensing.md)).

### Verdict, 2026-11-02

FFmpeg changes the plumbing, not the conclusions: no encoder, no lossless mode, no browser path. It
gives the first **native** LCEVC decode that returns samples (8–14 bits, YUV and grey) with an AV1
base wired through dav1d — a convenience for the offline trial's decode side, not a product path.

## Lossy viewing, 2026-11-02

The owner opened lossy viewing on 2026-11-02: role-based quality profiles in which most users scroll
cine-like series (DBT slices, breast ultrasound cine, ABUS; ≤ 12 bits) as a visually lossless lossy
stream, the exact frame on request. The idea: an LCEVC enhancement over an AV1 base made at ingest,
one LCEVC decoder shipped to the client, fewer bytes and less decode for more ingest compute.
Exactness is no longer asked of LCEVC here, so the reach table above does not bear on it. Theory,
read 2026-11-02, nothing built or run. Each claim: a source with its words, or *derived*, or
*unverified*.

Sources added (SHA-256 of the copies read):

```
b5b8958aea5fa89eabf5c34ef6f3ea9ed47e36788bb67011c113357078db649c  MPEG white paper on LCEVC, SC 29/AG 3 N0058 (lcevc.org PDF)
78fd9eada65bdbafebb4071e8e77d4e05608417a1139029d41dadcd40b5b932b  Battista et al., "Verification Test of the LCEVC Standard", IEEE TCSVT 33(8), 2023, CC BY 4.0 (iris.univpm.it)
```

### 1. What it is, and where its gain comes from

The [white paper](https://www.lcevc.org/wp-content/uploads/Whitepaper-on-Low-Complexity-Enhancement-Video-Coding-LCEVC-MPEG-meeting-137-January-2022.pdf):

> LCEVC works by encoding a lower resolution (and potentially also lower bit depth) version of a
> source video using any existing codec (the "base codec") and then coding the differences between
> the lower resolution video and the full-resolution source, up to mathematically lossless coding if
> needed, using a different compression method (the "enhancement").

The enhancement's tools are few and small, by design: two sub-layers of residuals (L-1 at the base's
size, L-2 at full size after a normative four-tap upscale); "two different transforms. Both operate
with a small kernel of size 2×2 or 4×4", "chosen to have a small kernel to optimize the coding of
sparse residuals"; a linear quantiser with a dead zone; temporal prediction that "uses a
zero-motion vector prediction with a temporal buffer which stores residuals from the previous frame
only"; and entropy coding of "two components: a Run Length Encoder (RLE) and a Prefix Coding
encoder".

**The gain is the base codec's, moved to a quarter of the area.** The expensive codec spends its
tools — motion, large transforms, context-adaptive arithmetic coding — on a picture a quarter the
size, where it is efficient, and the enhancement adds back the detail an unguided upscale misses
with tools tuned for *sparse* residuals (*derived* from the two passages above). The published
numbers, all from the MPEG verification test (LTM 5.1, MOS by BT.500 DSIS on a 65″ TV, UHD and HD
natural video and game graphics, 8-bit for AVC, 10-bit otherwise) — the
[paper](https://doi.org/10.1109/TCSVT.2023.3237907):

| base | MOS BD-rate against the base alone at full size, UHD · HD |
| --- | --- |
| AVC (JM) | −46 % · −28 % |
| HEVC (HM) | −31 % · −24 % |
| EVC (ETM) | −18 % · −9 % |
| VVC (VTM) | −16 % · −14 % |

The gain shrinks as the base gets better, and on fidelity it reverses against the best base: "with
respect to a purely statistical metric like PSNR, LCEVC performs better on average … than the full
resolution AVC, while for the most advanced full resolution VVC it is true the contrary". The white
paper itself did not report the EVC and VVC MOS figures, "due to several test points having
overlapping confidence intervals". The test chose content for its high frequencies seen by "a
non-expert viewer"; no AV1 base was tested. AV1 sits between HEVC and VVC in coding efficiency
(*unverified* here, not re-read).

### 2. Noisy 10–12-bit grey at a visually lossless point — no gain expected (*derived*)

**Published medical or noisy-content results: none found** (searches for LCEVC with medical,
radiology, mammography, tomosynthesis, ultrasound, grey, monochrome, 12-bit, noise and grain, on
2026-10-31 and 2026-11-02). A commercial-encoder comparison against open encoders including
SVT-AV1 exists (Universidad Miguel Hernández, `hdl.handle.net/11000/39590`); its PDF refused the
fetch, so its numbers are *unverified* and not used.

What a visually lossless profile asks, on this project's series: the distortion must stay below the
sensor noise, which is σ = 8.8–18 (12-bit DBT) and 3.9–7.6 (10-bit DBT) at the median intensity
([`../../../../docs/codecs/README.md`](../../../../docs/codecs/README.md) §The bound). So the stream
must carry the noise, near-white and independent from slice to slice. *Derived* from §1:

* **The base cannot carry it.** A 2×2 downscale keeps about a quarter of white noise's power; the
  rest is detail at full size, which only sub-layer 2 can add. The noise is coded at full size
  either way, so LCEVC moves no bits from expensive to cheap tools — the move its gain rests on.
* **No transform gains on white noise**, so what is left between the two is coding efficiency on
  dense, non-sparse residuals: AV1's context-adaptive arithmetic coding against run-length plus
  prefix codes made for sparse ones. That favours AV1.
* **The base is extra.** Base plus sub-layers code 1¼ samples per pixel; at a high rate the base's own
  quantisation error comes back in the residual for L-1 and L-2 to repay.
* **The temporal tool predicts nothing of the noise**: zero motion, previous residuals only, and
  slice-to-slice noise independent.
* **This is the regime where the verification test already measured a loss** — fidelity against the
  best base.

So at equal fidelity on DBT, **base AV1 + LCEVC is expected at about 1.0× AV1 alone's bytes or
above; a gain like the 14–16 % against VVC is not expected**. Ultrasound cine is less noisy per
level once scan-converted to 8 bits and closer to the test's content, so its sign is least certain
(*derived*, *unverified*). Where the gain could return: a profile that windows to 8 bits before
coding — DBT's σ falls to about 0.5–1.1 of an 8-bit level over the full range (σ ÷ 16) — but that
loses the 12-bit window/level (§3).

**Decode.** The requirement was only that base plus enhancement be "comparable" to the base decoder
alone at full size (white paper, quoting MPEG's w18098); the white paper's conclusion claims a
"significant reduction of overall processing complexity". Natively, a quarter-area AV1 decode plus
prefix-code decoding and 2×2 transforms is plausibly cheaper than full-size AV1 at the same rate,
by an unmeasured factor (*derived*, *unverified*). In the browser it does not matter yet: no decoder
returns samples (§3).

### 3. The browser path, and window/level

The licensor's web decoder renders, it does not decode to samples. Its renderer
([`docs/dec/renderer.md`](https://raw.githubusercontent.com/v-novaltd/LCEVCdecJS/main/docs/dec/renderer.md),
`main` = `50e4f35`, unchanged since §Re-checked 2026-10-31):

> The video texture is converted to YUV. If there is a LoQ0 texture, we merge the video texture with
> the LoQ0 texture. Then it is upscaled horizontally and upscaled vertically […] The merged texture
> is converted back to RBG, so it can be displayed by WebGL on the canvas.

The base comes from a `<video>` element ("Only supported on browsers with Media Source Extensions
support", its README) as an 8-bit RGBA texture (`src/queue/queue.js`, pinned above). *Derived*:

* **Window/level on 10–12 bits is lost.** The viewer maps a window of the samples to 256 display
  levels. On 12-bit samples a window 200 wide keeps 200 levels; on this path's 8-bit output, mapped
  over the full 0–3213 range, the same window holds about 16 (200 ÷ 3214 × 256) — banding, the
  opposite of visually lossless. Measurement statistics and the frame digest go with the samples
  ([`../../../../docs/decode/hardware.md`](../../../../docs/decode/hardware.md) §2).
* **It survives only as a profile rule**: scroll at one window baked in at ingest, and any
  window/level change, measurement or zoom past the stream fetches the exact frame. Then the stream
  is a display path, not a diagnostic one, and AV1 alone serves that rule as well.
* **The base is ≤ 10 bits in a browser anyway**: WebCodecs refuses 12-bit AV1
  ([`../../../../docs/av1/README.md`](../../../../docs/av1/README.md) §Where AV1 stands); LCEVC may
  lift the depth, but this path flattens it to 8 again.

**A WASM build that returns samples: none found.** LCEVCdec's WASM wrapper still reads "The WASM port
of `enhancement` and `pixel_processing` functions is not complete yet" (4.3.1, the latest tag on
2026-11-02); `lcevc_dec.js` on npm is the same web decoder; FFmpeg's sample-returning decode (§Re-checked
2026-11-02) has no WASM build with LCEVC. *Unverified* that none exists privately. A samples path
would be this project's own: dav1d-WASM or WebCodecs for the base, and LCEVCdec's enhancement core
finished under emscripten, or written from a standard that is not freely available.

### 4. An encoder at ingest, and its cost

* **MPEG's LTM 5.5** — open (BSD, no patent grant), but no AV1 base without patch P1 of the protocol
  above, and it is a test model; its speed is *unverified*. Formats `y10`, `y12` are offered, its
  README says 8 or 10 bpp.
* **The licensor's SDK** — commercial, terms *unverified*. Its
  [overview](https://docs.v-nova.com/technologies/mpeg-5.lcevc/v-nova-lcevc/lcevc-sdk-overview.md)
  lists plug-ins including "AV1 (libaom)" and "SVT-AV1" and "LCEVC-enabled builds and patches for:
  … FFmpeg/FFplay"; grey and 12-bit input are not stated (*unverified*).
* **FFmpeg** decodes only (§Re-checked 2026-11-02).

**Cost: probably less ingest compute, not more** (*derived*): the AV1 encode runs on a quarter of the
pixels and the enhancement's tools are 2×2 and 4×4; the licensor claims up to 4× faster AV1 encoding
(marketing, *unverified*). The real ingest cost is a second representation beside the exact one,
which the profile keeps for "the exact frame on request" — that cost is the same for AV1 alone.

### 5. Licence

Unchanged in kind ([`../../../../docs/av1/licensing.md`](../../../../docs/av1/licensing.md)): the
code's BSD grants no patents; the licensor licenses its essential patents alone. Its
[Video Distribution programme](https://v-nova.com/licensing-lcevc-vdlp/), read 2026-11-02:

> A Video Distribution Service refers to any branded media & entertainment service that transmits
> video content to end users over networks (e.g., the internet), primarily for viewing by
> individuals or entities other than the content provider. This includes services offering
> entertainment, social media, news, education, advertising, and more.

Its waiver tier is $0 "Up to 1.14M" average monthly active video users, "Up to 114K" subscribers,
"Up to $5.7M" semi-annual video distribution revenues; "Each distinct branded service is treated as
a separate service". Whether a PACS — clinical images shown to the provider's own readers — is
"media & entertainment" is **unverified**; the text leans against it, and nothing says what licence a
service outside the definition needs. A hospital is far inside the $0 tier if it is covered
(*derived*), but a licence is still a contract to sign, and this repository is public under MIT:
shipping an LCEVC decoder ships the patented method to every user, licensed or not. The commercial
SDK, if used, is a second fee (*unverified*).

### 6. Expected against AV1 alone, at the same quality (*derived*, not measured)

| | DBT 10–12-bit, visually lossless at native depth | ultrasound cine, 8-bit |
| --- | --- | --- |
| bytes | ≈ 1.0× or more — the noise is coded at full size by the weaker coder | unknown sign; at most the test's 14–16 % against VVC-class bases |
| native decode | below 1.0× by an unmeasured factor | the same |
| browser decode with samples | **none possible** today | the same |
| browser display, 8-bit | possible, window baked in | possible |
| ingest compute | below AV1 alone's at full size | the same |

### Blockers, ranked

1. **Bytes on noisy grey (decides it).** If base AV1 + LCEVC is not clearly smaller than AV1 alone at
   equal fidelity on DBT, nothing else matters; the theory above expects it is not.
2. **No samples in the browser.** The only web decoder draws 8-bit RGB: 10–12-bit window/level,
   measurement and the frame digest are lost. Escapable by a profile rule (window baked in, exact
   frame on any change) or by building a samples-returning WASM enhancement decoder, which does not
   exist.
3. **Licence.** Patents royalty-bearing, one licensor, a PACS's coverage unverified; a public MIT
   repository cannot pass a grant on.
4. **Encoder.** LTM needs the AV1-base patch; the SDK is commercial, its grey and 12-bit support
   unverified.

**The single measurement that decides it:** base AV1 + LCEVC against AV1 alone, bytes at equal
fidelity on `dbt12_ea1141` and `dbt10_ea1141` at three distortions around the noise (RMS error σ/4,
σ/2, σ of the series' floor estimate, `lab/av1/floor`). At ≥ 0.90× the idea is closed; below, blocker
2 is next.

### Proposed queue rows (not queued; the owner's)

| name | what | after |
| --- | --- | --- |
| **LCEVCRATE** | Bytes at equal fidelity, offline: LTM 5.5 with patch P1 (a YUV base from a decoded AV1 file) over a libaom base at half width and height, against libaom alone at full size, on `dbt12_ea1141`, `dbt10_ea1141` and one plane of `us_liver`; RMS error σ/4, σ/2, σ and PSNR at native depth; predicted ≥ 1.0× on DBT. Mutate: a zero enhancement must lose fidelity, a doubled step width must cut bytes. Native decode time, interleaved, as a side number. Closes the idea at ≥ 0.90× | — |
| **LCEVCWASM** | Only if LCEVCRATE is below 0.90×: LCEVCdec's enhancement core under emscripten, returning samples at the base's depth over a dav1d-WASM base; equal to native LCEVCdec's output sample for sample, decode time against dav1d-WASM AV1 alone at LCEVCRATE's points | LCEVCRATE |

The licence question (blocker 3) is not a row: the owner asks the licensor whether a PACS is a Video
Distribution Service.

### Verdict, lossy viewing

**Not worth building on present evidence.** LCEVC's gain comes from moving bits to a quarter-area base
and coding sparse detail cheaply; a visually lossless DBT stream must carry dense full-size noise,
where the published test already shows LCEVC losing fidelity to the best base, and the only browser
decoder returns no samples, so 10–12-bit window/level is lost. One offline bytes measurement
(LCEVCRATE) decides it.
