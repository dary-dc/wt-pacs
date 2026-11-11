# HTJ2K resolution levels and regions for large frames

*Row HTJ2K-TILES, 2026-11-09. Theory, predictions and a pre-registered protocol; **nothing here is run**. A
separate approach beside the optimal-quality design (`claude/docs-lines:docs/lines/optimal-quality.md`
§Open 9), lower priority than the week's demo. Sources are [S1]–[S4] at the end; *derived* marks
our arithmetic, *unverified* what no source here checks.*

## The question

For series whose frames are large (DBT slices and FFDM, up to 3328×4096 in the fixtures) or whose stored depth D is
high (12–16 bits), is lossless HTJ2K with resolution levels and HTJ2K tiles or precincts a better way than whole
frames to put an exact picture of what the screen shows on it first, and the full frame after?

* **At the fit:** the resolution level that matches the viewport, exact at that level.
* **On a zoom or a pan:** only the HTJ2K tiles or precincts in view, exact at full resolution in that region.
* **The price:** bytes and decode time per ask against whole-frame HTJ2K, and time to the screen's exact picture on
  shaped links.
* **The composition:** with the optimal-quality (OQ) AV1 view, as an alternative for some modalities or as the
  delivery of the exact frame a reader asks for.

## What earlier work settled, and what it did not

| settled | where | what it leaves |
| --- | --- | --- |
| Today's codestreams (RPCL, one layer, one HTJ2K tile, five levels) hold every level as an exact prefix: level 1 is 25.8–29.0 % of a frame, level 2 6.7–7.7 %, on breast series at ~2:1 | [`decode/README.md`](decode/README.md) §A frame at the level the screen needs; `claude/htj2k-progressive` §HTJ2K progressive, measured | nothing about regions |
| A level picture from its prefix decodes in ×0.27–0.31 of the whole frame (level 1), ×0.08 (level 2); exact once clamped to 2^D − 1 | the same | — |
| A level-first fill put the first exact picture on screen at ×0.09–0.69 of today and every frame at ×0.06–0.50, the whole a tie | [`adr/resolution-fitting-for-large-frames.md`](adr/resolution-fitting-for-large-frames.md) §7 | one fill of four views; no zoom |
| **As a fast preview the ladder is not one**: its first picture is 1.9–7.8× an AV1 preview's, since a level-1 prefix is ~27 % of a frame | `claude/htj2k-progressive` §HTJ2K progressive, measured | this question is not a preview: exact pixels at the screen's resolution and region |
| Quality layers: closed for previews (one HT set split puts 77–99 % of the bytes in layer 1; two sets cost 1 + layer 1) | `claude/htj2k-progressive` §Quality layers, measured | not used here |
| Three horizontal HTJ2K tiles as independent codestreams: bytes +0.12–0.59 %, an ask on 3 idle decoders ×0.39–0.45 of the whole frame at 4× | [`decode/README.md`](decode/README.md) §Not yet tried, P-TILE (row TILEMEASURE) | no 2D grid; no zoom's bytes on a link |
| Region decode in OpenHTJ2K costs a region's rows, not its area; today's codestreams (one precinct a resolution) cannot be fetched by region | [`decode/README.md`](decode/README.md) §Region decode, measured | precincts in the stored layout not tried |
| The proposal for the owner's large-frame rule: HTJ2K tiles, banded and band-major, no wire change | [`adr/resolution-fitting-for-large-frames.md`](adr/resolution-fitting-for-large-frames.md) §8 | TILEGRID and BANDS proposed, not run |

The owner's rule of 2026-10-10 (frames over 12 bits fitted plus regions; 12 bits or fewer filled) and of 2026-10-11
(device pixels) stand; this protocol is the measurement the ADR's §8.8 says the proposal still needs, widened to precincts and
to the OQ design of 2026-11-09.

## Terms

The glossary's **tile** is the server's read of an asked frame, so a codec's tile is always an **HTJ2K tile** here.

* **Level ℓ:** the picture after ℓ of the codestream's NL = 5 decompositions are left out, ⌈C/2^ℓ⌉ × ⌈R/2^ℓ⌉ for a frame of C columns and R rows; level 0
  is the frame. *Exact at level ℓ*: equal, sample for sample, to the reversible 5/3 analysis of the encoder's input
  taken to ℓ levels and clamped to [0, 2^D − 1] (`witness.py` in `claude/htj2k-progressive:lab/htj2k-progressive/`).
* **Viewport:** the client's drawing area in device pixels, w × h (device pixels decided 2026-10-11). **Zoom z:**
  displayed pixels per frame sample. **Fit:** the frame whole in the viewport, z_fit = min(w/C, h/R).
