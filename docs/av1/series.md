# AV1 — the target series

What each series AV1 targets is (the owner's list,
breast family first), read from the DICOM standard and the vendors' own conformance statements, against what this lab
measured, and what follows for the codec choice (HTJ2K or lossless AV1). Read 2026-10-05: **research, not a
measurement**. Standard: **DICOM 2026d** (dicom.nema.org/medical/dicom/current, read 2026-10-05). Every vendor value
is quoted from the vendor's own conformance statement (CS), [S1]–[S6]. **UNCONFIRMED** means no primary source was
read for that value.

**How to read the depth columns.** A CS gives *Bits Stored*, a container. The depth the codec
sees is *b*, the bits needed after subtracting the series minimum. Only the lab measures *b*.
The vendor's Bits Stored is an upper bound on *b*.

**AV1 limits these are checked against.**
- AV1 codes 8, 10 or 12 bits per stream [A1]:
  - Main profile: 8 or 10 bits, 4:2:0 or monochrome.
  - High profile: adds 4:4:4, still 8 or 10 bits. High cannot be monochrome (`seq_profile == 1` forces `mono_chrome = 0`).
  - Professional profile: adds 12 bits and 4:2:2.
- The bit split codes v as a top stream of b − k bits plus a low stream of k bits:
  - the top fits a 10-bit stream (WebCodecs, as the lab found in browsers) when k ≥ b − 10;
  - it fits a 12-bit stream (dav1d) when k ≥ b − 12.
- The lab's rule ([`README.md`](README.md) §Samples over 12 bits, queue rows 43–46, at `d749e63c`) is k = 2 up to 12 bits. Over 12 bits it needs a 12-bit top (k = b − 12) or k ≥ 3.
- The WebCodecs spec itself lists 12-bit formats (`I420P12`, `I444P12`…) and no Y-only format [W1]. So "≤ 10 bits" is what the browsers do, not a spec limit.

## 1. Breast imaging family

### 1a. What the standard allows (PS3.3 2026d)

| Series | SOP class (UID), IOD | Frames | Bits Allocated / Stored | Pixel Rep | Photometric, SPP | Section |
|---|---|---|---|---|---|---|
| FFDM, For Presentation and For Processing | Digital Mammography X-Ray Image Storage, For Presentation `1.2.840.10008.5.1.4.1.1.1.2` / For Processing `…1.1.2.1`; IOD A.27 | single (A.27.3 has no Multi-frame module) | 8 or 16 / **6–16** | 0 (unsigned) | MONOCHROME1 or 2; SPP 1 | DX Image Module C.8.11.3. Presentation Intent Type (0008,0068) separates the two classes (A.27.1) |
| Synthesized 2D | No class of its own. Stored as DM For Presentation, or as a one-frame Breast Tomosynthesis Image (vendor choice, §1b) | single | as the class used | 0 | MONOCHROME2 when stored as BTO | C.8.11.3 or C.8.21.1 |
| DBT reconstructed slices (and slabs) | Breast Tomosynthesis Image Storage `…1.1.13.1.3`; IOD A.55 | **multi-frame** (enhanced, functional groups) | 8 or 16 / **8–16** | unsigned (Pixel Representation is not enumerated in C.8.21.1; UNCONFIRMED) | **MONOCHROME2 only**; SPP 1 | X-Ray 3D Image Module C.8.21.1 |
| DBT projections | Breast Projection X-Ray Image Storage, For Presentation `…13.1.4` / For Processing `…13.1.5`; IOD A.74 (Sup 165) | **multi-frame** | 8 or 16 / **8–16** | 0 | MONOCHROME1 or 2; SPP 1 | Enhanced Mammography Image Module C.8.31.1 |
| Breast US, still | Ultrasound Image Storage `…1.1.6.1`; IOD A.6 | single | **8 / 8**; PALETTE COLOR 8 or 16. Bits Stored = Bits Allocated | 0 | MONOCHROME2, RGB, YBR_FULL, **YBR_FULL_422**, YBR_RCT, YBR_ICT, YBR_PARTIAL_420, PALETTE COLOR | US Image Module C.8.5.6, C.8.5.6.1.2–.15 |
| Breast US, cine | Ultrasound Multi-frame Image Storage `…1.1.3.1`; IOD A.7 | multi-frame, time | as still | 0 | as still | C.8.5.6. Cine Module C.7.6.5 is mandatory (A.7.4) |
| ABUS / 3D US volume | Enhanced US Volume Storage `…1.1.6.2`; IOD A.59. Vendors also use US Multi-frame (§1b) | multi-frame, 3D or 3D_TEMPORAL | 8 or 16; **Bits Stored = Bits Allocated** | 0 | **MONOCHROME2 only**; SPP 1 | Enhanced US Image Module C.8.24.3 |

Standard-wide rules:
- **Photometric for colour US.** For colour US, C.8.5.6.1.2 ties the photometric interpretation to the transfer syntax:
  - RGB for uncompressed or lossless;
  - YBR_RCT or YBR_ICT for JPEG 2000;
  - **YBR_FULL_422 for JPEG lossy**;
  - YBR_PARTIAL_420 for MPEG-2, H.264 and HEVC.
- **Rows and Columns.** No modality module above caps them. They are VR US, so ≤ 65 535.
- **Cine timing (C.7.6.5).** Frame Time (0018,1063) is in ms per frame. Frame Time Vector (0018,1065) holds per-frame increments in ms. Cine Rate (0018,0040) and Recommended Display Frame Rate (0008,2144) are in frames/s and are Type 3. The Frame Increment Pointer selects Frame Time or Frame Time Vector (C.8.5.6.1.4). The standard sets no rate limit.

### 1b. What vendors ship

