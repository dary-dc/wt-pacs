# AV1 — the target series

What each series AV1 targets is (the owner's list: [`queue.md`](queue.md) §The breast and mixed-decoder rows, breast
family first), read from the DICOM standard and the vendors' own conformance statements, against what this lab
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
- The lab's rule ([`queue.md`](queue.md) rows 43–46, at `c2d4d173`) is k = 2 up to 12 bits. Over 12 bits it needs a 12-bit top (k = b − 12) or k ≥ 3.
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
| | 3D volume data (also viewed as cine) | **US Multi-frame**, not Enhanced US Volume | 8 (8) | MONOCHROME2 | **600 × 800** | one frame per slice; count not fixed | as above |
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
2. **YBR_FULL_422 means the modality already coded the image lossily (JPEG baseline).**
   - The standard notes the chroma may in fact be 4:2:0 under that label (C.7.6.3.1.2, note 3).
   - Decoded pixels depend on the JPEG decoder (IDCT, chroma upsampling). So "bit-exact" needs a stated reference. There are three options:
     - a. the JPEG bytes themselves. DICOM has a transfer syntax for this, JPEG XL JPEG Recompression `1.2.840.10008.1.2.4.111`;
     - b. the decoded Y, Cb, Cr planes at their native subsampling. AV1 needs Main profile for 4:2:0 and **Professional** for 4:2:2;
     - c. RGB from one fixed decoder.
   - HTJ2K's table lists no YBR_FULL_422 (PS3.5 Table 8.2.14-1: MONOCHROME1/2, PALETTE COLOR, YBR_RCT, YBR_ICT, RGB, YBR_FULL). So an HTJ2K copy must also upsample first. Both codecs face the same choice.
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

## Sources (all fetched 2026-10-05)

- [D1] DICOM PS3.3 2026d. Sections A.27, A.55, A.74, A.6, A.7, A.59, A.14, A.16, C.7.6.3, C.7.6.5, C.8.2.1, C.8.3.1, C.8.5.6, C.8.7.1, C.8.11.3, C.8.19.2, C.8.21.1, C.8.24.3, C.8.31.1. https://dicom.nema.org/medical/dicom/current/output/chtml/part03/PS3.3.html
- [D2] DICOM PS3.4 2026d, Table B.5-1 (SOP class UIDs). https://dicom.nema.org/medical/dicom/current/output/chtml/part04/sect_B.5.html
- [D3] DICOM PS3.5 2026d, §8.2.14–8.2.16 and A.4.12–A.4.13. https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_8.2.14.html
- [D4] DICOM supplements in progress. https://www.dicomstandard.org/news-dir/progress
- [D5] WG-04 page (strategy update 2024-12-05). https://dicomstandard.org/activity/wgs/wg-04
- [D6] WG-04 minutes, 2024-10-02. https://dicom.nema.org/dicom/minutes/wg-04/2024/WG-04-2024-10-02-tcon-Mins.pdf
- [D7] DICOM work items. https://www.dicomstandard.org/workitems
- [S1] Hologic, "Selenia Dimensions and 3Dimensions Acquisition Workstation, DICOM Conformance Statement for Software Versions 1.12 and 2.3", RD-04751 Rev 001, August 2023. Tables 3.2.4-5, 7.1-11, 7.1-13, 7.2-5, 7.3-x, 7.7-x. https://hologic.com/sites/default/files/2023-09/Dimensions%20v1.12%20and%203Dimensions%20v2.3%20DICOM%20Conformance%20Statement%20%28RD-04751%29%20English%20Rev_001%2008-2023.pdf
- [S2] Siemens Healthineers, "DICOM Conformance Statement MAMMOMAT Revelation VC20G, WHAWS VX40C", May 2024. Document number UNCONFIRMED. Tables 1, 5, 75; §8.1.1. https://marketing.webassets.siemens-healthineers.com/89d6759f9a5b66ab/49eecb3d0fae/MAMMOMAT_Revelation_VC20G_DICOM_Conformance_Statement.pdf
- [S3] Fujifilm, "DICOM Conformance Statement FDR-3000AWS / CR-IR363AWS … (Standard)", 28th Edition, June 2020, 897N201838B, AWS V9.3. Tables 4.2-10, 4.2-15, 8.1-20, 8.1-37. https://www.fujifilm-medicalservice.de/assets/download-assets/DICOM-Conformance-Statement-Fujifilm-AMULET-Innovality.pdf
- [S4] GE HealthCare DICOM conformance catalogue: Invenia ABUS 2.0 DOC2125962 Rev 1; LOGIQ E10–E20 R5.x DOC2968238 Rev 6; Vivid E95 v202 DOC1966328 Rev 3. Pristina was found by search only, "ZEPHYR_4.2.50". **The PDFs were not readable (HTTP 502).** https://www.gehealthcare.com/en/products/interoperability/dicom-conformance-statements
- [S5] Siemens, "ACUSON S2000 Ultrasound System DICOM Conformance Statement", Version VA16, 2009-04-03. Tables 7, 8, 12; §11.18. https://marketing.webassets.siemens-healthineers.com/1800000000074060/f0bd0cb625bc/s2000_va16_dcs-00074060_1800000000074060.pdf
- [S6] Philips, "DICOM Conformance Statement EPIQ and Affiniti Family of Products, Release 9.0.x", 000789000000140 Rev B, 2024-06-28. Tables 4.7, 9.12–9.16. https://www.documents.philips.com/assets/DICOM%20Conformance%20Statement/20250227/0f8dddbc730e4f0188deb29100e392b8.pdf
- [I1] IHE Radiology TF Supplement, Digital Breast Tomosynthesis (DBT), Rev 1.3, Trial Implementation, 2016-09-09. Open issues 2, 3, 7, 34; §4.8.4.1.2.7. https://www.ihe.net/uploadedFiles/Documents/Radiology/IHE_RAD_Suppl_DBT_Rev1.3_TI_2016-09-09.pdf
- [A1] AOM, "AV1 Bitstream & Decoding Process Specification", last modified 2023-05-25. Profiles; Annex A levels. https://aomediacodec.github.io/av1-spec/
- [W1] W3C, WebCodecs, Working Draft 21 September 2026, `VideoPixelFormat`. https://www.w3.org/TR/webcodecs/. AV1 registration: Group Note Draft, 8 June 2026. https://www.w3.org/TR/webcodecs-av1-codec-registration/
- Lab: [`FIXTURES.md`](../FIXTURES.md) §AV1 data (every set named here, and the raw mammogram behind `ffdm_a`), and [`queue.md`](queue.md) rows 43–46, at `c2d4d173` (2026-10-05).

**Still open.**
- GE: Pristina and Invenia ABUS (retry the PDF host, or download them by hand).
- MAMMOMAT Inspiration and B.brilliant (URLs found, not read).
- A current ABVS-era Siemens US CS.
- Canon and Samsung ultrasound.
- Any XA vendor CS.
- A primary source for typical breast thickness and for cine frame rates.
