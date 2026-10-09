# The bit split against the literature (row 48 SPLITLIT)

Every AV1 layout over 8 bits here splits a sample v (after the series' offset, −min) into top = v ≫ k and
low = v & (2^k − 1), each a lossless stream ([`payload-format.md`](payload-format.md) §Representation). The lab reached it
by measurement alone (rows 7, 13, 28, 33, 36). This file asks whether the literature knows it, recommends it, or
offers something better. Web research only, 2026-10-05, no measurement. Each claim cites its source with the
source's date. **Unconfirmed** marks a claim that rests on a search summary or secondary text, where the primary
source was not read.

## 1. Prior art: the split is old, and no standard recommends it

**No standard or DICOM document recommends an MSB/LSB split.** DICOM's video transfer syntaxes stop at 8 and 10
bits stored (Sup 195, HEVC, final text 2016-11-08). For deeper samples it offers native-depth lossless codecs
(§2), not a split. No WG-04 material proposing one was found. Standards carry extra bits as *layers*: SHVC
bit-depth scalability and JPEG XT's residual layer (§2). Neither is a bare bit split.

**The split is published practice in research and in patents:**

| domain | source | what it reports |
| --- | --- | --- |
| aerospace video, 14 bits | Ho, George, Gordon-Ross, "Improving Compression Ratios for High Bit-Depth Grayscale Video Formats", IEEE Aerospace Conf. 2016 | "Bit-stream splitting": upper and lower byte as two videos. **Lossless x264 on the halves reaches a ratio of 2.82, against 1.62 for native 16-bit FFV1** and 1.63 for lossless JPEG 2000. Their build had no working high-bit-depth x265 or VP9. |
| infrared, 16 bits | Belyaev, Mantel, Forchhammer, Proc. SPIE 10403, 2017-08, doi:10.1117/12.2275542 | MSB and LSB byte images, each through JPEG or H.264. "Two 8 bit H.264/AVC codecs can achieve similar result as 16 bit HEVC". Lossy rate–distortion; the full paper was not read. |
| CT, 16 bits | Wang, Bai, Li, Zhai, Jiang, Liu, "Learning Lossless Compression for High Bit-Depth Volumetric Medical Image" (BD-LVIC), arXiv:2410.17814, 2024-10-23 | ⌊X/2^d⌋ and X mod 2^d at d = 8. **The low byte costs 5.0–6.8 bits a voxel and the high byte 0.3–0.6**, through JPEG XL and JPEG-LS, so the low part is 88–94 % of the total. The cost over d = 6…12 is U-shaped. Joint coding of the halves beats separate coding by 3.6 % (5.04 against 5.23 bits a voxel). Its learned codec is 11.7 % under JPEG XL on one CT set. |
| CT, 16 bits | the same group, "Learning Lossless Compression for High Bit-Depth Medical Imaging", ICME 2023 | The MSB image goes through a standard codec, the LSB image through a model conditioned on it. No numbers in the abstract. |
| medical, 16 bits | Li et al., "An optimized JPEG-XT-based algorithm for the lossy and lossless compression of 16-bit depth medical image", Biomed. Signal Process. Control 64:102306, 2021, doi:10.1016/j.bspc.2020.102306 | Upper and lower 8-bit sub-images, reaching lossless. The lower one is ">90 %" of the file. **Unconfirmed:** from a search snippet only. |
| depth video, 12 bits | Liu et al., "Hybrid Lossless-Lossy Compression for Real-Time Depth-Sensor Streams in 3D Telepresence", PCM 2015 | The top 2 bits are run-length coded losslessly and the low 10 go through 10-bit x264. "The lower bits of the depth pixels tend to contain noise". |
| depth video, 16 bits | Miao, Fu, Lu, Li, Chen, "Layered Compression for High-Precision Depth Data", IEEE TIP 24(12), 2015-12, doi:10.1109/TIP.2015.2481324 | MSB layer error-bounded, LSB layer through an 8-bit codec. Not lossless. |
| depth video, lossy | Pece, Kautz, Weyrich, "Adapting Standard Video Codecs for Depth Streaming", EGVE-JVRC 2011-09 | **Naive MSB/LSB multiplexing "creates severe artefacts" under lossy VP8 and H.264**. The paper's triangle-wave encoding is the lossy alternative. Wilson, ACM ISS 2017, doi:10.1145/3132272.3134144, says the same and codes depth losslessly without a video codec (RVL). |

**Patents.** Granted patents on the idea date from a 2006 priority. Status is as Google Patents lists it on
2026-10-05; legal status was not verified.

| patent | priority | status | claim |
| --- | --- | --- | --- |
| US7983500B2 | 2006-02-08 | expired | Lossless coding of > 8-bit pixels: the low 8 bits by DPCM and Huffman coding, the upper bits by run-length coding. |
| US8275208B2 | 2008-07-02 | listed active to 2031-04-26 | The top bits as bit planes in JBIG (lossless), the low bits with H.264 prediction. Its rationale is that the low bits are random. |
| US20150010068A1 | 2013-07-05 | abandoned | 16-bit samples (medical named) split into 8 MSB and 8 LSB, packed into an HEVC picture's luma and chroma. The closest to this design. |
| US9467681B2 | 2013-03-25 | listed active to 2034-12-03 | The depth counterpart of Miao et al.: the MSB layer lossless or error-bounded, the LSB layer lossy. |
| US10419781B2 | 2016-09-20 | listed active to 2037-06-04 | MSBs of residuals compressed losslessly; LSBs stored raw, "significantly" less correlated. |
| US10382769B2 | 2016-02-15 | listed active to 2037-09-02 | Depth streams: histogram compaction, a median predictor, and Golomb coding per bit plane with remainder bits verbatim. |

What the lab built differs from these claims in one respect. Both halves go through one standard lossless codec,
each as its own stream, with the split point set per series. Whether any active claim reads on that is a
question for counsel. This file does not answer it.

**What the sources report on cost and benefit.**

* The low part is noise and costs nearly its full width. This is BD-LVIC's 5.0–6.8 of 8 bits, and the
  "noise" remarks in Liu et al. and US8275208B2.
* Against a native-depth codec, the split wins where the alternative is weak: x264 lossless halves against FFV1.
  It roughly ties where the alternative is a modern 16-bit codec (Belyaev et al., lossy).
* Joint coding of the halves is worth about 3.6 % over separate coding (BD-LVIC). That is a learned codec at d = 8,
  where the low byte still carries structure.

## 2. Alternatives for 13–16-bit samples, and their browser decode today

No browser's native image or video path hands back 13–16-bit samples exactly. WebCodecs' `VideoPixelFormat`
stops at 12 bits and has no 4:0:0 format (W3C editor's draft, 2026-09-21). A canvas returns 8-bit or, from
Chrome 137, `rgba-float16` (MDN, `ImageData.pixelFormat`). float16 holds 11 significant bits, so it is not exact
over 11 bits (inference from the format). **Every exact path over 12 bits is WASM into typed arrays.**

| codec | lossless depth | DICOM | browser path today |
| --- | --- | --- | --- |
| **HTJ2K** (ISO/IEC 15444-15) | to 38 bits | Sup 235, final text 2023-11-14: `1.2.840.10008.1.2.4.201`–`.205` | none native; OpenJPH in WASM (BSD-2-Clause, the product's decoder) |
| JPEG 2000 Part 1 | to 38 bits | Sup 61 (2001): `.90`, `.91` | Safari dropped it in 18 (caniuse); OpenJPEG in WASM |
| **JPEG-LS** (ISO/IEC 14495-1) | 2–16 bits | `.80`, `.81` (PS3.6 2026d) | none native; CharLS in WASM (BSD-3-Clause) |
| **JPEG XL** (ISO/IEC 18181) | integer to 31 bits; libjxl to 24; Main profile Level 5 bounded by 16-bit buffers (arXiv:2506.05987, 2025-06) | Sup 232, final text 2024-09-18: `.110` lossless, bits stored 1–24 | Safari 17+ (stills). Chrome re-added it in 145 (2026-02) behind a flag, still flagged in 154 (2026-09-22); intent to ship 2026-08-24, no milestone. Firefox 152 (2026-06-16) built it in off by default; intent to ship moved to 158. Every native path draws through a canvas (8-bit or float16), so none is exact over 11 bits. WASM: jxl-oxide (MIT/Apache-2.0); whether its output keeps 16 bits is **unconfirmed** |
| HEVC RExt (H.265 V11, 2026-01) | Monochrome 16 and Main 4:4:4 16 Intra, lossless by `cu_transquant_bypass` | only Main and Main 10 (Sup 195) | browsers at most 12-bit, hardware-dependent; FFmpeg's decoder has no 16-bit format (`libavcodec/hevc/ps.c`) |
| VVC (H.266 v2, 2022-04) | Main 16 4:4:4 (Intra); 4:0:0 allowed | none | none native; vvdec's WASM build is Main 10 only. The profiles were read from patent text quoting the spec: **unconfirmed** against the ITU text |
| AV1 | 12 bits (Professional) | none | WebCodecs to 10 bits here (row 3: 12-bit refused); dav1d-WASM to 12 |
| AV2 v1.0.0 (2026-06-09) | **10 bits** (`bit_depth_idc` > 1 reserved; profiles Main_4xx_10); a 12-bit professional profile "in development"; nothing over 12 announced | none | no decoder ready (row 32: AVM likewise) |

**Scalable and layered schemes.**

* **SHVC** (H.265 Annex H) lets an enhancement layer be deeper than its base. Scalable Monochrome 12 and 16 are
  defined, and an external base layer is allowed. Transquant bypass is not excluded in Table H.3, so a
  lossless enhancement layer looks legal. That is an inference: no implementation or paper confirms it
  (**unconfirmed in practice**). Heindel, Wige, Kaup (IEEE TCSVT 27(8), 2017, doi:10.1109/TCSVT.2016.2556338)
  measure a lossy HEVC base with a lossless residual enhancement: −7.3 % against single-layer lossless, SHVC
  −3.9 %.
* **AV1 and AV2 have no bit-depth scalability.** AV1 has one `color_config` for every operating point. In AV2,
  an extended layer's `lcr_bit_depth_idc` "shall equal" the base's.
* **JPEG XT** (ISO/IEC 18477-6, -8; Part 8 2nd ed. 2020-05) is an 8-bit legacy JPEG base plus a residual layer.
  It is lossless for 16-bit input per its reference implementation (GPL-3.0). It has no DICOM transfer syntax,
  and a browser decodes only the base.
* **MPEG-5 LCEVC** has an enhancement up to 14 bits and no lossless mode confirmed. Row 19 found it not exact at
  14 bits.
* **Lossy base plus lossless residual.** Yea and Pearlman, IEEE TIP 2006, is the two-stage near-lossless coder,
  motivated by medical data. HTJ2K's own reversible codestream is lossy-to-lossless by truncation. The lab's
  version is row 17: 0.947–1.002 of HTJ2K's bytes, 1.31–1.89× its decode.

## 3. The lab's design against the literature

**The split itself: in line, and the literature adds nothing better within AV1.** Every source that splits finds
the low part noise-like and costly, as row 36 found (the low two bits cost AV1 1.34–2.01 bits a sample). No
source codes 13–16-bit samples with a ≤ 12-bit codec by another means that keeps them exact. The alternatives
change the codec, not the split. Those are a native-depth codec (HTJ2K, JPEG-LS, JPEG XL, all WASM-only in a
browser, HTJ2K being the product's) or a scalable layer that AV1 lacks.

**k: the literature points above 3 on the noisy series, and the lab never tried it.** The sources give the noise
floor in closed form.

* For Gaussian noise, the incompressible bits a sample are log2(σ√12) = log2 σ + 1.79 (Pence, Seaman, White,
  PASP 121:414, 2009-04, arXiv:0903.2140).
* A Rice or Golomb coder sends k ≈ log2(mean |e|) low bits raw (JPEG-LS: Weinberger, Seroussi, Sapiro, IEEE TIP
  9(8), 2000-08, doi:10.1109/83.855427; Kiely, JPL IPN PR 42-159, 2004-11-15).
* With mean |e| ≈ 0.8 σ for a Laplacian or Gaussian residual, that is k ≈ log2 σ − 0.3.

Row 36's σ is the residual of LOCO-I's own predictor. Its oracle found ⌊log2 σ⌋ − 1, fitted on nine series. But it
searched only k ∈ {1, 2, 3} (`lab/av1/bytes/low-stream/encx.py` `low_split`). It picked k = 3, the largest it tried, on
**all four** series with σ ≥ 17, where log2 σ is 4.2–6.1 (fluoroscopy 17.8–32.6, cone-beam 66.7–68.2). So the
fitted rule is censored at 3 exactly where it matters. The literature's rules say k = 4–6 there. Under that
noise the low bits cost their full width either way, and the top's noise falls as k grows. Rows 43–44 test
k ≤ max(b − 8, 4) and arms k = 2, 3, d12 and w10, so k = ⌊log2 σ⌋ on the noisy series is untested. Proposed
below.

**The low bits: deflate is what the literature does.** Raw or entropy-coded remainder bits are the standard
choices: JPEG-LS's and Rice's appended bits, CCSDS 121.0's split-sample option (**unconfirmed**, the document
was not opened), EBCOT's bypass of the lower bit planes (Taubman, IEEE TIP 9(7), 2000-07,
doi:10.1109/83.847830), and US10419781B2's raw LSBs. Row 36's deflated low bits match AV1's coding within
±0.5 points, and decode in 0.64–0.83× the time. A wrapped Gaussian (the noise taken mod 2^k) is nearly uniform
for 2^k up to about 2σ. Conditioning the low bits on the top then buys nothing. That is arithmetic on the
distribution, not a cited result, and row 36's measured plane entropies of 0.99–1.00 bits agree. BD-LVIC's
conditioning gain is at d = 8, where the low byte still carries structure.

**The offset: a published alternative beats it on sparse histograms.** −min keeps every gap in the histogram,
such as the CT's −2048 pad below air at −1097. **Histogram packing** maps the used levels onto 0…n−1 in order
and stores the table.

* Pinho: ICIP 2001, doi:10.1109/ICIP.2001.958146; IEEE SPL 9(1), 2002-01, doi:10.1109/97.988715.
* Starosolski, Proc. SPIE 5959, 2005-09, doi:10.1117/12.624489, and AIP Conf. Proc. 1060:269, 2008,
  doi:10.1063/1.3037069. Starosolski reports, with JPEG-LS:
  * CT 7.84 → 4.56 bits a pixel (−42 %);
  * MR 10.01 → 4.94 (−51 %);
  * CR 6.34 → 5.40 (−15 %);
  * ~0 to −3.7 % on dense histograms.

  The gain tracks the fraction of levels used. These figures are as the research summary gave them; the
  papers' tables were not re-read here.

Two cautions apply. Packing changes which bits are "low", so it interacts with k. And AV1's prediction may lose
on a non-linear mapping where a context coder does not. Not measured here. Proposed below.

**RGB: RCT is a published reversible transform, and slightly behind YCoCg-R in theory.**

* Malvar and Sullivan, JVT-I014r3, 2003-07, give theoretical coding gains on a standard photo set: YCoCg-R 4.54 dB, RCT 4.31 dB.
* HEVC SCC and VVC use YCgCo-R in their lossless colour transform. Choosing a transform per image gains 2.0–3.1 %
  over a fixed YCgCo-R (Strutz and Leipnitz, EUSIPCO 2017).
* AV1 has no colour transform of its own; it signals only `matrix_coefficients` (AV1 spec 1.0.0 with errata).
  ITU-T H.273 v3 names YCgCo-Re and -Ro (codes 16, 17); its approval date is **unconfirmed**.

Row 28 measured YCoCg-R and found it did not beat RCT, so the literature changes nothing at 8 bits. RCT's chroma
needs one more bit than the input, so RGB over 11 bits cannot go through AV1 after it. `payload-format.md` refuses
RGB over 8 bits already, and no modality here needs it.

**Lossless AV1 itself is barely studied.** No primary 2019–2026 paper measuring lossless AV1 on medical images
against JPEG-LS, JPEG 2000 or HEVC was found. On natural 8-bit RGB, Barina (WSCG 2021, arXiv:2108.02557; libaom
2.0.0) ranks AVIF lossless near the bottom: 12.04 bits a pixel against JPEG-LS 10.59 and JPEG XL 9.43. That run
had no colour transform and no split, which is row SIZE's starting point too.

**Above 12 bits: no reason in the literature to prefer a native-depth codec on bytes alone.** The one lossless
comparison (Ho et al.) favours the split over a weak native codec. BD-LVIC's per-half costs show the split
loses only the cross-half redundancy, 3.6 % at d = 8 and less at k ≤ 4 where the low part is noise. The reasons
to prefer native depth are decode and simplicity: one stream, and HTJ2K's 5–10× faster decode (rows 9, 33). That
is the trade rows 33 and 44 measure, not one the literature settles.

## 4. Patents and standards status

* **Standards:** the split is not standardised and not recommended. DICOM has no transfer syntax for AV1 at any
  depth (PS3.6 2026d), and its 13–16-bit lossless options are JPEG-LS, JPEG 2000, HTJ2K and JPEG XL. A payload
  stored this way is this project's format inside the bundle, not a DICOM encoding. It is converted at
  ingest, as every AV1 payload is.
* **Patents:** six on splitting high-bit-depth samples are listed in §1. Two have expired or been abandoned (2006,
  2013 priorities) and four are listed active to 2031–2037. None was read against this design's claims. Freedom
  to operate is the owner's question, with counsel. The split is also old enough (2006 priority, 2011–2017
  papers) that its general idea is prior art.

## Proposed follow-ups (not queued)

1. **k up to ⌊log2 σ⌋ on the σ ≥ 17 series.** Run row 36's oracle again with k ∈ {1…6} (b − k ≥ 6) on the
   fluoroscopy, 12-bit tomosynthesis, cone-beam and one projection system, bytes then decode. The literature's
   rule (k ≈ log2 σ − 0.3) predicts 4 on the first three and 6 on the cone-beam. This is a bytes sweep and
   fits row 44's arms.
2. **Histogram packing against −min,** in AV1 and in HTJ2K, on the CT (pad −2048 under data from −1097) and any
   sparse series rows 45–46 fetched. Measure the fraction of levels used first: Starosolski's gain is
   negligible above ½. It is a representation change, so a header field, and structural if adopted.
