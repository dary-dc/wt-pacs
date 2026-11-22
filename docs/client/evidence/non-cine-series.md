# What a series that is not a stack gets

**Question:** What does a reader get for a series with no consecutive dimension: one large projection, a few
unrelated frames, a depth over 12 bits? And, for the scope of 2026-11-22 (breast DBT and ultrasound, stacks first):
what do those two modalities bring that is not a stack, and which of it can wait?

*Written 2026-11-22 (NON-CINE-OPTIONS). **Theory and sources; nothing built, run or timed.** It reads the client and
the docs at `origin/claude/unified` `4a2b4277f`. Each number is labelled **(S)** a source quoted in §10, **(M)**
measured in this repository and cited, **(D)** arithmetic on (S) or (M) numbers, **(T)** this file's model, or
**(A)** assumed. The line it fills is [`../design.md`](../design.md) §Open, last sentence. Kept short on purpose
(the program's amendment 27, item 6).*

## 1 · The answer, short

**"Not cine-like" is three different things, and only one of them is in the scope's way.**

| class | in a breast study | frames, size | what it needs | wait? |
| --- | --- | --- | --- | --- |
| **a large single frame**, ≤ 12 bits | the synthesized 2D picture of each DBT view; a 2D mammogram (current in a combined exam, or a prior) | 1 a view, 6.8–28 Mpx (S9); 4.81 MB coded on `ffdm_d` (M) | its exact frame, whole, as today; the one open choice is whether an exact picture at the screen's size comes first (§5, L) | **no**: it is half the pictures of a DBT exam (§2) |
| **stills** | most of a hand-held breast ultrasound exam | 10 to a few tens (D on S6, S7), about 0.5–1.6 Mpx, 8 bits, grey or colour | nothing new in delivery: they are a stack of exact frames. What is missing is at the ingest (§5, S) | **no**, if ultrasound is shown at all; it is the cheap one |
| **over 12 bits** | For Processing images, raw projections; digitized film | 1 to 26, up to 30 Mpx | "fit plus tiles", decided 2026-10-10, not built | **yes**: a reading display shows For Presentation images (S1) |

Four things no earlier text here states:

1. **A reader of a DBT study does not start on a stack.** The profile the product reads from requires a DBT display
   to meet every 2D mammography display requirement and to switch between the slices and the 2D pictures of the same
   view (S1). By count, half of a DBT exam's pictures are single frames; by bytes they are under 3 % of it (§2, D on S9).
   "Start reading sooner" therefore depends on a class the product does not state.
2. **For one frame the fill's law does not apply.** `fill ≈ max(wire, decode) + rest` describes a pipeline in steady
   state. One frame's bytes arrive, then it decodes: first picture ≈ wire **+** decode (T). On every phone class
   the wire is the larger term below about 150 Mbit/s (§4, D), so bytes decide, and a lossy view would help only
   on slow links, at the cost of a second stored form (§5, V).
3. **A frame taller or wider than the device's largest texture paints nothing today**, with no message (read in
   `client/paint/paint-worker.js`, not run; §4.3). 3328 × 4096 fits the 4096 that Android's baseline promises with
   nothing to spare; a 50 µm detector's 4728 × 5928 does not (S9, S12).
4. **A real ultrasound series is refused at the ingest three ways** (read in `docs/FIXTURES.md`, not run): stills of
   different sizes in one series, a clip among stills, and a lossy source. None is a delivery question (§5, S).

**Recommended, for the `non-cine-series` page to put to the owner** (§8): large single frames get their exact frame
alone, whole, as today, and never an AV1 view; an exact level picture first is the one measurement worth queueing;
stills are served as a stack of exact frames once the ingest admits them; over 12 bits waits; the painter refuses
an oversized frame by name now.

## 2 · What breast DBT and ultrasound bring that is not a stack

**A DBT exam.** "Each study, current or prior can include one or multiple views of each breast, where one view may
contain a set of: • Tomosynthesis slices • Tomosynthesis projection images • Tomosynthesis slabs • Conventional 2D
mammography images • Generated 2D images derived from tomosynthesis data" (S2). Slices and slabs are stacks. The
rest:

* **The generated (synthesized) 2D picture**, one a view, "derived from the DBT source projection images, which are
  rendered to simulate 2-D DM"; "If SM is used, it must be labeled as such" (S5). It is stored with the *stack's* object class: generated 2D
  images "shall" be encoded "using the Breast Tomosynthesis Image Storage SOP Class", Image Type `GENERATED_2D` (S1,
  §4.8.4.1.2.7). So neither the modality nor the object class tells a stack from a single frame: only the frame count
  does (T). The fitting ADR already says so for size: "The classifier is **dimensions against viewport**, not
  modality" ([`../../adr/resolution-fitting-for-large-frames.md`](../../adr/resolution-fitting-for-large-frames.md) §1).
