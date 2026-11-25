# Do the results carry to ultrasound clips and to DBT stacks

Written 2026-11-24 by row US-DBT-CARRY (`claude/work-ledger:docs/queue-2026-11-24.md`; the program's amendment 28
item 3.3), a session that ran none of the rows behind it, from pushed results only; **nothing run** but `git` reads
and five fetches of standards. Inputs: the 20 pages and [`README.md`](README.md) at `8f396eb74`; the program's
§Decided approaches (`claude/work-ledger:docs/queue-2026-11-14.md`); and at `origin/claude/unified` `b7cc007f7`:
[`../FIXTURES.md`](../FIXTURES.md), `docs/av1/groups.md`, `docs/av1/noise-point.md`, `docs/av1/preview-noise.md`,
`lab/av1/profiles/README.md`, `lab/av1/profiles/results/lossless.jsonl`, `lab/av1/metrics/README.md`,
`lab/av1/bytes/colour-transform/README.md`, `claude/unified:docs/client/evidence/ask-model.md`,
`docs/client/evidence/what-a-view-asks-for.md`, `ingest/from-parser/src/main.rs`, `optimal.rs`,
`ingest/from-dicom/dicom_series.py`. Every number is labelled **source**, **theory**, **derived** or **measured**;
a measured number is an earlier row's, with its file. S1–S5 are §8's sources.

## 1 · The question

Every page carries its result to breast ultrasound "by theory" or says "not yet known", and none tested the premise
under that: that an ultrasound clip behaves as a DBT stack does (`README.md`, premise 2). For each decided approach
and each page's recommendation: does it hold for both, and by which property? It is the owner's because the scope
(amendment 27 item 6), the value statement and the release's status line all name both modalities.

## 2 · The recommendation, and the owner's yes or no

**For DBT stacks every page stands as written. For ultrasound, stop carrying "by theory": the premise is refuted on
the ultrasound pixels the fixtures hold, and it fails first at the door, not at the codec. Treat a clip as its own
case, decided by three properties: what its source is (lossy and colour-typed, in the archives read), that its
decode never binds (so its frame rate and the wire decide), and that its fine band is texture, not noise.**

| # | the owner's yes or no | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | **Premise 2 is retired.** Pages say of ultrasound what §4's tables say: *holds*, *holds in form only*, *moot*, *does not hold*, or *not known*, each with its property | **yes** | PAGES-PASS, or a row after it, replaces each page's ultrasound paragraph by its line of §4.3; the status line stays "ultrasound: function-checked, not measured" until item 7 | 15 pages each carrying to ultrasound by a different unstated property |
| 2 | **The source of a clip is asked first.** 997 of 1 000 multi-frame ultrasound instances read in a public archive are flagged lossy, 979 are colour-typed (§3, **measured** on headers). The PCS note asks: of the clips you deliver, how many are flagged lossy; in which photometric interpretation do their frames reach us; is Ultrasound Color Data Present (0028,0014) kept; and is the scanner's coded stream kept | **yes** | four questions added to PCS-NOTE's draft, with a request for one clip *as delivered* beside the lossless one | the product ingest reads `MONOCHROME1`, `MONOCHROME2` and `RGB` only and codes a view for grey only, so most field clips would be refused or served with no view, unseen until a site |
| 3 | **The exact frame of a lossy-sourced clip is not called "Lossless".** It is the delivered samples, bit for bit and checked; the label says so (*Original*, with *source lossy* where the flag is `01`) | **yes**, as one more wording for `frame-integrity` item 1's row | that row gains a state's wording; nothing else | *✓ Lossless* shown on a frame DICOM says "shall not be reset" from lossy (S1) |
| 4 | **A clip's switch is its own, and needs no device table:** the exact series alone where the goodput is at least an exact frame's bytes times the clip's rate; below it, the view first and the whole exact clip behind it without a request | **yes, as theory to be tested**: one pre-registered cloud cell on `usb_cine` (function check) and `uscine_crc1`…`3` (sound), in the next queue | a protocol row; no product code; `delivery-per-link` items 2 and 3 are answered for DBT only | DBT's rule (*G*★ = *b*_E ÷ *d*_V, a device's decode) applied to a series whose decode never binds |
| 5 | **A clip's fill is measured as time to stall-free play** at its rate, beside first picture, fill and jump | **yes** | SESSION-COST's and the next delivery protocol's clip cells report it (their authors' call how); the ask model's gate (§4.1) is its prediction | a clip judged by a DBT stack's three times, none of which says whether it plays |
| 6 | **Colour clips: exact only, for now**; the view's colour form (4:2:0, which a Main decoder must take, or 4:4:4, which it need not, S3) is measured before any build; a clip whose three samples are equal everywhere is grey and may be coded as one plane (S1's own note) | **yes**: as built; one theory row sizes both, next queue | nothing built | the same, with no row owning it |
| 7 | **The sound ultrasound fixtures are used.** `uscine_crc1`…`3` (the one sound cine, pinned 2026-11-04) appear in no row, rig or result; US-END-TO-END, SESSION-COST-RUN and item 4's cell take them beside `usb_cine` | **yes** | each of those rows gets one sentence in its brief or its review; an ultrasound number the provenance rule admits exists for the first time | every ultrasound time and byte stays "provisional" by the rule, with a sound clip unused |
| 8 | **Contradiction 6:** the value statement keeps "study"; the status line says "stacks and clips" and names what of a study it does not open | **yes** | one sentence in `final-state` §2's line (§5 below) | a status line read as the statement met |