* **The level an action needs:** ℓ(z) = min(NL, max(0, ⌊log2(1/z)⌋)), the most reduced level still at least as large
  as what is displayed (*derived*; ADR §8.2's rule).
* **Screen-exact picture:** every viewport pixel painted from samples exact at ℓ(z) in the visible rectangle. Whether a
  level picture counts as exact for reading is the owner's ruling, not this doc's (§Theory 2).
* **Region:** the visible rectangle in frame samples, w/z × h/z around the pan centre, clamped to the frame.
* **Layouts:** **W**, today's whole codestream asked whole; **L**, the same codestream asked level-first; **P**, one
  codestream with precincts and an index; **T3** and **T9**, three strips and a 3 × 3 grid of HTJ2K tiles, each its
  own codestream (the ADR's §8.3 proposal).
* **Backfill:** after an action's picture, the rest of the frame fetched behind it, so the frame ends exact whole.

## Theory

### 1 · A level is a prefix, by the progression order

RPCL loops over resolution first: "for each r = 0,..., Nmax / for each y … / for each x … / for each i … / for the
next precinct, k, if one exists, / for each l = 0,..., L – 1" [S1, B.12.1.3]. With one layer every packet of
resolutions 0…NL − ℓ comes before any finer one, whatever the precincts or positions, so level ℓ is a prefix in **W**,
**L** and **P** alike, and in each HTJ2K tile of **T3** and **T9** (*derived*). DICOM's HTJ2K Lossless RPCL syntax
(1.2.840.10008.1.2.4.202) is written for this use: "allows for progressive display of images, as well as retrieval of
thumbnail images. The progression order shall be RPCL … The Tile Length Markers (TLM) shall be present. This allows
finding the resolution breakpoints to support smart streaming. The following parameters may improve decoding
performance: Block Size: 64x64 Number of tiles: 1" [S3, §10.18.1]. It also says "The number of decompositions shall be
sufficient for the width or height of the base resolution to be <= 64"; the served profile's five decompositions leave
a 104 × 128 base on 3328×4096, so those frames would need a sixth to be sent under that syntax unchanged (*derived*; the
PCS's choice, not tested here).

### 2 · Exact at its level is not the full frame resampled

A level picture is the 5/3 low band, exact against the codestream, the same on every conforming decoder. It is not
what a viewer paints from the exact frame at the same size: on the 15 DBT volumes the level-fit picture against the
area-resampled exact frame was 41.4–46.9 dB, 51–81 % of in-window codes off by more than one
(`claude/htj2k-progressive` §HTJ2K progressive, measured, stage 1). So a screen-exact picture at ℓ ≥ 1 is a defined,
digestable picture, and whether a reader may read from it is the owner's ruling. At ℓ = 0, after a zoom to 1:1 or
past it, the region is the exact frame's own samples and the question does not arise.

### 3 · Which frames have a level to gain

Device pixels, the frame hung long side vertical; ℓ(z_fit) for each fixture size (*derived* from §Terms):

| frame (sets) | phone 1080×2400 | tablet 2048×2732 | laptop 2560×1600 | 5 MP 2048×2560 | 1:1 on the phone, share of the frame |
| --- | --- | --- | --- | --- | --: |
| 3328×4096 (`ffdm_d`, `ffdms_b1/b4/b5`, `mgraw_b1/b3/b4`, `syn2ds_b3`) | L1 | L0 | L1 | L0 | 19 % |
| 2560×3328 (`ffdm_a`, `ffdms_b2/b3`, `mgraw_b2/b5`, `syn2d_a`, `syn2ds_b1/b2`, `dbts_b1`) | L1 | L0 | L1 | L0 | 30 % |
| 2394×3062 (`ffdms_c2`–`c4`, `mgraw_c3/c5`, `syn2ds_a3/a4`) | L1 | L0 | L0 | L0 | 35 % |
| 2394×2850 (`syn2d_b`, `syn2d_d`, `syn2ds_a1/a2/a5`) | L1 | L0 | L0 | L0 | 38 % |
| 1996×2457 (`dbts_b3/b4`, `syn2d_c`, `syn2ds_b4`), 1914×2572 (`dbtproj_ge`) | L0 | L0 | L0 | L0 | 53 % |
| 1914×2294 (`ffdm_b/c`, `ffdms_a*`, `ffdms_c1/c5`, `mgraw_a*`) | L0 | L0 | L0 | L0 | 56 % |
| DBT systems A and C, up to 1147×2585 | L0 | L0 | L0 | L0 | 87–100 % |
| 4366×6871 (`mg16_cbis`) | L2 | L1 | L2 | L1 | 9 % |

The progressive lab's "fit" is a 1 000-sample long side, not a viewport in device pixels: its stage-1 rows mark level 1
"(fit)" on, among others, `dbts_c1`, `dbts_a2`–`a5` and `dbts_b2`, which fit at level 0 on a phone held upright (§Screen resolution, below).

**Where the fit is level 0, the approach has nothing to give at the fit, and W already holds the whole frame for every
zoom after it.** In device pixels that is every DBT slice set but `dbts_b1`, every 1914-wide mammogram, and every
fixture but `mg16_cbis` on a tablet or a 5 MP display. The question is about frames of at least 2 160 columns on
the phone or 3 200 rows on the laptop (*derived*: twice the viewport's side).

### 4 · What a region needs

Reconstructing a sample exactly needs, at each level below it, the coefficients the inverse 5/3 reads: "Equations
(F-5) and (F-6) give the coefficients needed to reconstruct X(2n) and X(2n + 1) losslessly. It can immediately be seen
that these are L(n), L(n + 1), H(n – 1), H(n), H(n + 1)" [S1, H.3.1.1]. A region at level 0 therefore needs the
finer resolutions' coefficients under it plus a margin of one or two coefficients a level (*derived*). After a fit at
level ℓ the coarse resolutions are already in hand, so a zoom to 1:1 needs only decomposition levels 1…ℓ, whose
64 × 64 code-blocks span 128 × 128 frame samples at level 1 and 256 × 256 at level 2 (*derived*). Region granularity is
fine exactly where the zoom needs it: this is what made OpenHTJ2K's region decode cost rows (its coarse-level blocks
span up to 2 048 rows) and need not here.

### 5 · Three ways to reach a region

* **HTJ2K tiles.** "tiling of the image actually creates tile-components that can be extracted or decoded
  independently of each other. This tile independence provides one of the methods for extracting a region of the
  image" [S1, §5.3]. Each tile-component's transform extends its own edges ("This extension procedure is known as
  'periodic symmetric extension'", [S1, F.3.7]), so level 0 is the same frame for any grid but a **level picture of a
  tiled frame differs from the untiled one near tile edges**: its digest is per layout (*derived*). Measured as three
  strips; a grid's bytes rise with its edge length (*derived*). Stored as independent codestreams (the ADR's §8.3) the delivered
  OpenJPH build decodes each as it is; stored as one multi-tile codestream the tile data is the same when tile edges
  fall on multiples of 2^NL = 32 (*derived* from H.3.1.1's parity "relative to the origin of the reference grid"),
  and a client would rewrite a tile-part's SIZ to decode it alone (*unverified*).
* **Precincts in one codestream.** "precinct: A one rectangular region of a transformed tile-component, within each
  resolution level, used for limiting the size of packets"; "packet: A part of the bit stream comprising a packet
  header and the compressed image data from one layer of one precinct of one resolution level of one tile-component"
  [S1, 3.71, 3.68]; "Packets provide another method for extracting a spatial region independently from the
  codestream" [S1, §5.3]. Precincts are anchored at multiples of 2^PP in each resolution [S1, B.6], and "at each
  resolution level, the code-block size is bounded by the precinct size", xcb′ = min(xcb, PPx − 1) for r > 0 [S1, B.7].
  With PP ≥ 7 the 64 × 64 block grid is unchanged, so **every code-block's bytes are today's and the level pictures
  are W's, bit for bit**; only packet headers and tag trees are added (*derived*). Proposed: `-precincts
  {128,128},{256,256}` (OpenJPH lists sizes "starting from the coarsest resolution; the last precinct is repeated for
  all finer resolutions" [S4, `ojph_compress.cpp`]), which keeps the codestream in T.814's LOCAL set: "PPx + PPy ≤ 16,
  except in the lowest resolution level within each tile-component, where PPx + PPy ≤ 14" [S2, 8.6]. On 3328×4096
  that is about 286 packets a frame (*derived*), and the frame stays a one-tile codestream DICOM's HTJ2K syntaxes
  carry as stored.
* **The standard's form of this, JPIP** (ISO/IEC 15444-9). DICOM references it: "a JPIP request for a 200 by 200
  pixel rendition of the entire image can be constructed … &fsiz=200,200", and "The JPIP server shall return a
  Content-type of image/jp2, image/jpp-stream, image/jpt-stream, image/jph or image/jphc" [S3, §8.4.1], with JPIP
  HTJ2K Referenced syntaxes 1.2.840.10008.1.2.4.204 and .205 [S3, A.11, A.12]. 15444-9 itself was not read; that
  jpp-stream carries precinct data and jpt-stream tile data is *unverified* here. Neither is built: the server serves
  stored entries by index, and that does not change below.

**What the client's decoder does.** OpenJPH writes precincts, tiles and TLM (`-precincts`, `-tile_size`,
`-tlm_marker`, [S4]) but no PLT, and reading it skips PLT ("Skipping PLT marker segment;this should not cause any
issues", [S4, `ojph_codestream_local.cpp`]). Its decode API restricts resolution only and pulls whole rows
("restricts resolution decoding for a codestream"; "pull one row from the codestream", [S4, `ojph_codestream.h`]): no
region. So **P** is decoded by splicing: the stored packets of the region, and for every other packet one empty
packet, legal by "The first bit in the packet header denotes whether the packet has a length of zero (empty packet).
The value 0 indicates a zero length; no code-blocks are included in this case" [S1, B.10.3], the last tile-part's
length set to 0 ("If the Psot is 0, this tile-part is assumed to contain all data until the EOC marker", [S1, A.4.2]).
That OpenJPH 0.31.0 decodes such a codestream exactly in the region is *unverified* and is stage 0's first check. The
index (resolution, precinct) → byte range is built at ingest by parsing packet headers, as the quality-layer lab
already does (`claude/htj2k-progressive:lab/htj2k-progressive/layers/shapes.py`).

### 6 · What decode costs

In the delivered build the HT block decoder is 55–70 % of a frame, the inverse wavelet 5–10 %, the copy out 7–15 %
and the wrapper's pack 4–10 % ([`decode/README.md`](decode/README.md) §Faster HTJ2K in the browser). A spliced **P**
codestream decoded at level 0 skips the absent blocks but synthesises, copies and packs the whole frame, so a zoom
costs roughly the share of block bytes present times 0.55–0.70 plus 0.20–0.35 (*derived*). **T** decodes only the
tiles in view, on as many idle decoders as there are tiles (measured for strips).

### 7 · How it composes with the optimal-quality view

* **DBT (cine-like, D ≤ 12): the exact path's delivery, not an alternative.** Scrolling stays the OQ view's (0.10–0.28
  of HTJ2K's bytes at the noise rule's Q, [`lines/codecs.md`](lines/codecs.md)); the levels lost to it as a preview.
  *Corrected 2026-11-11:* this read 0.07–0.22, Q 8's figures, which is not the rule's Q on the volumes
  (`claude/av1-audit-quality:docs/av1/audit-quality.md` F7). The OQ view is at most 10 bits on the product path (the
  owner, 2026-11-11), so D > 10 is the depth cut there and HTJ2K alone carries the stored depth.
  What changes is the reader's Lossless ask: today the whole frame, here the fit level first (~27 % of the bytes at
  level 1) and the region on zoom. By §3 only `dbts_b1` has a level to gain on a phone or laptop. The label's
  *Lossless* rests on the frame digest today; at ℓ ≥ 1 it would need a digest per level (and per tile for **T**) and a
  wording ("Lossless at this size") the owner sets.
* **FFDM and synthesized 2D (not cine-like): the alternative to whole frames.** AV1's scope is cine-like series
  (2026-10-30), so the exact frame is the only picture; the ADR's §8.8 choice 4 (12-bit large frames keep the plain fill) waits
  on exactly this measurement. The OQ view of a mammogram (AV1, G 1) is an arm for reference only: its first picture
  and bytes show what exactness costs, and it cannot meet the rule's exactness clause.
* **D > 12 (`mgraw_*`, the projections, `mg16_cbis`): HTJ2K only.** AV1's scope stops at 12 bits and WebCodecs at
  10; the owner's rule already fits these plus regions.

### 8 · What D changes

Nothing in the shape of the answer: OpenJPH codes 1–38 bits ([`codecs/htj2k.md`](codecs/htj2k.md)), and for the
reversible path T.814 adds no magnitude bound when levels are discarded ("no such adjustment is made for codestreams in
the HTREV set", [S2, 8.7.2 NOTE 2]). More bits leave more noise in the finest subbands, which lowers the compression
ratio and moves the level-1 share toward its ~25 % floor ([`decode/README.md`](decode/README.md) §A prefix draws a
smaller image: the share tracks the ratio). D scales the seconds, not the ratios (*derived*). A level picture still
needs the clamp to 2^D − 1, measured only on grey unsigned frames.

## Predictions

Written before anything is run. *Amended 2026-11-11, before any run (row HTJ2K-SCREEN):* P12 read "Q 8, 0.22 of the
bytes", ×0.8–1.6, refuted outside 0.6–2.0; Q 8 is not the rule's Q on `dbts_b1` (quality audit F7), and the bytes alone
put the ratio at 1.2–2.7. Shares are of the frame's bytes under W; ratios are × W's, the median of
round-paired ratios. "Phone zoom" is a zoom to 1:1 on the phone viewport after a fit at level 1. Each line's basis is
§Theory or the measurement it names; none is measured for this layout.

| # | quantity | predicted | refuted if | basis |
| --- | --- | --- | --- | --- |
| P1 | **P**'s bytes | every code-block segment byte-identical to W's; total +0.02–0.3 % | any segment differs, or over +1.0 % | §5, B.7 |
| P2 | **T3**, **T9** bytes | T3 +0.1–0.6 %; T9 +0.3–2 % | T9 over +3 % | P-TILE; edge length |
| P3 | fit bytes at level 1 (and level 2 on `mg16_cbis`) | 24–30 % (6–9 %), the 14-bit sets included | level 1 outside 20–35 % on any set | §8; RESLEVEL |
| P4 | fit picture | **P**'s equals W's bit for bit; **T**'s differs from W's only within a few samples of a tile edge | **P** differs anywhere | §5 |
| P5 | phone zoom bytes, share of the frame | **L** 70–76 % (the rest); **P** 10–35 % at the median position, ≤ 45 % at the worst; **T9** 20–50 %; **T3** 35–75 % | **P** at the median over 0.6 × **L** | §3, §4 |
| P6 | a pan by half a viewport after the zoom | **P** 4–20 %; **T9** 0–40 %, most often a whole row of HTJ2K tiles or nothing | **P** over **T9** at the median | §4 |
| P7 | decode an ask at 4× | fit ×0.25–0.34; **P** zoom ×0.40–0.75 on one decoder; **T9** zoom ×0.15–0.45 on its k idle decoders; **T3** ×0.35–0.50 | **P** zoom over ×0.9 | §6; P-TILE |
| P8 | time to the screen-exact picture, link-bound cells (5, 20 Mbit/s, `lte-good`) | fit ×0.25–0.40 for **L**, **P**, **T**; zoom after the fit: **P** ×0.15–0.50 of **L**'s | fit over ×0.45 at 5 or 20 Mbit/s; **P** zoom over 0.6 × **L**'s | bytes are the clock (§7 of the ADR) |
| P9 | the same at 50 Mbit/s, 4× | ratios rise toward P7's; fit ≤ ×0.5 | fit over ×0.6 | decode-bound there (progressive lab) |
| P10 | the full frame exact, with backfill | ×1.00–1.03 for every layout | over ×1.05 | the same bytes, more asks |
| P11 | sets whose fit is level 0 (negative control) | every arm ties W at the fit within the A/A spread | any arm over 5 % faster | §3 |
| P12 | `dbts_b1`, the exact ask at the fit under **L**, against the OQ view's first picture (the rule's Q: 0.10 of the bytes at G 1, 0.22 at G 16; WebCodecs at 10 bits) | ×1.2–2.7 of OQ's in link-bound cells (0.27 of a frame against 0.10–0.22) | outside 0.9–3.5 | §7; OQ bytes |
| P13 | level picture against the exact frame painted at the same size, FFDM | as on DBT: under 50 dB, most in-window codes off by more than one | over 99 % within ±1 under every window | §2 |

## Protocol, pre-registered

For a session given this section and nothing else. Code and rows go in a new directory, lab/htj2k-tiles, which does not exist yet.
`CLAUDE.md` §Measurement applies throughout: arms interleaved, every new check mutated, the store warm (disk is not
the question; nothing is claimed cold), times quoted and not throughputs, the host's saturation stated.

### Fixtures, and their limits

From [`FIXTURES.md`](FIXTURES.md) §AV1 data (`lab/av1/fetch_data.sh`, pinned by digest):

| role | sets | frame · D | stages |
| --- | --- | --- | --- |
| FFDM, 12 bits | `ffdm_d`, `ffdms_b1` · `ffdms_b2` · `ffdms_c2` | 3328×4096 · 2560×3328 · 2394×3062, 12 | 1, 2; `ffdm_d` and `ffdms_b2` in 3 |
| FFDM for processing, 14 bits | `mgraw_b1` · `mgraw_b2` · `mgraw_c3` | 3328×4096 · 2560×3328 · 2394×3062, 14 | 1, 2; `mgraw_b1` and `mgraw_b2` in 3 |
| DBT slices | `dbts_b1` (the first 8 slices in 2 and 3) | 2560×3328, 10 | 1, 2, 3 with the OQ arm |
| synthesized 2D | `syn2ds_b1` | 2560×3328, 10 | 1 |
| 16 bits | `mg16_cbis` | 4366×6871, 16 | 1, 2 |
| negative controls (fit at level 0) | `dbts_c3`, `ffdms_a1` | 1147×2585, 1914×2294, 12 | 1, 2; `ffdms_a1` in 3 |

**Limits, to be printed with every result:** all but `ffdm_d` and `mg16_cbis` come from one collection (EA1141), three
vendors' systems; a four-view exam is four frames and a DBT set's slices share content, so frames are not independent
samples; mammograms carry large air backgrounds, so a region's bytes depend on where it is, which is why positions are
chosen from stage 1's distribution; frames are hung long side vertical (an assumption about the viewer); every set is
grey and unsigned (`dbtproj_c`'s MONOCHROME1 is not used); **no sound 15- or 16-bit large frame exists** —
`mg16_cbis` is digitized film, lossless-but-unrepresentative, so 16 bits rests on it alone and is in no verdict; no
CR or DX set; no phone. Only `dbts_b1` among the DBT sets has a level to gain (§Theory 3).

### Arms

| arm | store | the fit | a zoom or pan | decoder |
| --- | --- | --- | --- | --- |
| **W**, **W′** | today's codestream, one entry a frame; W′ the same bytes under another name (A/A) | the whole frame | nothing more | the delivered build |
| **L** | today's codestream cut at ℓ_fit: two entries a frame (ADR §7) | the prefix, `decodeSubResolution(ℓ)`, clamped | the rest, whole | delivered build plus the level binding (`claude/htj2k-progressive:lab/htj2k-progressive/wasm/levels.patch`, with its SIZ reset) |
| **P** | one codestream, `-precincts {128,128},{256,256}` (and `{128,128}` throughout in stage 1 only), RPCL, one layer; entries: the fit prefix, then one entry per (resolution finer than the fit, precinct) in codestream order | the prefix | the region's precinct entries; the client splices (§Theory 5) | the same, on the spliced codestream at level 0, cropped |
| **T3**, **T9** | three strips, a 3 × 3 grid, edges on multiples of 32 samples; each HTJ2K tile its own codestream in the served profile, banded and band-major (ADR §8.8) | every tile's level band | the level-0 bands of the tiles in view | the delivered build, one tile a decoder, k idle decoders |
| **OQ** (reference, not exact) | the OQ series at Q 8, G 1 (`claude/oq-ingest:lab/av1/tools/ingest_coded.py --lossy 8 1`) | the whole AV1 payload | nothing more | the product's AV1 route for the depth |

No wire change: every arm's entries are asked as frames are today, `stream_frames` for each contiguous run and
`request_frame` otherwise; envelopes (8 bytes an entry) count in the bytes. The precinct size for stage 3 is the one of
stage 1's two with fewer phone-zoom bytes at the median position, unless it costs more than +0.5 % in total bytes;
on a tie, `{256,256}` (fewer entries).

### A viewport's actions, modelled

One frame per visit, one script, the same for every arm (*derived* rules in §Terms):

1. **Open** at the fit (ℓ_fit for the viewport).
2. **Zoom** to 1:1 at position p_med; 3. **pan** by half the viewport's width; 4. **zoom** to 2:1 there (no new
   bytes in any arm: a check, not a timing); 5. **back** to the fit; 6. **zoom** to 1:1 at p_worst.
7. **Backfill:** the rest of the frame, after action 6.

Each action starts when the previous one's picture is screen-exact (stage 3), or at once (stage 1, bytes only).
p_med and p_worst are the 1:1 viewport centres, on a 64-sample grid of the pan range, whose **P** zoom bytes are the
median and the maximum over the grid in stage 1, taken per frame before stage 3 and used by every arm. Viewports:
phone 1080×2400 in stages 2 and 3; in stage 1 also tablet 2048×2732, laptop 2560×1600, two side by side on the laptop
(1280×1600 each) and 5 MP 2048×2560.

### Stage 0, the tools and their checks

* **Encode.** **P** and **T** with `ojph_compress` 0.31.0 from `ingest/tools.sh`; **W**'s codestream must equal the
  ingest's sha256 on every frame. **The index**: (resolution, precinct) → byte range from parsing the packet headers
  alone (`layers/shapes.py`'s parser, one layer); its ranges must tile the codestream exactly.
* **The region map** from H.3.1.1's dependencies, level by level, from the visible rectangle out to precincts (or
  HTJ2K tiles).
* **Checks, every frame of every stage-1 set:** P1's segment identity; P4's fit pictures; for every action of the
  script at p_med and p_worst on the phone, the spliced codestream's level-0 crop equal to the encoder's input and to
  OpenJPEG 2.5.4 (`-d` for the area, `-r` for the level) decoding the same spliced bytes; every **T** tile at every
  level against `witness.py`'s analysis of that tile's samples; the assembled level-0 frame against the frame digest.
* **Mutants, each must be caught:** one precinct of the map dropped (the region not exact); the map shrunk by one
  coefficient at an edge where H.3.1.1 needs it (not exact); an empty packet written as 0x80 (refused or not exact);
  two HTJ2K tiles' bands swapped; every digest truth flipped; the SIZ reset removed from the level binding (a later
  whole frame not exact).
* `lab/decode-bench/parity.mjs` on the delivered build and on the lab build: `PARITY OK`.

### Stage 1, bytes (offline)

Every frame of every set, every layout and viewport: total bytes ÷ W's; the fit's bytes; for every grid position, the
zoom's, the pan's and the 1:1 region's coverage (bytes fetched over bytes of the visible rectangle's own blocks);
asks and entries an action; P13's display error (the progressive lab's stage-1 metrics: PSNR, max |Δ|, in-window codes
off by > 1 under every window). Rows per frame and action, raw in `rows/`.

### Stage 2, decode

Headless Chromium (Playwright's, version printed), the lab build in module workers, 1× and 4×
(`lab/scripts/cpu_throttle.mjs`), 10 rounds in a Williams order of the arms, the first 4 frames a set, 3 timed passes
after a checking pass; a fresh browser per throttle and round. Per action: ms from its last byte in hand to its picture
written (splice included), for **P** on one decoder, for **T** on k idle decoders and on one. × W's whole-frame decode,
round-paired. Every picture's digest after the clock.

### Stage 3, time on shaped links

`lab/av1/delivery/total-time/run.mjs` and its rig, unchanged but for the script above: links `r5000`, `r20000`,
`r50000`, `lte-good`; 1× and 4×; a fresh server, relay and browser a visit; cells in a Williams order each round and
arms inside each cell the same way; `plain` not run (it `VOID`s on this rig, [`rig-limits.md`](rig-limits.md)). Per
action: time from the action to its picture screen-exact; per visit: time from open to the full frame exact; bytes.
**OQ** contributes its first picture and bytes only. Every picture checked after the clock; a visit with any picture
not exact fails the arm in that cell. `VOID` visits as the rig defines them are reported both dropped and kept.

**The host.** State cores, CPU, browser, and **where it saturates**: the cells whose W arm is decode-bound rather than
link-bound (exact time at 4× over 1.05 × the 1× time) are named, and no ratio from them enters the rule's link-bound
clauses. Nothing above 50 Mbit/s is claimed; nothing past k = 3 decoders is claimed on a 4-core host, so **T9**'s
k-decoder arm runs k = min(tiles in view, 3).

### The decision rule

Per set and cell, a bound b is missed only past b × (1 + s), s the cell's p90 of |W′/W − 1|; strict readings are printed
too. **Link-bound cells** are 5 and 20 Mbit/s and `lte-good`, minus any the host section names.

* **R0, exact.** Every picture of an arm exact in every kept visit, by both witnesses where two exist. An arm failing it
  is out, naming the cell.
* **R1, the fit pays.** **L**'s fit ≤ ×0.50 of W's in every link-bound cell, on every stage-3 set whose fit is level 1.
  If R1 fails, stop: **P** and **T** fetch at least **L**'s fit bytes, so none of them pays at the fit (*derived*).
* **R2, the region pays.** A layout's zoom ≤ 0.60 × **L**'s at p_med and ≤ 0.80 × at p_worst, in at least two thirds of
  the link-bound cells, on every stage-3 FFDM set of 2560×3328 or more.
* **R3, no tax.** Total bytes ≤ ×1.01 of W's (**P**, **T3**) or ×1.03 (**T9**); the full frame exact ≤ ×1.03 of W's;
  no action's decode at 4× over ×1.10 of W's whole frame.
* **R4, the controls.** On `ffdms_a1` no arm differs from W at the fit beyond the spread; if one does, the rig is
  suspect and no verdict is drawn.

**Verdicts.** R1 ∧ R2 ∧ R3 for **P**: propose **P** for large exact frames, a store-format change for the owner — over
**T9** when its zoom bytes are no more than **T9**'s and its zoom decode ≤ ×1.25 of **T9**'s on k decoders, otherwise
**T9** (or **T3** by the same test). R1 ∧ R3 without R2: propose **L** alone, ADR §7's path, for the exact frame at
the fit. R1 failing: whole frames stay. **For DBT:** if R1 holds on `dbts_b1`, the reader's Lossless ask is proposed
level-first, the OQ view kept for scrolling, and P12's ratio printed beside it; the label's wording and the per-level
digest are the owner's. 16 bits (`mg16_cbis`) is reported and in no verdict.

### Shards, each ≤ 4.5 h

| shard | content | estimate (*derived*) |
| --- | --- | --- |
| S0 | stage 0: encoders, index, splicer, region map, checks and mutants on every stage-1 frame | 2–3 h |
| S1 | stage 1, every frame, every layout, viewport and grid position | 1.5–3 h |
| S2 | stage 2, 11 sets × 4 frames × 10 rounds × 2 throttles | 2.5–4 h |
| S3a, S3b | FFDM 12 bits (`ffdm_d`, `ffdms_b2`), rounds 1–6 · 7–12 | ~2–2.5 h each: 7 arms × 4 links × 2 throttles × 2 sets a round, ~10 s a visit |
| S3c, S3d | 14 bits (`mgraw_b1`, `mgraw_b2`), rounds 1–6 · 7–12 | ~2.5–3 h each (larger frames) |
| S3e, S3f | `dbts_b1` with OQ and `ffdms_a1`, rounds 1–6 · 7–12 | ~1.5–2 h each |

Each S3 shard records its rounds and pins (commit, Chromium, the store's digests); the summary joins pairs with equal
pins only. A shard that reaches 4.5 h stops at the round boundary and says how many rounds it kept; the rule then
reads the n it has and prints it.

## Screen resolution against the demo's approach (row HTJ2K-SCREEN, 2026-11-11)

*Theory and a pre-registered protocol; **nothing here is run**. The owner asked to compare one lossless HTJ2K
codestream served at the resolution the client's screen shows, completed to full resolution on a zoom or a request,
with the demo's approach, for DBT and other large frames. It is not a preview (none is decided): every picture is
exact at its level, at least as many samples as the viewport shows. Sources are [S1]–[S4]; *derived* marks our
arithmetic, *assumption* a band no measurement here backs.*

### The approaches

* **D, the demo.** The optimal-quality (OQ) AV1 series fills the scroll (≤ 10 bits: D > 10 by the depth cut; WebCodecs,
  dav1d only as its fallback); an explicit Lossless request fetches the exact HTJ2K frame whole
  ([`lines/optimal-quality.md`](lines/optimal-quality.md)).
* **S, screen level.** Today's HTJ2K codestream, nothing re-encoded. The fill sends each frame's prefix at ℓ_fit for
  the viewport (§Terms), level-first as layout **L** (two store entries a frame, prefixes first); a zoom or a Lossless
  request fetches that frame's rest. A level is a prefix by the progression order (§Theory 1).
* **S+R.** S, with the rest fetched by region on a zoom: layout **P** (precincts) or **T9** (HTJ2K tiles), §Theory 5.
  A Lossless request still fetches the whole rest.
* **D+L.** D's scroll, with the Lossless request served level-first (§Theory 7's DBT case).

For frames AV1 does not serve (not cine-like: FFDM, synthesized 2D; or over 12 bits), D does not exist: the demo's
equivalent is the whole HTJ2K frame, W, and the comparison is this file's protocol above. What follows is DBT.

### What a phone screen needs from the three DBT fixtures

Viewports in device pixels (decided 2026-10-11), the frame hung long side vertical, **assumed**: a phone of
1080×2400 with the browser's bars leaving 1080×2100; a smaller phone, 720×1600 → 720×1400; a larger one, 1440×3120 →
1440×2800; the first held sideways, 2400×950. ℓ_fit from §Terms (*derived*):

| fixture | frames × C×R, D | HTJ2K series · a frame (*derived*) | 1080×2100 | 720×1400 | 1440×2800 | 2400×950 |
| --- | --- | --- | --- | --- | --- | --- |
| `dbts_a1` | 56 × 1142×1785, 12 | ≈ 69 MB · 1.23 MB | L0 | L0 | L0 | L0 |
| `dbts_b1` | 50 × 2560×3328, 10 | ≈ 109 MB · 2.19 MB | **L1** | **L1** | L0 | **L1** |
| `dbts_c1` | 69 × 976×2513, 12 | ≈ 72 MB · 1.05 MB | L0 | L0 | L0 | **L1** |

The series' bytes are the link's rate times the plain HTJ2K arm's link-bound time, envelopes and transport included
(`claude/htj2k-progressive:lab/htj2k-progressive/rows/stage3-volumes.md`, `htj2k` at r5000 and r20000, which agree
within 1 %). **On a phone held upright, S sends `dbts_a1` and `dbts_c1` whole: S there is today's exact fill.** Only
`dbts_b1` has a level to gain, and not on the larger phone. Level 1 is 26.9–27.3 % of a `dbts_b1` frame (ibid.,
stage1-levels).

### Bytes

Shares of the exact series. D at the noise rule's Q: `dbts_a1` 0.27 (Q 4), `dbts_b1` 0.10 · 0.22 (G 1 · 16),
`dbts_c1` 0.096 · 0.28 (`claude/av1-audit-quality:docs/av1/audit-quality.md` F7). S at the upright 1080×2100 phone.
MB are *derived* from the table above.

| | `dbts_a1` | `dbts_b1` | `dbts_c1` |
| --- | --- | --- | --- |
| first picture, D (one frame's share; a key frame is above its group's mean, not measured) | ≥ 0.33 MB | ≥ 0.22–0.48 MB | ≥ 0.10–0.29 MB |
| first picture, S | 1.23 MB, the frame | 0.59 MB, level 1 | 1.05 MB, the frame |
| the whole scroll at screen resolution, D · S | 18.6 · **69** MB | 10.9–24.0 · **29.6** MB | 7.0–20.2 · **72** MB |
| one frame at full fidelity after the scroll, D · S | 1.23 · **0** MB | 2.19 · 1.60 MB | 1.05 · **0** MB |
| S's total ≤ D's once the reader asks Lossless on at least (*derived*) | 41 of 56 frames | 32 of 50 (G 1) · 10 of 50 (G 16) | 63 of 69 (G 1) · 50 of 69 (G 16) |
| stored, D · S | 1.27 · 1.00 | 1.10–1.22 · 1.00 | 1.10–1.28 · 1.00 |

*Corrected 2026-11-11 (HTJ2K-REVIEW):* the break-even row read "more than … 62 · 49" on `dbts_c1`, rounded from
1.05 MB a frame; it does not depend on the MB: n ≥ (1 − q)·F where the fit is level 0 and n ≥ (s₁ − q)/s₁·F at level 1
(q D's share, s₁ = 0.271 the level-1 share, F the frames), which gives 63 and 50 there and leaves the others.

S costs 1.2–10× D's bytes to the first picture and to the scroll (*derived*, the table's ranges); it pays only for a reader who asks Lossless
on most slices. On a link-bound phone the time is the bytes (§Theory 7 of the ADR): the progressive lab's `fit` arm,
which is S at level 1, pictured every `dbts_b1` frame in 12.0 s at 20 Mbit/s and 47.5 s at 5 (stage3-volumes). S+R
changes only the zoom: a 1:1 region on the phone is 10–35 % of a frame under **P** at the median position (P5,
predicted), against S's 73 % rest.

### Decode on a phone

No phone is measured; the host at 4× CPU throttling stands in, an **assumption** about a mid-range phone. From the
progressive lab's stage-3 decode sums divided by frames (*derived*): a whole frame 93–107 ms (`dbts_a1`), 93–103 ms
(`dbts_c1`, *corrected 2026-11-11 (HTJ2K-REVIEW)* from 94–103: the `htj2k-aa` arm at r20000 reads 93.2), 268–286 ms (`dbts_b1`); a `dbts_b1` level-1 prefix 74–81 ms, ×0.26–0.30 of its whole frame. S is WASM on
the CPU in the decoders the client already runs. D's OQ view through WebCodecs decodes in about 1.55–1.81 HTJ2K frames
on this host without a GPU (`dbts_a1`, `dbts_c1`, Q 8, 1×). *Corrected 2026-11-11 (HTJ2K-REVIEW):* this was cited to
[`lines/codecs.md`](lines/codecs.md), which says 1.05–2.04; 1.55–1.81 is
`claude/av1-audit-decode:docs/av1/audit-decode.md` finding 2's *derived* figure with a discarded JS pass taken off the
clock, timed on another host, so it is not measured. At 4× the same audit reads 0.81–0.97 HTJ2K frame on `a1` and `c1`
and attributes it to WebCodecs' threads each getting a quarter CPU while OpenJPH has one (its finding 1). On a phone WebCodecs
may take a hardware decoder, which would leave the CPU free, and whether it does at 10 bits on these sizes is owed to a
phone (codecs line, Open 4). Decoded pictures stay in the OPFS cache, so each frame is decoded once.
*Corrected 2026-11-11 (HTJ2K-REVIEW):* not under S at ℓ ≥ 1. OpenJPH decodes a codestream from its start, so the rest
of a `dbts_b1` frame is decoded as a whole frame again: the progressive lab's `fit` arm, which is S's level-first fill,
reads 74–81 ms for the prefix and 273–296 ms for the whole at 4× (stage3-volumes), so a Lossless ask under S costs a
whole-frame decode, as under D, and the level's decode is spent once more.

### What *Lossless* means in each

* **D.** The OQ picture is never Lossless: its label is *Optimal quality*, its error the coding's, within the noise at
  the rule's Q. *Lossless* is the explicit request: the whole HTJ2K frame, at its stored depth, its XXH3 against the
  ingest's frame digest, bit for bit.
* **S at level 0** (`dbts_a1`, `dbts_c1` upright). Every scrolled picture is the exact frame at its stored depth (12
  bits, no depth cut), checked by today's frame digest: *Lossless* from the first picture, with no request.
* **S at level ℓ ≥ 1** (`dbts_b1`). The picture is the reversible 5/3 low band, clamped: exact against the codestream
  and equal on every conforming decoder, but neither the frame nor the frame resampled to that size (on `dbts_b1` the
  level-1 picture against the area-resampled frame differs by more than one code on most in-window samples,
  §Theory 2). It is not *Lossless*; a per-level digest written by the ingest makes it checkable, and its wording is the
  owner's. It becomes *Lossless* when the rest arrives and the frame digest matches.
* **S+R.** A zoomed region at level 0 is the frame's own samples, but the frame digest covers only the whole frame: a
  region needs a digest per precinct or HTJ2K tile (ADR §8.3), and its label ("Lossless in view") is the owner's.

Which of D's and S's level-1 pictures is nearer to the exact frame *as painted at the viewport's size* is not known;
it is the protocol's R4.

### How each fits the PCS's input and the `.sbnd` layout

* **D:** the PCS encodes each source twice, the exact HTJ2K series and the OQ AV1 series (Q by the noise rule, G per
  modality, the depth cut); two `.sbnd` files, paired by the source fingerprint (row SOURCE-FINGERPRINT).
  *Corrected 2026-11-11 (HTJ2K-REVIEW):* the PCS delivers HTJ2K as `mf.mxf` and AV1 as `mf.mp4`, not `.sbnd`; who
  builds the `.sbnd` is open ([`lines/metadata.md`](lines/metadata.md) §Open 1).
* **S:** one encode, today's codestream (RPCL, one layer, one HTJ2K tile, five levels), unchanged. The ingest adds,
  per frame, the byte offset of each level's smallest exact prefix (found by decoding, as the lab does, or by parsing
  packet headers, `claude/htj2k-progressive:lab/htj2k-progressive/layers/shapes.py`) and the per-level digest. In
  version 1 of the `.sbnd` the lab's layout already works with no format change: 2F entries, every prefix first, then
  every rest ([`FIXTURES.md`](FIXTURES.md) §SBND series bundle); version 2's band entries are
  [`disk-layout/target.md`](disk-layout/target.md) §Layout 1. No wire change (ADR §8.4).
  *Corrected 2026-11-11 (HTJ2K-REVIEW):* "RPCL, one layer, one HTJ2K tile, five levels" is our ingest's profile
  (`HTJ2K_ARGS`, `ingest/coded-frames/ingest.py`), not a known property of the PCS's `mf.mxf`. S needs the PCS's
  codestreams resolution-major; if they are not, "one encode, unchanged" becomes a re-encode at the PACS. Unverified;
  a question for the PCS team. Our profile writes no TLM, which DICOM's RPCL syntax requires (§Theory 1). DICOM's HTJ2K Lossless RPCL
  syntax is written for this use and asks a base resolution of at most 64 [S3, §10.18.1]: five decompositions leave
  `dbts_b1` 80×104, so it would need a sixth to be sent under that syntax unchanged (*derived*).
* **S+R:** **P** changes the PCS's encode (`-precincts`) and keeps one codestream a frame; **T9** stores each HTJ2K tile
  as its own codestream, so a DICOM frame is reassembled on export (§Theory 5). *Added 2026-11-11 (HTJ2K-REVIEW):* the
  store's own proposal for large frames is **T3**, [`disk-layout/target.md`](disk-layout/target.md) §Layout 1 (three
  strips × bands, each strip its own codestream), on the one measured tiling (row TILEMEASURE, below); **T9** is not
  measured.
* **The client, for S:** the render path must take a picture smaller than the frame (ADR §4, still the blocker); a
  level binding with the SIZ reset the progressive lab found missing in OpenJPH 0.31.0; the clamp to 2^D − 1; a label
  state for an exact level picture.

### What theory predicts, before any run

| # | quantity, link-bound cells, upright phone | predicted | refuted if |
| --- | --- | --- | --- |
| Q1 | S's first picture ÷ D's | `dbts_a1` 2–8, `dbts_c1` 2–15, `dbts_b1` 1.1–4 (the bytes' ratio, compressed toward 1 by the round trip; wider than the table because the run's D is Q 8) | under 1.0 on any volume |
| Q2 | S's every frame pictured ÷ D's | `dbts_a1` 3–8, `dbts_c1` 3–15, `dbts_b1` 1.1–4 | under 1.0 on any volume |
| Q3 | Lossless after the scroll, S ÷ D | 0 on `dbts_a1`, `dbts_c1`; 0.70–0.78 on `dbts_b1` | over 0.9 on `dbts_b1` |
| Q4 | in-window codes within ±1 of the exact frame painted at the viewport, S's level-1 picture and D's picture, `dbts_b1` | not predicted: both are filters of the frame the paint does not use | — |

The fixtures cannot carry more than this: three volumes of one collection; two of them never leave level 0 upright.

### Protocol, pre-registered

For a session given this section, §Protocol above and nothing else. Code and rows in a new directory, lab/htj2k-tiles/screen, which does not exist yet.
`CLAUDE.md` §Measurement throughout: arms interleaved, every new check mutated, the store warm, times quoted and not
throughputs, the host's saturation stated.

**The rule, stated first.** Per volume and cell; a bound b is missed only past b × (1 + s), s the cell's p90 of
|D′/D − 1| (D′ the same series under another name), strict readings printed too. Link-bound cells are 5 and
20 Mbit/s and `lte-good`, minus any the host names as decode-bound (§Protocol, the host).

* **R0, exact.** Every S picture equals its witness (the frame digest at level 0; `witness.py` and OpenJPEG at
  ℓ ≥ 1) and every Lossless picture the frame digest, in every kept visit. An arm failing it is out.
* **R1, the first picture.** S's ≤ 1.5 × D's.
* **R2, the scroll.** S's every frame pictured ≤ 1.25 × D's.
* **R3, Lossless.** From the request after the scroll to the exact picture, S's ≤ 0.5 × D's.
* **R4, the screen.** S's picture's share of in-window codes within ±1 of the exact frame painted at the viewport's
  size, under every header window, ≥ D's, on every frame.

**Verdicts.** R0 ∧ R1 ∧ R2 on at least two of the three volumes: S is proposed for DBT on phones, a store-format
change for the owner. Otherwise, R0 ∧ R3 on `dbts_b1`: D+L is proposed, D's scroll kept and the Lossless request
level-first, for volumes whose fit is level 1. Otherwise D stays. R4 is reported with every verdict and decides
nothing alone; the reading of a level picture is the owner's.

**Arms.** **D** and **D′**: the demo's series from `claude/demo-fixes-1:scripts/demo-series.sh` (the demo tip on
2026-11-11), Q 8 at G 1 and at G 16, the depth cut on `dbts_a1` and `dbts_c1`, through the product's AV1 route; the
Lossless request is the exact series' frame whole. Q 8 is the demo's and the rule's Q only on `dbts_c1` at G 1 (F7),
so the run's D differs from the bytes table's on the other two; both are printed. **S**: the exact series split at
ℓ_fit by `claude/htj2k-progressive:lab/htj2k-progressive/delivery/make_frames.py` (level-first, prefix entries then
rests), decoded by its `delivery/decoder.js`; where ℓ_fit is 0, S is the exact series whole. **D+L**: D's scroll, then
S's prefix and rest for the requested frame. Viewports: 1080×2100 and 2400×950, so that `dbts_c1` is run at both
levels.

**A visit.** Open at the first slice; the fill runs; the scroll is pictured when every slice is; then a Lossless request
on the middle slice; then a zoom to 1:1 at the slice's centre (S+R's bytes from stage 1 of §Protocol above, not timed
here). Per visit: time to the first picture, to every slice pictured, from the request to the Lossless picture; bytes.

**Stage 0, checks and mutants.** The split's prefixes against `witness.py` and OpenJPEG, every frame of the three
volumes; the D series' bytes and digests against that script's table. Mutants, each caught: a prefix one byte
short; the clamp removed; the SIZ reset removed (a later whole frame not exact); every digest truth flipped.

**Stage 1, the screen (offline).** For every frame of `dbts_b1`, and of `dbts_c1` at 2400×950: S's level picture and
D's picture decoded by dav1d, each painted at the viewport's size by `client/paint`'s
resampling and window, against the exact frame painted the same way; R4's share, PSNR and max |Δcode| per window.

**Stage 2, time.** `lab/av1/delivery/total-time/run.mjs` and its rig: links r5000, r20000, r50000, `lte-good`; 1× and
4×; a fresh server, relay and browser a visit; cells in a Williams order each round, arms inside each cell the same
way; 6 rounds in two shards of 3. Every picture checked after the clock. **The host:** cores, CPU, browser; a cell whose D arm's time at 4×
exceeds 1.05 × its 1× time is decode-bound, named, and kept out of R1–R3. Nothing above 50 Mbit/s is claimed. A shard
~2.5–3 h on a 4-core host (*derived* from the stage-3 visit times: S whole takes 110–175 s a visit at 5 Mbit/s, ~45–55
min a round over 5 arms, 4 links, 2 throttles, 3 volumes and the sideways viewport where it changes a level).

**Fixtures, and their limits, printed with every result:** three timed DBT volumes (`dbts_a1`, `dbts_b1`, `dbts_c1`),
all from one dataset (EA1141), slices of a volume not independent samples; only `dbts_b1` upright and `dbts_c1`
sideways reach level 1; no breast ultrasound cine; 4-core cloud hosts without a GPU, so WebCodecs is software here and
no phone's decoder is measured; the phone's viewports are assumed, not read from a device.

## Sources

Read 2026-11-09; quotations are verbatim, with the PDF's symbols restored where text extraction lost them (≤).

* **[S1]** Rec. ITU-T T.800 (06/2019) | ISO/IEC 15444-1:2019, *JPEG 2000 image coding system: Core coding system*,
  itu.int, PDF sha256 `9932e967462cd56a193db87117917e74734fb385913bf51d1f52fb0428924e1c`. The 07/2024 edition was not read.
* **[S2]** Rec. ITU-T T.814 (06/2019) | ISO/IEC 15444-15:2019, *High-throughput JPEG 2000*, itu.int, PDF sha256
  `3480bb5f636d9a0bd654ecd31d6c756c0ec5667fe767acfb2b6771de9ddc3542`.
* **[S3]** DICOM PS3.5 2026d, *Data Structures and Encoding*, dicom.nema.org (`current`), §8.2.14, §8.4.1, §10.18,
  A.11, A.12. ISO/IEC 15444-9 (JPIP) is cited through it and was not read.
* **[S4]** OpenJPH tag 0.31.0 (`c68064d0`), github.com/aous72/OpenJPH: `src/apps/ojph_compress/ojph_compress.cpp`,
  `src/core/openjph/ojph_codestream.h`, `src/core/codestream/ojph_codestream_local.cpp`, `docs/status.md`.

Repository evidence is cited where it is used: [`decode/README.md`](decode/README.md),
[`adr/resolution-fitting-for-large-frames.md`](adr/resolution-fitting-for-large-frames.md),
[`codecs/htj2k.md`](codecs/htj2k.md), [`FIXTURES.md`](FIXTURES.md), and on branches:
`claude/htj2k-progressive:lab/htj2k-progressive/README.md`, `claude/htj2k-progressive:docs/decode/README.md`
§HTJ2K progressive, `claude/docs-lines:docs/lines/codecs.md`, `claude/docs-lines:docs/lines/optimal-quality.md`.
