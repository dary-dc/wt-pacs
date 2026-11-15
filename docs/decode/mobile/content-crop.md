# Decode on a phone's browser: code only the content's rectangle

*Queue row MOBILE-OPT-CONTENT-CROP, 2026-11-15, by its brief in `claude/work-ledger:docs/queue-client-2026-11-14.md`
§The new mobile options, from `new-options.md` §6. The option's advocate: its best version, then its costs. Theory
and sources first; one cloud cell, pre-registered here before it ran. Nothing run on a phone or a GPU.*

Labels as in `new-options.md`: **(S)** a source quoted, listed in §9 with its revision; **(R)** a result of this
repository, by its file; **(M)** measured by this row's cell (§7); **(D)** derived here, the arithmetic written out;
**(T)** theory, not measured.

The question, from `new-options.md` §6: if the view is coded from the rectangle that holds everything but
background, offset in the metadata, the exact series whole, what does it save on a phone, and what does it risk?

## 1. What it shows

* **The safe rectangle is rare on these fixtures** (M, §3): under a lossless rule (outside it every sample is exactly
  the background), a rectangle under 0.90 of the matrix exists on **3 of 19** volumes, all of system B: `dbts_b1`
  0.50, `dbts_b3` 0.73, `dbts_b2` 0.83. Systems A and C already store the breast's box (0.96–1.00 of their stored
  frames), and so do the two fixtures the fetch cropped.
* **The background is a third of the samples, but not in a rectangle** (M, not pre-registered): 26–66 % of every
  volume's samples are exactly the background, in the corners the breast's curve leaves inside its own box.
* **Bytes do not move** (M, §5): crop ÷ whole 0.9996–1.0018 for the AV1 view, 0.9973–0.9995 for HTJ2K. Both coders
  already code flat background for almost nothing.
* **Decode moves by less than the area** (M, §5): on `dbts_b1`, half the area, the AV1 view decodes in 0.85 of the
  time and HTJ2K in 0.76; on `dbts_b3` (0.73 of the area) 0.94 and 0.94; on `dbts_b2` (0.83) within the runs'
  spread. Every decode prediction missed, all on the side of less saving.
* **What is per sample scales exactly** (D, §4): hash, copies, upload, memory; on `dbts_b1` each halves.
* **No AV1 level changes** (D, §3): `dbts_b1`'s rectangle, 4 256 256 samples, is still above level 4's 2 359 296.
* **Nothing is lost on screen** (D, §6): with the exact-background rule the paint shows the source outside the
  rectangle, so the displayed image is not cropped; the label question the ACR raises is the owner's.
* It multiplies with every option and competes with none (§8), and on these fixtures it multiplies by about 1
  everywhere but the largest detector.

## 2. The form, at its best

* **Ingest** finds the series' background value `bg` and the safe rectangle (§7.1), one for the series, codes the view
  from the rectangle, and writes `crop {y, x, h, w}`, `bg` and the matrix's size into the series' metadata. A series
  with no safe rectangle is coded whole, as today; nothing else changes for it.
* **The digest** of the view, where it has one, is over the rectangle's decoded samples; the exact series keeps the
  whole frame and its digest (FIXTURES.md §Frame digests).
* **The paint** places the decoded rectangle at its offset and fills the rest with `bg`, which the window maps as it
  maps any sample; `valueAt` and measurements answer in the matrix's coordinates, `bg` outside. Since every sample
  outside is `bg` in the source (the rule, checked at ingest), what is shown outside is the source exactly (D).
* **DICOM has a name for `bg`.** PS3.3 C.7.5.1.1.2 (S2): "Pixel Padding Value (0028,0120) is typically used to pad
  grayscale images (those with a Photometric Interpretation (0028,0004) of MONOCHROME1 or MONOCHROME2) … to
  rectangular format. The native format of some images is not rectangular. It is common for devices with this format
  to pad the images, to the rectangular format required by the DICOM Standard, with a specific pixel value that is not
  contained in the native image." The rule here does not trust the attribute: it measures `bg` from the samples and
  checks every sample outside (whether these fixtures carry the attribute was not read).
