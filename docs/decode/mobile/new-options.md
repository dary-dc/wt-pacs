# Decode on a phone's browser: options not on the list

*Queue row MOBILE-DECODE-OPTIONS, 2026-11-15, under amendment 20 of
`claude/work-ledger:docs/queue-client-2026-11-14.md`: the six options of the row's first brief each have a
MOBILE-OPT row and a file beside this one; this file proposes options **not** on that list, argued from what the
phone, the browser and the data allow. Theory and sources; nothing run on a device, a GPU or a coder. Every choice
stays the owner's.*

The question: **in a phone's browser, how can a series be shown fast enough, at full precision, with every frame
checked, and at what cost in bytes?**

Labels: **(S)** a source quoted, listed in §8 with its revision; **(R)** a result of this repository, by its file;
**(D)** derived here, the arithmetic written out; **(T)** theory, not measured. Fixtures behind every (R): three timed
DBT volumes of one dataset (`dbts_a1`, `dbts_b1`, `dbts_c1`), 19 DBT volumes for bytes and noise, no ultrasound cine;
4-core cloud hosts without a GPU; one phone (Chrome 157), one home link, one evening.

## 1. What it shows

* **A hardware frame can be checked after all, at 8 bits** (§3, T). The frame check needs samples whose XXH3-64
  equals the ingest's digest; it does not need the browser to *hand over* the decoder's samples. A hardware frame
  reaches the GPU as an 8-bit picture; for grey with constant chroma that picture is a function of the luma sample
  alone, and where that function is one-to-one the page inverts it, in a shader or after a read-back, and hashes the
  result. No specification has to define the conversion: the digest itself says whether the inversion gave the
  decoder's samples, per frame, and a frame that fails falls back to software. This turns "AV1 in hardware,
  unchecked" into a checked route on any engine that can draw a video frame into WebGL2, and it is not tied to AV1.
* **Past 8 bits through the same pipe** (§4, T): a second 8-bit picture carrying the first one's error. Two hardware
  decodes a frame; bytes unknown; it touches two 2026-11-09 decisions, so it is the owner's before it is a row.
* **A lossy HTJ2K view** (§5): the list's lossy options are all AV1. HTJ2K's lossy form is a DICOM transfer syntax,
  needs no depth cut, decodes in the decoder the client already ships for the exact frame, and is the published
  throughput design; its bytes against AV1's at equal coding error are unmeasured here.
* **Code only the content's rectangle** (§6): two of the repository's DBT fixtures were cropped to the breast at
  0.25 and 0.38 of their matrix (R, D). Every cost counted per sample (decode, hash, copy, memory, cache, the AV1
  level a hardware decoder must reach) scales with it, under every option on either list.
* **Three premises of the brief did not hold as written** (§2): that a converted picture cannot be checked; that a
  phone's hardware decoder takes a DBT frame at all (`dbts_b1` and `dbts_c1` need AV1 level 5.0, above the level
  the Android compatibility document asks of a hardware decoder); that the lossy view is AV1.
* Rows appended: **MOBILE-OPT-HW-INVERTED**, **MOBILE-OPT-HTJ2K-LOSSY**, **MOBILE-OPT-CONTENT-CROP** (§7). Named
  without a row, each with its reason: §6.1.

## 2. The brief's premises, questioned

| # | premise | verdict |
| --- | --- | --- |
| 1 | No shipped browser route returns a hardware-decoded frame's samples | **Held**, as `claude/hw10-routes:docs/decode/hardware-10bit.md` §9 reads the sources; not re-verified here. |
| 2 | A hardware frame reaches the page or the GPU as an 8-bit RGB image | **Held**, same file §5–§7; not re-verified here. |
| 3 | So a hardware frame cannot be checked ("A converted picture cannot be checked: no spec defines a browser's YUV-to-RGB conversion", same file §2) | **Did not hold.** True for a digest *predicted at ingest* over the converted picture. It does not follow for a conversion inverted on the device and confirmed by the existing digest (§3). |
| 4 | The decode is the phone's bound | **Held, narrowly** (R, `claude/work-ledger:docs/queue/FILL-SPLIT.md`): 133–135 ms a frame on `dbts_b1-q8-g8`, 0.76–0.94 of every fill; the decoder Chrome took was not recorded and the decoder count not varied. |
| 5 | A phone with a hardware AV1 decoder can decode these frames in it | **Unchecked, and not implied by the platform's minimum** (§2.1). |
| 6 | The lossy view is AV1 | **A choice, not a constraint.** The view's contract is a visually lossless picture, checked, decodable everywhere (`docs/av1/payload-format.md` §Optimal quality); §5. |
| 7 | The picture decoded is the stored matrix | **A choice.** §6. |