| Vendor, product (CS) | Series | SOP class used | Stored (Alloc) | Photometric | Rows × Cols | Frames | Storage transfer syntaxes offered |
|---|---|---|---|---|---|---|---|
| Hologic Selenia Dimensions / 3Dimensions [S1] | FFDM For Processing ("Original") | DM For Processing | **14** (16) | MONOCHROME1 | 3328 × 2560 (18×24 paddle); 4096 × 3328 (24×29) | 1 | JPEG Lossless SV1, Explicit/Implicit LE, Explicit BE, JPEG-LS Lossless, JPEG 2000 Lossless. **No lossy, no RLE, no HTJ2K** (Table 3.2.4-5) |
| | FFDM For Presentation ("Derived") | DM For Presentation | **12** (16) | MONOCHROME2 | as above | 1 | as above |
| | Synthesized 2D (C-View / Intelligent 2D) | DM For Presentation, **or** one-frame BTO | **10** (16) | MONOCHROME2 | "based on synthesized 2D image processing" | 1 | as above |
| | DBT slices; slabs | BTO (preferred). Falls back to SC or CT if the receiver lacks BTO | **10** (16) | MONOCHROME2 | not stated (UNCONFIRMED) | slices "based on the thickness of the breast"; slabs = slices / 3 | as above |
| | Projections, raw | Breast Projection For Processing (or proprietary inside SC) | **14** (16) | MONOCHROME1 | 2048 or 4096 × 1664 or 3328 | **15** | as above |
| | Projections, processed | Breast Projection For Presentation (or SC) | **10** (16) | MONOCHROME2 | as above | 15 | as above |
| Siemens MAMMOMAT Revelation VC20G [S2] | FFDM, Insight 2D, tomo projections | DM (For Presentation / For Processing). **Projections are stored as DM, not Breast Projection.** Insight 2D is DM Standard Extended | "14" \| "12" (16). The split by series type is UNCONFIRMED | MONOCHROME1 \| MONOCHROME2 | "Paddle and mode specific" | 1 each. Projections: "(=26)" in the acquisition | JPEG Lossy Baseline and Extended, JPEG Lossless SV1, Explicit/Implicit LE, Explicit BE (Table 5). "lossy compression may not be allowed for FFDM images". No JPEG 2000 / HTJ2K |
| | DBT slices, Insight 3D | BTO (multi-frame) or CT (single-frame) | as above | as above | pixel spacing 0.085 mm (CT form) | slice thickness "Tomo: 1" mm | as above |
| Fujifilm AWS V9.3 [S3]. Hosted as the AMULET Innovality CS, but it never names the product (UNCONFIRMED that it covers it) | FFDM; DBT; S-View | DM For Presentation / For Processing; BTO; CT; CR. The class for S-View is UNCONFIRMED | DM: MONOCHROME1, Alloc 16. Stored not fixed (UNCONFIRMED). BTO: MONOCHROME2 | see Stored | UNCONFIRMED | DBT: one file per frame or one multi-frame file, configurable | Implicit/Explicit LE, JPEG Lossless SV1, JPEG 2000 Lossless (new in V9.3). No lossy, no HTJ2K |
| GE Senographe Pristina; Invenia ABUS 2.0 [S4] | all | **UNCONFIRMED**: every GE PDF returned HTTP 502 (maintenance page), 2026-10-05 12:40–15:56 UTC | | | | | |
| Siemens ACUSON S2000 VA16 (with ABVS) [S5] | US still, cine, ABVS clips | US Image, US Multi-frame, SC | **8** (8) | RGB, or MONOCHROME2 if configured. **YBR_FULL_422 when JPEG lossy** | not stated | cine: Frame Time Vector | Implicit/Explicit LE, Explicit BE, **JPEG Lossy Baseline**, JPEG Lossless (Table 7). No RLE / JPEG 2000 / HTJ2K |
| | 3D volume data (also viewed as cine) | **US Multi-frame**, not Enhanced US Volume | 8 (8) | MONOCHROME2 | **600 × 800** | one frame per slice; count not fixed. Frame Increment Pointer: Frame Time [S5 Table 12] | as above |
| Philips EPIQ / Affiniti 9.0.x [S6] | US still, cine | US Image, US Multi-frame. 3D goes as US Multi-frame plus a private 3D presentation state | **8** (8) | Uncompressed: MONOCHROME2 or RGB. **Lossy: YBR_FULL_422**. Lossless: RGB | "Varies with export resolution configuration…" | cine: Frame Time in ms; Cine Rate = display rate | Still: Implicit/Explicit LE, JPEG Baseline (lossy), JPEG Lossless, RLE. **Multi-frame: Implicit/Explicit LE, JPEG Baseline, RLE (no JPEG Lossless)**. The default is UNCONFIRMED |

No vendor CS read here offers HTJ2K, and none offers Enhanced US Volume for breast volumes. No CS gives a numeric cine frame rate; the CSs only carry the attribute. Rate is UNCONFIRMED by any primary source.

### 1c. Typical study composition

**Per view.** A screening DBT ("combo") exam is four views: R CC, L CC, R MLO, L MLO. Per view, per the CSs:

| Series | Frames | Uncompressed size | Source of the size |
|---|---|---|---|
| FFDM For Presentation | 1 | 17.0 MB (3328 × 2560 × 2 B) or 27.3 MB (4096 × 3328) | Hologic [S1]. The lab's `ffdm_a` file is 17 043 822 B ([`data.json`](../../lab/av1/data.json)) |
| FFDM For Processing (optional) | 1 | same | |
| Synthesized 2D | 1 | | |
| DBT slices | 1 per mm of compressed breast: Hologic "based on the thickness of the breast"; Siemens "Tomo: 1" mm | ≈ 9.3 MB per slice | Lab's Hologic-geometry volume, 1890 × 2457 × 2 B. The CS gives no slice matrix |
| Optional slabs | Hologic: slices / 3 | | |
| Projections | 15 (Hologic), 26 (Siemens CS) | | |