* **The same rule makes a cropped exact frame lossless** (D): the HTJ2K arm of §5 is that, decoded back bit for bit
  with the outside refilled. It saves 0.05–0.27 % bytes, so it is not proposed; its decode is §5's.

## 3. The rectangle on the 19 volumes (cell A, M)

`lab/av1/content-crop/rows/box.jsonl`. `bg` is 0 on all 19. Shares are of the stored frame; *frames* is the mean
share of each frame's own box; *blocks* (not pre-registered, `rows/blocks.txt`) the share of 64 × 64 blocks from the
origin holding content in any frame; *content* the share of all samples that are not `bg`.

| volume | stored | safe box | share | frames | content | blocks | AV1 level, whole → safe |
| --- | --- | --- | --: | --: | --: | --: | --- |
| `dbts_b1` | 2560 × 3328 | 1632 × 2608 | **0.500** | 0.485 | 0.344 | 0.375 | 5.x → 5.x |
| `dbts_b3` | 1996 × 2457 | 1612 × 2233 | **0.734** | 0.716 | 0.515 | 0.565 | 5.x → 5.x |
| `dbts_b2` | 1890 × 2457 | 1562 × 2457 | **0.826** | 0.820 | 0.658 | 0.702 | 5.x → 5.x |
| `dbts_b4` | 1996 × 2457 | 1996 × 2289 | 0.932 | 0.914 | 0.642 | 0.949 | 5.x → 5.x |
| `dbts_b5` | 1890 × 2457 | whole | 1.000 | 0.910 | 0.695 | 1.000 | 5.x |
| `dbts_a1`…`a5` | 712–1142 × 1785–2223 | | 0.981–1.000 | 0.927–0.953 | 0.601–0.736 | 0.700–0.811 | 4.x (`dbts_a4` 5.x) |
| `dbts_c1`…`c5` | 662–1147 × 2100–2585 | | 0.979–1.000 | 0.920–0.943 | 0.447–0.705 | 0.530–0.802 | 4.x, 5.x for `c1`, `c3` |
| `dbt12_ea1141`, `dbt12_c` | 614 × 1359, 931 × 2124 | whole | 1.000 | 0.971, 0.929 | 0.657, 0.522 | 0.709, 0.592 | 4.x |
| `dbt10_ea1141`, `dbt10_d` | 678 × 1727, 757 × 2336 | whole | 1.000 | 0.990, 0.987 | 0.660, 0.698 | 0.751, 0.757 | 4.x |

* *No safe rectangle* on 16 of 19 (share ≥ 0.90). On `dbts_b5` the border itself is mostly not `bg` (0.33 of border
  samples are), so no lossless rectangle exists; a threshold rule would find one and lose samples, and is not tested.
* `dbt10_ea1141` and `dbt10_d` are the fetch's crops: of the detector's 1890 × 2457 matrix they are 0.25 and 0.38 (R,
  `new-options.md` §6). Two of system B's five whole volumes come near that (0.50, 0.73); three do not.
* Levels (S1, Annex A *Levels*): "UpscaledWidth * FrameHeight is less than or equal to MaxPicSize" with MaxPicSize
  "2359296" at 4.0 and 4.1, "8912896" at 5.0 to 5.3. `dbts_b1`'s safe box: 1632 × 2608 = 4 256 256 > 2 359 296, so
  5.x (D). `dbts_a4` whole, 1131 × 2223 = 2 514 213, also needs 5.x, which `new-options.md` §2.1's table did not
  list (it tabled the three timed volumes); `dbts_c1`'s tightest box, 970 × 2513 = 2 437 610, still does.

## 4. What scales a frame, written out (D)

`dbts_b1`, the view at 10 bits, two bytes a sample, whole 2560 × 3328 = 8 519 680 samples, rectangle 4 256 256:

| per frame | whole | rectangle | ratio |
| --- | --: | --: | --: |
| samples decoded and painted | 8 519 680 | 4 256 256 | 0.4996 |
| bytes hashed (XXH3-64 over the samples) | 17 039 360 | 8 512 512 | 0.4996 |
| bytes copied out of the decoder (`copyTo`) | 17 039 360 | 8 512 512 | 0.4996 |
| bytes uploaded to a texture | 17 039 360 | 8 512 512 | 0.4996 |
| memory, 50 frames held | 851 968 000 | 425 625 600 | 0.4996 |
| bytes on the wire and in the cache (coded) | 7 577 633 ÷ 16 frames | 7 589 218 ÷ 16 | 1.0015 (M) |
| decode time | — | — | 0.85 AV1, 0.76 HTJ2K (M) |
| a level 5.1 decoder's bound, `MaxDecodeRate` 547 430 400 (S1) | 64.3 frames/s | 128.6 frames/s | 2.0 (T, a conformance bound) |

547 430 400 ÷ 8 519 680 = 64.3; ÷ 4 256 256 = 128.6. On `dbts_b3` every per-sample row is 0.734, on `dbts_b2` 0.826,
on the other 16 volumes 1.

## 5. Bytes and decode (cell B, M)

`lab/av1/content-crop/rows/cost.jsonl`: the middle 16 frames, crop ÷ whole, decode the ratio of medians of six
interleaved runs a arm (seven, the first pair dropped).

| volume | share *s* | AV1 bytes | HTJ2K bytes | AV1 decode | HTJ2K decode | band predicted for decode, [*s*, (1 + *s*) ÷ 2] |
| --- | --: | --: | --: | --: | --: | --- |
| `dbts_b1` | 0.500 | 1.0015 | 0.9973 | **0.849** | **0.761** | 0.500–0.750 |
| `dbts_b3` | 0.734 | 0.9996 | 0.9991 | 0.944 | 0.938 | 0.734–0.867 |
| `dbts_b2` | 0.826 | 1.0018 | 0.9995 | 0.991 | 1.023 | 0.826–0.913 |

* The whole arm's AV1 runs on `dbts_b1` spread 0.817–1.008 s, about ±10 %: `dbts_b2`'s ratios are inside that
  spread, so it shows no saving either way; `dbts_b1`'s are outside it.
* The share of the saved area the decode recovers, (1 − ratio) ÷ (1 − *s*) (D): AV1 0.151 ÷ 0.500 = 0.30 on
  `dbts_b1`, 0.056 ÷ 0.266 = 0.21 on `dbts_b3`; HTJ2K 0.239 ÷ 0.500 = 0.48 and 0.062 ÷ 0.266 = 0.23. So 50–80 % of
  the background's decode cost was already not being paid (T: block skipping in AV1, empty code-blocks in HTJ2K).
* On the phone (T, a cloud ratio carried to another CPU): the software AV1 decode of `dbts_b1` measured at
  133–135 ms a frame (R, `claude/work-ledger:docs/queue/FILL-SPLIT.md`) would become 0.849 × 133–135 = 113–115 ms.
* Bytes: AV1's crop arm is 0.15–0.18 % larger on two of three volumes (T: the rectangle's edges no longer fall on
  the frame's own, and a constant background is close to free in either).

## 6. The hazard, and what a display states

* **What could be lost.** Only what lies outside the rectangle. Under §7.1's rule nothing is: every sample outside is
  `bg`, checked over every frame at ingest, so a burned-in marker, a clip or an implant's edge, being not `bg`, is
  inside by construction (D). The margin (8 samples, aligned to 8) is room for a coder's edge effects (T), not for
  content. A rule with a threshold above `bg` would cut real samples and is not proposed.
* **DICOM.** Pixel padding is DICOM's own notion of background "that may be suppressed" (S2: "Single pixel value or
  one limit (inclusive) of a range of pixel values used in an image to pad to rectangular format or to signal
  background that may be suppressed or that may be rendered "transparently" when superimposing images"). The
  portion of an image a device shows is a presentation state's *Specified Displayed Area* (S3, C.10.4: "The
  Specified Displayed Area is that portion of the image displayed on the device"); the form here changes neither,
  since the whole matrix is shown. PS3.3 C.7.6.1 (S4) has the attribute for annotation in the pixels, "Burned In
  Annotation (0028,0301) … Indicates whether or not image contains sufficient burned in annotation to identify the
  patient and date the image was acquired"; an image whose annotation is in the pixels keeps it, by the rule.