Premise 4 per sample (D): 135 ms ÷ (2560 × 3328 = 8 519 680 samples) = 15.8 ns a sample, one decoder.

### 2.1 Premise 5: the frame's size against the AV1 levels

The AV1 specification's level table (S1, Annex A.3) gives, per level, `MaxPicSize`, `MaxHSize`, `MaxVSize`: in the
rows of levels 4.0 and 4.1 "2359296", "6144", "3456", and of levels 5.0 to 5.3 "8912896", "8192", "4352". "A level X.Y compliant decoder must
be able to decode all bitstreams (that can be decoded by the general decoding process) that conform to that level."

| series (`docs/FIXTURES.md`) | samples (D) | level 4.x, ≤ 2 359 296 | level 5.x, ≤ 8 912 896 |
| --- | --- | --- | --- |
| `dbts_a1`, 1142 × 1785 | 2 038 470 | fits | fits |
| `dbts_c1`, 976 × 2513 | 2 452 688 | **no** | fits |
| `dbts_b1`, 2560 × 3328 | 8 519 680 | **no** | fits, with 4.4 % to spare |

What Android asks of a hardware AV1 decoder (S5): §5.3.9, "[C-2-2] MUST be able to decode at least HD 1080p video
decoding profiles from the table below when the height reported by Display.getSupportedModes() method is equal or
greater than 1080p."; and, for a handheld that declares the media performance class `VERSION_CODES.V` (§2.2.7.1), "[5.1/H-1-14] MUST support AV1 hardware decoder Main
10, Level 4.1 with film grain effect over GPU composition." Neither reaches level 5.0. So whether a given phone's
hardware decoder accepts `dbts_b1` or `dbts_c1` is the vendor's choice and a device fact; a page learns it only by
configuring and decoding (D). It binds MOBILE-OPT-AV1-HW-UNCHECKED as much as §3; the ask is in §7.

If a level 5.1 decoder is there, the level's `MaxDecodeRate` (S1: 5.1, "547,430,400" samples a second) bounds what
it must sustain: 547 430 400 ÷ 8 519 680 = 64 frames of `dbts_b1` a second (D, T: a conformance bound, not a
measurement), against 1 ÷ 0.135 s = 7.4 a second for one software decoder on the phone (R).

## 3. A hardware frame, inverted to its samples and checked

**The argument.** Amendment 1 asks that "the decoder's exact output samples reach an XXH3". The digest is over the
luma samples; any procedure whose output hashes to it has produced those samples, up to a 64-bit collision. So the
route is free to be unspecified, device-specific and occasionally wrong, provided a wrong frame fails its check and
is decoded again in software, which is what the client already does on a refusal.

**The steps** (T, each to be sourced and measured by its row):

1. *The stream*: 8-bit 4:2:0, both chroma planes constant 128 (the GREY420 form of `docs/av1/payload-format.md`
   §8-bit grey as 4:2:0; +0.01–0.12 % bytes, R, DEPTH8-MEASURE P5, which also measured the decoded chroma at 128).
   AV1 decoding is exact: "decoders shall produce output frames that are identical in all respects and have the same
   output order as those produced by the decoding process specified herein" (S1, §7.2, film grain off). So the
   ingest's digest over the 8-bit luma plane is the digest of any conformant decoder's output, hardware included.