**Totals.** The frame totals scale with thickness, so a 50–60 mm breast gives about 0.5 GB of slices per view. Typical thickness is UNCONFIRMED by a primary source here.

**What IHE requires.** IHE's DBT profile ([I1], Trial Implementation, 2016) makes projections a named option. Projections "are not reviewed" in screening. The profile keeps generated 2D separate from conventional 2D. It lets modalities and displays choose lossless compression, while the archive must convert on the fly. Whether the profile has since reached Final Text is UNCONFIRMED.

**Diagnostic and ultrasound studies.** Diagnostic work adds spot or magnification views (DM) and breast US (stills plus cine clips). ABUS adds several volumes per breast. GE's count and size are UNCONFIRMED. Siemens S2000 stores 600 × 800 × 8-bit frames.

### 1d. Derived, per series

| Series | Bits Stored (CS) | b measured (lab) | AV1 placement | Colour | Structure |
|---|---|---|---|---|---|
| FFDM For Presentation | Hologic 12. Siemens 12 or 14 | 12 (`ffdm_a`, `ffdm_b`: two vendors) | b = 12: k = 2 gives a 10-bit top, through WebCodecs. If a Siemens For Presentation image really fills 14 bits, it is the over-12 case (UNCONFIRMED) | grey | single |
| FFDM For Processing | Hologic 14, MONOCHROME1 | 13 (the raw image behind `ffdm_a`) | **over 12**: k = 1 for a 12-bit top (dav1d), or k ≥ 3 for a 10-bit top | grey (MONOCHROME1 inverts at display; coding is unaffected) | single |
| Synthesized 2D | Hologic 10 | 10 (`syn2d_a`), 12 (`syn2d_b`) | ≤ 12: plain 10-bit, or k = 2 | grey | single |
| DBT slices | Hologic 10. Siemens 12 or 14 (split by type UNCONFIRMED) | 10 (`dbt10`), 12 (`dbt12`) | ≤ 12 on everything measured | grey | **multi-frame stack**, scrolled like cine |
| DBT projections | Hologic 14 (raw) / 10 (processed) | 14 (`dbtproj_ge`, `dbtproj_holo`). 12 and 11 without the single value 16383 | **over 12**: k = 2 for a 12-bit top, or k = 4 for a 10-bit top | grey | multi-frame, ordered by angle |
| Breast US, still and cine | 8 (standard and every CS) | none in the lab (CMB-BRCA only probed) | 8-bit streams. RGB needs 4:4:4 (AV1 High profile), or plain G, B, R planes, or the RCT | grey or RGB. Often YBR_FULL_422 (see note 2) | single; cine = time |
| ABUS | 8 (Siemens; standard allows 16 in Enhanced US Volume) | none in the lab (hosts blocked) | 8-bit grey. A 16-bit Enhanced US Volume would be over 12 (no vendor seen shipping it) | grey | volume, ordered by position |

## 2. Secondary: echo and general US cine, XA, RF

| Series | SOP class (UID) | Standard pixel constraints | Vendor / lab | b and AV1 placement |
|---|---|---|---|---|
| Echo, general US cine | US Multi-frame `…1.1.3.1` | As breast US (C.8.5.6): 8-bit, colour often | Philips [S6]: 8-bit; JPEG lossy gives YBR_FULL_422; multi-frame has no JPEG Lossless. Lab `us_liver`: 70 × 760×421 RGB 8-bit, uncompressed in the file. Its coding history was not checked | 8; colour as note 2. Echo frame rates: UNCONFIRMED (no CS gives a number) |
| XA | X-Ray Angiographic `…1.1.12.1` (A.14). Enhanced XA `…1.1.12.1.1` (A.47) | XA (C.8.7.1): Bits Stored **8, 10, 12 or 16**, MONOCHROME2 only, unsigned, SPP 1; Cine Module conditional. Enhanced XA/XRF (C.8.19.2): Bits Stored 8 (with Alloc 8) or 9–16 (Alloc 16), MONOCHROME1 or 2 | No vendor CS read (UNCONFIRMED). Lab: no multi-frame XA open; `xa_dynact16` is a reconstructed volume, b = 13 | 8–12 within AV1; a 16-bit XA run would be over 12 (none seen) |
| RF | X-Ray Radiofluoroscopic `…1.1.12.2` (A.16). Enhanced XRF `…1.1.12.2.1` (A.48) | X-Ray Image Module as XA; same enhanced module | Lab `rf_fluoro`: 12 of 16 bits, 26..3984, 2 frames/s | b = 12: k = 2 |

## 3. Contrast

- **CT** (`…1.1.2`; C.8.2.1): Bits Allocated 16, Bits Stored 12–16, MONOCHROME1/2, SPP 1. Signed values with a pad are common. Lab: b = 13 on three vendors' series, so over 12.
- **MR** (`…1.1.4`; C.8.3.1): Bits Allocated 16. Bits Stored is not enumerated. MONOCHROME1/2. Lab: b = 9–11, so ≤ 12.

## Notes

1. **Over 12 bits in the breast family comes only from For Processing data.**
   - It covers raw FFDM (Hologic 14 stored, lab 13) and raw projections (14).
   - Every For Presentation series (FFDM, synthesized 2D, slices, processed projections) is 10 or 12 bits in every CS and every lab series.
   - The projections' 14th bit comes from one value. Every sample is ≤ 3648 or ≤ 1794 except 16383 = 2^14 − 1.
   - That is consistent with a saturated direct-exposure background in MONOCHROME1 raw data. This is an inference, not stated by any CS.
   - IHE's DBT profile does not require projections to be stored, and screening does not read them [I1]. So the over-12 case may be rare in the target workload. How often archives keep them is UNCONFIRMED.
