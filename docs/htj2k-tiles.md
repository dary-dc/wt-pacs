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

### Review (row HTJ2K-REVIEW, 2026-11-11)

*By a session that wrote none of the above. Corrections are in place, each marked; this lists what was checked and
what the section missed. Nothing is run.*

**Checked and standing.** DICOM PS3.5's §10.18.1, §8.4.1 and A.11 quotes, verbatim against the current HTML (the
elisions drop only sentences). OpenJPH 0.31.0's `-precincts` help, `restrict_input_resolution`'s and `pull`'s
comments and the PLT skip, verbatim [S4]. T.800 and T.814 were not re-read (no copy here): those quotes stand on the
2026-11-09 reading. Every ℓ_fit in the viewport table; the series' MB from `stage3-volumes` (rate × the `htj2k` arm's
time, r5000 and r20000 within 1 %); every bytes-table cell but the break-even row; the level-1 share 26.90–27.29 %
(`stage1-levels`); the `fit` arm's 12.0 and 47.5 s; `dbts_b1`'s 268–286 and 74–81 ms; §Theory 2's display error.

**Fairness.** Same lossless end state: yes, the Lossless row prices it. Same content: no, and it favours D's bytes: on
`dbts_a1` and `dbts_c1` S's scroll is the 12-bit exact frame, D's a depth-cut lossy picture; a verdict must say so.
The phone sizes are assumptions; the 1440-wide phone already takes `dbts_b1` to level 0, so the one volume with a level
to gain loses it on a large phone.

**Missed.**
* **The measured tiling, for the Lossless decode in both approaches.** Row TILEMEASURE
  ([`decode/README.md`](decode/README.md) P-TILE, `lab/av1/decode/tile`) decoded three strips on three idle workers
  at ×0.388–0.448 of the whole frame at 4× on the large series, bytes +0.12–0.59 %; Layout 1 is the store's proposal
  built on it. A `dbts_b1` Lossless frame's 268–286 ms would be about 105–130 ms (*derived*; 2560×3328 was not in the
  run, and a phone's three idle cores are an assumption). It shortens D's and S's Lossless ask alike, so it changes
  the decode-bound cells, not R3's ratio where the link is the clock.
* **Level offsets from the main header.** OpenJPH 0.31.0 writes "tilepart divisions at each resolution, indicated by
  the letter R" (`-tileparts R`) and "a TLM marker" (`-tlm_marker true`) [S4, `ojph_compress.cpp`]. Under RPCL each
  level's prefix would then end on a tile-part boundary whose offset TLM lists, so the ingest needs no decode or packet
  parse to find it, and the codestream meets the RPCL syntax's TLM clause (*derived*, not tried; it costs a tile-part
  header a resolution). For HTJ2K-IMPROVE.
* **The PCS's input**, corrected in place above: the profile S relies on is ours, not known to be the PCS's.
* **What changes the answer.** By the break-even row S pays only for a reader who asks Lossless on most slices of a
  volume; the review found nothing that moves that. What could: a phone whose WebCodecs is slow at 10 bits (the decode
  side, owed to a phone), or a reading practice that asks Lossless on most slices, which no fixture or record here
  shows.

## Improve, for a phone on lossy wireless (row HTJ2K-IMPROVE, 2026-11-11)

*By a session that wrote neither §Screen resolution nor its review. Theory, predictions and one consolidated protocol;
**nothing here is run**. Every decided approach is kept: no reduced-resolution preview (a level below the viewport's
is never painted), the lossless end state, no wire change, the OPFS cache with no re-decoding, the OQ view through
WebCodecs. Sources [S1]–[S4]; *derived* marks our arithmetic, *assumption* a band no measurement here backs.*

**What cannot be improved, said first.** At the viewport's level an exact picture costs its level's bytes: 26.9–27.3 %
of a `dbts_b1` frame at level 1, the whole frame at level 0 on `dbts_a1` and `dbts_c1` upright (§Screen resolution).
Nothing below changes those bytes by more than +0.6 %, so S's first picture and scroll stay 1.2–10× D's on a link-bound
phone and the break-even counts stand. What can be improved is the time an ask waits on decode, what is fetched or
decoded twice, and the profile's fit to DICOM and the PCS. The improved S is called **S★**; the same changes applied to
D's Lossless request give **D+T3** and **D+L★**.

### I1 · The profile: tile-parts at resolutions, TLM, and the base DICOM asks