* **The ACR.** The technical standard (S5, §III.D.1.e, item 8): "Prior application of irreversible compression ratio,
  processing, or cropping on the image and/or overlay should be indicated." The view is already labelled lossy; with
  the exact-background rule nothing is cropped from what is displayed, so this form adds nothing a reader would see
  (T, the reading of the text is this row's; whether the label should say more is the owner's).

## 7. The cell, pre-registered

Written and pushed before anything ran. **A limit stated first:** the standing rule asks that a protocol be written by
a session other than the one that measures; this row's brief asks the row to pre-register its own cell, so one session
wrote this section and ran it. The predictions below were committed before the first frame was read.

**Fixtures.** The 19 DBT volumes of `docs/FIXTURES.md` §AV1 data (`dbts_a1`…`a5`, `dbts_b1`…`b5`, `dbts_c1`…`c5`,
`dbt12_ea1141`, `dbt12_c`, `dbt10_ea1141`, `dbt10_d`), fetched by `lab/av1/fetch_data.sh`, checked against
`lab/av1/data.json`. `dbt10_ea1141` and `dbt10_d` are stored already cropped to their non-zero box by the fetch (their
`crop` in `data.json`); their share of the detector's matrix (1890 × 2457) is reported beside their share of the
stored frame. Three reconstruction systems of one dataset; one 4-core x86-64 cloud host without a GPU.

### 7.1 Cell A: the rectangle

* **The background rule.** A volume's background value `bg` is the most frequent sample value among the samples of
  the outermost row and column on every side of every frame. A sample is *content* if it is not exactly `bg`. The
  volume's rectangle is the bounding box of content over **all** frames (one coded size a series, as one AV1 sequence
  needs), and, for the record, each frame's own box.
* **Why exactly `bg`:** every sample outside the rectangle then equals `bg`, so a paint that fills the outside with
  `bg` shows exactly the source there; the crop loses nothing (D). A threshold above `bg` would be a lossy rule and is
  not tested.
* **The safe rectangle**: the volume's box widened by a margin of 8 samples a side, then each side rounded outward
  to a multiple of 8 from the matrix's origin, clipped to the matrix. *No safe rectangle* when that box's area is
  0.90 of the matrix or more (the crop would save under 10 %).
* **Reported per volume:** `bg`, its count on the border, the share of all samples equal to `bg`; the box, the safe
  box and their areas as shares of the stored matrix; the mean and maximum of the per-frame box shares; the AV1 level
  the safe box needs (S1, Annex A.3: 4.x if its area ≤ 2 359 296, width ≤ 6144 and height ≤ 3456, else 5.x if ≤
  8 912 896, ≤ 8192, ≤ 4352).

**Predictions** (P-A1…P-A4, before the run):

* **P-A1.** System B (`dbts_b1`…`b5`, fixed detector sizes 2560 × 3328 and 1890–1996 × 2457): `bg` is 0 and the safe
  box's share is 0.25–0.60 on every volume, from the two system-B fixtures stored cropped at 0.25 and 0.38 (R).
* **P-A2.** Systems A and C, whose stored sizes differ by exam (`dbts_a1` 1142 × 1785, `dbts_a3` 712 × 2041, …),
  already crop to the breast at reconstruction: safe box share 0.80–1.00, and *no safe rectangle* on at least half
  of their ten volumes.
* **P-A3.** `dbt10_ea1141` and `dbt10_d`: share of the stored frame 1.00 (their crop is already the non-zero box);
  `dbt12_ea1141` and `dbt12_c` as P-A2.
* **P-A4.** `dbts_b1`'s safe box fits level 4.x (needs share under 0.277 of 2560 × 3328, `new-options.md` §6): **no**,
  predicted share 0.30–0.50 (a CC view of a large detector); `dbts_c1`'s needs ≤ 2 359 296 of 2 452 688 samples
  (0.962): **yes** if it has any safe rectangle.

### 7.2 Cell B: what the crop does to bytes and decode