2. *The picture*: `texImage2D` takes a `VideoFrame` (S3: "source of type HTMLVideoElement or VideoFrame[WEBCODECS]";
   S2 §9.4: "VideoFrame is a CanvasImageSource"). With chroma at its neutral value every colour matrix gives
   R = G = B, a function of luma alone: H.273's luma is "E′Y = KR * E′R + ( 1 − KR − KB ) * E′G + KB * E′B" (S4,
   eq. 45), whose three weights sum to 1, so equal E′R, E′G, E′B give E′Y equal to them, and conversely (D).
3. *The inverse*: read the picture's red channel through a 256-entry table measured on the device (§3.2), giving
   the luma sample back.
4. *The check*: XXH3-64 over the recovered plane, against the ingest's digest. Either after a read-back
   (`readPixels`: "Only two combinations of format and type are accepted. The first is format RGBA and type
   UNSIGNED_BYTE", S3) of a pass that packs four samples a texel, or on the GPU
   (`claude/hw10-routes:docs/decode/hardware-10bit.md` §5.4 derives XXH3-64 in WGSL), reading back eight bytes.
5. *The paint*: from the same texture through the inverse table and the window table, as today's paint from
   samples; `valueAt` reads the recovered sample. Nothing downstream of the check sees a converted value.

### 3.1 When the conversion is one-to-one

H.273 (S4, §8.3) quantises luma, with `VideoFullRangeFlag` 0, as "Y = Clip1Y( Round( ( 1 << ( BitDepthY − 8 ) ) *
( 219 * E′Y + 16 ) ) )" (eq. 30) and, with the flag 1, as "Y = Clip1Y( Round( ( ( 1 << BitDepthY ) − 1 ) * E′Y ) )"
(eq. 36). AV1 carries the flag as `color_range` (S1, §6.4.2: "color range equal to 0 shall be referred to as the
studio swing representation and color range equal to 1 shall be referred to as the full swing representation") and
adds: "this specification does not enforce the range when signaled as Studio swing. Therefore the application
should perform additional clamping and color conversion operations according to the specified range."

A converter that undoes these to an 8-bit full-range picture computes, ideally (D):

```
studio swing:  p = 255 × (Y − 16) ÷ 219, for Y in 16 … 235      step 255 ÷ 219 = 1.1644 a sample
full swing:    p = Y, for Y in 0 … 255                          step 1
```

* Studio swing, Y in 16…235: consecutive samples are 1.1644 apart. Two reals more than 1 apart round to different
  integers (if y − x > 1 then round(x) ≤ x + ½ < y − ½ ≤ round(y)), and floor likewise. So any converter that is
  the ideal one followed by one rounding is one-to-one on those **220** samples; a fixed-point one is one-to-one
  whenever it is strictly increasing (D). Samples under 16 or over 235 clamp and are lost.
* Full swing: one-to-one on all 256 only if the converter is exactly the identity; a converter that ignores the
  flag and stretches is still one-to-one on 16…235 and loses the rest (D).
* So **a stream whose decoded luma stays within 16…235 is invertible under either reading of the flag** (D). The
  ingest already decodes every frame it writes (`docs/av1/payload-format.md` §Optimal quality, *Checked at
  ingest*); it would also hold each decoded frame's minimum and maximum inside 16…235, leaving headroom for the
  coding error's overshoot, or code again.
* The cost is depth: 220 levels, log2 220 = 7.78 bits. A 10-bit source cut to 220 levels has a step of
  1024 ÷ 220 = 4.65 source units, rounding RMS 4.65 ÷ √12 = 1.34; a 12-bit one 4096 ÷ 220 = 18.6, RMS 5.37 (D).
  DEPTH8-THEORY's cut to 256 levels gave 1.12 and 4.61 (R), under the noise on every volume; 220 is 16 % coarser.
  Bytes at 256 levels: 1.14–1.86× today's view at the highest Q under the noise bar (R, DEPTH8-MEASURE P4); at 220
  unmeasured.

What can break the one-to-one map, and what removes each (T; the row sources each per engine):

* *A transfer or gamut conversion after the matrix.* WebGL has a switch (S3, `UNPACK_COLORSPACE_CONVERSION_WEBGL`):
  "If set to NONE, no colorspace conversion is applied, other than conversion to RGBA. (For example, a rec709 YUV
  video is still converted to rec709 RGB data, but not then converted to e.g. srgb RGB data)"; the default "is
  applied during subsequent texture data upload calls" and "The precise conversions may be specific to both the
  browser and file type." The page can also state the frame's colour space itself: `VideoDecoderConfig.colorSpace`,
  "If colorSpace exists, the provided values will override any in-band values from the bitsream" (S2, §7.6, the
  typo is the draft's).
* *Scaling or filtering*: the texture at the coded size, sampled at texel centres.
* *Dither or a vendor's picture enhancement in the decoder's output path*: not removable by the page; the check
  catches it, the route is then off on that device.
* *Chroma not exactly 128 after decoding*: held at ingest, as luma's range is.

### 3.2 The table, measured on the device

One calibration unit, coded at ingest and bundled with the client: a picture holding every sample 16…235 in known
positions, its digest known. Decoded through the hardware route once a session, read back, it gives the table
(picture value → sample) and proves it one-to-one on that device, browser and decoder, or the route is not used.
Calibration is a convenience, not the safeguard: every frame is still checked against its own digest (§3, step 4).

### 3.3 What it costs and what is unknown

| | today's software view (R) | this route (T) |
| --- | --- | --- |
| decode a frame, `dbts_b1` | 133–135 ms, one decoder, the phone | hardware; **unknown**; ≤ 64 frames/s by level 5.1's bound, if the decoder is there (§2.1) |
| bytes hashed a frame | 2 × 8 519 680 = 17 039 360 | 8 519 680 |
| bytes read back a frame | the `copyTo` of 17 MB | 8.5 MB packed four samples a texel, or 8 bytes with the hash on the GPU |
| precision | 10 bits | 7.78 bits (220 levels), §3.1 |
| checked | yes | yes, the same digest definition at 8 bits |
| bytes | the view's | 1.14–1.86× at 256 levels (R); 220 unmeasured |
| engines | Chromium's 10-bit WebCodecs, dav1d-WASM elsewhere | any that draws a hardware `VideoFrame` or `<video>` frame into WebGL2 (T) |

Unknown, and only a phone answers: whether the decoder is there and takes the size (§2.1); whether the map is
one-to-one on it; the read-back's time for 8.5 MB (`readPixels` "is a blocking operation … In multi-process WebGL
implementations, it also incurs an expensive inter-process round-trip", S3, WebGL 2 *Reading back pixels*, which
points to a `PIXEL_PACK_BUFFER` read instead); how many frames the decoder lends before it stalls (MOBILE-OPT-AV1-HW-UNCHECKED's
question, shared).