2. **Ultrasound that arrives as JPEG has no single exact source; the reference is an open decision.**
   - **What arrives.** Ultrasound scanners offer baseline JPEG, Photometric Interpretation YBR_FULL_422, as a storage format before the image reaches the archive.
     - The Siemens S2000 lists JPEG Lossy Baseline and stores YBR_FULL_422 when it uses it [S5 Table 7].
     - The Philips EPIQ / Affiniti stores lossy images as YBR_FULL_422. For multi-frame (cine), its only compressed options are JPEG Baseline and RLE; JPEG Lossless is not offered [S6].
     - How often archives receive JPEG rather than uncompressed or RLE pixels is UNCONFIRMED.
   - **What DICOM fixes.**
     - JPEG Baseline (`1.2.840.10008.1.2.4.50`) with three samples allows YBR_FULL_422 or RGB, 8 bits [D3 §8.2.1, Table 8.2.1-1].
     - The JPEG stream's own characteristics control decompression. The colour space, which the JPEG interchange format does not carry, comes from Photometric Interpretation, and the JFIF APP0 marker is recommended absent [D3 §8.2.1].
     - PS3.3 defines YBR_FULL by the forward equations only: RGB to YCbCr, four-decimal coefficients, no rounding rule and no inverse. YBR_FULL_422 is YBR_FULL with Cb and Cr at half the horizontal rate [D1 C.7.6.3.1.2].
     - Its notes add that the JPEG stream may in fact be 4:2:0 under that label, and that JPEG chroma is sited as in JFIF, midway between luma samples, not cosited as in native data [D1 C.7.6.3.1.2].
     - A JPEG image decompressed and stored natively as RGB has its Photometric Interpretation changed to RGB [D3 §8.2.1]. DICOM records that a conversion happened, not which one.
   - **What the JPEG standards leave open.**
     - **The inverse DCT.** T.81 gives the IDCT as an ideal equation whose terms "cannot be represented with perfect accuracy by any real implementation", and places the accuracy requirement in Part 2 [J1 §A.3.3, note]. A decoder must reconstruct "with appropriate accuracy", as determined by Part 2's compliance tests [J1 §7]. Part 2 is T.83 [J2]. The tolerance T.83 sets was not read, since the text is sold rather than published: UNCONFIRMED.
     - **Chroma upsampling.** T.81 leaves component sample registration and the colour space to the application [J1 §1, note; §4.1]. Its only upsampling filter belongs to hierarchical mode [J1 §J.1.1.2], not to baseline's subsampled chroma. JFIF fixes where subsampled chroma sits, not how it is interpolated [J3 §9].
     - **Colour conversion.** JFIF gives YCbCr to RGB as real-valued equations with rounding and clamping, and coefficients "to four decimal position accuracy" as an approximation [J3 §7]. It does not fix one integer implementation.
   - **So "the source pixels" are not uniquely defined.** Two conforming decoders may differ in the IDCT's rounding, the chroma upsampling (replication or one of several interpolations) and the integer colour conversion. Bit-exact needs a stated reference. How far browser decoders differ on real ultrasound was not measured: UNCONFIRMED.
   - **The options**, for the owner to decide:
     - a. **Serve the stored JPEG bytes as they are.** Bit-exact to the archive. No AV1 or HTJ2K for these series. The browser's JPEG decoder produces the pixels, so what is displayed varies by browser; without the JFIF marker, each engine also chooses the colour space by its own default (which default each applies is UNCONFIRMED). DICOM's JPEG XL JPEG Recompression transfer syntax (`1.2.840.10008.1.2.4.111`) carries the same bytes recompressed and reversibly [D3 §A.4.12], and changes none of this.
     - b. **Fix one reference decoder, by name and version, and code its RGB output losslessly.** Exact against that reference. The lab's AV1 payload format already codes 8-bit RGB exactly through the RCT ([payload-format.md](payload-format.md)), and HTJ2K takes RGB as it is [D3 Table 8.2.14-1]. Costs one JPEG decode at ingest, a decoder pinned for as long as the copies are kept, and three full-resolution channels where the JPEG had half-resolution chroma.
     - c. **Code the decoded Y, Cb, Cr planes at their stored resolution.** Removes the upsampling and colour-conversion dependence; the IDCT's remains. Neither codec carries YBR_FULL_422 as it is: HTJ2K's table lists MONOCHROME1, MONOCHROME2, PALETTE COLOR, YBR_RCT, YBR_ICT, RGB and YBR_FULL, not YBR_FULL_422 [D3 Table 8.2.14-1], and AV1 codes 4:2:2 only in the Professional profile [A1 §A.2]. A stream that is 4:2:0 under the label fits AV1's Main profile. Upsampling the planes at ingest, to fit either codec, brings the decoder dependence back.
3. **Frame geometry against AV1 levels** [A1 Annex A]:
   - Level 5.x caps a picture at 8 912 896 samples, 8192 wide, 4352 high.
   - 3328 × 2560 (8.5 M) and the 1890 × 2457 slice fit level 5.
   - **4096 × 3328 (13.6 M, Hologic 24×29) needs level 6.x.**
   - Whether browser WebCodecs decoders accept level 6 is UNCONFIRMED and unmeasured in the lab.
4. **Lab against vendors.**
   - **Agree.**
     - `ffdm_a` is Hologic 18×24 geometry: 2560 wide × 3328 high, 12 bits. Its For Processing source is MONOCHROME1, as [S1] says.
     - `syn2d_a` is 10 bits, matching Hologic generated 2D.
     - `dbt10` is 10 bits, matching Hologic BTO.
     - `dbtproj_holo` has 15 frames and 14 bits, matching "Projections = 15", For Processing = 14.
   - **Disagree, or not explained.**
     - `dbtproj_holo` is 1280 wide. [S1] lists projection Columns 1664 or 3328 (Rows 2048 matches). The lab's study may come from another software version (UNCONFIRMED).
     - The 9-view `dbtproj_ge`, the 12-bit `dbt12`, `ffdm_b` and `syn2d_b` cannot be checked against GE's CS until it is readable.
   - **Header against measurement.** Bits Stored overstates b on the lab's raw images: 14 stored, 13 measured on the raw FFDM. The lab's breast MR is stored as 12 of 16 bits and measures 9 (`mr9_ispy2`).