* **Which volumes.** Those with a safe rectangle (§7.1), at most six: the three timed volumes `dbts_a1`, `dbts_b1`,
  `dbts_c1` if they have one, then the remaining eligible volumes by smallest safe share, up to six.
* **Frames.** The middle 16 frames of each (two G 8 groups), the same frames in both arms.
* **Arms.** *whole*: the stored frame. *crop*: the safe box cut from it. Both coded the same way:
  * the AV1 view as `docs/av1/payload-format.md` §Optimal quality codes it, Q 8 G 8, depth min(b, 10), a 12-bit source
    cut to its top 10 bits (rounded, as `top10` in `lab/av1/profiles/bytes.py`), aomenc 3.15.1 with the payload
    format's arguments, one thread; decoded by dav1d 1.5.4 `--threads=1`, output to the `null` muxer;
  * HTJ2K lossless as the exact series is coded (OpenJPH 0.31.0 `ojph_compress -num_decomps 5 -block_size {64,64}
    -prog_order RPCL -reversible true`), one frame a file, decoded by `ojph_expand` to a file on `/dev/shm`.
* **Bytes**: the sum over the 16 frames, crop ÷ whole.
* **Decode**: wall time of the decoder process over the 16 frames, repeated 7 times, the arms interleaved (whole,
  crop, whole, crop, …; the first pair discarded as warm-up), one process at a time on an otherwise idle host (one of
  four cores busy: not saturated). Reported as the ratio of medians, crop ÷ whole, per volume and codec. No absolute
  time is claimed from a cloud host; a ratio on one host only.
* **Checks:** every crop arm's decoded frames, put back into a frame filled with `bg`, equal the whole arm's source
  outside the box (by construction) and, for HTJ2K, the source exactly everywhere.

**Predictions** (P-B1…P-B3), with *s* the volume's safe share:

* **P-B1 (bytes).** Background is flat and costs little in either codec: bytes ratio 0.90–1.00 for AV1 and for HTJ2K
  on every volume, far above *s*.
* **P-B2 (decode, AV1).** dav1d's work has a part per block that a skipped flat block still pays (prediction, loop
  filters, CDEF and restoration run over the whole frame): decode ratio between *s* and (1 + *s*) ÷ 2.
* **P-B3 (decode, HTJ2K).** The inverse wavelet runs over every sample and empty code-blocks cost almost nothing:
  decode ratio between *s* and (1 + *s*) ÷ 2, nearer *s* than AV1's.

A miss is reported as a miss beside its prediction.


### 7.3 Results against the predictions

* **P-A1, miss.** System B's shares are 0.50, 0.73, 0.83, 0.93, 1.00: one of five inside 0.25–0.60.
* **P-A2, hit.** Systems A and C: 0.979–1.000 on all ten; no safe rectangle on ten of ten.
* **P-A3, hit.** `dbt10_ea1141`, `dbt10_d` 1.000; `dbt12_ea1141`, `dbt12_c` 1.000, no safe rectangle.
* **P-A4, hit, and void.** `dbts_b1` 0.4996, inside 0.30–0.50, not level 4.x; `dbts_c1` has no safe rectangle, so its
  conditional prediction does not apply (its tightest box still needs 5.x, §3).
* **P-B1, 4 of 6.** HTJ2K 0.9973–0.9995, three hits; AV1 0.9996 a hit, 1.0015 and 1.0018 just above the band.
* **P-B2, 0 of 3; P-B3, 0 of 3.** Every decode ratio is above its band (§5): the background was cheaper to decode
  than predicted, so cropping it saves less. P-B3's "nearer *s* than AV1's" held on `dbts_b1` (0.76 against 0.85).