**It is not tied to AV1** (T). The inversion needs a decoder whose output is specified exactly and a picture that
is a one-to-one function of luma. HEVC, VP9 and H.264 at 8 bits meet the second by the same arithmetic; whether
each specification fixes its decoder's output exactly is for MOBILE-OPT-OTHER-CODECS to quote, whose "whether any
route returns samples" this changes: at 8 bits, every route that draws does.

## 4. Past 8 bits through an 8-bit picture: a second picture

(T throughout; no coder run.) The first picture A is the view cut to 220 levels and coded coarsely; its decoded
reconstruction r_A is known at ingest exactly (§3, step 1). The second picture B codes what A missed, in source
units, offset into 16…235:

```
b = clamp(v − centre(r_A) + 126, 16, 235)          v the source sample, centre(c) the source value code c stands for
shown = centre(r_A) + r_B − 126                    r_B the decoded B
```

The shown value's error is B's coding error alone, in source units, so its precision is the source's and its
quality is set by B's quantizer, wherever |v − centre(r_A)| ≤ 109: A's own error may reach 109 ÷ 4.65 = 23 of its
levels before B clamps (D). Each picture is checked by §3; the sum is formed in the paint's shader.

* Decode: two hardware frames a shown frame, so half §2.1's bound, 32 a second at level 5.1 (D, T). Side by side in
  one picture does not fit: 5120 × 3328 = 17 039 360 samples exceeds level 5's 8 912 896 (D, S1).
* Bytes: **unknown**. B is A's coding error plus the detail under A's step, close to noise; a layered coding
  ordinarily costs more than one stream at the same quality. One cloud cell measures it: A and B by libaom on the 19
  volumes at the noise rule's bar, against today's 10-bit view.