5. **Current DICOM work.**
   - HTJ2K is in the standard: Sup 235, Final Text, publication 2023e. Its UIDs are `…1.2.4.201` (Lossless), `.202` (Lossless RPCL) and `.203` (lossy allowed).
   - HTJ2K allows MONOCHROME at Bits Stored 1–38, signed or unsigned, and PALETTE COLOR ≤ 16 bits (PS3.5 8.2.14).
   - JPEG XL is in as Sup 232 (2024d), and Deflated Image Frame as Sup 244 (2025a).
   - **There is no AV1 transfer syntax and no AV1 work item.**
     - WG-04's page lists Sup 244 as its only current item and "no actionable items" beyond tracking JPEG XS and JPEG AI.
     - The approved work-items list has no AV1 entry. Its newest compression item is HTJ2K.
     - The newest WG-04 minutes reachable are from 2024-10-02 and do not mention AV1.
   - AV1 therefore stays a delivery format, not an archive transfer syntax.
   - No current breast-specific supplement was found. The last is Sup 165, Breast Projection X-Ray, 2012.

## 4. What "cine-like" could mean

The owner's question, 2026-10-30: is cine-like "series that are consecutive through a single dim, like time"? This
section gives the axes each series is ordered along, then three candidate definitions and what each implies; the
owner adopted one on 2026-10-30 (§4c). Read 2026-10-30: **research, not a measurement**. CT and MR stay on HTJ2K by the owner's 2026-10-05 list
(§3), which is the owner's choice, not a team decision. *Derived* marks this file's inference.

**AV1's ceiling is 12 bits** [A1 §A.2, note]: "the Professional profile extends support over the High profile to
also bitstreams with bit depth equal to 12". §5.5.2 `color_config()` sets no other value: `BitDepth = twelve_bit ? 12 : 10`.

### 4a. Axes per series type

| Series | Axis | Frames | Bits Stored | Read as (*derived* from the axis) | Ordering in DICOM |
|---|---|---|---|---|---|
| DBT slices | depth, about 1 mm apart (§1c) | 1 per mm of breast (§1c) | 10–14 (§1b) | scrolled | BTO: per-frame Plane Position (Patient), mandatory; no dimension constraint found [D8 A.55.4] |
| DBT projections | angle | 15 or 26 (§1b) | 14 raw, 10 processed (§1b) | single views, "not reviewed" in screening (§1c) | Positioner Primary Angle per frame [D8 C.8.31.2]; Multi-frame Dimension "U" [D8 A.74.3]. Siemens stores them as DM, one frame each (§1b) |
| Hand-held breast US cine | time | not found in official sources | 8 (§1a) | played | Cine Module mandatory; Frame Increment Pointer to Frame Time or Frame Time Vector [D8 C.8.5.6.1.4] |
| ABUS / ABVS | position, along the sweep | not stated in the CS read | 8 [S7] | scrolled | Siemens: US Multi-frame, "each frame represents a single slice from the 3D", yet the pointer is "Set to 0018,1063 (Frame Time" [S5 Tables 4, 12; S7 Table 13]. GE Invenia ABUS: CS still HTTP 502 on 2026-10-30, **unconfirmed** |
| Breast DCE-MRI | position × time (§4b) | 1 pre + ≥ 2 post phases [M2]; per phase ~166–190 slices in one protocol [M5] | 12 or 16 (§4b) | scrolled through slices, compared across phases | Enhanced MR: Multi-frame Dimension "M", no dimension organisation required [D8 A.36.2.3]. Temporal Position Index: "Ordinal number (starting from 1) of the Frame in the set of Frames with different temporal positions" [D8 C.7.6.16.2.2] |
| XA | time | not found in official sources | 8, 12, 16 [S9 Table 101] | played | Pointer: "Enumerated Values: 00181063H Frame Time … 00181065H Frame Time Vector" [D8 C.8.7.1]. Enhanced XA: a "Cine Run encoded in a single Multi-frame Image", no Cine Module [D8 A.47] |
| RF / stored fluoroscopy | time | not found | as XA | played | as XA [D8 A.16.3]. ARTIS stores fluoroscopy as XA, "STORE FLUORO" in Image Type [S9 §9.1.2.1] |
| Echocardiography | time | not found; 40–80 frames/s at rest, as reported by [E1], guideline not read | 8 [S8] | played | US Multi-frame, "Sequencing by Frame Time Vector (0018,1065)" [S8 §8.1.1.2] |
| CT, MR stacks | position | not in scope | CT 12–16, MR §4b | scrolled | classic: one frame per instance, Image Position (Patient) [D8 A.3.3, C.7.6.2]; Enhanced: Multi-frame Dimension "M", no constraint [D8 A.38] |

What the modules say:
- **Frame Increment Pointer** "Contains the Data Element Tag of the Attribute that is used as the Frame increment in
  Multi-frame pixel data"; each IOD "specializes" it [D8 C.7.6.6.1.2]. XA allows a Frame Dimension Pointer to angles or
  table positions, but notes "many implementations will … continue to assume that Frames are temporally related" [D8 C.8.7.1.1.12].
- **Multi-frame Dimension**: "The actual order of the Frames in the object is up to the generating application"
  [D8 C.7.6.17]. Dimension Organization Type: "3D Spatial Multi-frame Image of equally spaced parallel planes";
  "3D_TEMPORAL Temporal loop of equally spaced parallel-plane 3D volume sets".