**How it serves the value statement** (amendment 27 item 7). "A breast DBT *or ultrasound* study": items 1, 2 and 7
are what make the second half a tested claim instead of a carried one. "Every frame the reader asks to see exactly is
the original, bit for bit": item 3 keeps that sentence true of a clip whose original is already lossy. "A fast first
picture, a fast full fill": items 4 and 5 say what those mean for a series that is played, not scrolled.

## 3 · The options

What a clip could be given, with the numbers that separate them. Bytes are whole-set means from
`lossless.jsonl` and `lab/av1/metrics/README.md` §Controls; ratios from `lab/av1/profiles/README.md` and
`docs/av1/groups.md`; all **measured** there, on one 4-core cloud host, libaom 3.15.1.

| set (provenance) | frame | exact HTJ2K, bytes a frame · ratio | view at Q 8, G 1, ÷ exact | G 16's gain at Q 8 |
| --- | --- | --: | --: | --: |
| `dbts_a1` (sound) | 1142 × 1785, 12-bit | 1 210 936 · 2.53 | 0.074 | −0.2 % |
| `dbts_b1` (sound) | 2560 × 3328, 10-bit | 2 148 152 · 4.96 | 0.219 | +1.2 % |
| `ustrus_1`, `ustrus_2` (sound; a prostate sweep) | 452², 8-bit | 75 716, 78 094 · 2.70, 2.62 | 0.338, 0.347 | +23.0, +22.7 % |
| `usb_cine` (lossy-sourced: an MPEG-4 clip) | 512², 8-bit, 25 frames/s | 78 004 · 3.36 | 0.291 | +72.2 % |
| `usb_cine_rgb` (lossy-sourced) | 512² RGB, 30 frames/s | 184 711 · 4.26 | 0.177 | — |
| `us_liver` (lossy-sourced: flagged `01`, ratio 12.4) | 760 × 421 RGB | 257 419 · 3.73 | 0.247 | +8.3 % |