* **It touches two decisions** of 2026-11-09 (`docs/client/design.md` §Decided): "the residual dropped" and "a split
  into top and low streams discarded". Those were a residual to exactness and a split of the source's bits; this is
  neither exact nor a bit split, but it is a second stream per series all the same. So it has no row: it is a
  section of MOBILE-OPT-HW-INVERTED's brief, to be worked out only as theory and one byte cell, and the owner's to
  open.

## 5. A lossy HTJ2K view

**The argument.** Hardware aside, the view is decoded in software, and the list's software options are AV1 (lossy,
135 ms a frame on the phone) and HTJ2K lossless (bytes 4.6–14× the view's). The cell between them is empty: the
same throughput codec, lossy.

* *It is a standard form, and DICOM's.* PS3.5 (S6, §8.2.14): "Annex A defines three Transfer Syntaxes that
  reference the HTJ2K Standard and provide one lossy compression scheme, and two lossless compression schemes";
  its Table 8.2.14-1 lists "HTJ2K | 1.2.840.10008.1.2.4.203" for MONOCHROME1 and MONOCHROME2 with Bits Stored
  "1-38". So no depth cut for D > 10, and a PCS can produce and store the view as DICOM.
* *One decoder.* OpenJPH, which the client ships for the exact frame, codes and decodes it: "for wavelet
  transform, only reversible 5/3 and irreversible 9/7 are supported" (S7, README); its lossy path is the
  irreversible one, `-qstep` in its example, since "In reversible compression, quantization is not supported" (S7,
  `docs/usage_examples.md`). No WebCodecs probe, no engine differences in the decoder, no decoder lost by a hidden
  page (`docs/client/evidence/hidden-page-decode.md`), the resolution levels and strips of `claude/htj2k-tiles:docs/htj2k-tiles.md`
  available to the view as to the exact series.
* *Decode time* (published, a desktop, not a phone): the HTJ2K authors' white paper (S8, §7, Table 9: "4K, 4:4:4
  12b/channel video, irreversible 9/7 DWT with MSE(PSNR)-based rate allocation, with 64x64 code-blocks. Throughputs
  are measured on a 4-core Intel i7-6700 CPU") gives HT decoding at "117", "112" and "91" frames a second at 1, 2
  and 4 bits a sample, by Kakadu on eight threads. So a lossy stream at a quarter of the rate decodes in 91 ÷ 117 =
  0.78 of the time: the transform's cost does not shrink with the bytes (D). Here (R, `docs/client/evidence/decode-speed-of-the-optimal-quality-picture.md`) the
  AV1 view at Q 8 decodes in 1.24–1.74 lossless HTJ2K frames in the cloud; if the white paper's ratio carried to
  OpenJPH-WASM, a lossy HTJ2K view would decode in 1 ÷ 0.78 × (1.24–1.74) = 1.6–2.2 of its own frames in the time of
  one AV1 frame (T; two builds, two machines, neither a phone). HTJ2K's decode on the phone is unmeasured; it is the
  next phone round's first cell.
* *Bytes*: **unknown here**, and the deciding number. `dbts_b1`'s exact frame is 107 410 134 B ÷ 50 = 2 148 203 B,
  2.02 bits a sample; its Q 8 G 8 view about 464 KB, 0.44 bits a sample (R; D). A lossy HTJ2K picture at the same
  coding error lies between; where is one cloud cell: `ojph_compress -reversible false -qstep` swept on the 19
  volumes, the coding error measured as `lab/av1/metrics` measures the view's, bytes at the noise rule's bar.
* *Checked*: the digest is over decoded samples, so the decoder must give the same samples on every device. The
  irreversible path computes in floating point; whether one WASM build does so identically on every engine, or the
  view must use the reversible transform with its code-block passes cut, the row sources and tests (T).
* *What it gives up*: inter prediction (measured small at Q 8 here: G 16 against G 1 is ±1.2 % bytes, R,
  `docs/av1/payload-format.md` §Optimal quality) and any hardware route of §3.

## 6. Code only the content's rectangle

A stored DBT frame is the detector's matrix; the breast fills part of it. Two fixtures were stored cropped (R,
`docs/FIXTURES.md`): `dbt10_ea1141`, "678×1727 of 1890×2457", 1 170 906 of 4 643 730 samples, **0.25**; `dbt10_d`,
"757×2336 of 1890×2457", 1 768 352 of 4 643 730, **0.38** (D). The three timed volumes are "whole and uncropped".

