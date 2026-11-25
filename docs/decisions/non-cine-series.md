# What a series that is not a stack gets

Written 2026-11-22 by row NON-CINE-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`), a session that ran none of
the rows behind it, from pushed results only; nothing run but `git` reads. Inputs: `claude/non-cine` `69c0552aa`
(`docs/client/evidence/non-cine-series.md`, cited below as *the file*, with its section), PR 431's body
(§NON-CINE-REVIEW, §NON-CINE-REVIEW-FIX, §Re-review with its n1–n4, carried corrected here), and at
`origin/claude/unified`: [`../client/design.md`](../client/design.md) §Open, the fitting ADR, `client/paint/paint-worker.js`.
**Nothing on this page was run for it: every number is a source, derived, assumed, or an earlier row's measurement,
labelled where it is used.**

## 1 · The question

A breast study is not only stacks. A DBT view also has a synthesized 2D picture, a combined exam a conventional 2D
mammogram, and a hand-held ultrasound exam is mostly stills. "What series that are not cine-like get is not stated
yet" (`design.md` §Open, last line). It is the owner's because it sets what the product shows for half the pictures
of a DBT exam, and two of its options would reopen decided approaches (*no low-resolution preview*, *AV1 only for
cine-like series*).

## 2 · The recommendations, and the owner's yes or no

"Not cine-like" is three classes (the file §1): **a large single frame** at 12 bits or under (the synthesized 2D, a
2D mammogram: half a DBT exam's pictures by count, under 5 % by bytes, **derived**); **stills** (most of a hand-held
ultrasound exam, 8 bits, grey or colour); **over 12 bits** (For Processing images, which a reading display does not show).

| # | item | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | Large single frames ≤ 12 bits: **the exact frame alone, whole (W); no AV1 view (V)** | **yes** | one sentence each in `ARCHITECTURE.md` and `design.md` §Open (a docs row); nothing built: W is today's fill | the class unstated; V stays an option on a frame no phone's hardware decoder is promised to take (§4) |
| 2 | **An exact level picture first (L)** on those frames | **run the one cell not measured, adopt nothing yet** | nothing: the run (the file §7: level 1 on `ffdm_d`, V as reference, two yes/no probes) changes no product code, so it is queued by PHASE2-PLAN without a yes (amendment 28 rule 2); adopting L stays [`exact-frame-layout.md`](exact-frame-layout.md) item 5's question, "no, for now" | the 2026-10-13 ruling (the plain fill "until a measurement shows a level-first fill is net") with level 1 unmeasured |
| 3 | **Stills are a stack of exact frames**, in acquisition order; the ingest's three refusals (sizes that differ in one series, a clip among stills, a lossy source) go to the PCS team as questions | **yes** | three questions added to the PCS note beside `metadata.md` §Open's; no delivery change | the refusals stand unasked, and a real ultrasound exam is refused at the ingest (read in `docs/FIXTURES.md`, not run) |
| 4 | **The painter refuses a frame over the device's texture limit by name** | **yes, now** | one Opus row: a test against `MAX_TEXTURE_SIZE` before `texStorage2D` and a named refusal, with a failing test first, as a draft PR into `claude/unified`; splitting the upload over several textures waits for a 50 µm matrix in scope | a frame over the limit paints nothing and says nothing (§4) |
| 5 | **Over 12 bits waits**, with tiles ("fit plus tiles", 2026-10-10) | **yes** | nothing | the same |

**How they serve the value statement** (amendment 27 item 7: "open a breast DBT or ultrasound study … and start
reading sooner"; "Every frame the reader asks to see exactly is the original, bit for bit, and checked"): a DBT
display must also show the 2D pictures of the same view (IHE RAD TF-2 §4.16.4.2.2.1.3, the file S1), so a reader's
first picture is often a single frame, and item 1 keeps it the original; item 2 is the one lever on that first
picture's wait, measured before it is adopted; item 4 turns a blank viewport on a phone into a stated refusal; item 3
is what stands between an ultrasound exam and any picture at all.

## 3 · The options

First picture of one 70 µm frame (3328 × 4096, 4.81 MB coded exact, **measured** on `ffdm_d`), wire + decode, a
middle-class phone, no round trip or paint (**derived**, the file §5; L at level 1 carried, level 2 measured):

| | what the reader gets | mobile p10, 18 Mbit/s | mobile median, 103 | Wi-Fi median, 218 | stored beside the exact series | reopens |
| --- | --- | --- | --- | --- | --- | --- |
| **W** the exact frame, whole | the original, checked | 2.2–2.3 s | 0.45–0.54 s | 0.25–0.34 s | nothing | nothing |
| **L** an exact level picture, then the rest of the same codestream | the frame at the screen's size, exact at that size | level 1: 0.57–0.67 s (**derived**, bytes carried); level 2: 0.16–0.17 s (**derived** on measured bytes) | 0.12–0.16 s; 0.03–0.04 s | 0.07–0.10 s; 0.02–0.03 s | a digest a level | *no low-resolution preview*, unless read as one codestream at the screen's size |
| **V** an AV1 view, the exact frame on request | a lossy picture, at most 10 bits of a 12-bit frame (the depth cut) | 0.31–0.89 s | 0.13–0.40 s | 0.11–0.34 s | a second coded form, AV1 level 6 | *AV1 only for cine-like series* |
| **R** fit plus regions (tiles or precincts) | L's first picture, then actual pixels under the viewport | as L, then a region | | | tiles or precincts; a digest a region | "frames of 12 bits or fewer are filled" |
| **H** levels of every hung view first | every view on screen before any is whole | four views 2.2–2.5 s against W's 8.6 s | 0.39–0.43 s against 1.5 s | | as L | as L; an ask that names a level (structural) |

V's bytes are DBT's view ratio (0.10–0.28) carried to a mammogram, **assumed**: no mammogram's view was measured.
L at level 2 is measured in the cloud: the first exact picture at ×0.09–0.27 of today's fill's on the 5/20/50 Mbit/s
links (**measured**, `ffdm_d`, [`../decode/README.md`](../decode/README.md) §A frame at the level the screen needs;
"of today's fill's", four views a fill, is the re-review's n3 correction of "of the whole fill's").

Stills (**C**, the coded bytes, on no earlier list): a lossy-JPEG still sent as its own coded bytes and checked as
bytes. Not proposed: it would reopen *XXH3 the frame check* for that class, and whether such stills reach us at all
is the PCS's contract (the file §5).

## 4 · Where it holds

**Fixtures** (earlier rows'; none used here): `ffdm_d` (four For Presentation views of one earlier 70 µm detector, 12
bits), nine level-1 series, six sets of eight colour ultrasound stills that are not breast stills, three DBT volumes of
one dataset (`dbts_a1`, `dbts_b1`, `dbts_c1`) for the view's ratios; 4-core x86 cloud hosts without a GPU, headless
Chromium 141 and 153, software decode. What is missing is in the list below.

**The population.** Phone decode is scaled by the device model's ranges for an HTJ2K frame on one fast core
(×1.75–2.50 entry, ×0.81–1.65 middle, ×0.65–1.03 premium against the cloud host, **derived** on its theory; that
model's own phone prediction not read against the 2026-11-22 round when NON-CINE-OPTIONS wrote it; the round is read
in [`phone-decode-route.md`](phone-decode-route.md) §4). Links are `link-profiles.md`'s open-data
goodputs, not ours.

**Where the link, not the decode, binds** (amendment 28; labelled and completed 2026-11-25, PAGES-PASS): for one frame
the fill's law does not apply, first picture ≈ wire **+** decode; the wire is the larger term on every class up to the
mobile median, and it equals the decode at 151–239 Mbit/s on entry phones, 229–517 middle, 366–644 premium
(**derived**, the file §4.2). So below about 150 Mbit/s bytes decide the first picture of a single frame on any phone,
and only item 2 moves it. No link here is measured (the list below), and no transport row is lowered by this or by
the decode-bound phone (`README.md` §Premises item 1: on the one phone measured, the exact series filled faster than
the view in 15 of 15 rounds, median 0.705; the premise untested).

**To breast ultrasound and DBT stacks:** this page is their complement, not a result about them. Its bounds carry to a
DBT slice by pixel count and depth (a slice is a frame of the same matrices, **theory**); the texture bound applies to
a stack's frames unchanged: a `dbts_b1` slice (2560 × 3328) fits a 4096 limit and not 2048 (**derived** on the
OpenGL ES 3.0 minimum of 2048 and Android's Vulkan baseline 4096, sources quoted in the file §4.3). An ultrasound
clip's frames (0.5–1.6 Mpx) are under every limit. Item 4's fix therefore protects stacks as well.

**Each limitation and what found it** (completed 2026-11-25, PAGES-PASS):

* No 50 µm frame, no generated 2D at its real depth from more than one vendor, no breast ultrasound exam with its
  original objects, no phone's `MAX_TEXTURE_SIZE`, no reader. Found by NON-CINE-OPTIONS (the file §Where it holds, and
  its limits; §7: "no 50 µm frame and no breast still with its original geometry exist here").
* No radio: the links are `link-profiles.md`'s open-data goodputs, not ours. Found by this page's reading of the
  file's §4.2 inputs; what found it first is not recorded.
* The phone decode is the device model's ranges; when NON-CINE-OPTIONS wrote them the model's own prediction was not
  read against the 2026-11-22 round (the file §Where it holds: "its 2026-11-22 round not yet read"), which
  `phone-decode-route` §4 reads since. Found by NON-CINE-OPTIONS; dated by PAGES-PASS-FIX (README §Pass review m8).

* Level 1 on `ffdm_d` (the level a phone's 1080 × 2400 device pixels need) is carried from the nine level-1 series
  (25.8–29.0 %), not measured on this frame: NON-CINE-REVIEW B1, fixed by labelling it, still unmeasured.
* Level 2 is what the harness's 1 000-pixel rule picks and what a **phone's** left–right hanging needs (540 × 665 a
  view, **derived**), not a laptop's two views, which still need level 1: the re-review's n1, corrected here.
* "No AV1 decoder at all" on phones without the media performance class: every handheld MUST decode AV1 ([5.3/H-0-6],
  Android 16 CDD §2.2.2); what is not promised is a **hardware** decoder, and none to level 6: the re-review's n2. The
  conclusion stands: a mammogram's view would be software decode on a phone, 1.24–1.74 of the exact frame's decode on
  DBT (**measured**, `decode-speed-of-the-optimal-quality-picture.md`).
* Under 5 % of a DBT exam's bytes (0.7–2.4 % with one 2D picture a view, 1.4–4.7 % with two), not under 3 %:
  NON-CINE-REVIEW m2; PR 431's opening summary still says 3 % (n4).
* "A frame over the texture limit paints nothing and says nothing" is read in `client/paint/paint-worker.js`, not run
  (the file §4.3; NON-CINE-REVIEW read it; at `origin/claude/unified` today the one `texStorage2D` call, line 97, has
  no limit test before it, and no file under `client/` names `MAX_TEXTURE_SIZE`).
* The level picture fell short of the visually lossless proxy at display scale on `dbts_b1` (46.9 dB, measured,
  `claude/mobile-decode:docs/decode/mobile/htj2k-preview.md`); no mammogram was in that run. Found by the resolution
  ladder, as HTJ2K-PREVIEW-MOBILE quotes it.
* Coded sizes other than `ffdm_d`'s are scaled by pixel count (**assumed**); a finer detector's noise differs, "so they
  may be off in either direction". Found by NON-CINE-OPTIONS (the file §Where it holds, and its limits).
* V's bytes are DBT's view ratio carried to a mammogram (**assumed**: no mammogram's view was measured). Found by
  NON-CINE-OPTIONS (the file §7's predictions: "V's 0.10–0.28 from DBT").
* Not found by any source read (the file §10): a share of single-frame series in an archive; a count of stills an
  exam; a distribution of `MAX_TEXTURE_SIZE` over phones in use. "Differ by decoder" for lossy JPEG is unquoted theory.

## 5 · The mechanism

A stack's fill is a pipeline: frames arrive while others decode, so the slower of wire and decode sets the pace. One
frame is not a pipeline: its bytes arrive, then it decodes, so the wait is the sum, and its bytes are most of it below
about 150 Mbit/s. Only fewer bytes before the first picture help: a level of the same codestream (L, exact at that
size) or a smaller lossy form (V). V needs a second stored form at a level no phone's hardware takes and puts a lossy
picture where the reader looks for the finest detail, and on a single frame it is ahead of L only at the low end of
its bytes (×0.5–1.6 of L's wait at mobile p10, **derived**). The texture bound is absolute: a GPU refuses a texture
larger than its limit, and the painter uploads the frame at its own size, so a 4728 × 5928 frame on a 4096 device is
refused by the GPU and nothing tells the reader. Fit plus tiles never meets the bound, since a level that fits the
viewport and a region the viewport's size are no larger than a screen. Stills need nothing new in delivery: an exam's
stills in acquisition order are an index a fill can follow; what is missing is at the ingest.

## 6 · What would change the recommendation

* **The file §7's run** (cloud, pre-registered predictions there): W, L at level 1 and V as reference, interleaved at 5,
  20 and 50 Mbit/s on `ffdm_d`. L is refuted if level 1's smallest exact prefix falls outside 25.8–29.0 %, or its
  first picture, less the round trip, outside ×0.26–0.29 of W's at 5 Mbit/s; V against its own band. A confirmed L at
  ×0.26–0.29 makes item 2 a question for the owner's wording (`exact-frame-layout.md` item 5), not for more runs.
* The same run's two probes: does `VideoDecoder.isConfigSupported` accept level 6 (if no, V is off on Chromium
  whatever its bytes); does the page paint a frame of 4097 rows on the host's WebGL.
* **A phone session** reading `MAX_TEXTURE_SIZE`: at 8192 and over, item 4 is a guard; at 4096, a 50 µm detector's 2D
  picture cannot be shown on that phone without R or a split upload.
* **The PCS team's answers** to item 3: if its output never mixes geometries in a series or holds lossy stills, two
  refusals are moot.
* **A reader**, for whether an exact level picture may be painted first; no agent runs that.

## 7 · What it would reopen

Nothing, if taken as recommended. Not taken, and building nothing on it: L and H would reopen *no low-resolution
preview* unless the owner reads an exact level of the same codestream as the queue of 2026-11-10 did ("This is not a
low-resolution preview (decided: none); it is one lossless codestream served at the screen's resolution, whose further
levels complete it", quoted in the file §9); V *AV1 only for cine-like series*; C *XXH3 the frame check, every frame
checked*, for lossy-source stills; R below 12 bits the 2026-10-10 line "frames of 12 bits or fewer are filled".
DELIVERY-FIT-ARM (amendment 28, phase 2: "each frame first at the resolution level that fits the screen", HTJ2K only)
is option L read as one codestream, for stacks; it reopens nothing under that reading, and its result is evidence for
L here (added 2026-11-23, `README.md` §Review m12).

## 8 · Rows and links

* NON-CINE-OPTIONS (Fable), NON-CINE-REVIEW (B1, m1–m11), NON-CINE-REVIEW-FIX, NON-CINE-REVIEW-FIX-REVIEW (no
  blocker; n1–n4): PR 431, `claude/non-cine` `69c0552aa`, status files under `claude/work-ledger:docs/queue/`.
* The file's sources, each with its sha256 there (§10): S1 IHE RAD TF-2 Rev 23.0; S3 DICOM PS3.3 2026e; S9 the NHS
  Breast Screening Programme's technical evaluation reports; S11 OpenGL ES 3.0.6; S12 Vulkan-Profiles; S13 WebGPU;
  S16 the AV1 specification's levels; S17 the Android 16 CDD.
* The fitting ADR: [`../adr/resolution-fitting-for-large-frames.md`](../adr/resolution-fitting-for-large-frames.md);
  the level's measured cells: [`../decode/README.md`](../decode/README.md); the ingest's refusals:
  [`../FIXTURES.md`](../FIXTURES.md); the tiles' line: [`../htj2k-tiles.md`](../htj2k-tiles.md); the links:
  [`../transport/link-profiles.md`](../transport/link-profiles.md).
* Related pages: [`exact-frame-layout.md`](exact-frame-layout.md) item 5 (a level picture first, on stacks);
  [`visually-lossless.md`](visually-lossless.md) (what a lossy view may claim); [`asking.md`](asking.md) (the need-time
  key, which on a single frame orders levels, then regions: the file §3).