* **The conventional 2D mammogram**, one exposure an object ("shall consist of the result of a single X-Ray exposure",
  S3 A.26.1), in a combined exam and in most priors. In one health system's two weeks, 99.99 % of 13 484 breasts had
  3D views and 70.15 % also had 2D acquisitions (S8; one system, nine hospitals).
* **Projection images**: an option of the profile, For Presentation only (S1). Ordered by angle, so a stack.

**How much of an archive (D on S; no source gives the share directly).** A four-view DBT exam is four stacks and
four or eight single frames: half or two thirds of its pictures. By bytes, uncompressed and on the same system:
a 2D picture of 13.6 MB (D), 16.2 MB (S9) and 20.2 MB (D) against a reconstructed volume of 1 900, 1 120 and 821 MB
(S9; phantoms at 60 mm, one acquisition each), 0.7–2.5 % (D). Of the
27 933 accredited units in the United States on 2026-11-01, 13 668 are DBT units and 14 264 are 2D digital units
(S4): at 51 % of units every picture made is a single frame (D; units, not exams, and a DBT unit also takes 2D).

**A hand-held breast ultrasound exam** is stills first. A finding is recorded "in two orthogonal projections with
and without calipers", with "One or more color or power Doppler images" recommended (S6): five or more stills a
finding (D). A whole-breast screening exam documents "at minimum each of the four quadrants and the subareolar
region" (S7): ten stills for two breasts (D). No published count per exam was found. Each still is its own object
(the Ultrasound Image IOD has no Cine or Multi-frame module; the Multi-frame IOD requires both, S3), 8 bits, and
its photometric interpretation is one of "MONOCHROME2 PALETTE COLOR RGB YBR_FULL YBR_FULL_422 YBR_RCT YBR_ICT
YBR_PARTIAL_420" (S3 C.8.5.6.1.2). Clips, and an automated scan's "229-282 slices" (S8), are stacks.

**Outside both, and not pictures of a series:** dose and CAD structured reports, presentation states. Named here so
that no page reads this file as covering them.

## 3 · The premises, questioned

