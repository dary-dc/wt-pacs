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

* **DBT (cine-like, D ≤ 12): the exact path's delivery, not an alternative.** Scrolling stays the OQ view's (0.07–0.22
  of HTJ2K's bytes, `claude/docs-lines:docs/lines/codecs.md`); the levels lost to it as a preview.
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

Written before anything is run. Shares are of the frame's bytes under W; ratios are × W's, the median of
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
| P12 | `dbts_b1`, the exact ask at the fit under **L**, against the OQ view's first picture (Q 8, 0.22 of the bytes, WebCodecs at 10 bits) | ×0.8–1.6 of OQ's: the exact fit picture arrives about as soon | outside 0.6–2.0 | §7; OQ bytes |
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