| option | what it is | its number | verdict here |
| --- | --- | --- | --- |
| U0 | as built: a grey clip gets the view at the bare flag's Q 8, G 8; a colour clip the exact series alone; other photometrics refused | `main.rs:249–251`, `optimal.rs:34` (**measured** by reading) | what item 2's answers are needed for |
| U1 | the clip's switch (item 4): exact alone where *G* ≥ *b*_E × *r* | 15.6 Mbit/s for `usb_cine`, 44.3 for `usb_cine_rgb` (**derived**: 78 004 × 25 × 8; 184 711 × 30 × 8; provisional, lossy-sourced); `what-a-view-asks-for.md` has the same form ("25 frames/s needs … 51 on `us_liver`") | recommended as theory |
| U2 | the view first, the whole exact clip behind it, unasked | a clip's exact series is 5.0–18.0 MB (`usb_cine`, `usb_cine_rgb`, `us_liver`; 64–70 frames) against 67.8–107.4 MB a DBT volume (**measured**) | with U1; answers contradiction 1 for clips |
| U3 | the scanner's lossy stream passed through as the exact frame, its bytes hashed | `us_liver`: 3.3× fewer bytes than its lossless re-coding (**derived**: 12.4 ÷ 3.73, one clip) | **not recommended now**: asked in the PCS note only (§7) |
| U4 | a colour view, 4:2:0 or 4:4:4 | "WebCodecs takes no High profile" (`colour-transform/README.md`, **measured** on this host's Chromium); no 4:2:0 colour view row exists | a theory row first |
| U5 | G over 1 for clips | +23 % on the sound sweeps at Q 8, where DBT gains nothing | carried to `ingest-optimal-quality` item 11's G note |

## 4 · Where it holds

**Fixtures and limits.** DBT: 19 volumes of one dataset, three timed. Ultrasound, by `docs/FIXTURES.md`'s classes:
**sound** — two prostate sweeps (`ustrus_*`, frames neighbouring in space, not time; "never an ABUS or breast-cine
verdict", `groups.md`), six sets of eight colour stills (`usrgb_*`), and three grey liver clips of one series, 21–28
frames of 552 × 421 at `CineRate` 32 (`uscine_crc*`), **in no result**; **lossy-sourced** — `usb_cine`,
`usb_cine_rgb` (breast, MPEG-4 video files), `us_liver` (a DICOM clip flagged lossy), which by the rule "enter no
bytes, time or inter verdict": their numbers above stand as measured, provisional. The header counts are one public
research archive (IDC v25). What is missing is in the list at the end of this section.

### 4.1 · Premise 2, tested where the fixtures allow

| DBT's result | on DBT | on ultrasound | holds? |
| --- | --- | --- | --- |
| the view is a small fraction of the exact bytes at Q 8 | 0.074–0.219 (three volumes) | 0.338, 0.347 (two sound sweeps) | **no**: the view saves 2.9×, not 4.6–13.5× (**measured**) |
| "G saves almost nothing at Q 8" | −0.2 to +1.2 % | +23.0, +22.7 % sound; +8.3 to +72.2 % lossy-sourced | **no** (**measured**) |
| the noise rule picks Q | σ_min 3.4–14.8, valid "for the DBT fixtures only" | "does not hold for TRUS … gives no Q at all on lossy-sourced input" (`noise-point.md`) | **no** (**measured**) |
| the fine band is noise | error ÷ noise 1.03–1.23 | 1.54–1.71: "their fine band holds as much structure as noise" (`preview-noise.md`) | **no** (**measured**) |
| exact frames compress about 2.5–5 : 1 | 2.22–4.96 | 2.62–2.70 sound | yes, at the low end (**measured**) |
| the source is lossless | every volume | 3 of 1 000 instances read (below) | **no** (**measured**, headers) |
| a frame's decode can bind a fill | 18.9 ms exact, 42.1 ms view, a premium phone, `dbts_b1` | 0.6–1.2 ms exact at 512² (**derived on theory**: 18.9 and 40.4 ms scaled by pixels, 0.262 ÷ 8.52 Mpx; no small frame on a phone) | **no**, if the scaling holds |

**The door** (`docs/FIXTURES.md` §The ultrasound data search, 3 233 headers, 2026-11-04; counted here from its
table, **derived**). Multi-frame instances: 917 + 56 + 3 + 18 + 6 = 1 000. Lossy Image Compression `01`: 997. `RGB`,
`YBR_FULL`: 979; `MONOCHROME2`: 21. Sound: 3. S1 says why: a JPEG lossy stream "shall be … YBR_FULL_422", and
"Monochrome Ultrasound images may be coded using a color photometric interpretation". The product ingest:
`(p, c) => bail!("{p} with {c} samples a pixel: no frame file this ingest reads")` for all but `MONOCHROME1`,
`MONOCHROME2` and `RGB` (`main.rs:249–251`), and `ensure!(f.comps == 1, "optimal quality is grey only")`
(`optimal.rs:34`). Whether the PCS's parser turns such a clip into `RGB` frames before us is not known here.

### 4.2 · The decided approaches

| decided approach | DBT stacks | ultrasound clips | by which property |
| --- | --- | --- | --- |
| WebCodecs first, dav1d the fallback | holds (**measured**, cloud; one phone) | holds for a grey clip; a 4:4:4 colour view would be dav1d's alone | the coded form: Main is 8 or 10 bits, 4:2:0 or monochrome (S3, **source**) |
| the view at most 10 bits, the depth cut over 10 | binds systems A and C (12-bit), not B | **moot**: "Bits Allocated … 8" for every US photometric (S1, **source**) | depth |
| 10 bits on hardware the goal, 8 the fallback | open (M5; 10 bits came back as 8 on the one phone) | **moot**: the clip is 8 bits; the hardware route is the direct one | depth |
| no second picture over 8 bits; no content crop | holds | **moot** | depth |
| no low-resolution preview | contradiction 2 stands | **moot**: 0.2–0.8 Mpx fits every screen (**derived** on sizes) | frame size |
| the exact HTJ2K frame, bit for bit | holds | holds for what is delivered; the name *Lossless* does not (item 3) | provenance (S1; S4 on why a JPEG's samples depend on the decoder) |
| XXH3 on every exact frame; the view's check reopened | holds | holds: the hash reads samples of any depth or count (**theory**, by construction; colour not run) | none of the modality's |
| AV1 only for cine-like series | holds; inter pays nothing at Q 8 | holds, and here inter pays (**measured**, sound sweeps) | what neighbouring frames share |
| only a lost ask is asked again, once; `cubic-restart` | holds (**measured**, DBT fills) | **not known**: a whole clip is 5–18 MB, two to eight `dbts_b1` frames, so its fill lives in the start a DBT fill leaves behind (**theory**) | transfer size |
| the web the approach, native paused | holds | holds more strongly: native's reason is a 10-bit hardware route | depth |
| telemetry and cache off | holds | holds; a clip fits memory (17–67 MB decoded, **derived**, `ask-model.md` §3.3) | size |

### 4.3 · The pages' recommendations

*Holds* means for the same reason; *form only* means the rule's shape carries and none of its numbers.

| page | DBT stacks | ultrasound clips | by which property |
| --- | --- | --- | --- |
| `delivery-per-link` (A + C1; B and C2 no) | **measured**, three volumes | **form only**; items 2 and 3 do not carry: the switch has no decode term and the clip's rate enters (items 4, 5) | decode time; the reading dimension is time |
| `phone-decode-route` (view first, no class table; B1 no) | **measured**, two volumes, one phone | the class question dissolves if the scaling holds; B1 and the 10-bit forms **moot** | frame size; depth |
| `visually-lossless` (A: claim nothing; Q 8 interim) | holds | A holds by construction; Q 8 is not the same picture (0.34 of exact, not 0.07–0.22); B–G **do not hold**, in kind | the fine band is the tissue's texture (**measured** as structure; that readers read it is **theory**, no source read) |
| `ingest-optimal-quality` (R, S2, Q and G from the trigger) | holds; S2 never fires | S2 **moot**; "grey only" gives most field clips no view (4.1); G is not DBT's; σ_min **does not hold** | sample count; inter gain |
| `frame-integrity` (five states; a failed frame withheld) | holds | holds; one state's wording does not (item 3) | provenance |
| `asking` (the rule; no slice skipped; `waitAhead` off) | holds; no-skip by the DBT profile's own words | the order holds; the hold never acts; the gate is the whole question; "no slice skipped" becomes *wait, then play at the clip's rate* (`ask-model.md` §4.1; S2 gives the rate; "no profile read here binds breast ultrasound") | the reading dimension |
| `non-cine-series` | its complement | its complement: stills are most of a hand-held exam | — |
| `exact-frame-layout` (Layout 1 for D+T3, unbuilt) | by frame size | **moot**: nothing to build | frame size |
| `cache` | CACHE-DESIGN's | **not known**; the stores' memory failures were at DBT's largest frames | frame size; the study's many objects |
| `transport-stack` (WebTransport the one wire) | **measured** | holds in form; no cell is clip-sized: one is owed, where per-frame streams of 78–257 KB differ most from DBT's 1–2 MB | transfer size |
| `reports` | holds | holds; the record's size at a clip's frame count **not known**, and free to read in US-END-TO-END | frame count |
| `view-target` (the view worker) | holds | holds more strongly: at 25–32 frames/s, 2.5–3.2 frames fall due under one 100 ms task (**derived**) | the thread a paint waits on |
| `engines` | holds | the Firefox G = 8 failure on 8-bit 4:2:0 is the form a colour view with G over 1 would take: its trace matters more here | coded form |
| `pacs-sync` | pixel-free | pixel-free; instance and object counts **not known** | the study's shape |
| `paused-lines`, `client-calls`, `repository`, `unified-to-main`, `final-state`, `lab-list` | hold | hold; `repository` §4's "no US cine fixture" is wrong (r-m1): six clips are pinned, three of them sound | none |

**Where the link, not the decode, binds** (amendment 28 item 3.7): for a clip, on every link, if the scaling holds.
Against `link-profiles.md`: one far LTE stream is 27–85 Mbit/s, its lower quartile 7–26 (**source** there), so an
exact 512² grey clip at 25 frames/s (15.6) plays on the median and not on the quartile's low end, an exact 512²
colour clip (44.3) on neither's low half, and the Q 8 view (4.5 and 7.8 Mbit/s, **derived**: 0.291 × 15.6,
0.177 × 44.3) on all of them. The view's case is strongest for the clip and weakest for DBT on a fast link, the
reverse of how the pages carry it. Transport rows are lowered by none of this, nor by the decode-bound phone
(`README.md` §Premises item 1; 2026-11-25, PAGES-PASS).

**Each limitation, and what found it** (made a list and completed 2026-11-25, PAGES-PASS):

* No sound breast clip exists. Found by the data searches (`FIXTURES.md` §The ultrasound data search).
* No breast ultrasound in DICOM, no ABUS, no ultrasound frame on any phone, in any transport, delivery or cache run.
  Found by this page's reading of the 20 pages and their rows (§4.3).
* `uscine_crc1`…`3`, the one sound cine, are in no result. Found by this page (item 7), from `FIXTURES.md` and the rows.
* `usb_cine`, `usb_cine_rgb` and `us_liver` are lossy-sourced, so their numbers are provisional. Found by
  `FIXTURES.md`'s provenance rule ("enter no bytes, time or inter verdict").
* The sweeps are spatial neighbours on one device, "never an ABUS or breast-cine verdict". Found by `groups.md` §Limits.
* `usb_cine`'s inter gain is "the recorder's predictability, not the scanner's". Found by `frame-groups.md`.
* The header counts are one public research archive (IDC v25), four collections, none breast, 917 of the 1 000 from
  one; they say what scanners wrote there, not what the PCS delivers. Found by this page's reading of `FIXTURES.md`'s
  table.
* Whether the PCS's parser turns a colour-typed clip into `RGB` frames before us is not known. Found by this page (4.1).
* The ingest lines (`main.rs:249–251`, `optimal.rs:34`) were read, not run. Found by this page.
* A small frame's decode is scaled by pixels (**derived on theory**; no small frame on a phone), which ignores a
  frame's fixed cost. Found by this page; `decode/README.md` notes small frames read "the throttle's quantum" at 4×.
* The hash on a colour clip is **theory** by construction, not run. Found by this page (4.2).
* Whether a clip's fill behaves under the retransmit rule and `cubic-restart` is **not known** (**theory** only).
  Found by this page (4.2).
* That readers read the fine band's texture is **theory**, no source read. Found by this page (4.3, `visually-lossless`).
* No transport cell is clip-sized; a clip's record size in `reports`, the stores' behaviour in `cache`, and instance
  counts in `pacs-sync` are **not known**. Found by this page (4.3).
* Not read: which phones' hardware decoders take the High profile; how a browser decodes a JPEG stream and whether two
  do so alike; any source on what a reader takes from speckle. Found by this page (§8, "Not read").
* S3 is the AV1 specification's working document, not the approved version. Found by this page's fetch (§8, S3's row).

## 5 · The mechanism

A DBT stack and an ultrasound clip differ on two axes the pages folded into one. **The pixels**: 8 bits, small,
often three samples, a fine band that is structure, and a source that is usually already lossy. **The reading
dimension**: a stack is scrolled at the reader's pace along space; a clip is played along time at a rate the object
states (S2). Small frames remove the decode from every inequality the DBT pages wrote, and the rate puts a deadline
in its place: a frame is needed at *k* ÷ *r*, so a clip plays without stalling when *G* ≥ 8 × *b* × *r*, and
otherwise after holding about *n*(1 − ρ) frames (`ask-model.md` §4.1). An automated breast volume, if one arrives,
takes ultrasound's pixels and DBT's reading: the sweeps are its nearest fixture.

**Contradiction 6.** Both sentences are true because they answer different questions: the statement says what the
product is for, the status line what was verified. A stack-only release opens, of a DBT exam, the stacks (half its
pictures by count, over 95 % of its bytes, `non-cine-series`); of a hand-held ultrasound exam, the clips, which are
the minority of its objects. So the line reads: "… for breast DBT stacks and ultrasound clips; a study's single
frames and stills are outside it (`non-cine-series`)". `non-cine-series` items 1 and 3 are what close the gap.

## 6 · What would change the recommendation

* **One clip as the PCS delivers it, and one lossless** (item 2): if delivered clips are grey, unflagged and
  `MONOCHROME2`, the door of 4.1 is an archive's artefact and items 2, 3 and 6 shrink to notes.
* **`uscine_crc1`…`3` through the view and the exact path** (item 7): if their Q 8 ratio and G gain sit with DBT's
  and not with the sweeps', premise 2 fails by less than 4.1 says.
* **A 512² frame's decode on a phone**, one cell of PHONE-ROUND-2: if a fixed cost keeps it near a frame period,
  item 4's rule needs DBT's decode term back.

## 7 · What it would reopen

Nothing recommended here reopens a decided approach. U3 (the scanner's stream passed through) would reopen *the
exact HTJ2K frame* and *XXH3 the frame check* for lossy-sourced clips, and is the PCS's layout to offer: it is asked,
not built. A G over 1 for clips touches no decided approach (G is the trigger's, `ingest-optimal-quality` item 3).

## 8 · Rows and links

US-DBT-CARRY (this page); US-DBT-CARRY-REVIEW (owed). For the next queue, none new work beyond the items: item 4's
cell and its protocol; item 6's theory row; the clip-sized transport cell. For rows running now, one sentence each:
PCS-NOTE (item 2), US-END-TO-END and SESSION-COST-RUN (item 7, and `reports`' record size), PAGES-PASS (item 1).

Sources, fetched 2026-11-24, each quoted verbatim above or here:

| | source, section, revision | quoted | URL · sha256 of the fetch |
| --- | --- | --- | --- |
| S1 | DICOM PS3.3 2026e, C.8.5.6 US Image Module: Table C.8-18, C.8.5.6.1.2, C.8.5.6.1.10, Table C.8-20 | "Once this Attribute has been set to a Value of "01" it shall not be reset."; "shall be RGB for uncompressed or lossless compressed Transfer Syntaxes that do not have defined color space transformations, … YBR_FULL_422 for JPEG lossy compressed Transfer Syntaxes"; "Some Ultrasound images may have a Photometric Interpretation equal to RGB but the image will have no color information if R=G=B for all pixels. For consistency within a particular implementation Monochrome Ultrasound images may be coded using a color photometric interpretation."; "MONOCHROME2 8 RGB 8 YBR_FULL 8 YBR_FULL_422 8" | `https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.8.5.6.html` · `9d745240a46fb084aa07c8c8622ddffa7f80a6334c622eafffc3c47decfb4223` |
| S2 | DICOM PS3.3 2026e, C.7.6.5 Cine Module, Table C.7-13 | "Recommended Display Frame Rate (0008,2144) 3 Recommended rate at which the Frames of a Multi-frame Image should be displayed in Frames/second."; "Frame Time (0018,1063) 1C Nominal time (in msec) per individual Frame." | `https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.5.html` · `625a1e839bd65c9485d85697932edc15d475efffa578294c514ceb8a5acae46d` |
| S3 | AV1 Bitstream & Decoding Process Specification, Annex A, Profiles; the page "Last modified: 2023-05-25 12:27 PT", which calls itself a working document, not the approved version | "“Main” compliant decoders must be able to decode streams with seq_profile equal to 0."; "The Main profile supports YUV 4:2:0 or monochrome bitstreams with bit depth equal to 8 or 10. The High profile further adds support for 4:4:4 bitstreams with the same bit depth constraints." | `https://aomediacodec.github.io/av1-spec/` · `acf58a3fdb82a85e25aa7fe19b8fe2a5ccc02884d0e852f2fc9b05ba7aa49609` |
| S4 | CCITT Rec. T.81 (09/92), A.3.3 and K.7.2.1 | "These equations contain terms which cannot be represented with perfect accuracy by any real implementation."; "Since IDCT implementations can differ significantly, truly lossless coding after a DCT hierarchical progression cannot be guaranteed." | `https://www.w3.org/Graphics/JPEG/itu-t81.pdf` · `631031d4ba56b06abee3e312a0f235b9422da9c7267d1c8f7604418795768bf0` |
| S5 | the DBT profile's no-skip rule and the general viewer profile's cine rate, **as the repository recorded them** (`ask-model.md` §3.4, §4.1), not fetched again | "The Image Display shall not skip slices during manual or automatic scrolling."; "The default shall be the frame rate specified in the DICOM attributes, if present" | — |

Not read, and said so where used: which phones' hardware decoders take the High profile; how a browser decodes a
JPEG stream and whether two do so alike; any source on what a reader takes from speckle.