- **Enhanced US Volume** requires one of those two, "Enumerated Values: 3D 3D_TEMPORAL" [D8 C.8.24.3], with a
  temporal index first and Image Position (Volume) second [D8 C.8.24.3.3]. No vendor read ships it for breast (§1b).

### 4b. Breast DCE-MRI

- **It is 4-D** (*derived*): one volume "first performed before contrast administration and is repeated multiple
  times after contrast administration" [M3 §Technical aspects]. ACR accepts the phases "in 3 separate series, in 2
  series … or in a single series" [M2].
- **Phases.** ACR: "At least 2 phases of post-contrast images must be submitted: the earliest and the latest phase";
  "The first post-contrast sequence must be completed in ≤ 4.0 minutes of completion of contrast injection" [M2].
  EUSOBI: "at least two measurements after the contrast medium has been given, but the optimal number of
  repetitions is unknown" [M3]. One protocol: "obtained once before and four times after injection" [M6].
- **Temporal resolution.** EUSOBI: "in the order of 60–120 s per volume acquisition" [M3]. ACR gives only
  "postcontrast intervals separated by 4 minutes or less" and ≤ 3 mm slices [M1 §VI].
- **Ultrafast.** "20 ultrafast … (TWIST) acquisitions (0.9 × 1 × 2.5 mm, temporal resolution, 4.3 seconds)" [M4];
  "15 phases of ultrafast DCE-MRI (temporal resolution of 2.7-4.6 s)" [M5]; "4 seconds per keyhole dynamic frame" [M6].
  ACR and EUSOBI give no ultrafast numbers (not found in official sources).
- **Bits.** Enhanced MR allows Bits Stored 8, or "16 | 12, 16" [D8 C.8.13.1.1.2, Table C.8-82]; classic MR fixes only
  Bits Allocated 16 (§3). Philips fixes "Bits Stored … 12" on both MR objects [S11 Tables 136, 148]; Siemens
  declares "12 or 16" for Enhanced MR [S10 §9.1.1.1]. So 12 bits is a vendor's choice, not a guarantee (*derived*).
  The lab's breast MR measures b = 9 in 12 stored (Notes, 4), within AV1's 12.

### 4c. Candidate definitions