* *What scales with the rectangle* (D): the samples hashed, copied, uploaded, held in memory and written to the
  cache, all in proportion; the AV1 level (a `dbts_b1` rectangle under 0.277 of its matrix, 2 359 296 ÷ 8 519 680,
  fits level 4.x, §2.1); the decode by less than proportion, because flat background is already cheap to decode
  (skipped blocks in AV1, empty code-blocks in HTJ2K) — how much less is one cloud cell (T).
* *The form*: the view coded from the rectangle, its offset and the matrix's size in the metadata; the paint places
  it and fills the rest with the series' background value; coordinates, `valueAt` and measurements stay in the
  matrix's frame. The exact series is untouched, so *Lossless* still brings the whole frame.
* *The hazard*: what lies outside the rectangle is not shown in the view. A burned-in marker or an implant's edge
  outside the breast's box must stay inside the rectangle, so the box is of everything that is not background, with
  a margin, and a frame with no safe box is coded whole. The ACR's display note quoted in
  `docs/adr/exactness-in-production.md` (§8, "prior application of irreversible compression ratio, processing, or
  cropping") names cropping as a thing a display states: a labelling question for the owner.
* It multiplies with every option on either list and competes with none.

### 6.1 Named, without a row

* **Decode at the screen's size.** A phone shows fewer samples than `dbts_b1` holds, so a screen-sized picture
  cuts every per-sample cost. Not new: HTJ2K at the viewport's level is `claude/htj2k-tiles:docs/htj2k-tiles.md` §Screen resolution
  (withdrawn for the scroll on bytes over a link, HTJ2K-VERDICT; kept as the level picture D+L★), an AV1 half-size
  base was measured (`docs/av1/README.md`, the two-layer scalable measurement), and "no low-resolution preview" is
  decided. Those judged bytes and waits on links; none judged the phone's decode. A point for MOBILE-DECODE-COMPARE
  to carry, not a row.
* **Hardware paints first, software confirms.** A hardware frame shown at once as unchecked, replaced by the
  checked software frame when it lands. A composition of two listed options, for MOBILE-DECODE-COMPARE; §3 makes it
  unnecessary at 8 bits.
* **The web client in a shell with a native decoder** (a WebView page calling MediaCodec, the first route of
  `claude/hw10-routes:docs/decode/hardware-10bit.md` §9). Not a browser, and amendment 19 puts the web first; one
  line in NATIVE-NOTES' *how to resume* would hold it.
* **The server renders** (a windowed 8-bit video, the window sent back on every change). The phone decodes video
  well, but the samples never reach it: no check, no local window, a round trip per interaction, and a server
  change the product statement excludes.
* **AV1 with its reconstruction on the GPU** (entropy decoding in WASM, prediction, transforms and filters in
  WebGPU compute). A variant of MOBILE-OPT-GPU-COMPUTE; its brief gets one line.
* **A checked stream and an attested decoder** (hash the coded bytes, prove the decoder once a session on known
  units). Cheaper than hashing every frame's samples, but weaker than amendment 1's wording; §3 meets the wording
  instead.

## 7. Rows, asks, a leaning

**Rows appended** to `claude/work-ledger:docs/queue-client-2026-11-14.md`, each a MOBILE-OPT row by amendment 20:

| row | file | what it must settle |
| --- | --- | --- |
| MOBILE-OPT-HW-INVERTED | `hw-inverted.md` | §3 per engine from sources (the upload's conversion, the switch, the read-back), the 16…235 form's bytes and noise, the calibration unit, §4 as theory and one byte cell |
| MOBILE-OPT-HTJ2K-LOSSY | `htj2k-lossy.md` | bytes at equal coding error on the 19 volumes, decode against the lossless frame and the AV1 view in the cloud, exactness across engines |
| MOBILE-OPT-CONTENT-CROP | `content-crop.md` | the content rectangle's share on the 19 volumes, the decode's share of it, the hazard's rule |

**Asks for the next phone round**, one line each in `claude/phone-protocol:docs/phone-rows/next-round.md`:

1. For each of `dbts_a1`, `dbts_b1`, `dbts_c1` as an 8-bit 4:2:0 constant-chroma unit: does `prefer-hardware`
   configure and decode it, at which coded size does it stop (§2.1).
2. The calibration unit through the hardware route into WebGL2 with the colour-space switch at NONE: the 220
   picture values read back; one-to-one or not (§3.2).
3. One hardware frame recovered and hashed against its digest; the read-back's and the hash's time (§3.3).

**What the sources decide alone.** That exact decoding makes an ingest digest valid for hardware (S1); that the
ideal studio-swing conversion is one-to-one on 16…235 and why (S4, D); that the platform's minimum does not promise
a decoder for `dbts_b1` or `dbts_c1` (S1, S5); that lossy HTJ2K is a DICOM form with no depth cut (S6). **What they
do not:** anything about a real converter, a real decoder's size limit, any time on a phone, any byte count for
§3 at 220 levels, §4 or §5.

**A leaning, labelled as one.** §6 first, because it costs an ingest change and helps whatever else is chosen.
Then §5 and §3 answer different failures of today's view: §5 if the phone's HTJ2K cell shows software HTJ2K well
ahead of software AV1 and the byte cell is tolerable, since it keeps full depth, one decoder and every engine; §3
if the three asks pass on the phone, since only hardware changes the decode by an order, at the price of 7.78 bits
and 1.14–1.86× bytes. §4 only if the owner reopens a second stream.

## 8. Sources

Fetched 2026-11-15. Section numbers are the documents' own.

* **S1** AV1 Bitstream & Decoding Process Specification, the AOMedia working document at
  <https://aomediacodec.github.io/av1-spec/>, "Last modified: 2023-05-25 12:27 PT": §6.4.2 *Color config
  semantics*, §7.2 *General decoding process*, Annex A.3 *Levels*.
* **S2** WebCodecs, W3C Working Draft, 9 November 2026, <https://www.w3.org/TR/2026/WD-webcodecs-20261109/>: §7.6
  *VideoDecoderConfig*, §9.4 *VideoFrame Interface*.
* **S3** WebGL Specification, Editor's Draft, and WebGL 2.0 Specification, Editor's Draft,
  `KhronosGroup/WebGL` at `39443210f7f8`, `specs/latest/1.0/index.html` (*Texture objects*, *Pixel Storage
  Parameters*, *Reading back pixels*) and `specs/latest/2.0/index.html` (*Reading back pixels*):
  <https://github.com/KhronosGroup/WebGL/tree/39443210f7f8/specs/latest>. The drafts' section numbers were not in the
  text read; the headings are named instead.
* **S4** Recommendation ITU-T H.273 (V4) (07/2024), *Coding-independent code points for video signal type
  identification*, §8.3, equations 30, 36 and 45: <https://www.itu.int/rec/T-REC-H.273-202407-I>.
* **S5** Android 16 Compatibility Definition, "Last updated: December 2, 2025",
  <https://source.android.com/docs/compatibility/16/android-16-cdd>: §5.3.9 *AV1*, and §2.2.7.1 *Media*, item
  [5.1/H-1-14].
* **S6** DICOM PS3.5 2026d, §8.2.14 *High-Throughput JPEG 2000 Image Compression* and Table 8.2.14-1:
  <https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_8.2.14.html> (read as *current*, which
  named itself 2026d).
* **S7** OpenJPH, `aous72/OpenJPH` at `97a9579aed20`: `README.md`, `docs/usage_examples.md`.
* **S8** D. Taubman, A. Naman, R. Mathew, M. Smith, O. Watanabe, P.-A. Lemieux, *High Throughput JPEG 2000
  (HTJ2K): Algorithm, Performance and Potential*, "Last updated: 29 May 2020", §7, Tables 8 and 9:
  <https://htj2k.com/wp-content/uploads/white-paper.pdf>.