* **Mechanism.** OpenJPH under RPCL with `-tileparts R` writes one tile-part a resolution: for each r it writes an SOT
  with `(ui8)r, (ui8)(max_decompositions + 1)` and then that resolution's precincts [S4, `ojph_tile.cpp`]; `-tlm_marker
  true` writes, in the main header, a TLM segment of 6 bytes plus, per tile-part, `Ttlm` (2 bytes) and `Ptlm` (4 bytes)
  [S4, `ojph_params.cpp`, `param_tlm::write`]. Level ℓ's prefix is then the main header plus the first NL + 1 − ℓ
  tile-parts, its length read from TLM alone: no decode and no packet-header parse at ingest. DICOM's RPCL syntax asks
  exactly this: "The Tile Length Markers (TLM) shall be present. This allows finding the resolution breakpoints to support
  smart streaming", and "The number of decompositions shall be sufficient for the width or height of the base resolution
  to be <= 64" [S3, §10.18.1]. Five decompositions leave `dbts_b1` 80×104, so it takes six (40×52); `dbts_a1` (36×56)
  and `dbts_c1` (31×79, its width ≤ 64) already meet it (*derived*). A level ℓ ≤ 5 picture is the same 5/3 low band
  whatever NL is (*derived*: deeper decompositions only split it further, reversibly).
* **Expected effect.** Bytes +112 B a frame at NL = 5 (five more SOT and SOD, 14 B each, and TLM's 6 + 6 × 6 B;
  *derived* from [S4]), +132 B at NL = 6: ≤ 0.02 % of a DBT frame; the sixth decomposition ±0.1 % (*assumption*). The
  ingest's level offsets cost nothing; the codestream meets the DICOM RPCL syntax that is written for this use, so a
  PCS that writes that syntax needs no re-encode at the PACS for S (the review's open question becomes one: does it).
* **Cost.** An encoder option; a reader that finds tile-parts (OpenJPH reads tile-parts in order, `next_tile_part`
  [S4, `ojph_tile.cpp`]). A prefix ends without EOC and with TNsot naming tile-parts it lacks; whether OpenJPH 0.31.0
  decodes it under `restrict_input_resolution` with an EOC appended, as the lab's prefixes are, is *unverified* and is
  stage 0's first check.

### I2 · Three strips, decoded on the decoders the client already runs

* **Mechanism.** Layout 1's tiling ([`disk-layout/target.md`](disk-layout/target.md) §Layout 1): three horizontal
  strips, each its own codestream in the profile of I1, strip height a multiple of 2^NL (32, or 64 at NL = 6: 1 152
  rows on `dbts_b1`). "tiling of the image actually creates tile-components that can be extracted or decoded independently
  of each other" [S1, §5.3]. The client already runs min(3, `hardwareConcurrency`) decoders
  (`client/transport/downloader.js`), so k = 3 strips match them; a 3 × 3 grid would put nine codestreams on three
  decoders and pay more edge bytes (P2), for no decode gain.
* **Expected effect.** Measured (row TILEMEASURE, [`decode/README.md`](decode/README.md) P-TILE): bytes +0.12–0.59 %;
  one ask on three idle workers ×0.388–0.448 of the whole frame at 4× on 1914×2572 to 3328×4096, ×0.476 on 931×2124.
  *Derived* for the fixtures: a `dbts_b1` Lossless decode 268–286 ms → 104–128 ms at 4×; `dbts_a1` and `dbts_c1`
  93–107 ms → 38–54 ms (*assumption*: their sizes sit between the measured 931×2124 and 1914×2572). **Over a link the
  gain is larger than the decode's alone**, because strips arrive one after another and each decodes as it lands: the
  time after the last byte is one strip's decode, not the frame's. A `dbts_b1` Lossless ask at 20 Mbit/s, 4×: 2.19 MB in
  0.88 s, then 268–286 ms whole against ~90–105 ms for the last strip, so ×0.84–0.86 of D's Lossless; at 5 Mbit/s
  ×0.95 (*derived*, *assumption* that a strip decodes in a third of the frame's time on one worker, TILEMEASURE's
  one-worker ×0.996–1.08). **During the fill it changes nothing**: three decoders are already busy on three frames.
  *Corrected by HTJ2K-VERDICT (2026-11-12):* the mechanism holds in stage 2 (J3), but on a link it explains at most
  a third of the measured gain. On `r5000` D+T3 saves 47–51 ms at 1× and 139–311 ms at 4× against D, with the same
  bytes (±0.2 %). That is 2.5–3× the frame's whole decode (stage 2: 17–47 ms at 1×, 64–191 ms at 4×), and strips can
  save at most two thirds of it. The rest is unattributed (§Verdict, A1).
* **What it changes in *Lossless*.** The three level-0 strips stacked are the frame and hash to today's frame digest;
  a level picture is per strip, its truth the strip's own analysis, near an edge not the untiled level picture
  (§Theory 5); Layout 1 carries a samples hash per tile and band.
* **Cost.** Layout 1 is a proposal, not built; three entries a frame-band; the client assembles three strips into
  one frame; a DICOM export of the frame needs the strips joined into one codestream (§Theory 5, *unverified*) or
  re-encoded.

### I3 · Bands at the viewport's level, asked by index

* **Mechanism.** Layout 1's bands are levels 2, 1 and 0, band-major, `e = b · N · T + f · T + t`
  ([`disk-layout/target.md`](disk-layout/target.md) §Layout 1). S★ keeps that format unchanged and asks bands 0..b_fit
  together, b_fit = 2 − ℓ_fit: the fill at the fit is one contiguous run, entries [0, (b_fit + 1) · N · T), sent as
  `stream_frames` asks it today; the opened slice's entries are asked ahead of the run, as a step to a frame not yet
  here is today (`client/README.md` §Frames); a Lossless or zoom ask on frame f is its T entries of each finer band,
  contiguous. **Band 0 alone (level 2) is never painted on a phone**: it is below the viewport, a reduced-resolution
  preview the owner ruled out. Turned sideways, ℓ_fit can only fall (L1 → L0 on `dbts_c1`): the finer band is asked,
  nothing is fetched twice.
* **Expected effect.** No bytes beyond I1 and I2; asks a frame 3 (b1 at the fit) or 6 (a1, c1 whole) entries, all in
  runs; envelopes 8 B an entry (*derived*).
* **Cost.** None beyond Layout 1.

### I4 · The cache: nothing fetched twice, a level decoded once

* **Mechanism.** The OPFS store keeps frames checked `true` (`claude/demo-fixes-2:client/viewer/store.js`). S★ adds two things to it, per
  frame: the **coded bands received** while its rest has not come, and the **decoded level picture** once every strip's
  level hash matches, kept under its level. A reopen paints the level picture without a decode and asks only the
  missing bands; when the rest arrives, the stored bands join it and the frame is decoded whole; once the frame
  digest matches, the frame enters today's store and both are dropped. A level picture is never stored or shown as
  *Lossless*.
* **What it cannot remove.** OpenJPH decodes from the codestream's start and restricts only how many fine resolutions
  it skips ("reading and decoding is not performed for this number of fine resolutions", [S4, `ojph_codestream.h`]);
  it has no call that resumes from a decoded low band. So at a Lossless ask the coarse levels' blocks are decoded
  again: on `dbts_b1` the level's 74–81 ms at 4× on one worker, inside the whole decode's 273–296 ms (§Screen
  resolution, the review's correction), about 30–50 ms a strip under I2 (*assumption*). A patched decoder that takes
  the low band in hand would save that; it is **not proposed**: a fork of a pinned decoder for at most a quarter of
  one decode a Lossless ask, which I2 already shortens more.
* **Expected effect.** A reopened series fetches and decodes nothing it holds (*derived*). Space on `dbts_b1`: a level
  picture is 1 280 × 1 664 × 2 B = 4.3 MB, its bands 0.59 MB, against 17.0 MB a whole frame (*derived*).
* **Cost.** A second record kind in the store, keyed by level; a per-strip level hash check before a level picture is
  kept.

### I5 · Precincts and code-blocks: kept as they are for DBT

* **Code-blocks** stay 64 × 64, DICOM's "Block Size: 64x64" that "may improve decoding performance" [S3, §10.18.1];
  smaller blocks give a finer region at level 1 for more headers and a slower HT decode, and no arm here needs them.
* **Precincts inside each strip** (§Theory 5's **P**, PP ≥ 7, every block's bytes unchanged) would let a zoom fetch
  its region rather than whole strips. On an upright phone a 1:1 region of `dbts_b1` is 1 080 × 2 100 samples, which
  spans two or all three strips of 1 152 rows, so I2 alone saves 0–⅓ of a zoom's rest (*derived*); **P** would save
  more (P5: 10–35 % of a frame against 73 %). It is **not proposed for DBT now**: its splice decode is *unverified*
  (§Theory 5), and how often a phone reader zooms past the fit is not known. Stage 1 below reports its zoom bytes as a
  reading; §Protocol's R2 decides **P** for FFDM.

### I6 · Window and zoom changes

A window change asks no bytes and no decode in any arm (*derived*: the paint maps samples already held). Under S★ at
level 0 the samples are the frame's own at its stored depth (12 bits on `dbts_a1`, `dbts_c1`); under D they are the
cut 10 bits, lossy. That is a difference in what a window shows, not in time, and the protocol reads none of it. A
zoom under S★ asks the strips in view of the finer bands (I3); a zoom under D shows the OQ picture enlarged until a
Lossless request.

### Combined, and what is predicted

| arm | scroll | Lossless request on frame f | changes |
| --- | --- | --- | --- |
| **D** | the demo's OQ view | the HTJ2K frame whole | — |
| **D+T3** | D's | f's three level-0 strips, each decoded as it lands | I1, I2 |
| **D+L★** | D's | f's strips' bands at ℓ_fit first (an exact level picture, then painted), then the rest | I1–I4 |
| **S★** | every frame's bands at ℓ_fit, strips | f's finer bands | I1–I4 |

D+L★ differs from D+T3 only where ℓ_fit ≥ 1 (`dbts_b1` upright, `dbts_c1` sideways); elsewhere it is D+T3.

| # | quantity (link-bound cells: 5, 20 Mbit/s, `lte-good`, `wifi-home`) | predicted | refuted if |
| --- | --- | --- | --- |
| J1 | I1's bytes, every frame | +0.005–0.1 % of today's; each level's TLM prefix decodes to the smallest exact prefix's picture | over +0.2 %, or any picture differs |
| J2 | I2's bytes, three volumes | +0.1–0.6 % | over +1.0 % |
| J3 | one Lossless decode at 4×, three strips on three workers ÷ the whole frame on one | ×0.38–0.50 (`dbts_b1`); ×0.40–0.55 (`dbts_a1`, `dbts_c1`) | over ×0.60 on any volume |
| J4 | Lossless after the scroll, D+T3 ÷ D, 4× | `dbts_b1` ×0.79–0.95; `dbts_a1`, `dbts_c1` ×0.85–0.97 | over ×1.0 in any link-bound cell |
| J5 | the same at 1× | ×0.93–1.00 | over ×1.03 |
| J6 | D+L★'s level picture ÷ D's Lossless, `dbts_b1` upright | ×0.22–0.40 | over ×0.50 |
| J7 | D+L★'s Lossless ÷ D+T3's | ×1.00–1.08 (the level's decode again, I4) | over ×1.15 |
| J8 | S★ ÷ D, first picture and every frame pictured | Q1, Q2 unchanged within 10 % (bytes the clock) | under 1.0 on `dbts_a1` or `dbts_c1` |
| | *verdict* | not refuted; band missed twice: `dbts_a1` every slice ×14 (Q2 3–8), `dbts_b1` first ×0.67–0.90 (Q1 1.1–4) | |
| J9 | S★'s first picture ÷ S's (stage 2, decode only, 4×) | ×0.40–0.60 of the decode; ×0.85–1.00 of the time on a link | — (a reading) |
| J10 | reopen after a complete fill, S★ and D+L★ | 0 bytes asked, 0 decodes | any |
| J11 | `r20000` with 1 % loss each way: every ratio above | within ±5 % of its clean `r20000` value | outside ±10 % |
| | *verdict* | **refuted**: ×0.39–4.1 of clean; s 0.5–3.9 on that cell, so six rounds cannot resolve it | |

The predicted standing: **S★ still does not pay for a scroll** (J8); its gains are a reader's Lossless wait and a
reopen. The candidate this predicts is **D+T3** for every Lossless ask, and **D+L★** where a level is to be had, if the
owner rules that an exact level picture may be shown before the frame.

### Protocol, pre-registered, for HTJ2K-MEASURE

For a session given this section, §Screen resolution's protocol and §Protocol above, and nothing else; where they
differ, this one rules. Code and rows in a new directory, lab/htj2k-tiles/improve, which does not exist yet.
`CLAUDE.md` §Measurement throughout: arms interleaved, every new check mutated, the store warm, times quoted and not
throughputs, the host's saturation stated, nothing past it claimed.

**The rule, stated first.** Per volume and cell, a bound b is missed only past b × (1 + s), s the cell's p90 of
|D′/D − 1|, strict readings printed too. Link-bound cells: `r5000`, `r20000`, `lte-good`, `wifi-home`, minus any the
host names as decode-bound (a cell whose D arm at 4× exceeds 1.05 × its 1× time).

* **R0, exact.** Every level picture equals its strip's witness (`witness.py` on the strip's samples, and OpenJPEG on
  the same bytes), every Lossless picture the frame digest, in every kept visit. An arm failing it is out.
* **R1, the profile (offline).** J1's bound on every frame of the three volumes. If it fails, I1 is withdrawn and the
  arms run on prefixes found as §Protocol's stage 0 finds them; say so.
* **R2, the strips.** J2's bound, and J3's ×0.60 at 4× on every volume in at least 8 of 10 rounds. If it fails, D+T3,
  D+L★ and S★ are withdrawn and nothing below is run but D, D′ and S (§Screen resolution's protocol, as written).
* **R3, the Lossless ask.** D+T3 ≤ ×0.92 of D at 4× on `dbts_b1` in at least two thirds of the link-bound cells, and
  ≤ ×1.02 of D in every cell of every volume: **D+T3 is proposed for the Lossless request**, Layout 1 for DBT, a
  store-format change for the owner.
* **R4, the level first.** On `dbts_b1` upright: D+L★'s level picture ≤ ×0.40 of D+T3's Lossless, and its Lossless
  ≤ ×1.08 of D+T3's, in at least two thirds of the link-bound cells: **D+L★ is proposed beside D+T3**; whether a level
  picture may be shown, and its words, are the owner's.
* **R5, the scroll.** §Screen resolution's R1 and R2 for S★ against D (first picture ≤ 1.5×, every frame pictured
  ≤ 1.25×) on at least two of three volumes: S★ is proposed for DBT on phones. Otherwise S stays withdrawn for the scroll.
* **R6, the cache.** J10 in every visit that reopens; a miss withdraws I4 and names the arm.
* **R7, loss.** J11 is reported with every verdict and decides nothing alone; a ratio outside ±10 % on the lossy cell
  is named in the verdict.

**Arms.** **D**, **D′**: the demo's series from the demo tip's `claude/demo-fixes-2:scripts/demo-series.sh` (or its successor's) at the commit
printed, through the product's AV1 route; the Lossless request is today's frame
whole. **D+T3**, **D+L★**, **S★**: the exact series re-encoded by `ojph_compress` 0.31.0 from `ingest/tools.sh`
per strip as I1 and I2 say (`-prog_order RPCL -reversible true -num_decomps` 5, 6 on `dbts_b1`, `-tileparts R
-tlm_marker true`), cut into Layout 1's band-major entries at TLM's boundaries, decoded by a lab worker that decodes a
strip's prefix at its level with the lab level binding (`claude/htj2k-progressive:lab/htj2k-progressive/wasm/levels.patch`,
its SIZ reset kept) and a strip whole with the product's build, and assembles the strips into one frame. Stage 2
also runs **S** (§Screen resolution, today's codestream, level-first) and **W** (today's whole frame) as decode
references. Viewports 1080×2100, and 2400×950 for `dbts_c1`.

**Stage 0, checks and mutants.** On every frame of the three volumes: the strips stacked equal the encoder's input and
the frame digest; each strip's TLM prefix at each level decoded by the lab binding and by OpenJPEG 2.5.4 (`-r`) equals
`witness.py`'s analysis of the strip; the cut entries tile each strip codestream exactly; the store's reopen asks
nothing it holds. `lab/decode-bench/parity.mjs` on both builds: `PARITY OK`. Mutants, each must be caught: a TLM
length off by one (a prefix short); strips stacked in the wrong order; one strip's level hash taken from the untiled
frame (the edge rows differ); the SIZ reset removed (a later whole strip not exact); the cache's coded bands dropped
(the reopen asks a band again); band 0 painted on the phone viewport (a preview, refused); every digest truth flipped.

**Stage 1, bytes (offline).** Per frame and arm: total bytes ÷ today's; the level's bytes; J1, J2; a 1:1 zoom's bytes at
the frame's centre on the phone, under strips (I2) and under precincts in each strip (I5, `{128,128},{256,256}`), a
reading that decides nothing.

**Stage 2, decode.** Headless Chromium (version printed), 1× and 4× (`lab/scripts/cpu_throttle.mjs`), 10 rounds in a
Williams order of W, S, D+T3 and S★, the first 8 frames a volume, 3 timed passes after a checking pass, a fresh
browser per throttle and round: per ask, ms from its last byte in hand to its picture, on three idle workers and on
one; J3, J9.

**Stage 3, time on links.** `lab/av1/delivery/total-time/run.mjs` and its rig: `--links r5000,r20000,lte-good,wifi-home`
clean, and `r20000` with `--impairs l1`; `--throttles 1,4`; a fresh server, relay and browser a visit; cells in a
Williams order each round and the five arms (D, D′, D+T3, D+L★, S★) inside each cell the same way; 6 rounds. A visit:
open at the first slice; the fill; a Lossless request on the middle slice once every slice is pictured; then close
and reopen the page and wait for every slice (J10). Per visit: time to the first picture, to every slice pictured,
from the request to the level picture (D+L★) and to the Lossless picture; bytes; a reopen's asks and decodes. Every
picture checked after the clock. `lte-good` and `wifi-home` carry their profile's own burst loss (0.01 % and 0.5 %,
run.mjs's defaults); `l1` adds 1 % each way on `r20000`.

**The host.** Cores, CPU, browser; the cells named decode-bound; nothing above 20 Mbit/s on a fixed rate, and nothing
past three decoders on a 4-core host, is claimed.

**Shards, each ≤ 4.5 h** (*derived* from §Screen resolution's visit times; S★ is S's bytes): S0 stage 0 and 1, 2–3 h;
S2 stage 2, ~2 h; S3a–S3c stage 3, rounds 1–2, 3–4, 5–6, ~3 h each (about 1.5 h a round: S★ takes 110–175 s a visit at
5 Mbit/s on `dbts_a1` and `dbts_c1`, the four D arms 20–50 s). Each shard prints its pins (commit, Chromium, the
series' digests); the summary joins rounds with equal pins only. A shard that reaches 4.5 h stops at a round's end and
says how many it kept.

**Fixtures, and their limits, printed with every result:** three timed DBT volumes (`dbts_a1`, `dbts_b1`, `dbts_c1`),
all from one dataset (EA1141), slices of a volume not independent samples; only `dbts_b1` upright and `dbts_c1`
sideways reach level 1; no breast ultrasound cine; a 4-core cloud host without a GPU, so WebCodecs is software, 4×
throttling stands in for a phone (*assumption*), and the phone's viewports are assumed; the links are emulated, one
host's loss models, not a phone's radio. **What only a phone can show** and this run claims nothing about: a phone's
WebCodecs at 10 bits (hardware or not), its cores free for three decoders beside the page, its storage speed for the
OPFS reopen, and a real radio's loss.

### Improve, measured: stages 0–2 (row HTJ2K-MEASURE, 2026-11-11)

*Run by a session that wrote none of the protocol. The run follows the protocol as written, except for the
deviations named below. Code and raw rows are in [`lab/htj2k-tiles/improve/`](../lab/htj2k-tiles/improve/README.md).
Stage 3 is **not run yet**, so no verdict that needs it (R3–R7) is drawn here.*

**Fixtures and host, with every result:** three timed DBT volumes (`dbts_a1` 56 × 1142×1785, 12 bits; `dbts_b1` 50 ×
2560×3328, 10 bits; `dbts_c1` 69 × 976×2513, 12 bits), all from one dataset (EA1141), slices not independent samples;
only `dbts_b1` upright and `dbts_c1` sideways reach level 1; no breast ultrasound cine; a 4-core cloud host (Intel
Xeon, 2.1 GHz) without a GPU, headless Chromium 153.0.8010.12 (Playwright's), three decoder workers beside the page,
so nothing past three decoders is claimed; 4× is `lab/scripts/cpu_throttle.mjs`'s cgroup cap standing in for a phone
(*assumption*; its own check on this host read page ×4.0, worker ×2.7). Nothing here runs on a link, so no cell is
link-bound or decode-bound yet. Nothing on the list of **what only a phone can show** (§Protocol above) is claimed.

**Stage 0, every frame of the three volumes (175).** I1's profile (`-tileparts R -tlm_marker true`, NL 5; NL 6 on
`dbts_b1`, whose base at five is 80×104) and I2's three strips (rows 0/608/1216/1785, 0/1152/2304/3328, 0/864/1728/2513).
**R0 holds on 175/175 frames:**

* every TLM length equals its SOT's Psot;
* every level's TLM prefix, with EOC appended, decodes by OpenJPEG 2.5.4 (`-r ℓ -allow-partial`) and by OpenJPH
  0.31.0's `ojph_expand -skip_res ℓ,ℓ` to the 5/3 witness of its strip (ℓ = NL … 0) and of the whole frame
  (ℓ = NL … 1);
* the level-0 strips stacked equal the frame's sha256;
* Layout 1's three bands tile each strip at TLM boundaries.

I1's open question was whether a TLM prefix decodes without EOC and with tile-parts missing. It does, on both
decoders, once EOC is appended. The lab binding (`levels.patch`, built with the delivered build's toolchain and flags)
was checked on the first 8 frames: every strip, at every level and then whole, on one decoder, 456/456 exact. The
delivered build was built on the host from its checked cache, because this host has no container daemon; it matched
`manifest.sha256`. **Mutants, each caught:**

* every TLM length one byte short: both decoders refuse the prefix;
* strips stacked in reverse: the digest fails;
* a strip's level truth taken from the untiled frame: levels ≥ 1 differ;
* every truth flipped: 0/456, and 0 of 175 frames;
* the SIZ reset removed: 72/456 whole strips are not exact after a level.

**Deviations:**

* The stage-2 bench never decodes a whole codestream on the level decoder; the delivered build does that. So the
  SIZ-reset mutant passes the bench (896/896 in one round) and is caught by the binding's own check instead.
* `lab/decode-bench/parity.mjs` and the cache's two mutants (bands dropped, band 0 painted) are not run, because
  there is no S★ client yet; that client is part of stage 3.

**Stage 1, bytes (every frame).**

| volume | J1: I1 ÷ today − 1 | J2: three strips ÷ today − 1 | level bytes at the phone's fit | 1:1 zoom at the centre, strips in view |
| --- | --- | --- | --- | --- |
| `dbts_a1` | +0.009 … +0.011 % | +0.107 … +0.144 % | L0, the frame | nothing to fetch (L0) |
| `dbts_b1` | **−0.303 … −0.267 %** | **−0.242 … −0.198 %** | L1, 0.267–0.271 of the strips | 0.729–0.733 of the strips: all three |
| `dbts_c1` | +0.010 … +0.013 % | +0.106 … +0.138 % | L0 (sideways L1, 0.272–0.275) | nothing to fetch (L0) |

* **J1 holds** (refuted over +0.2 %): +112 B a frame at NL 5, as derived. On `dbts_b1` it falls under its band. The
  sixth decomposition, which DICOM's base ≤ 64 asks for, *saves* 0.27–0.30 %; I1 had put it at ±0.1 % (*assumption*,
  missed).
* **J2 holds** (refuted over +1.0 %): within +0.1–0.6 % on `dbts_a1` and `dbts_c1`, and under the band on `dbts_b1`
  for the same reason. **R1 holds, and so does R2's bytes clause.**
* The zoom reading decides nothing. At the centre of `dbts_b1`, an upright 1:1 viewport (2 100 rows) spans all three
  strips, so I2 saves none of a zoom's rest there; this is the lower end of I5's "0–⅓". The precinct reading (I5,
  `{128,128},{256,256}`) is **not run**.

**Stage 2, decode.** The first 8 frames of each volume, 10 rounds, a fresh browser per throttle in a Williams order,
and arms W, S, D+T3 and S★ in a Williams order per frame and pass, with a checking pass and then 3 timed passes.
**17 920/17 920 pictures exact.** Each figure below is, per set and throttle, the median of the rounds' medians.
s is the p90 of |S's Lossless ÷ W − 1|: the same bytes on the same build, used as this stage's A/A pair. That is a
*deviation*: the rule names D′/D, which is a stage-3 pair.

| set | W's decode, 1× · 4× | s, 1× · 4× | J3, three strips on three workers ÷ W, 4× (1×) | rounds ≤ ×0.60, 4× | three strips on one worker ÷ W, 4× | J9, S★'s first picture ÷ S's, 4× (1×) |
| --- | --- | --- | --- | --- | --- | --- |
| `dbts_a1` upright | 17.0 · 65.5 ms | 0.069 · 0.093 | **×0.426** [0.358–0.467] (×0.453) | 10/10 | ×0.997 | ×0.416 (×0.464) |
| `dbts_b1` upright | 47.2 · 191.1 ms | 0.047 · 0.025 | **×0.461** [0.419–0.494] (×0.473) | 10/10 | ×0.976 | ×0.566 (×0.596) |
| `dbts_c1` upright | 16.7 · 64.2 ms | 0.087 · 0.046 | **×0.475** [0.408–0.544] (×0.513) | 10/10 | ×1.036 | ×0.445 (×0.498) |
| `dbts_c1` sideways | 16.7 · 65.6 ms | 0.044 · 0.082 | ×0.452 [0.402–0.500] (×0.515) | 10/10 | ×1.008 | ×0.433 (×0.529) |

* **J3 holds on every volume**: predicted ×0.38–0.50 on `dbts_b1` and ×0.40–0.55 on the others. **R2 holds**: J3 is
  ≤ ×0.60 at 4× in 10/10 rounds on every volume, both strictly and with s. **D+T3, D+L★ and S★ therefore stay in
  stage 3.**
* **J9 holds where it means something**, the sets whose fit is level 1: predicted ×0.40–0.60 of the decode, measured
  ×0.566 on `dbts_b1` and ×0.433 on `dbts_c1` sideways. Where the fit is level 0, J9 measures the same thing as J3.
* One worker decodes the three strips in 0.98–1.04 of the frame's time. Strips add no decode cost; they only spread
  it across workers.
* W's whole `dbts_b1` decode takes 191 ms at 4× here, against §Screen resolution's 268–286 ms. The host and the
  throttle differ, so the ratios carry over and the times do not.

**Owed, for stage 3** (shards S3a–S3c, the next session):

* ~~the D arms' series~~ built from the demo commit `157b7109`'s `scripts/demo-series.sh`, equal byte for byte to FREEZE-E2E's run;
* ~~the strip arms' series~~ cut into Layout 1's band-major entries; checked from the entries alone, 294/294 pictures exact, three mutants caught ([`stage3_check.py`](../lab/htj2k-tiles/improve/stage3_check.py));
* ~~a lab client for D+T3, D+L★ and S★~~ built ([`stage3/`](../lab/htj2k-tiles/improve/stage3/)), with I4's store and its reopen; stage 0's two cache mutants caught (below);
* ~~`parity.mjs` on both builds~~ PARITY OK on the delivered build and on the lab level binding, nine fixtures, 87 frames each ([`rows/stage3-parity.txt`](../lab/htj2k-tiles/improve/rows/stage3-parity.txt));
* ~~then §Protocol's stage 3 as written, and R3–R7~~ run, six rounds (below).

### Improve, measured: stage 3 (row HTJ2K-MEASURE, 2026-11-12)

*Same session rules as stages 0–2. Fixtures and host as above; the links are emulated by the rig's relay. Rows land
in lab/htj2k-tiles/improve/rows/stage3-s3a.jsonl (rounds 0–1, linked once committed) and its successors as
they are measured; the readings below are written only once a shard ends.*

**Amendments, written before any run:**

* **D's series.** The protocol names "the demo's series" and no G; §Screen resolution's names Q 8 at G 1 and at
  G 16. The run takes **Q 8 at G 16** (the depth cut on `dbts_a1`, `dbts_c1`), and **D′** is the same bundle under a
  second name; G 1 is not run, for time.
* **Two series a visit.** The rig serves one series per server, and D needs the OQ series and the exact one (D+T3
  and D+L★ need the OQ and the strip series). Each series gets its own server behind its own relay, on the cell's
  link with the round's seed, both started together. The Lossless request is issued only once the fill is over, so
  the two relays never carry at the same time; a real phone would share one radio.
* **The store.** The reopen goes through a lab OPFS store ([`store.js`](../lab/htj2k-tiles/improve/stage3/store.js))
  that keeps every arm's pictures and S★'s coded bands. It stands in for the product store plus I4's two record kinds.
  It is written after the clock in every arm, so no time measured includes a store write. J10 is judged on S★ and
  D+L★; the other arms' reopens are reported too.
* **The OQ pictures have no truth.** A lossy series' metadata carries no digests, and the viewer leaves those frames
  unchecked. The run does the same, and joins a visit's OQ pictures into one digest, which must agree across a
  volume's D visits. Every exact and level picture is checked against `frames.json`.
* **J10's bands.** "Asks nothing it holds" is read two ways. Nothing is asked to picture every slice again. And for
  every S★ frame not yet Lossless, its fit bands are held, so a later Lossless ask fetches only the finer bands
  (`bandsAgain`). The `bands-dropped` mutant must turn the second reading on.

**Stage 0's cache mutants, and two more** (S★ on `dbts_c1` sideways, `r20000`, 1×), each caught:

* bands dropped: 408 bands would be fetched again;
* band 0 painted: refused as a preview;
* every truth flipped: 0/70 exact;
* one sample flipped: 0/70 exact.

The unmutated smoke visits (not kept) were exact in every arm, with 0 asks and 0 decodes on every reopen.

**Shard S3a, rounds 0–1 (2026-11-11 23:52 to 11-12 06:22; 400 visits).** These are facts only. The ratios need all
six rounds, so no verdict is drawn here. Rows are in
[`rows/stage3-s3a.jsonl`](../lab/htj2k-tiles/improve/rows/stage3-s3a.jsonl), and the readings are produced by
[`summary.py`](../lab/htj2k-tiles/improve/stage3/summary.py).

* **Kept: 350.** 33 visits are void (the relay ran late) and 17 failed.
* **Why 17 failed.** Every failed visit had received all its bytes (the relays' packet counts are full) and never
  reported. Round 1's stall report places them all after the clock, in the lab store: one OPFS write through a sync
  access handle never returned. A debug run reproduced it once in 7 visits. No time measured is affected, but the
  visit is lost. From S3b the page restarts the store after 30 s and sends the operation again; the row counts the
  retries (`storeRetries`).
* **R0 holds in every kept visit:** every level and Lossless picture is exact. The OQ pictures' digest agrees across
  the D visits of each volume.
* **J10.** 0 asks and 0 decodes hold in 140/140 reopens of S★ and D+L★. Two D+L★ reopens on `dbts_b1` each gave one
  picture that differs from its filled copy; which one is not recorded in S3a. From S3b the row names it.
* **The decode-bound test, as pre-registered,** names 12 of the 20 (set, link) pairs. In those, D's every-slice time at
  4× exceeds 1.05 × its time at 1×, because D's fill is decoded by software WebCodecs on this host. So `r5000` and the
  lossy cell are most of what stays link-bound. This is reported with the verdict and is not amended.

**Shard S3b, rounds 2–3 (2026-11-12 06:42 to 10:32; 400 visits),** with the store retry. Facts only, as for S3a. Rows
are in [`rows/stage3-s3b.jsonl`](../lab/htj2k-tiles/improve/rows/stage3-s3b.jsonl).

* **Kept: 354.** 44 visits are void (the relay ran late) and 2 failed. The store retry never fired (0 retries).
* **Why 2 failed.** Both on `dbts_b1` at 4× (D+T3 on `r20000` `l1`, D+L★ on `lte-good`). A store write was refused
  with "The operation failed because it would cause the application to exceed its storage quota", and the page then
  did not picture every slice. Both relays had carried the whole fill. As in S3a, no time measured is affected.
* **R0 holds in every kept visit,** and the OQ digest agrees across each volume's D visits.
* **J10.** Every reopen of S★ and D+L★ asked 0 bands and decoded nothing (144/144). One of them (D+L★, `dbts_b1`,
  `r5000`, 4×) gave one picture that differs from its filled copy: frame 49's OQ picture, the volume's last. All
  three differing reopens of S3a and S3b are D+L★ on `dbts_b1`. The one named is an OQ picture, not a level or a
  Lossless one.
* **The decode-bound test** names 11 of the 20 (set, link) pairs in S3b alone.

**Stage 3, all six rounds (S3a–S3c, 11-11 23:52 to 11-12 ~14:30; 1 200 visits).** Rows:
[`rows/stage3-s3a.jsonl`](../lab/htj2k-tiles/improve/rows/stage3-s3a.jsonl), `-s3b`, `-s3c`. Readings come from
[`summary.py`](../lab/htj2k-tiles/improve/stage3/summary.py) over all three files. Fixtures and host are as above
(Chromium 153.0.8010.12; WebCodecs decoded every OQ frame, in software), and the links are emulated. Nothing on the
list of what only a phone can show is claimed. Each ratio is the median of six round-paired ratios, and s is the
cell's p90 of |D′/D − 1| on the denominator's quantity.

* **Kept: 1 053.** 125 visits are void (the relay ran late) and 22 failed: 17 in S3a, then 2 and 3 once the store
  retry was in. Every failed visit had received all its bytes and stalled in the lab store, after the clock.
* **R0 holds** in every kept visit: every level and Lossless picture is exact, and the OQ digest agrees across each
  volume's D visits.
* **Decode-bound cells, by the rule as written.** In 13 of the 20 (set, link) pairs, D's every-slice time at 4×
  exceeds 1.05 × its time at 1×; the software AV1 fill is the cause. **The only link-bound cell left on every volume
  is `r5000`.** The rule's "two thirds of the link-bound cells" is therefore one cell of one. The readings below
  name it, and give the other cells as readings that decide nothing.

| reading (4× unless said) | `dbts_b1` `r5000` (link-bound) | the other cells, clean | the lossy cell `r20000 l1` |
| --- | --- | --- | --- |
| D+T3's Lossless ÷ D's | ×0.923 (s 0.016); 1× ×0.972 | `dbts_b1` ×0.73–0.92; `dbts_a1`, `dbts_c1` ×0.78–0.94 (1× ×0.93–0.98) | ×0.85–1.17 |
| D+L★'s level picture ÷ D+T3's Lossless | ×0.285 (s 0.087); 1× ×0.287 | `dbts_b1` ×0.35–0.47; `dbts_c1` sideways ×0.31–0.59 | ×0.14–0.32 |
| D+L★'s level picture ÷ D's Lossless (J6) | ×0.264; 1× ×0.279 | `dbts_b1` ×0.28–0.37 | ×0.14–0.39 |
| D+L★'s Lossless ÷ D+T3's (J7) | ×1.010; 1× ×1.001 | ×0.94–1.07 | ×0.77–1.17 (s up to 3.9) |
| S★'s first picture ÷ D's | ×0.665 | `dbts_b1` ×0.39–0.68; `dbts_a1` ×1.3–5.6; `dbts_c1` upright ×1.1–4.6, sideways ×0.57–1.4 | — |
| S★'s every slice ÷ D's | ×1.227 | `dbts_b1` ×0.62–1.33; `dbts_a1` ×7.5–20; `dbts_c1` upright ×5.8–14, sideways ×1.3–3.3 | — |

* **R3, the rule as written: holds, on its one link-bound cell.** D+T3 is ×0.923 of D at 4× on `dbts_b1` `r5000`.
  That is a miss strictly (bound 0.92) and within the bound with s (0.92 × 1.016). D+T3 is also ≤ ×1.02 × (1 + s)
  of D in 40/40 (volume, throttle) groups, 38/40 strictly; the two strict misses are the lossy cell's `dbts_b1` at 1×
  (×1.021) and `dbts_c1` sideways at 1× (×1.171, s 0.154). The rule's consequence follows: **D+T3 is proposed for
  the Lossless request**, with Layout 1 for DBT, a store-format change for the owner. Its standing rests on one
  link-bound cell, since the others are decode-bound by the D arm's AV1 fill on this host.
* **R4 holds** on `dbts_b1` upright at `r5000`, 1× and 4×: the level picture is ×0.285–0.287 of D+T3's Lossless
  (≤ ×0.40), and its Lossless ×1.001–1.010 (≤ ×1.08). **D+L★ is proposed beside D+T3.** Whether a level picture may
  be shown, and in what words, is the owner's.
* **R5: S★ is withdrawn for the scroll**, on one volume of three. Where the fit is level 0 (`dbts_a1`, `dbts_c1`
  upright), S★ sends the whole exact series; every slice is pictured ×5.8–20 later than D, and the first picture is
  ×1.1–5.6 later. On `dbts_b1` (fit level 1) it meets both bounds in 5/5 cells at 4× and 4/5 at 1×.
* **R6 holds.** Every reopen of every arm asked 0 bands and decoded 0 pictures: 431/431 for S★ and D+L★, 1 053/1 053
  in all. *Outside the rule:* in 18 reopens on `dbts_b1` (the D arms; 17 MB pictures), OQ frame 47 or 49 read back
  from the lab store differed from the picture that was filled. The exact and level pictures always matched. This is
  a lab-store defect, unexplained, that touches no time.
* **R7 (J11), named and deciding nothing:** many ratios on `r20000 l1` sit outside ±10 % of their clean `r20000`
  value. D+T3 ÷ D moves ×1.26 on `dbts_b1` at 4× and on `dbts_c1` sideways. D+L★'s level ÷ D+T3 moves ×0.39–0.70.
  S★ ÷ D moves ×1.1–4.1. s on the lossy cell reaches 0.5–3.9, so one lossy round can move a ratio more than the arms
  differ.

**A replicate of rounds 4–5, outside the rule and the verdict.** A session resumed this row at 13:25, while it was
still running, and ran S3c's rounds 4–5 again whole, in a fresh container with equal pins (2026-11-12 13:34 to 17:50;
[`rows/stage3-s3c-4.jsonl`](../lab/htj2k-tiles/improve/rows/stage3-s3c-4.jsonl), its summary with S3a and S3b in
[`rows/stage3-s3c-4-summary.txt`](../lab/htj2k-tiles/improve/rows/stage3-s3c-4-summary.txt)). It kept 268 of 400 (131
void, 1 failed on the storage quota). With it in place of S3c, every reading above holds alike except one clause.
D+T3 on `dbts_b1` `r5000` at 4× is ×0.924 (s 0.016), and R4, R5 and R0 read the same. The exception is R3's
"≤ ×1.02 in every cell": the lossy cell's `dbts_c1` sideways at 1× is ×1.35 (s 0.164), over the bound with s, where
S3c gave ×1.171 within it. So that clause's pass depends on which run of rounds 4–5 is taken, on the lossy cell
alone. Two more D+L★ reopens on `dbts_b1` read an OQ picture back differently (frames 49 and 47). It is a duplicate,
not new rounds, and decides nothing here.

## Verdict (row HTJ2K-VERDICT, 2026-11-12)

*By a session that wrote none of §Screen resolution, its review, §Improve, or the run. It is judged on HTJ2K-MEASURE's
done result: rows through `9d622d3e` (S3a, S3b, S3c) and readings `ef5adda2`, re-read with `summary.py`. A second run
of S3c's rounds 4–5 (`rows/stage3-s3c-4.jsonl`) was started by a session that resumed the row while it was still
running. It is a duplicate and is outside this verdict.*

**Fixtures and host, with every line below:** three timed DBT volumes (`dbts_a1`, `dbts_b1`, `dbts_c1`), all from one
dataset (EA1141), with slices not independent samples; only `dbts_b1` upright and `dbts_c1` sideways reach level 1; no
breast ultrasound cine; a 4-core cloud host without a GPU, headless Chromium 153 with software WebCodecs; a 4× cgroup
cap standing in for a phone (*assumption*); emulated links. **The host saturates**: D's software AV1 fill makes 13 of
20 (set, link) pairs decode-bound at 4×, which leaves `r5000` as the only link-bound cell. Nothing past it is claimed.

**Every prediction against its cell** (link-bound cells; the rest are readings):

| # | predicted | measured | verdict |
| --- | --- | --- | --- |
| J1 | +0.005–0.1 % bytes | +0.009–0.013 % (`a1`, `c1`); −0.27–0.30 % (`b1`, six decompositions) | holds; I1's ±0.1 % for the sixth decomposition missed (it saves) |
| J2 | +0.1–0.6 % | +0.11–0.14 %; `b1` −0.20–0.24 % | holds |
| J3 | ×0.38–0.55 at 4× | ×0.43–0.48, 10/10 rounds | holds |
| J4 | `b1` ×0.79–0.95, others ×0.85–0.97; refuted over ×1.0 | `r5000` 4×: `b1` ×0.923, `a1` ×0.936, `c1` ×0.915, sideways ×0.908 | holds; the size is not I2's (A1 below) |
| J5 | ×0.93–1.00 at 1×; over ×1.03 | ×0.972–0.980 | holds |
| J6 | ×0.22–0.40; over ×0.50 | ×0.264 (4×), ×0.279 (1×) | holds, and the mechanism with it: the level is 0.27 of the strips' bytes |
| J7 | ×1.00–1.08; over ×1.15 | ×1.001–1.010 | holds, at its floor: the level decoded twice does not show on a link |
| J8 | Q1, Q2 within 10 %; under 1.0 on `a1`/`c1` | `a1` ×4.0–5.6 · ×14; `c1` ×3.5–4.6 · ×11; `b1` ×0.67–0.90 · ×1.23 | not refuted; two bands missed (`a1` every slice above Q2's 3–8; `b1` first under Q1's 1.1) |
| J9 | ×0.40–0.60 of the decode | ×0.566 (`b1`), ×0.433 (`c1` sideways) | holds (stage 2) |
| J10 | 0 asks, 0 decodes | 431/431 (S★, D+L★); 1 053/1 053 in all | holds; 24 reopens read an OQ picture back differently (below) |
| J11 | within ±5 % of clean | ×0.39–4.1; s up to 3.9 | **refuted**; the cell cannot resolve the arms in six rounds |

**R0–R7 as written:** R0, R1, R2, R4 and R6 hold. R3 holds on its one link-bound cell, within its bound only with s
(×0.923 against 0.92 × 1.016). R5 withdraws S★ for the scroll, since only `dbts_b1` meets it. R7 is named above.

**Each change:**

* **I1, the profile (tile-parts at resolutions, TLM, base ≤ 64): survives.** J1 holds. Its byte cost is corrected in
  place in stage 1: the sixth decomposition saves 0.27–0.30 %.
* **I2, three strips: survives, corrected in place.** The decode split holds (J3). On a link, D+T3's measured gain
  is 2.5–3× the frame's whole decode on every volume, with the same bytes. From stage 2's decode times, the strips
  can explain at most about ×0.97 of D on `dbts_b1` at 4×, which would miss R3's ×0.92. The rest is a difference
  between the arms' paths that no row isolates. D's Lossless runs on the product client: one ask, decoded on its one
  decoder and XXH3-checked before the picture. D+T3 runs on the lab page: nine asks on three workers, hashed after the
  clock. XXH3 with SIMD over 17 MB is a few ms (*assumption*), so it is not the rest either. **So R3's pass rests on a
  part that is not the strips.**
* **I3, bands at the fit asked by index: survives inside D+L★** (J6, J7, R4). It is withdrawn with S★ for the scroll.
* **I4, the cache's two record kinds: survives on R6** (no reopen asks or decodes). Two facts outside the rule are
  owed before it is built:
  * In 24 reopens (18 in the D arms, 6 in D+L★), all on `dbts_b1`, the lab store read an OQ picture of frame 47 or
    49 back differently. These are 17 MB pictures, the volume's last. Exact and level pictures always matched.
  * Two visits were refused for storage quota on the same volume.

  The product store keeps only checked frames, so neither reaches it. I4 would add about 215 MB of level pictures
  per `dbts_b1` volume (4.3 MB × 50, *derived*), and how much a phone allows is unmeasured.
* **I5, precincts not proposed for DBT: stands.** Nothing was measured; the zoom reading on precincts was not run.
* **I6, window and zoom: stands as derived.** Nothing was measured.

**The approach against the demo's.** The demo's approach (the OQ AV1 scroll, the whole HTJ2K frame on request)
**stands for the scroll** on all three volumes. HTJ2K at the screen's level (S★) sends the whole exact series where
the fit is level 0, and pictures every slice ×11–14 later at 5 Mbit/s. Only `dbts_b1` (fit level 1) meets R5: first
picture ×0.67–0.90 and every slice ×1.23 at `r5000`, and better than D in the decode-bound cells. That is because this
host decodes AV1 in software, which a phone with a hardware AV1 decoder may not share. **For the Lossless request,
two candidates are on the table:**

* **D+L★**, an exact level picture at ×0.26–0.28 of today's wait on `dbts_b1` at 5 Mbit/s. Its gain is the level's
  byte fraction, a mechanism that holds.
* **D+T3**, the whole frame at ×0.91–0.94. Most of that gain is not yet attributed.

Both need Layout 1, a store-format change.

**Runs still owed, in order, each pre-registered here and run by another session:**

* **A1, attribution (this host, before any phone).**
  * *Arms:* D; **D+T1**, today's whole codestream as one entry through the lab page's path (one worker, hashed after
    the clock); D+T3. Interleaved in a Williams order.
  * *Cells:* `r5000` and `r20000`, 1× and 4×, all three volumes, 6 rounds. D′ is the A/A pair.
  * *Rule:*
    * The strips' effect is D+T3 ÷ D+T1, predicted ×0.96–0.99 at 4× on `dbts_b1`.
    * Layout 1 stays proposed for D+T3 only if that effect is ≤ ×0.95 × (1 + s) at 4× on `dbts_b1` at `r5000`.
      Otherwise D+T3 is withdrawn, and D+L★ alone carries Layout 1.
    * If D+T1 ÷ D ≤ ×0.95, the product's exact path has an overhead the lab page lacks. That is a client-line
      finding (`docs/lines/client.md`), whatever the layout.
* **P1, whether a phone's fill is decode-bound** (the phone session's protocol, `docs/devices.md` §7, tether and
  Wi-Fi). D's every-slice time on `dbts_b1` and `dbts_c1`, read from the overlay over 6 alternations, against
  the bytes ÷ the link's measured rate.
  * *Rule:* a link where D's fill is within 1.10× of its wire time is link-bound on that phone.
  * R3 and R5 are re-judged on those links from P2's rows; this host's decode-bound cells decide nothing about a phone.
* **P2, the Lossless request on a phone** (after A1, only for the arms that survive it). The stage-3 page served by
  the laptop's `dev-server.py`, `dbts_b1` upright, arms D, D+T3, D+L★ alternated, 6 rounds a link. Reported: the
  request to the level picture and to the Lossless picture, from the page's result beacon.
  * *Rule:* R3 and R4 as written, on P1's link-bound links.
* **P3, the store on a phone.** After a D+L★ fill of `dbts_b1`: `navigator.storage.estimate()`, the level and band
  records' bytes, the reopen's time, and every picture read back against its filled copy (the 24 differing reads).
  * *Rule:* I4 is built only if every record reads back equal and fits the reported quota with the series' frames
    beside it. Otherwise its level-picture record is dropped and only the coded bands are kept (*assumption*: they
    are 0.59 MB a frame).

**For the owner:** whether Layout 1 waits for A1, which decides whether D+T3's gain is the strips'. Whether an exact
level picture may be shown before the frame (D+L★), and in what words. Whether P1–P3 join the next phone run.

## Sources

Read 2026-11-09; quotations are verbatim, with the PDF's symbols restored where text extraction lost them (≤).

* **[S1]** Rec. ITU-T T.800 (06/2019) | ISO/IEC 15444-1:2019, *JPEG 2000 image coding system: Core coding system*,
  itu.int, PDF sha256 `9932e967462cd56a193db87117917e74734fb385913bf51d1f52fb0428924e1c`. The 07/2024 edition was not read.
* **[S2]** Rec. ITU-T T.814 (06/2019) | ISO/IEC 15444-15:2019, *High-throughput JPEG 2000*, itu.int, PDF sha256
  `3480bb5f636d9a0bd654ecd31d6c756c0ec5667fe767acfb2b6771de9ddc3542`.
* **[S3]** DICOM PS3.5 2026d, *Data Structures and Encoding*, dicom.nema.org (`current`), §8.2.14, §8.4.1, §10.18,
  A.11, A.12. ISO/IEC 15444-9 (JPIP) is cited through it and was not read.
* **[S4]** OpenJPH tag 0.31.0 (`c68064d0`), github.com/aous72/OpenJPH: `src/apps/ojph_compress/ojph_compress.cpp`,
  `src/core/openjph/ojph_codestream.h`, `src/core/codestream/ojph_codestream_local.cpp`, `docs/status.md`; and, read
  2026-11-11 for §Improve, `src/core/codestream/ojph_tile.cpp` and `src/core/codestream/ojph_params.cpp`.

Repository evidence is cited where it is used: [`decode/README.md`](decode/README.md),
[`adr/resolution-fitting-for-large-frames.md`](adr/resolution-fitting-for-large-frames.md),
[`codecs/htj2k.md`](codecs/htj2k.md), [`FIXTURES.md`](FIXTURES.md), and on branches:
`claude/htj2k-progressive:lab/htj2k-progressive/README.md`, `claude/htj2k-progressive:docs/decode/README.md`
§HTJ2K progressive, `claude/docs-lines:docs/lines/codecs.md`, `claude/docs-lines:docs/lines/optimal-quality.md`.