- **T — time-ordered.** The frames' order is time: a Frame Increment Pointer to Frame Time or Frame Time Vector, or a
  temporal dimension (Temporal Position Index, or 3D_TEMPORAL's temporal index).
- **A — one ordered axis** (the owner's). The frames vary along one axis only, time, position or angle: a single
  pointer, one stack, or Dimension Organization Type 3D.
- **P — predictable neighbours.** Adjacent frames share what intra coding cannot predict. Not a DICOM attribute: it is
  decided per series type by measurement.

| Series | T | A | P |
|---|---|---|---|
| DBT slices | out | in | **out, measured**: ρ 0.11–0.22, G = 1 adopted ([`frame-groups.md`](frame-groups.md) §1, §4) |
| DBT projections | out | in | out, two series (frame-groups §1) |
| Breast US cine | in | in | predicted in (speckle repeats), untested (frame-groups §4 point 8) |
| ABUS | out by its geometry; **in by Siemens' header** (Frame Time) | in | untested; lower than cine (frame-groups §T3) |
| Breast DCE-MRI | in, along time | **out**: two axes, unless split per phase or per slice | not found for DCE. On a 12-bit TCGA-BRCA breast MR set, HEVC with inter scores 2.03 against HEVC intra's 1.77 and JPEG-LS's 2.06 [L4 Table 6]; whether its z axis is slices or phases is not stated |
| XA, RF | in | in | predicted under 5 % (frame-groups §4 point 10); 1.6–3.8 % over 2-D coders on 12-bit XA [L3]; "estimation of interframe motion is not advantageous" [L1] |
| Echo | in | in | untested; no lossless inter-frame study of US or echo found |
| CT, MR stacks | out | **in** | CT "significant", MRI "rather small" (frame-groups [S14]); 2-D "best" when "slice thickness is large compared to the pixel size" [L2] |

What each implies:
- **T** is read from headers and selects US cine, echo, XA and RF. It drops DBT slices, which the owner ruled
  cine-like on 2026-10-12 ([`queue.md`](queue.md) §Blocked, owner rulings 2026-10-12). Siemens' ABVS label makes it put a spatial sweep in by its header.
- **A** is the owner's wording. It **cannot separate a DBT stack from a CT or MR stack**: both are Dimension
  Organization Type 3D, ordered along one spatial axis. Keeping CT and MR on HTJ2K then needs a second criterion, such
  as modality or depth (CT b = 13, §3). It puts DCE-MRI out, though each phase or each slice position alone is in.
- **P** names the property that decides whether inter-frame prediction pays: how similar neighbouring frames are in
  what intra cannot predict, noise and speckle. Inter beats intra on noise only where its frame-to-frame correlation ρ
  exceeds ½ (frame-groups §4 point 4). The literature agrees: "interframe coding is activated only when the
  interframe correlation is high enough" (Miaou, frame-groups [S13]); "the optimal dimensionality … is related to
  the magnitudes of the local correlation coefficients" [L2]. Measured, P is empty so far: G = 1 on every content type
  (frame-groups §1). So under P, AV1's case on any series rests today on its intra bytes, not on prediction (*derived*).

**Adopted by the owner, 2026-10-30** (the owner's decision, not the team's): cine-like means frames ordered along one
axis (time, depth, sweep or angle), breast imaging first, at most 12 bits a sample: **A**, bounded by family and
depth. Inside it, how much neighbouring frames share, noise and speckle included (**P**), decides whether groups are
worth testing. The bound on family keeps CT and MR out, which A alone could not. What falls inside:
[`frame-groups.md`](frame-groups.md) §1.

## Sources (all fetched 2026-10-05, except §4's)

- [D1] DICOM PS3.3 2026d. Sections A.27, A.55, A.74, A.6, A.7, A.59, A.14, A.16, C.7.6.3, C.7.6.5, C.8.2.1, C.8.3.1, C.8.5.6, C.8.7.1, C.8.11.3, C.8.19.2, C.8.21.1, C.8.24.3, C.8.31.1. https://dicom.nema.org/medical/dicom/current/output/chtml/part03/PS3.3.html
- [D2] DICOM PS3.4 2026d, Table B.5-1 (SOP class UIDs). https://dicom.nema.org/medical/dicom/current/output/chtml/part04/sect_B.5.html
- [D3] DICOM PS3.5 2026d, §8.2.1 (Table 8.2.1-1), §8.2.14–8.2.16 and A.4.12–A.4.13. https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_8.2.html and https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_8.2.14.html
- [D4] DICOM supplements in progress. https://www.dicomstandard.org/news-dir/progress
- [D5] WG-04 page (strategy update 2024-12-05). https://dicomstandard.org/activity/wgs/wg-04
- [D6] WG-04 minutes, 2024-10-02. https://dicom.nema.org/dicom/minutes/wg-04/2024/WG-04-2024-10-02-tcon-Mins.pdf
- [D7] DICOM work items. https://www.dicomstandard.org/workitems
- [S1] Hologic, "Selenia Dimensions and 3Dimensions Acquisition Workstation, DICOM Conformance Statement for Software Versions 1.12 and 2.3", RD-04751 Rev 001, August 2023. Tables 3.2.4-5, 7.1-11, 7.1-13, 7.2-5, 7.3-x, 7.7-x. https://hologic.com/sites/default/files/2023-09/Dimensions%20v1.12%20and%203Dimensions%20v2.3%20DICOM%20Conformance%20Statement%20%28RD-04751%29%20English%20Rev_001%2008-2023.pdf
- [S2] Siemens Healthineers, "DICOM Conformance Statement MAMMOMAT Revelation VC20G, WHAWS VX40C", May 2024. Document number UNCONFIRMED. Tables 1, 5, 75; §8.1.1. https://marketing.webassets.siemens-healthineers.com/89d6759f9a5b66ab/49eecb3d0fae/MAMMOMAT_Revelation_VC20G_DICOM_Conformance_Statement.pdf
- [S3] Fujifilm, "DICOM Conformance Statement FDR-3000AWS / CR-IR363AWS … (Standard)", 28th Edition, June 2020, 897N201838B, AWS V9.3. Tables 4.2-10, 4.2-15, 8.1-20, 8.1-37. https://www.fujifilm-medicalservice.de/assets/download-assets/DICOM-Conformance-Statement-Fujifilm-AMULET-Innovality.pdf
- [S4] GE HealthCare DICOM conformance catalogue: Invenia ABUS 2.0 DOC2125962 Rev 1; LOGIQ E10–E20 R5.x DOC2968238 Rev 6; Vivid E95 v202 DOC1966328 Rev 3. Pristina was found by search only, "ZEPHYR_4.2.50". **The PDFs were not readable (HTTP 502).** https://www.gehealthcare.com/en/products/interoperability/dicom-conformance-statements
- [S5] Siemens, "ACUSON S2000 Ultrasound System DICOM Conformance Statement", Version VA16, 2009-04-03. Tables 4, 7, 8, 11, 12. *Corrected 2026-10-30:* §11.18, cited here before, is the structured-report breast section, not storage. https://marketing.webassets.siemens-healthineers.com/1800000000074060/f0bd0cb625bc/s2000_va16_dcs-00074060_1800000000074060.pdf
- [S6] Philips, "DICOM Conformance Statement EPIQ and Affiniti Family of Products, Release 9.0.x", 000789000000140 Rev B, 2024-06-28. Tables 4.7, 9.12–9.16. https://www.documents.philips.com/assets/DICOM%20Conformance%20Statement/20250227/0f8dddbc730e4f0188deb29100e392b8.pdf
- [J1] ITU-T T.81 (09/1992), "Digital compression and coding of continuous-tone still images – Requirements and guidelines" (ISO/IEC 10918-1), with Corrigendum 1 (01/2004). §1 note, §4.1, §7, §A.3.3, §J.1.1.2. https://www.itu.int/rec/T-REC-T.81. ITU sells the text; the section numbers were read from the 1992 text as hosted by W3C, https://www.w3.org/Graphics/JPEG/itu-t81.pdf.
- [J2] ITU-T T.83 (11/1994), "Digital compression and coding of continuous-tone still images: Compliance testing" (T.81's Part 2, ISO/IEC 10918-2). https://www.itu.int/rec/T-REC-T.83. Sold, not read; its tolerances are UNCONFIRMED, and the ISO/IEC number is from T.81's references to "Part 2", not from the ITU page.
- [J3] ITU-T T.871 (05/2011), "Digital compression and coding of continuous-tone still images: JPEG File Interchange Format (JFIF)" (ISO/IEC 10918-5:2012), with Erratum 1 (03/2013, not read). §7, §9. https://www.itu.int/rec/T-REC-T.871
- [I1] IHE Radiology TF Supplement, Digital Breast Tomosynthesis (DBT), Rev 1.3, Trial Implementation, 2016-09-09. Open issues 2, 3, 7, 34; §4.8.4.1.2.7. https://www.ihe.net/uploadedFiles/Documents/Radiology/IHE_RAD_Suppl_DBT_Rev1.3_TI_2016-09-09.pdf
- [A1] AOM, "AV1 Bitstream & Decoding Process Specification", last modified 2023-05-25. Profiles; Annex A levels. https://aomediacodec.github.io/av1-spec/
- [W1] W3C, WebCodecs, Working Draft 21 September 2026, `VideoPixelFormat`. https://www.w3.org/TR/webcodecs/. AV1 registration: Group Note Draft, 8 June 2026. https://www.w3.org/TR/webcodecs-av1-codec-registration/
- Lab: [`FIXTURES.md`](../FIXTURES.md) §AV1 data (every set named here, and the raw mammogram behind `ffdm_a`), and [`README.md`](README.md) §Samples over 12 bits (queue rows 43–46), at `d749e63c` (2026-10-05).

**Read 2026-10-30, for §4.**
- [A1] above, §A.2 and §5.5.2.
- [D8] DICOM PS3.3 2026d, sections A.3.3, A.16.3, A.36.2.3, A.38, A.47, A.55.4, A.74.3, C.7.6.2, C.7.6.6, C.7.6.16.2, C.7.6.17, C.8.5.6, C.8.7.1, C.8.13, C.8.24.3, C.8.24.3.3, C.8.31.2. https://dicom.nema.org/medical/dicom/current/output/chtml/part03/ (one page per section)
- [S7] Siemens, "DICOM Conformance Statement, ACUSON S Family Ultrasound System, Release VE10", January 2017, P/N 10851863 Rev 02. Table 13. https://marketing.webassets.siemens-healthineers.com/1800000003776715/b0a01ae19ea7/sfamily_ve10_dcs_2017_01_01-03776715_1800000003776715.pdf
- [S8] Siemens, "DICOM Conformance Statement, ACUSON SC2000 Volume Imaging Ultrasound System, Release VB10", November 2014. §8.1.1.2. https://marketing.webassets.siemens-healthineers.com/1800000001972495/15b67df071e9/sc2000_vb10_dcs-01972495_1800000001972495.pdf
- [S9] Siemens Healthineers, "ARTIS VE50 DICOM Conformance Statement", June 2025, 11546898-ESK-001-00. Tables 1, 101, 105; §9.1.2.1. https://marketing.webassets.siemens-healthineers.com/ea68cecc442b76f6/1c364f6ad53d/ARTIS_VE50_DICOM_Conformance_Statement.pdf
- [S10] Siemens Healthineers, "DICOM Conformance Statement syngo MR XA51A", 2024-09-11. §9.1.1.1, §9.1.1.4. https://marketing.webassets.siemens-healthineers.com/58254401f96c4f32/1879ec7117fa/MR_MAGNETOM_XA51A_DICOM_Conformance_Statement.pdf
- [S11] Philips, "DICOM Conformance Statement MR Systems", 8001001301 Version 4.0, 2025-08-28. Tables 136, 148. https://www.documents.philips.com/assets/DICOM%20Conformance%20Statement/20260304/e3d2f80e64cd4dfda614b4030052b8fb.pdf
- [M1] ACR, "ACR Practice Parameter for the Performance of Contrast-Enhanced Magnetic Resonance Imaging (MRI) of the Breast", revised 2023 (Resolution 8), §VI. https://gravitas.acr.org/PPTS/DownloadPreviewDocument?DocId=6
- [M2] ACR Accreditation Support, "MRI Exam-Specific Parameters: Breast", revised 2025-03-19. https://accreditationsupport.acr.org/support/solutions/articles/11000114407
- [M3] Mann RM et al. (EUSOBI), "Breast MRI: guidelines from the European Society of Breast Imaging", Eur Radiol 18:1307–1318, 2008, doi:10.1007/s00330-008-0863-7. Full text, https://pmc.ncbi.nlm.nih.gov/articles/PMC2441490/
- [M4] Mann RM et al., "A novel approach to contrast-enhanced breast magnetic resonance imaging for screening: high-resolution ultrafast dynamic imaging", Invest Radiol 49(9):579–585, 2014, doi:10.1097/RLI.0000000000000057. Abstract only.
- [M5] Onishi N et al., Breast Cancer Res 22:58, 2020, doi:10.1186/s13058-020-01292-9. Full text, abstract and Methods.
- [M6] Bode M et al., "Intraindividual Comparison of Ultrafast versus Standard Two-dimensional Dynamic Contrast-enhanced Breast MRI", Radiology 315(2):e241371, 2025, doi:10.1148/radiol.241371. Abstract only.
- [E1] Spahiu F et al., Am J Physiol Heart Circ Physiol 328(4):H752–H760, 2025, doi:10.1152/ajpheart.00817.2024. Abstract only; it reports the societies' recommendation second-hand.
- [L1] Roos P, Viergever MA, "Reversible interframe compression of medical images: a comparison of decorrelation methods", IEEE TMI 10(4):538–547, 1991, doi:10.1109/42.108588. Abstract only.
- [L2] Roos P, Viergever MA, "Reversible 3-D decorrelation of medical images", IEEE TMI 12(3):413–420, 1993, doi:10.1109/42.241868. Abstract only.
- [L3] dos Santos RA, Scharcanski J, "Lossless and near-lossless digital angiography coding using a two-stage motion compensation approach", Comput Med Imaging Graph 32(5):379–387, 2008, doi:10.1016/j.compmedimag.2008.03.001. Abstract only.
- [L4] Liu F et al., "The Current Role of Image Compression Standards in Medical Imaging", Information 8(4):131, 2017, doi:10.3390/info8040131. Full text, Tables 5–6. https://pmc.ncbi.nlm.nih.gov/articles/PMC8525863/
- Not reached: GE Invenia ABUS DOC2125962 and every GE PDF (HTTP 502 again, 2026-10-30); the ASE/EACVI echo guideline text.

**Still open.**
- GE: Pristina and Invenia ABUS (retry the PDF host, or download them by hand).
- MAMMOMAT Inspiration and B.brilliant (URLs found, not read).
- A current ABVS-era Siemens US CS.
- Canon and Samsung ultrasound.
- Any XA vendor CS.
- A primary source for typical breast thickness and for cine frame rates.