**"A series either has a consecutive dimension or it has none."** Two properties hide in "cine-like"
([`../../av1/series.md`](../../av1/series.md) §12: "frames ordered along one axis", **A**, and what neighbours
share, **P**). A third matters to the reader and is in neither: **the order the reader pages in**. Stills have that
order (the acquisition's) and no shared content. For delivery, the order is what counts: a fill, an ask and a window
need an index, not a correlation. And P is empty so far even on stacks: "G = 1 on every content type … AV1's case on
any series rests today on its intra bytes, not on prediction" (the same file). So the product's view of a DBT slice
is already an intra-coded picture, and "an intra-coded view" of a mammogram would be the same mechanism with a frame
count of one (T). What separates the classes is not the codec's reach.

**"A single frame has no dimension to move along."** It has three: scale, and position in two axes. The reader
fits the picture, then goes to actual pixels and pans: "each encoded pixel occupies one display pixel in the
viewport. If the size of the pixel data exceeds the size of the viewport … some form of pan or quadrant navigation
functionality shall be provided" (S1, View Actual Pixels), and "there shall be a mode in which actual pixels of
'For Presentation' images are displayed … with no further processing or interpolation other than application of
point grayscale transformations" (S1, §4.16.4.2.2.1.1.9). The 2026-11-22 ask model orders frames by *need time*
along the paths a mode allows (`claude/ask-model:docs/client/evidence/ask-model.md`, PR 430). On a single frame
the same key orders **resolution levels, then regions**: the level that fills the viewport is needed at once, the
actual pixels under the viewport on the next gesture, their neighbours after (T). Fit plus tiles (2026-10-10) is
that rule's shape, reached from bytes; here it is reached from the reader.

**"What bounds a single frame is its bytes."** On a phone a second bound is absolute: the largest texture (§4.3).
The decided "fit plus tiles" happens to be the one delivery shape that never meets it, since a level that fits the
viewport and a region the size of the viewport are both no larger than a screen (T).

**"The view exists to make a picture arrive sooner."** It exists to make a *fill* short: N frames' bytes. With N
between 1 and 4 the saving is one to four frames' bytes, once (§5, V).

**"Exact" for a still.** Where the source object is lossy JPEG (photometric `YBR_FULL_422` "for JPEG lossy
compressed Transfer Syntaxes", S3), the original is a coded stream, not samples. The ingest refuses it: "a lossy
transfer syntax: its samples are not the original's" ([`../../FIXTURES.md`](../../FIXTURES.md) §Input). That is
consistent, and it leaves such a still with no picture at all (§5, S3).

## 4 · What bounds one frame

### 4.1 · The frames

| detector pixel | matrix (S9) | Mpx (D) | raw at 16 bits (D) | coded, exact |
| --- | --- | --- | --- | --- |
| 100 µm | 2394 × 2850 | 6.82 | 13.6 MB | 2.4 MB (A: `ffdm_d`'s 2.82 bit a pixel) |
| 85 µm | 2816 × 3584 | 10.09 | 20.2 MB | 3.6 MB (A) |
| 70 µm | 3328 × 4096 | 13.63 | 27.3 MB | **4.81 MB** (M, `ffdm_d`, [`../../decode/README.md`](../../decode/README.md)) |
| 50 µm | 4728 × 5928 | 28.03 | 56.1 MB | 9.9 MB (A) |

Bits stored: 12 for a For Presentation 2D image, 10 for the generated 2D, 14 for the For Processing one (S10, one
vendor). The standard allows a DX image 6 to 16 (S3 C.8.11.3). Stills: 960 × 720 to 1552 × 970 on the six colour
sets here, 3 × 8 bits, 2.1–4.5 MB raw (D); their coded bytes are in no document read (the measurement is one `ls`).

### 4.2 · Wire and decode, one 70 µm frame

Goodput percentiles are [`../../transport/link-profiles.md`](../../transport/link-profiles.md)'s (open-data
summaries, not our links). Decode: 91.9–102 ms the whole frame and 8.2 ms its level 2, one thread, on a 4-core cloud
host (M, `ffdm_d`, headless Chromium 141, [`../../decode/README.md`](../../decode/README.md)); a level-1 picture is
×0.27–0.31 of the whole decode on nine series (M, the same). Phone classes scale it by
[`../../decode/mobile/device-model.md`](../../decode/mobile/device-model.md)'s ranges for an HTJ2K frame on one fast
core (its 100–143, 46–94 and 37–59 ms against the cloud's 57.1): ×1.75–2.50 entry, ×0.81–1.65 middle, ×0.65–1.03
premium (D on that model's T; the model's own prediction on a phone is not yet reviewed against the 2026-11-22
round).

| | LTE p10, 18 Mbit/s | LTE median, 103 | home Wi-Fi median, 218 |
| --- | --- | --- | --- |
| wire, the exact frame (4.81 MB) | 2.14 s | 0.37 s | 0.18 s |
| wire, its level 1 (25.8–29.0 %, M) | 0.55–0.62 s | 0.10–0.11 s | 0.05 s |
| wire, four views whole | 8.6 s | 1.5 s | 0.71 s |

| decode, whole frame (D) | entry | middle | premium |
| --- | --- | --- | --- |
| 70 µm | 161–255 ms | 74–168 ms | 60–105 ms |
| 50 µm (A: by pixels, ×2.06) | 0.33–0.53 s | 0.15–0.35 s | 0.12–0.22 s |
| wire = decode at (70 µm) | 151–239 Mbit/s | 229–520 | 367–642 |

So the wire binds on every class up to the LTE median, and on entry phones the two meet inside home Wi-Fi's range.

### 4.3 · The largest texture, and memory

* **What is promised.** OpenGL ES 3.0, which WebGL 2 "conforms closely to" (S14): `MAX_TEXTURE_SIZE` minimum
  **2048**, and "If width, height, or depth exceed the corresponding maximum size, an INVALID_VALUE error is
  generated" (S11). Android's Vulkan baseline profiles of 2021 and 2022, "functionality that is broadly supported on
  Android": `maxImageDimension2D` **4096**; Android 16's mandated minimums: **8192** (S12; Vulkan, not GL: the GL
  limit of the same GPU is not stated by any source read). WebGPU: `maxTextureDimension2D` default **8192**,
  compatibility-mode default **4096**; "Adapters are always guaranteed to support the defaults or better" (S13).
* **What the client does** (read, not run): `texture()` calls `gl.texStorage2D(…, w, h)` at the frame's size
  with no test against `MAX_TEXTURE_SIZE` (`client/paint/paint-worker.js`, `texture` and `upload`; no file under
  `client/` names the limit). Over the limit the call fails and nothing is painted or said. The native painter
  already "refuses a frame over them by name" ([`../../native/README.md`](../../native/README.md)).
* **Which frames.** At 4096: every matrix to 3328 × 4096 fits, the 50 µm matrix (5928) and `mg16_cbis` (6871) do
  not. At 2048 no mammography matrix fits, nor a `dbts_b1` slice (2560 × 3328). How many phones in use report 2048
  or 4096 to WebGL: **unknown** (no official source; third-party databases not used).
* **Memory.** The painter holds the frame's texture and an RGBA8 picture "at source size"
  ([`../../../client/paint/README.md`](../../../client/paint/README.md)): 6 bytes a pixel on the GPU beside the
  2 held in memory (D). One painted 70 µm view: 82 MB + 27 MB; one 50 µm view: 168 MB + 56 MB. Eight viewports,
  which S1's same-size example names, each with its own painter (A): 0.87 GB and 1.8 GB (D). A stack's window pays the
  RGBA8 picture once; a hanging of single frames pays it per viewport (T).
* **The canvas is not a bound**: it is the viewport's size, not the frame's. For the record: Chromium limits a WebGL
  drawing buffer to 5760 × 5760 in area, WebKit a canvas to 8192 × 8192 in area on iOS (S15).

### 4.4 · AV1 on one large frame

Level 5.x holds 8 912 896 samples and 4352 rows; level 6.x 35 651 584 and 8704 (S16). Only the 100 µm matrix fits
level 5; 85, 70 and 50 µm need level 6, and the 50 µm frame also three tiles or more ("TileWidth * TileHeight is
less than or equal to 4096 * 2304", S16; 28.03 ÷ 9.44, D). A phone's hardware decoder is promised to "Main 10, Level
4.1" at most (S17, the performance class of Android 15), so on a phone the view of a mammogram is software decode,
which here costs 1.24–1.74 of the exact frame's decode on DBT (M,
[`decode-speed-of-the-optimal-quality-picture.md`](decode-speed-of-the-optimal-quality-picture.md)). Whether
WebCodecs accepts level 6 at all is unconfirmed ([`../../av1/series.md`](../../av1/series.md)).

## 5 · The options

First picture of one 70 µm frame on a middle-class phone, wire + decode, without the round trip and the paint
(D on §4.2; V's bytes are DBT's ratio of 0.10–0.28 carried to a mammogram, **A**: no mammogram's view was measured
against the noise rule).

| | what the reader gets | LTE p10 | LTE median | Wi-Fi median | stored beside the exact series | decisions it touches |
| --- | --- | --- | --- | --- | --- | --- |
| **W** the exact frame alone, whole | the original, checked; *Lossless* always | 2.2–2.3 s | 0.45–0.54 s | 0.25–0.34 s | nothing | none: it is today's fill, and the 2026-10-10 rule ("series at 12 bits or less are filled") |
| **L** an exact level picture, then the rest of the same codestream | the frame at the screen's size, exact at that size, replaced by the whole frame | 0.57–0.67 s, whole as W + one more decode | 0.12–0.16 s | 0.07–0.10 s | a digest a level; the level's offset | *no low-resolution preview*; the label's words ("Lossless at this size") |
| **V** an AV1 view, the exact frame on request | a lossy picture until asked | 0.31–0.89 s | 0.13–0.40 s | 0.11–0.34 s | a second coded form, level 6 | *AV1 only for cine-like series*; FDA's rule on lossy review bites hardest here |
| **R** fit plus regions (tiles, or precincts) | L's first picture, then actual pixels where the viewport is | as L, then a region | | | tiles or precincts in the codestream; a digest a region | tiles "delayed, not closed" (2026-10-24); the PCS's HTJ2K layout |
| **H** the hanging as the unit: levels of every hung view first, then the rest of the one looked at | every view on screen before any is whole | four views at L's size, wire only: 2.2–2.5 s against 8.6 s | 0.39–0.43 s against 1.5 s | | as L | as L; an ask that names a level (the wire: structural, the owner's) |

* **W** is what the repository decided and built, and for the scope it is enough to *show* the frames. Its cost is
  the table's first column: on a slow link a four-view screen takes 8.6 s to complete.
* **L** is known and measured in the cloud, not adopted: a level-first fill "put the first exact picture on screen at
  ×0.09–0.49 of that and every view at ×0.06–0.50, the whole a tie" (M, the fitting ADR §8.6), and the choice was
  left with the owner; 2026-10-13 kept the plain fill "until a measurement shows a level-first fill is net". What
  this file adds: for a single frame, the first picture *is* the wait, so "the whole a tie" is not a tie for the
  reader (T). Against it: the level picture is the codestream's low band, not a resampling of the frame, and on
  `dbts_b1` it fell short of the visually lossless proxy at display scale (M, 46.9 dB,
  `claude/mobile-decode:docs/decode/mobile/htj2k-preview.md`). On a single frame it is on screen for the time the
  rest takes, 1.6 s at LTE p10 and 0.1 s on Wi-Fi (D), not for a scroll. No mammogram was in that proxy run.
* **V** is ×0.5–1.6 of L's wait at LTE p10, ahead only at the low end of its bytes, and ×0.8–3.3 by the LTE median
  (D). It needs a second stored form at a level no phone's hardware is promised, and puts a lossy picture where a
  reader looks for the finest detail. Not recommended; kept as a reference arm, as
  [`../../htj2k-tiles.md`](../../htj2k-tiles.md) §7 already has it.
* **R** is the 2026-10-10 rule extended down to 12 bits. It is the only option that never meets the texture bound
  (§3). New here, **precincts instead of tiles**: an RPCL codestream coded with precincts can yield a region's
  packets at each resolution with no tile boundary in the picture; whether the PCS's codestreams carry precincts
  smaller than the frame is not known here (the PCS team's; no source quoted, T). Not needed for the scope's frames
  on a device whose texture limit is 4096 or more.
* **H** is new: it is L with the ask model's key applied across the views of a hanging instead of along a stack. It
  matters only when a viewer hangs several views (the viewer line is paused), so it is recorded, not proposed.

**Stills (S).** They need no new delivery: a still is a small exact frame, an exam's stills are a stack in
acquisition order, and a fill of exact frames is built. A colour still's exact HTJ2K decode is 16–32 ms on the cloud
host (M, 960 × 720 to 1552 × 970, `lab/av1/bytes/colour-transform/README.md`), so a still is wire-bound on any
phone class, and its wire is at most its raw size: 0.9–2.0 s at LTE p10 uncompressed (D), less by whatever the coder
gains (not recorded). What stands in the way is the ingest's contract, each refusal quoted from
[`../../FIXTURES.md`](../../FIXTURES.md) §Refused:

1. "files of another … Rows, Columns … or PhotometricInterpretation": an exam's stills may differ in size and mix
   grey with colour; Rows and Columns are attributes of each image (S3 C.7.6.3), and no source read says a series
   keeps them equal. The options: one bundle per geometry (loses the order across them), or geometry per frame in
   the metadata (structural: the owner's and the PCS team's).
2. "a multi-frame object in a folder": a clip stored among the stills of one series.
3. "a lossy transfer syntax" and "a photometric interpretation other than MONOCHROME1, MONOCHROME2 or RGB": a
   still stored as lossy JPEG. **S3, on no list:** send such a still's own coded bytes and check them as bytes,
   since they are the original; the decoded samples then differ by decoder and cannot carry the frame check
   (T; it would reopen *XXH3 the frame check* for that class, and is the coded-bytes digest of
   `claude/integrity-model:docs/client/evidence/integrity-model.md`, PR 429, used alone). Not proposed:
   whether lossy-source stills reach us at all is the PCS's contract.

## 6 · What "fit plus tiles" (2026-10-10) covers, and what it leaves

It covers "every series over 12 bits that is not a volume or 3D view" (the fitting ADR §8): in the breast family
"only For Processing images" and raw projections. A reading display shows For Presentation images ("All mammography
Image Displays shall support the Retrieve Images transaction for 'For Presentation' images", S1), so for the scope
the rule's class is empty until a deployment sends the others. It leaves: every large frame at 12 bits or under,
which it fills whole (W); the build (the ADR is "blocked on a dependency outside this repo", tiles "delayed, not
closed"); a digest per level and per region; the label's words; and the texture bound, which it meets without having
been written for it (§3).

## 7 · A cloud run that could refute §5 (an outline for the next queue; nothing run)

Fixtures: `ffdm_d` (four views, 3328 × 4096, 12 bits, one earlier detector) and the `syn2d_*` sets; no 50 µm frame
and no breast still with its original geometry exist here. Arms W, L and, as reference, V (AV1, G 1, the rule's Q,
level 6), interleaved, at 5, 20 and 50 Mbit/s through the relay, headless Chromium, 4-core host without a GPU.
Predictions for one `ffdm_d` frame's first picture, wire + decode (D; cloud decode 92–102 ms whole, ×0.27–0.31 for
level 1, V at ×1.24–1.74):

| | 5 Mbit/s | 20 | 50 |
| --- | --- | --- | --- |
| W | 7.8 s | 2.0 s | 0.86–0.87 s |
| L | 2.0–2.3 s | 0.52–0.59 s | 0.22–0.26 s |
| V (bytes A) | 0.88–2.3 s | 0.31–0.72 s | 0.19–0.39 s |

Refuted if L's first picture is not within ×0.25–0.33 of W's at 5 Mbit/s, or if V beats L at 50 Mbit/s by more
than the run's noise floor. Also to record, each a yes or a no: does `VideoDecoder.isConfigSupported` accept the
level-6 configuration; does the page paint a frame of 4097 rows on the host's WebGL (prediction: it depends on the
host's limit, and the client says nothing either way).

## 8 · For the owner, through the `non-cine-series` page

1. **Large single frames at 12 bits or under: the exact frame alone, no AV1 view** (W; V not taken). A yes changes
   one sentence in `ARCHITECTURE.md` and `design.md` §Open; nothing is built.
2. **An exact level picture first (L) on those frames:** queue §7's run, or leave the 2026-10-13 ruling as it is.
   A yes to the run changes no product code.
3. **Stills are a stack of exact frames**; the three ingest refusals of §5 go to the PCS team as questions (which
   of them the PCS's output can contain), beside `metadata.md` §Open's.
4. **The painter refuses a frame over the device's texture limit by name** (one test, as the native painter has),
   now; splitting the upload over several textures waits for a 50 µm matrix in scope.
5. **Over 12 bits waits**, with tiles, as decided.

## 9 · What it would reopen, and builds nothing on

* L and H: *no low-resolution preview (a preview is tiny or full size)*, unless the owner reads an exact level of
  the same codestream as the queue of 2026-11-10 did ("This is not a low-resolution preview (decided: none); it is
  one lossless codestream served at the screen's resolution, whose further levels complete it").
* V: *AV1 only for cine-like series*. S3: *XXH3 the frame check, every frame checked*, for lossy-source stills only.
* R below 12 bits: the 2026-10-10 line "frames of 12 bits or fewer are filled".

## Where it holds, and its limits

Nothing here was run. The measured numbers are earlier rows': `ffdm_d` (four For Presentation views of one earlier
70 µm detector, 12 bits), nine level-1 series, six sets of eight colour ultrasound stills that are not breast
stills, three DBT volumes of one dataset for the view's ratios; 4-core x86 cloud hosts without a GPU, headless
Chromium 141 and 153, software decode. Phone numbers are a model's ranges, its 2026-11-22 round not yet read. No
50 µm frame, no generated 2D at its real depth from more than one vendor, no breast ultrasound exam with its
original objects, no phone's `MAX_TEXTURE_SIZE`, and no reader. Coded sizes other than `ffdm_d`'s are scaled by
pixel count (A): a finer detector's noise a pixel differs, so they may be off in either direction.

**For breast ultrasound and DBT stacks:** this file is their complement. Its §2 says what else a study of each
carries; its bounds carry to a DBT slice by pixel count and depth (a slice is a frame of the same matrices), and the
texture bound applies to a stack's frames unchanged.

## 10 · Sources

Fetched 2026-11-22; sha256 of the file as fetched.

* **S1** IHE Radiology Technical Framework, Volume 2, "Revision 23.0 Final Text, August 8, 2025",
  `https://www.ihe.net/uploadedFiles/Documents/Radiology/IHE_RAD_TF_Vol2.pdf`,
  `23b6e028b038ac7cedd0af958057b9be07c342d4ea42866d463189ec982e35ad`: §4.16.4.2.2.1.1 (lines 5708–5718);
  §4.16.4.2.2.1.1.3.1 *Same Size* (5780–5787: "a user reviewing a four-view screening mammogram together with a
  four-view prior mammogram might want to display eight viewports"); §4.16.4.2.2.1.1.3.3 *View Actual Pixels*
  (5805–5811); §4.16.4.2.2.1.1.9 (5989–5993); §4.16.4.2.2.1.3 *Display of DBT Images* (6003–6030: "shall fulfill all
  requirements listed in Section 4.16.4.2.2.1.1 for the display of Digital Mammography X-Ray Image instances" and
  "the user shall be provided with a means to toggle between the available conventional 2D mammography images,
  tomosynthesis slices, tomosynthesis projection images (if the For Presentation Breast Projection X-Ray Images
  Option is supported), and generated 2D image for the views currently displayed without affecting the display
  layout"); §4.8.4.1.2.7 and its Table 4.8.4.1.2.7-1.
* **S2** The same framework, Volume 1, "Revision 23.0 – Final Text, August 8, 2025", lines 6860–6870,
  `https://www.ihe.net/uploadedFiles/Documents/Radiology/IHE_RAD_TF_Vol1.pdf`,
  `4f3d47400e22e0b1d0653e5ae0f74e3fbc843a1ec9646e2b8bb68db64e664f65`.
* **S3** DICOM PS3.3 2026e, `https://dicom.nema.org/medical/dicom/current/output/chtml/part03/<section>.html`:
  `sect_A.26` `3e02a99e0ba0c986b97fba519b39fba785e934bec3c8edfe67c7e2b0c4bda448`; `sect_C.8.11.3` (DX Image
  Module: "Bits Stored … Enumerated Values: 6 7 8 9 10 11 12 13 14 15 16")
  `1113677a8461fb1182bdab197803f00cf0d1146bce32bea7f5dd64ed3f433071`; `sect_A.6`
  `01168b347eb94191895362aa6aa7e00ac7583de2b5c1fc6da0913ed833675d41` and `sect_A.7`
  `c8975bd6d09a9e88ac79eadb27866b690c8b7e3861e6d8afbcbb2bed9eb63b75` (Tables A.6-1 and A.7-1: "Cine | C.7.6.5 | M",
  "Multi-frame | C.7.6.6 | M" in the second only); `sect_C.8.5.6`
  `9d745240a46fb084aa07c8c8622ddffa7f80a6334c622eafffc3c47decfb4223`; `sect_C.7.6.3` (Table C.7-11c: "Rows
  (0028,0010) 1 Number of rows in the image.") `401608e320741a1229d888db89b7d5ebaa85386c786ffc9a21bae3a03d5dccd6`.
* **S4** FDA, *MQSA National Statistics*, "Content current as of: 11/09/2026", "Certification statistics, as of
  November 1, 2026": "Total certified facilities / Total accredited units | 9,140 / 27,933"; "Certified facilities
  with 2D digital units / Accredited 2D digital units | 9,139 / 14,264"; "Certified facilities with DBT units /
  Accredited DBT units | 8,702 / 13,668"; footnote 4: "Facilities with DBT also have FFDM".
  `https://www.fda.gov/radiation-emitting-products/mqsa-insights/mqsa-national-statistics` (redirects),
  `2d6b4edef21c657a530c00c3de2ebc9839339dd1fc035800c07f1dbea7729910`.
* **S5** ACR, *Practice Parameter for the Performance of Digital Breast Tomosynthesis*, "Revised 2023 (Resolution
  9)", §A, `https://gravitas.acr.org/PPTS/DownloadPreviewDocument?DocId=7`,
  `b039c7e41c8b804814061da3ecdcaf4bd1edee9194203f1b29a87cd9480bea5a`.
* **S6** ACR, *Practice Parameter for the Performance of a Diagnostic Breast Ultrasound Examination*, "Revised 2026
  (Resolution 21)", §IV.B.1 and §IV.B.4, `https://gravitas.acr.org/PPTS/DownloadPreviewDocument?DocId=124`,
  `969423a7352ded1bc3758e13ee27c59bed0bed139c19ab3c220311df6b43b7a7`.
* **S7** ACR, *Practice Parameter for the Performance of Whole-Breast Ultrasound for Screening and Staging*,
  "Revised 2024 (Resolution 10)", p. 5, `https://gravitas.acr.org/PPTS/DownloadPreviewDocument?DocId=61`,
  `273b937de8b4a0c8e664a8c440ca05fde6ea2bb665f6a6455e9b564c186fe9bc`.
* **S8** PubMed abstracts through `eutils.ncbi.nlm.nih.gov` efetch, one file,
  `76922908bc9c96c0c171d8e28d5165be39b3a106fc2381c65fc61eb8e3917ad6`: PMID 40795810 (Br J Radiol 2025;98(1175):
  1963-1969): "6849 screening exams on 13 484 breasts … that received 3D views (13 482/13 484, or 99.99%) and 2D
  acquisitions (9459/13 484, or 70.15%)"; PMID 24694157 (Med Phys 2014;41(4):042901): "An ABUS volume was comprised
  of 229-282 slices of two-dimensional (2D) images." Abstracts only.
* **S9** NHS Breast Screening Programme technical evaluation reports (the national coordinating centre's site,
  `https://medphys.royalsurrey.nhs.uk/nccpm/`), each "Pixel array" and file-size table as printed; phantom
  acquisitions, not clinical averages. A 100 µm system's tomosynthesis report, January 2019, pp. 6–7 ("2394 x
  2850"; "Planes 2394x2850 145 1900"), `1285b9ad29f797a08995f373adae59f62a79a80abeea8b41b4c1d4a03bd673c6`. An 85 µm
  system's, December 2024, pp. 8–9 ("2816 x 3584"; "Planes 2816x3584 61 821"),
  `848e03f232e568b2bd7273c9d5daada6f0eb911f1bd1d789cec92e5530fec506`. A 70 µm system's 2D report, February 2026,
  p. 8 ("Pixel array 3328 x 4096 / Typical image sizes 16.2 MB … 26.0 MB"),
  `7bc21553537857cc9d23d0efe4400b47a257a0b83c501fdfbf32d6160ebf608b`, and a 70 µm system's tomosynthesis report,
  March 2019, p. 8 ("Planes 2560x3328 66 1120", the 18 cm x 24 cm paddle, with the 2D report's 16.2 MB field),
  `084fdf76664759a48097a31988baeedaab8bd07bd92297492911859d602dfdf0`. A 50 µm
  system's, Equipment Report 1601, February 2017, p. 7 ("Pixel array 4728 x 5928"),
  `03b88291039de59375e5ae98ba905d908d89a2959d6bcb764258a48a034fedb2`.
* **S10** A vendor's DICOM conformance statement, RD-04751 Revision 001, August 2023 (listed in
  [`../../av1/series.md`](../../av1/series.md)'s sources), Table 7.1-13 ("Bits Stored
  Original image: 14 / Derived image: 12 / Generated 2D image: 10"),
  `f15767a820cf4de5af89c6379d68b227afa1d8c0b98ce511ddcb331fbafa8d11`.
* **S11** OpenGL ES 3.0.6 (November 1, 2019), Table 6.28 (printed p. 273) and §3.8.3,
  `https://raw.githubusercontent.com/KhronosGroup/OpenGL-Registry/6af574a14089ccfee87efe230ebcdd8742859813/specs/es/3.0/es_spec_3.0.pdf`
  (the registry's own host answered an automated-client check),
  `7e831831595d3e44c267cc0a0d754f8c244cf3c8f5056f49a674f25fb9d5adeb`.
* **S12** KhronosGroup/Vulkan-Profiles at `42ab32071ec62228a8302f08b96b3eeebcfd5256` (2026-11-20),
  `profiles/VP_ANDROID_baseline_2022.json` line 70 `1ea115eb3ff05a3fe5ce0b5d41b00f4a4d6fd4e935609ebc75a2ae4da4e7353c`,
  `VP_ANDROID_baseline_2021.json` line 49 `c6f39eec7d5f6a9147aa6f65247fa241dfd9e6dae0453b279653e8d03060b256`,
  `VP_ANDROID_16_minimums.json` line 56 `78eeb53155a8aee1c70f517ed29f7b10dc871e9e07f8ff6247b47190fa50297f`.
* **S13** WebGPU, gpuweb/gpuweb at `ca61f22ce89f36537fe2f6b9706ea5bd138d2f64` (2026-11-21), `spec/index.bs`
  §Limits, lines 1622–1625 and 1672–1673, `280b47ea412609273447810cdf4b0e8b61104436ee378570d8d7fbb7d2074a26`.
* **S14** WebGL 2.0, KhronosGroup/WebGL at `39443210f7f81db4773eb104facadfb85d05dfa4` (2026-11-05),
  `specs/latest/2.0/index.html` line 87, `05da9e8c2110e7cf57a25944c96484fe139ab1225216adc2b4a778eea78499cd`.
* **S15** chromium/src at `6e14c6883bfc79413d4ae88039a21b648038fca9` (2026-11-22),
  `third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc` lines 2558–2571 ("const int kMaxArea =
  5760 * 5760;"), `16a26e5509c9a8d13c7ede6abaa9318b6a18e620fd1bf3ec35c746f090540c39`. WebKit/WebKit at
  `f12fdb01dc25c1de22c9630e00a4d114e5dd12fc` (2026-11-22), `Source/WebCore/html/CanvasBase.cpp` lines 124–131
  ("#if PLATFORM(IOS_FAMILY) return 8192 * 8192;"),
  `b9ee05415afa83f4a078a9f7fd85aacf5be2080e0d10b10a5180292756b1e430`.
* **S16** AV1 Bitstream & Decoding Process Specification, AOMediaCodec/av1-spec at
  `5e04f3f75e73a5898d7616c47c52f032144b8f80` (2023-06-12), `annex.a.levels.md` lines 76–92 and 259,
  `80a54c0423ac29e65113d6ed09c13d47e7cd0bd1d713acd5678519cde64fefea`.
* **S17** Android 16 Compatibility Definition, §2.2.7.1: "[5.1/H-1-14] MUST support AV1 hardware decoder Main 10,
  Level 4.1 with film grain effect over GPU composition." `https://source.android.com/docs/compatibility/16/android-16-cdd`,
  `0c0b740cd0e1c4a8e8028dcd3ee497e57bb83edbb7ab9bc04f4845f2e3547dde`. Android 17's text names no level.

Not found, and said so above: a published share of single-frame series in an archive; a published count of stills
an exam; a distribution of `MAX_TEXTURE_SIZE` over phones in use. Not read: IHE's and DICOM's text on lossy JPEG
decoders' tolerances (§5's "differ by decoder" is unquoted theory).