* Host: one 4-core x86-64 cloud host, no GPU; one decoder process at a time, one thread; no absolute time claimed.
  Fixtures: 19 DBT volumes of three reconstruction systems of one dataset; cell B on three volumes of one system,
  16 frames each, one Q and G. Codecs: libaom 3.15.1 `--cpu-used=6`, dav1d 1.5.4, OpenJPH 0.31.0, built by
  `ingest/tools.sh`. Tests of `measure.py`: `measure_test.py`, five mutants killed (an end-inclusive box, no margin, no
  clip to the matrix, the minimum for the border's mode, the level by size alone).

## 8. The comparison's columns

The option is a factor on another option's row, not a row of its own. "×" is the factor on these fixtures.

| column | content crop |
| --- | --- |
| decode time on a phone | **unknown**; cloud factor 0.85 (AV1) and 0.76 (HTJ2K) on `dbts_b1`, 0.94 on `dbts_b3`, ≈ 1 on `dbts_b2` and the other 16 (M); `dbts_b1` software AV1 113–115 ms predicted (T) |
| bytes | × 0.997–1.002 (M): unchanged |
| precision on screen | unchanged: inside as the option it multiplies, outside the source exactly (D) |
| checked | as the option it multiplies, its digest taken over the rectangle; the exact series untouched |
| window/level and tools | unchanged; `valueAt` outside the rectangle gives `bg`, the source's value (D) |
| ships today | no: an ingest change (`crop`, `bg` in the metadata) and the paint placing the rectangle |

Per option it multiplies (D unless marked):

* *AV1 in software, HTJ2K in software, lossy HTJ2K*: decode × the factor above; hash, copy, upload and memory × the
  share (0.50, 0.73, 0.83 or 1).
* *AV1 in hardware (unchecked or inverted)*: no volume changes level (§3), so no phone that refuses a whole frame
  takes its rectangle; the read-back of `hw-inverted.md` × the share, 8.5 MB → 4.3 MB on `dbts_b1`; a level's
  `MaxDecodeRate` bound × 1 ÷ share (64 → 129 frames/s, T).
* *GPU compute*: every per-sample stage × the share (T).
* *Other codecs*: as AV1 in hardware; the levels are their own specifications' (not read here).

**What a phone cell must measure.** One: `dbts_b1` whole against its rectangle through the phone's software AV1
decode and its HTJ2K decode, interleaved, as a ratio, to replace §5's carried cloud ratio. Nothing else here needs a
phone: per-sample costs scale by arithmetic.

**A leaning, labelled as one.** On these fixtures the option is worth its ingest change for the largest detector only:
one volume in 19 halves its per-sample work and gains 15–24 % of its decode; sixteen gain nothing because their
systems already store the breast's box. `new-options.md` §7's leaning put this option first because it helps
whatever else is chosen; measured, it helps little except on `dbts_b1`'s size, which is also the volume whose phone decode
was measured (133–135 ms a frame, R). Data from more system-B volumes, or from other vendors that store the whole detector,
would change this; none is open here (FIXTURES.md §AV1 data).

## 9. Sources

Fetched 2026-11-15. Section numbers are the documents' own.

* **S1** AV1 Bitstream & Decoding Process Specification, <https://aomediacodec.github.io/av1-spec/>, "Last modified:
  2023-05-25 12:27 PT" (page sha256 `acf58a3fdb82`): Annex A, *Levels* (the level table) and *Level imposed
  constraints*.
* **S2** DICOM PS3.3 2026d, §C.7.5.1.1.2 *Pixel Padding Value and Pixel Padding Range Limit* and the General
  Equipment module's table:
  <https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.5.html> (read as *current*, which named
  itself 2026d; sha256 `48e80ea4e2d0`).
* **S3** DICOM PS3.3 2026d, §C.10.4 *Displayed Area Module*:
  <https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.10.4.html> (sha256 `ffcf4cc56398`).
* **S4** DICOM PS3.3 2026d, §C.7.6.1 *General Image Module*:
  <https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.html> (sha256 `8d7d584b8f88`, the
  same bytes `docs/adr/exactness-in-production.md` read on 2026-10-10).
* **S5** ACR–AAPM–SIIM *Technical Standard for Electronic Practice of Medical Imaging*, "Revised 2022 (Resolution 48)"
  and "Amended 2023 (Resolution 2c, 2d)" by its chronology, §III.D *Display*, 1.e *Presentation support features*,
  item 8: <https://gravitas.acr.org/PPTS/DownloadPreviewDocument?DocId=136> (sha256 `503d82d32542`).
  `docs/adr/exactness-in-production.md` §8 cites the same sentence as "§III.B and §III.D"; it is in §III.D.
