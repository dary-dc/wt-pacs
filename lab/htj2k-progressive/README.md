# htj2k-progressive

The pre-registered protocol of [`docs/decode/README.md`](../../docs/decode/README.md) §HTJ2K progressive protocol,
pre-registered, run by a separate session; the reading and the rule's verdict are in the same file, §HTJ2K progressive,
measured. Only the ladder was built: the lab writer for one set, two layers and for two sets was not, so those shapes
are answered by the protocol's §3 derivation and marked so there. A later session built both quality shapes
(§Quality layers, built, below); nothing of them is timed.

```bash
lab/av1/tools/tools.sh aom dav1d && lab/av1/delivery/scalable/encoder/build.sh && lab/av1/delivery/scalable/two-layer/build_wasm.sh
VARIANTS=simd client/decode/wasm/dav1d/build.sh && client/decode/wasm/fetch_openjph.sh && client/transport/ts/build.sh
client/decode/wasm/build/build.sh                    # the delivered build, checked against its manifest
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160   # OpenJPH 0.31.0's source and ojph_compress
# OpenJPEG 2.5.4, native: lab/av1/bytes/embedded/build.sh's first half (tag v2.5.4, commit 6c4a29b0)
lab/htj2k-progressive/wasm/build.sh                  # the lab decoder
lab/av1/.venv/bin/pip install scikit-image==0.25.2 pillow
lab/av1/fetch_data.sh dbts_a1 … dbts_c5 dbt12_ea1141 dbt10_ea1141 dbt12_c dbt10_d rf_fluoro mr_ispy1 mr9_ispy2 usb_cine usb_cine_rgb us_liver
W=lab/.av1-work/hp
for i in $(seq 0 86); do lab/av1/.venv/bin/python lab/scripts/gen_frame_pnm.py $(printf $W/sets/cine512/%03d.ppm $i) 512 512 3 255 $i 87 cine; done
lab/htj2k-progressive/stage1.sh $W/ladder lab/av1/data/<set> …  $W/sets/cine512        # stage 1, every frame
lab/av1/.venv/bin/python lab/htj2k-progressive/summary1.py $W/ladder <set> …
NODE_PATH=$(npm root -g) node lab/htj2k-progressive/decode/run.mjs --rounds 4 --out $W/decode.json   # stage 2
node lab/htj2k-progressive/decode/summary.mjs $W/decode.json
# stage 3: the AV1 scalable preview's frames as lab/av1/delivery/scalable/tool/README.md makes them, into lab/.av1-work/preview-e2e
lab/av1/.venv/bin/python lab/htj2k-progressive/delivery/make_frames.py $W/ladder $W/rig <set> … --svc lab/.av1-work/preview-e2e
NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --frames lab/.av1-work/hp/rig --sets dbts_a1,dbts_b1,dbts_c1 \
  --links plain,r5000,r20000,r50000 --throttles 1,4 --per-frame --rounds 1 --first-round $r --out $W/rig-dbt.jsonl
lab/av1/.venv/bin/python lab/htj2k-progressive/summary3.py $W/rig-dbt.jsonl $W/rig $W/ladder
```

## Stage 0, the tools

**The ladder's codestreams** are the ingest's: `ladder.py --phase encode` codes every frame with
`ingest/coded-frames/ingest.py`'s `coded()` (OpenJPH 0.31.0 from `ingest/tools.sh`, checked back by the ingest) and again
with `lab/av1/decode/per-frame`'s writer from the other OpenJPH 0.31.0 build (`lab/.openjph-build`), and stops unless the
two sha256 are equal on every frame.

**The witness** ([`witness.py`](witness.py)) is T.800's reversible 5/3 and colour transform written from the standard: a
level-r picture is the LL band after r levels (*reduced*, (r, r)) or that band synthesised back to full size with
every finer subband zero (*full*, (r, 0)), clamped to the samples' range. OpenJPEG 2.5.4 is the second witness, on the
prefix itself: `-r r -allow-partial` for (r, r), `-allow-partial` alone for (r, 0).

**The lab decoder** ([`wasm/`](wasm/)) is the client's wrapper with one method added by [`levels.patch`](wasm/levels.patch),
`decodeLevel(skipRead, skipRecon)` over OpenJPH's `restrict_input_resolution`, built as `lab/decode-bench/wasm/build.sh`
builds it at the delivered build's 4 MB heap. The delivered build itself is `client/decode/wasm/build/build.sh`'s; its
container image could not be pulled here (Docker Hub 429), so `inside.sh` ran on the host from the same checked cache, and
its outputs matched `manifest.sha256` byte for byte.

**Checked** ([`cut.mjs`](cut.mjs), every frame, every level 1–5): the whole frame against the source digest and against
the delivered build (bytes, range, frame info); the smallest prefix whose (r, r) decode equals the whole codestream's
(binary search, sound only where a longer prefix never loses the level, so the boundary is checked after); that prefix's
(r, r) and (r, 0) against the witness; the prefix one byte short against both, which must fail; then OpenJPEG on every
prefix (`ladder.py --phase check`). `lab/decode-bench/parity.mjs` on the fixtures `g512 c512 g8 s512 s12 sat256 cine512`
(8 frames each): the lab decoder and the delivered build each `PARITY OK` against the package.

**Mutated:** `cut.mjs --mutate short` (every cut one byte short) fails every level of every frame, `--mutate truth`
every check; `MUTATE=short ladder.py --phase check` makes OpenJPEG differ on every prefix; `decode/run.mjs --mutate`
turns every stage-2 picture to not exact. Two bugs of the lab decoder were caught by these checks before any number was
kept (README §Two bugs, below).

**Two bugs, caught.** OpenJPH 0.31.0's `codestream::restart()` clears `skipped_res_for_read = skipped_res_for_recon = 0;`
but not the SIZ's `skipped_resolutions`, which `restrict_input_resolution` sets (`siz.set_skipped_resolutions(skipped_res_for_recon);`)
and only `param_siz::init()` clears (`skipped_resolutions = 0;`), so a reused decoder's next `readHeader` read the last
reduced size back: stage 2's whole frames decoded 6/16 exact after a level until `decodeLevel` reset the skip after
its decode, and 17/87 `cine512` frames failed `cut.mjs`'s whole-frame check until the reset also ran when a prefix
throws. Source: OpenJPH `src/core/codestream/ojph_codestream_local.cpp` and `ojph_params_local.h` at tag 0.31.0
(`c68064d0`). A product binding of `restrict_input_resolution` would need the same reset.

## Stage 1

[`ladder.py`](ladder.py) `--phase metrics` and [`quality.py`](quality.py), every frame of every set, levels 1–5:

* **Bytes:** the smallest exact prefix (cut.mjs), its share of the frame and of the series.
* **Quality** of the (r, 0) picture against the source at its depth b (peak 2^b − 1): PSNR over the series from the summed
  squared error and the worst frame; max |Δ|; SSIM, scikit-image 0.25.2's `structural_similarity` with
  `gaussian_weights=True, sigma=1.5, use_sample_covariance=False, data_range=2^b − 1`, as `lab/av1/profiles` sets it
  (`1354e428`), the mean and the worst frame; PSNR and SSIM over **in-window samples** — those whose code under the
  series' first window is strictly between 0 and 255, `1354e428`'s definition; the **windowed display error** through
  every window pair of the first frame's header (`ingest/from-dicom/dicom_series.py`'s `frame_display`), each painted as
  `client/paint/voi.js` paints it (`lab/av1/display_tags.py`'s port): the share of in-window codes that differ, that
  differ by > 1, and max |Δcode|; the worst window is reported. A set with no window (the ultrasound and `cine512`) is
  painted as stored.
* **At display scale:** the exact frame and the (r, 0) picture each area-resampled (PIL's box filter) to a 1 000-pixel
  long side, and the (r, r) picture resampled to the same size. A frame whose long side is under 1 000 pixels is not
  enlarged: its display scale is its own size.
* **The proxy:** a picture meets it when, under every window, ≥ 99 % of in-window codes are within ±1 of the exact
  frame's.

## Stage 2

[`decode/run.mjs`](decode/run.mjs): headless Chromium (Playwright's, its version printed per round), the lab decoder in a
module worker, 1× and 4× (`lab/scripts/cpu_throttle.mjs`), the first 16 frames of every set, a fresh browser per throttle
and round, throttles in a Williams order, sets, frames and arms rotating inside it. Arms a frame: `A` and `A2` (A′), the
whole codestream; `p1`–`p5`, a level's prefix alone at (r, r); `f1`–`f5`, at (r, 0); `s10`, `s20`, `s210`, `s543210`,
ladders from scratch, each step its own prefix, ending with the whole frame. Every picture's sha256 against the
witness or the source digest, after the clock.

## Stage 3

`lab/av1/delivery/total-time/run.mjs`, the rig of [`../av1/delivery/total-time`](../av1/delivery/total-time/README.md):
server, store and downloader unchanged, a fresh server, relay and browser a visit, cells in a Williams order each round
and arms inside each cell the same way, `--per-frame`. Arms: `htj2k` (A) and `htj2k-aa` (A′), the delivered build;
`fit` and `l2`, the ladder split at the level fit and at level 2, level-major ([`delivery/make_frames.py`](delivery/make_frames.py)):
entry i frame i's prefix, entry F + i its rest only, decoded by [`delivery/decoder.js`](delivery/decoder.js) — the
prefix by the lab decoder at (r, r) as a preview, the joined codestream by the product's module and the delivered
build; and on the three volumes `predicted-two-quarter-q40`, the scalable preview from `claude/av1-svc-preview` at
`301c5e24`, its tool's `make_frames.py`, `shapes.py` and `decoder.js` taken unchanged from that commit, with its rig changes
(`exactAt`, `--per-frame`) and `client/decode/av1-webcodecs.js`'s `stallMs` (default 2 000 ms, the product unchanged; the
tool's worker sets 10 000). The rig gains `plain` (the relay's 20 ms one way, no rate) and each visit's decode time,
previews and exact frames apart.

## The rule as applied

Written before stage 3 ran. Per volume and cell, for the ladder at its fit level (`dbts_a1`'s fit is level 0, so it has
no split and fails the display-scale clause by construction): every frame exact and every preview its witness's, in
every kept visit; the first picture over the scalable preview's, the median of round-paired ratios, ≤ 1.5; at 5 and
20 Mbit/s, every slice at display scale exact at its level over today's exact series ≤ 0.3; the exact series over
today's ≤ 1.02, at today's bytes (the prefix and its rest are today's codestream). *Beyond the A/A spread* is read two
ways and both are printed: strict (each bound as written) and with the spread (a bound b is missed only past
b × (1 + s), s the cell's p90 of |A′/A − 1|). The ladder is a candidate if at least two of the three volumes pass in
every cell run.

## Quality layers, built

*2026-11-04, a later session. Code in [`layers/`](layers/); every row in [`rows/layers/`](rows/layers/).*

* **Asked:** build the protocol's two quality shapes — one HT set split across two layers, and two HT sets — check
  every decoded prefix with the client's OpenJPH-WASM and the whole stream bit-exact, give the bytes per layer.
* **Answer:** both are built as the protocol names them, and every check passes on the five fixtures below
  (149 frames, 1 192 codings). One set, two layers: layer 1 is 80–99 % of today's bytes and the whole stream ×0.985–1.000.
  Two sets: layer 1 runs from 55–84 % (cleanup at plane 1) to 0.4–1.3 % (plane 7), and the whole stream is
  layer 1 plus 99.7–100.6 % of today's bytes.
* **Rests on:** a lab writer whose one-layer output equals `ojph_compress`'s byte for byte on every frame; the
  client's delivered OpenJPH build, rebuilt here to its `manifest.sha256`, decoding each prefix rewritten as the
  one-layer codestream it accepts; OpenJPEG 2.5.4 decoding each layer-1 prefix's own bytes; the sources quoted below.
* **Fixtures, and the only content any number here is claimed for:** `mr9_ispy2`, `rf_fluoro`, `mr_ispy1`,
  `dbt12_ea1141` (every frame) and `dbts_b1` (every fifth frame), all grey and sound ([`docs/FIXTURES.md`](../../docs/FIXTURES.md)).
* **Left:** no open encoder writes either shape, and no decoder at hand reads the layered bytes themselves: OpenJPH
  refuses two layers, and OpenJPEG 2.5.4 refuses or misreads the second. A browser decoder that parses layers comes
  before any timing; nothing here is timed. Grey only; the RGB sets were not built.

### Terms

* **Resolution scalability:** "the ability to extract reduced resolution representations directly from the
  code-stream" [T22, §1]. The ladder above is this.
* **Quality scalability** (SNR scalability elsewhere; T.800's only use of SNR in this sense is "for SNR progressive
  applications", J.13.2): "the ability to extract reduced quality representations
  directly from the code-stream, while ensuring that the extracted representation has the same high coding efficiency
  as if the content were encoded directly at the corresponding reduced bit-rate" [T22, §1]. T.800 itself names
  neither; its word is *layer*.
* **Layer** (quality layer): "A collection of compressed image data from coding passes of one or more code-blocks of a
  tile-component. Layers have an order for encoding and decoding that must be preserved" [T.800, 3.60]; "Each layer
  successively and monotonically improves the image quality" [T.800, B.8 NOTE 1].
* **Progression order:** the order of packets in the codestream; T.800 B.12: "The order in which these packets are
  found in the codestream is called the progression order." **LRCP** puts every packet of layer 0 first ("for each l
  … for each r … for each i … for each k", B.12.1.1), so a prefix is a quality prefix; **RLCP** and **RPCL** loop
  over resolution first, so a prefix is a resolution prefix. With one tile, one component and one precinct per
  resolution, RLCP and RPCL are the same order (*derived*).
* **Code-block, coding pass, bit-plane:** each sub-band is cut into 64×64 code-blocks, each coded on its own; a coding
  pass codes some bits of a block's coefficients; bit-plane p is the bit of value 2^p of every magnitude.
* **HT set:** HTJ2K's block coder writes "groups of coding passes, called HT sets, each of which consists of three
  coding passes": "The first coding pass is an HT cleanup coding pass; • If present, the second coding pass is an HT
  SigProp coding pass; • If present, the third coding pass is an MagRef coding pass" [T.814, B.1]. A cleanup at
  plane p codes every magnitude's bits at and above p; SigProp and MagRef then add plane p − 1 (SigProp for samples
  becoming significant, i.e. nonzero, next to significant ones; MagRef for samples already significant).
* **Placeholder passes:** "3 ∙ P0 coding passes, called placeholder passes, for which no codeword segment bytes appear
  in the codestream" [T.814, B.1].
* **Prefix:** the first bytes of a codestream; here the main header, layer 1's tile-part, and an end-of-codestream
  marker.

### Encoders, and what Part 15 allows

**No open encoder found writes HTJ2K with more than one layer.**

| encoder (version read) | HT code-blocks | more than one layer with HT | source, verbatim |
| --- | --- | --- | --- |
| OpenJPH 0.31.0 (the product's) and 0.33.0 | yes | no | `docs/status.md`: "There is currently no implementation for rate-control-based encoding."; `ojph_block_encoder.cpp`: `assert(num_passes == 1);`; `ojph_params_local.h`: `num_layers(1)`, which nothing in the encoder's API sets |
| Grok v20.4.25 (`46ab34de`) | yes | no | `doc/man/md/man1/grk_compress.1.md`, under `-r` and `-q`: "Note: not supported for Part 15 (HTJ2K) compression"; `CodeStreamCompress.cpp`: `grklog.warn("Rate control not supported for HTJ2K compression.");` then `parameters->numlayers = 1;` |
| OpenJPEG 2.5.4 (`6c4a29b0`) | decode only | — | `NEWS.md`, 2.5.0: "Decoder: add support for high throughput \(HTJ2K\) decoding."; `src/lib/openjp2` holds `ht_dec.c` and no HT encoder |
| FFmpeg n8.1.3 | no | — | `libavcodec/j2kenc.c`: `bytestream_put_byte(&s->buf, 0); // cblk style` |

Kakadu is not open and was not read; whether it writes HT layers is *unverified*. Grok's decoder parses
HT placeholder passes across layers by its source; it could not be built here, so it is no witness (*unverified*).

**What T.814 allows** [T.814, Annex B unless noted]:

* **The first packet carries one cleanup.** "The packet … that contains the first HT cleanup coding pass for a
  code-block shall include only one HT cleanup coding pass. NOTE 1 – This packet can contain at most two additional
  coding passes: HT SigProp coding pass and HT MagRef coding pass" (B.3). So one set splits at most once: cleanup in
  one layer, SigProp and MagRef in a later one.
* **Segments and layers.** Passes group into HT segments ending at the indices "T = ⋃(3P0 + T_k), where T_k = ⌈3k/2⌉"
  (B.2) — each cleanup its own segment, each SigProp and MagRef pair one — and "Each codeword segment for a given
  code-block in a packet terminates with either: • a coding pass … with an index in set T … or • the last coding pass
  of the code-block included in the packet" (B.3). A later layer's packet therefore spends one length field a segment.
* **Several sets.** "S_blk = P + P0 + S_skip where P is the number of zero-bit-planes recovered from the packet that
  contains the first contribution for the code-block, and S_skip is the number of HT sets preceding the given HT set";
  "HT sets that contain only zero-length HT segments can be used to skip bit-planes between non-empty HT sets" (B.3
  NOTE 2). Each later set is a full re-coding: "The use of multiple non-empty HT sets in a code-block results in
  redundancy" and "a decoder is not required to decode more than one HT set" (8.3); a codestream that may hold them
  sets Ccap15 bit 13: "If bit 13 of Ccap15 is 1, then the codestream may belong to the MULTIHT set" (A.3.3).
* **Mixed blocks** (Part 1's block coder, with its many truncation points, beside HT blocks) are allowed when SPcod's
  bits 6 and 7 are both 1: "zero or more of the code-blocks within the corresponding tile-component shall be HT
  code-blocks" (A.4). OpenJPEG rejects it (`j2k.c`: "Unsupported Mixed HT code-block style found"), OpenJPH too; not
  built.
* **What the standard says of it:** "substantial elimination of quality scalability" (Introduction); "the HT
  block-coder does not provide an effective mechanism for progressive coding" (8.6 NOTE 2); "quality scalability is
  the only JPEG 2000 feature that is sacrificed by HTJ2K, but it is readily retrievable by reversibly transcoding some
  or all code-blocks back to the highly embedded J2K1 representation" [T22, §2.1].

### What was built

[`layers/shapes.py`](layers/shapes.py) codes a frame as the served profile does — reversible 5/3, five levels, 64×64
HT blocks, one precinct a resolution, the main header taken from `ojph_compress`'s — with the 5/3 written from T.800
Annex F, packets and tag trees from B.10, and each block's HT set by [`layers/htblock.cpp`](layers/htblock.cpp):
OpenJPH 0.31.0's own cleanup encoder at plane p, and SigProp and MagRef encoders written as the exact inverse of
OpenJPH's decoder (`ojph_block_decoder32.cpp`). Each layer is its own tile-part, in LRCP.

* **`today`**, one layer, RPCL: must equal `ojph_compress`'s codestream byte for byte, every frame (run.py stops
  otherwise). It does — after reproducing one OpenJPH habit: its tag-tree parents read one child past an odd row's end,
  into the next row (`tag_tree::get`, `ojph_precinct.cpp`), so a parent can be coded below its children's minimum.
  Decodable; on `dbts_b1` frame 30 it cost 29 bytes.
* **`oneset`, one set split over two layers**: layer 1 each block's cleanup at plane 1, layer 2 its SigProp and MagRef
  at plane 0. SigProp reaches only samples next to a significant one, so a block with a plane-0 sample it cannot reach
  cannot end exact this way; such a block is coded whole (its cleanup at plane 0) in layer 1. *Blocks split* in the
  table is the share that could be.
* **`twosetsP`, two sets**: layer 1 each block's cleanup at plane P (P = 1 … 7); layer 2, after P − 1 empty sets (two
  zero-length segments each), its lossless cleanup at plane 0 — today's block bytes. A block with nothing at or above
  plane P is first included in layer 2. Ccap15 bit 13 is set.

### Checks, each mutated

[`layers/run.py`](layers/run.py) writes, for every frame and shape, the layered codestream, its layer-1 prefix rewritten
as one layer, and the whole rewritten as one layer; [`layers/check.mjs`](layers/check.mjs) decodes them with the client's
delivered OpenJPH build (`client/decode/wasm/built`, rebuilt here by `inside.sh` on the host from the pinned cache:
`manifest.sha256` matched byte for byte).

* **The rewrite** ([`shapes.py`](layers/shapes.py) `single`) parses the layered bytes alone — packet headers, tag
  trees, segment lengths, never the writer's state — and keeps, per block, the last HT set present behind
  3 × S_skip placeholder passes: what B.3 and 8.3 say a decoder reconstructs, in the one-layer form OpenJPH reads.
* **Every layer-1 picture** must equal the picture computed from the coefficients (OpenJPH's bin centre: a nonzero
  magnitude cut at plane q gains 2^(q−1)), and **every whole frame** the source's sha256. The layered codestream itself
  must be refused, as it is: "The current implementation supports 1 quality layer only.  This codestream has 2 quality
  layers" (`ojph_codestream_local.cpp`).
* **OpenJPEG 2.5.4** decodes each layered layer-1 prefix itself, an independent read of layer 1's packet headers and
  blocks, and the whole layered stream.
* **Mutants, every one caught:** the middle byte of layer 2's tile-part flipped (the whole must not be exact); the
  layer-1 prefix three bytes short (must not equal layer 1); two sets with S_skip ignored (must not be exact);
  `check.mjs --mutate truth` (every digest check must fail). An early `0x5A` flip missed once, on an empty packet's
  header byte, where only the first bit counts; the mask is `0xA5`. Two real bugs were caught before any number was
  kept: the MagRef writer did not start with OpenJPH's reader's unstuffing armed (`mrp->unstuff = true`), and a
  decoder left unusable by a thrown decode ("null function or function signature mismatch") failed every later file
  until `check.mjs` reloaded it.

| set | frames | codings | decoded as expected (fail) | mutants caught (missed) | `--mutate truth`: digest checks failing |
| --- | --: | --: | --- | --- | --- |
| `mr9_ispy2` | 34 | 272 | 816 (0) | 782 (0) | 544 of 544 |
| `rf_fluoro` | 18 | 144 | 432 (0) | 414 (0) | 288 of 288 |
| `mr_ispy1` | 58 | 464 | 1 392 (0) | 1 334 (0) | 928 of 928 |
| `dbt12_ea1141` | 29 | 232 | 696 (0) | 667 (0) | 464 of 464 |
| `dbts_b1` | 10 | 80 | 240 (0) | 230 (0) | 160 of 160 |

A coding is one frame in one of the eight layered shapes; each gives three decodes (the layered stream refused, layer 1,
the whole) and two or three mutants. Raw: [`rows/layers/check.jsonl`](rows/layers/check.jsonl).

### Bytes per layer

`layers/summary.py`, every frame of each set but `dbts_b1` (every fifth); *today* is the served codestream. PSNR is
against 2^b − 1, b the stored bits (`mr_ispy1` stores 16 bits for 0–1765, so its dB read high); the max error is in
sample values.

| set | shape | frames | layer 1 ÷ today, % (series; frames) | layer 2 ÷ today, % | whole ÷ today | blocks split, % | layer 1 PSNR, dB (series; worst) | layer 1 max abs error | OpenJPEG: layer 1 · whole |
| --- | --- | --: | --- | --- | --- | --- | --- | --: | --- |
| `mr9_ispy2` | oneset | 34 | 99.0; 96.3–99.8 | 0.2–3.5 | ×1.000 | 11 | 73.1; 71.6 | 5 | 34/34 equal · 6 wrong, 28 refused |
| `mr9_ispy2` | twosets1 | 34 | 55.3; 46.3–59.1 | 99.7–99.8 | ×1.550 | 100 | 68.8; 68.2 | 8 | 34/34 equal · 34 refused |
| `mr9_ispy2` | twosets2 | 34 | 21.7; 12.0–26.4 | 100.1–100.2 | ×1.219 | 99 | 65.0; 64.4 | 13 | 34/34 equal · 34 refused |
| `mr9_ispy2` | twosets3 | 34 | 8.4; 3.7–11.5 | 100.2–100.4 | ×1.088 | 80 | 61.4; 60.4 | 25 | 34/34 equal · 34 refused |
| `mr9_ispy2` | twosets4 | 34 | 3.5; 1.7–5.0 | 100.2–100.6 | ×1.039 | 69 | 56.5; 55.4 | 49 | 34/34 equal · 34 wrong |
| `mr9_ispy2` | twosets5 | 34 | 1.5; 0.9–2.1 | 99.9–100.6 | ×1.018 | 45 | 50.5; 50.2 | 90 | 34/34 equal · 34 wrong |
| `mr9_ispy2` | twosets6 | 34 | 0.8; 0.6–1.0 | 99.7–100.4 | ×1.008 | 16 | 44.4; 43.2 | 178 | 34/34 equal · 34 wrong |
| `mr9_ispy2` | twosets7 | 34 | 0.5; 0.5–0.6 | 99.7–100.0 | ×1.003 | 3 | 37.9; 36.7 | 272 | 34/34 equal · 34 wrong |
| `rf_fluoro` | oneset | 18 | 83.7; 82.9–86.5 | 12.5–15.8 | ×0.988 | 99 | 68.1; 67.8 | 10 | 18/18 equal · 18 refused |
| `rf_fluoro` | twosets1 | 18 | 83.6; 82.9–84.9 | 100.0 | ×1.836 | 100 | 68.0; 67.8 | 10 | 18/18 equal · 18 refused |
| `rf_fluoro` | twosets2 | 18 | 66.6; 65.0–69.5 | 100.1 | ×1.667 | 100 | 64.5; 64.3 | 17 | 18/18 equal · 1 wrong, 17 refused |
| `rf_fluoro` | twosets3 | 18 | 48.7; 46.2–53.8 | 100.2 | ×1.489 | 100 | 58.7; 58.6 | 26 | 18/18 equal · 9 wrong, 9 refused |
| `rf_fluoro` | twosets4 | 18 | 30.2; 27.6–37.4 | 100.3 | ×1.305 | 100 | 52.4; 52.3 | 57 | 18/18 equal · 18 wrong |
| `rf_fluoro` | twosets5 | 18 | 14.0; 12.1–20.5 | 100.4 | ×1.144 | 99 | 46.8; 46.5 | 104 | 18/18 equal · 18 wrong |
| `rf_fluoro` | twosets6 | 18 | 4.1; 3.2–7.1 | 100.4–100.5 | ×1.046 | 92 | 42.2; 41.4 | 201 | 18/18 equal · 18 wrong |
| `rf_fluoro` | twosets7 | 18 | 1.3; 1.2–1.5 | 100.3–100.5 | ×1.017 | 64 | 38.7; 37.9 | 366 | 18/18 equal · 18 wrong |
| `mr_ispy1` | oneset | 58 | 88.2; 86.7–89.7 | 9.6–12.3 | ×0.991 | 61 | 93.3; 92.9 | 8 | 58/58 equal · 58 refused |
| `mr_ispy1` | twosets1 | 58 | 78.9; 78.2–79.6 | 99.9 | ×1.789 | 100 | 92.4; 92.2 | 9 | 58/58 equal · 58 refused |
| `mr_ispy1` | twosets2 | 58 | 56.9; 55.3–58.2 | 100.1 | ×1.569 | 100 | 88.2; 88.0 | 17 | 58/58 equal · 3 wrong, 55 refused |
| `mr_ispy1` | twosets3 | 58 | 34.6; 32.4–36.6 | 100.2 | ×1.348 | 100 | 82.2; 81.9 | 30 | 58/58 equal · 18 wrong, 40 refused |
| `mr_ispy1` | twosets4 | 58 | 16.3; 13.9–18.7 | 100.3 | ×1.166 | 100 | 76.6; 76.4 | 59 | 58/58 equal · 58 wrong |
| `mr_ispy1` | twosets5 | 58 | 5.4; 3.4–7.4 | 100.2–100.3 | ×1.056 | 71 | 71.5; 71.3 | 95 | 58/58 equal · 58 wrong |
| `mr_ispy1` | twosets6 | 58 | 1.2; 0.3–2.2 | 100.1–100.3 | ×1.014 | 48 | 65.1; 64.7 | 187 | 58/58 equal · 58 wrong |
| `mr_ispy1` | twosets7 | 58 | 0.4; 0.1–0.8 | 100.0–100.3 | ×1.005 | 26 | 61.9; 61.1 | 378 | 58/58 equal · 58 wrong |
| `dbt12_ea1141` | oneset | 29 | 84.2; 84.0–84.4 | 14.5–14.8 | ×0.989 | 98 | 68.9; 68.6 | 9 | 29/29 equal · 29 refused |
| `dbt12_ea1141` | twosets1 | 29 | 84.2; 84.0–84.3 | 100.0 | ×1.841 | 100 | 68.9; 68.6 | 9 | 29/29 equal · 29 refused |
| `dbt12_ea1141` | twosets2 | 29 | 68.0; 67.6–68.2 | 100.1 | ×1.681 | 100 | 66.7; 66.5 | 12 | 29/29 equal · 4 wrong, 25 refused |
| `dbt12_ea1141` | twosets3 | 29 | 51.1; 50.5–51.4 | 100.2 | ×1.514 | 100 | 61.0; 60.7 | 22 | 29/29 equal · 23 wrong, 6 refused |
| `dbt12_ea1141` | twosets4 | 29 | 32.5; 31.8–32.9 | 100.3–100.4 | ×1.328 | 100 | 54.0; 53.8 | 49 | 29/29 equal · 29 wrong |
| `dbt12_ea1141` | twosets5 | 29 | 14.3; 13.6–14.7 | 100.5 | ×1.147 | 99 | 47.5; 47.4 | 103 | 29/29 equal · 29 wrong |
| `dbt12_ea1141` | twosets6 | 29 | 3.1; 2.8–3.4 | 100.6 | ×1.037 | 97 | 43.1; 42.7 | 189 | 29/29 equal · 29 wrong |
| `dbt12_ea1141` | twosets7 | 29 | 0.7; 0.6–0.9 | 100.2–100.3 | ×1.009 | 41 | 40.0; 39.4 | 354 | 29/29 equal · 29 wrong |
| `dbts_b1` | oneset | 10 | 79.6; 79.5–79.7 | 18.8–19.0 | ×0.985 | 99 | 60.0; 59.9 | 9 | 10/10 equal · 10 refused |
| `dbts_b1` | twosets1 | 10 | 79.5; 79.3–79.6 | 100.0 | ×1.795 | 100 | 60.0; 59.8 | 9 | 10/10 equal · 10 refused |
| `dbts_b1` | twosets2 | 10 | 57.9; 57.5–58.2 | 100.2 | ×1.580 | 100 | 56.4; 56.4 | 15 | 10/10 equal · 10 refused |
| `dbts_b1` | twosets3 | 10 | 34.0; 33.4–34.4 | 100.3 | ×1.342 | 100 | 50.6; 50.5 | 31 | 10/10 equal · 10 wrong |
| `dbts_b1` | twosets4 | 10 | 11.9; 11.5–12.2 | 100.4 | ×1.123 | 100 | 44.5; 44.5 | 58 | 10/10 equal · 10 wrong |
| `dbts_b1` | twosets5 | 10 | 2.0; 1.9–2.1 | 100.4–100.5 | ×1.025 | 81 | 40.6; 40.2 | 108 | 10/10 equal · 10 wrong |
| `dbts_b1` | twosets6 | 10 | 0.8; 0.7–0.8 | 100.2 | ×1.010 | 33 | 37.2; 36.5 | 167 | 10/10 equal · 10 wrong |
| `dbts_b1` | twosets7 | 10 | 0.5; 0.4–0.5 | 100.2 | ×1.007 | 28 | 30.2; 29.6 | 395 | 10/10 equal · 10 wrong |

**Reading.** *One set*: the split costs nothing — the whole is 0–1.5 % *smaller* than today's (that SigProp
and MagRef's near-raw bits undercut a plane-0 cleanup is the likely reason, *unverified*) — but layer 1 still holds 80–99 % of the bytes,
since it is everything but one bit-plane, and on content with isolated small magnitudes (`mr9_ispy2`) few blocks can
split at all. *Two sets*: layer 1 shrinks fast with P, but layer 2 is today's whole codestream again, so the series
costs 1 + layer 1; a layer 1 near 1 % (P = 7) leaves a max error of 272–395 sample values. So far as these fixtures
go, neither shape gives a cheap full-size preview that ends exact at today's bytes: the trade is the protocol's §3 one,
now measured in bytes.

**OpenJPEG 2.5.4 on the layered bytes.** Every layer-1 prefix decoded equal to the expected picture. No whole layered
stream decoded exact: it refused some and returned wrong pictures for the rest, silently. Its packet parser gives an HT
block's first segment one pass whatever the layer (`t2.c`: `l_cblk->segs[l_segno].numnewpasses = l_segno == 0 ? 1 :
(OPJ_UINT32)n;`) and its HT decoder rejects more than three passes ("We do not support more than 3 coding passes in an
HT codeblock"), so neither shape is read by it (*derived* from those lines; not traced further).

### Commands

What a measuring session runs, from a fresh clone (no timing here):

```bash
lab/htj2k-progressive/layers/build.sh                  # the block coder, over OpenJPH 0.31.0
# native OpenJPH 0.31.0 and OpenJPEG 2.5.4, where run.py looks for them
git -c advice.detachedHead=false clone -q --depth 1 --branch v2.5.4 https://github.com/uclouvain/openjpeg.git lab/.openjph-build/openjpeg
cmake -S lab/.openjph-build/src -B lab/.openjph-build/native -DCMAKE_BUILD_TYPE=Release -DOJPH_ENABLE_TIFF_SUPPORT=OFF && make -C lab/.openjph-build/native -j
cmake -S lab/.openjph-build/openjpeg -B lab/.openjph-build/opj -DCMAKE_BUILD_TYPE=Release && make -C lab/.openjph-build/opj -j
# the client's delivered build: build.sh fetches the pinned cache; without Docker, run its inside.sh on the host
client/decode/wasm/build/build.sh || bash client/decode/wasm/build/inside.sh "$PWD/client/decode/wasm/build/.cache" "$PWD/client/decode/wasm/built" "$(id -u):$(id -g)"
(cd client/decode/wasm/built && sha256sum -c --quiet ../build/manifest.sha256)
lab/av1/fetch_data.sh mr9_ispy2 rf_fluoro mr_ispy1 dbt12_ea1141 dbts_b1
W=lab/.av1-work/layers
for s in mr9_ispy2 rf_fluoro mr_ispy1 dbt12_ea1141; do lab/av1/.venv/bin/python lab/htj2k-progressive/layers/run.py $W lab/av1/data/$s; done
lab/av1/.venv/bin/python lab/htj2k-progressive/layers/run.py $W lab/av1/data/dbts_b1 --every 5
for s in mr9_ispy2 rf_fluoro mr_ispy1 dbt12_ea1141 dbts_b1; do
  node lab/htj2k-progressive/layers/check.mjs $W/$s 2>/dev/null                  # pass, fail 0, caught, missed 0
  node lab/htj2k-progressive/layers/check.mjs $W/$s --mutate truth 2>/dev/null   # every digest check fails
done
lab/av1/.venv/bin/python lab/htj2k-progressive/layers/summary.py $W/*/rows.jsonl
```

Before a timing: a browser decoder that reads two layers (OpenJPH patched to parse L layers and keep a block's last HT
set, as the protocol's stage 0 names it), checked against these rewrites file by file; then stage 2's arms, each
shape's layer 1 alone and layer 1 then the whole, 1× and 4×, interleaved as stage 2 interleaves them.

**Sources** (read 2026-11-04): [T.814] Rec. ITU-T T.814 (06/2019) | ISO/IEC 15444-15:2019, itu.int; [T.800] Rec.
ITU-T T.800 (06/2019) | ISO/IEC 15444-1:2019, itu.int (superseded by the 07/2024 edition, not read); [T22] Taubman et
al., *Frontiers in Signal Processing* 2 (2022), doi:10.3389/frsip.2022.885644; OpenJPH tags 0.31.0 (`c68064d0`) and
0.33.0 (`345a8bcd`), github.com/aous72/OpenJPH; Grok tag v20.4.25, github.com/GrokImageCompression/grok; OpenJPEG tag
v2.5.4, github.com/uclouvain/openjpeg; FFmpeg tag n8.1.3, github.com/FFmpeg/FFmpeg.

## Quality layers, measured

*2026-11-04/05, a separate session given the protocol and nothing else. Code in [`layers/`](layers/); every table in
full, and the rows, in [`rows/layers-measured/`](rows/layers-measured/).*

* **What was run:** the pre-registered protocol's four stages for its two quality shapes (one HT set split over two
  layers; two HT sets), through a layered OpenJPH decoder built for it, on every grey set the writer can code.
* **What it shows:** by the rule as written, **one set, two layers is interesting**: on `rf_fluoro` its layer 1 is at
  the proxy at full size, the whole is ×0.988 of today's bytes and the exact series ×0.988–1.037 of today's in every
  kept cell; on `dbts_c1` and `dbt12_c` the same holds in every cell but 50 Mbit/s at 4×. **Two sets are closed**.
* **What it rests on:** every exact frame equal to its source's sha256 (single-decoder: no other decoder reads the
  layered whole); every layer-1 picture equal to the coefficients' and to OpenJPEG 2.5.4's; n = 2–3 rounds a cell of
  the protocol's 12, on one 4-vCPU host.
* **What is left:** the protocol's n; the RGB sets; content this repo lacks (breast ultrasound cine, ABUS); and what
  a layer 1 at 77–99 % of the bytes is worth, which the rule does not ask (below).
* **Fixtures, and the only content any result is claimed for:** the 15 DBT volumes `dbts_a1`…`dbts_c5`; the
  cine-like `dbt12_ea1141`, `dbt10_ea1141`, `dbt12_c`, `dbt10_d`, `rf_fluoro`, `mr_ispy1`, `mr9_ispy2`; and
  `usb_cine`, lossy-sourced and in no verdict. Not built: `usb_cine_rgb`, `us_liver` and `cine512`, which are RGB
  (the writer is grey only); `dbts_*_max` and `ustrus_*` (no pins on this base).

### Terms

* **One set** (`oneset`): §Quality layers, built's shape — layer 1 each code-block's HT cleanup at bit-plane 1,
  layer 2 its SigProp and MagRef passes at plane 0. **Two sets, p** (`twosetsP`): layer 1 a cleanup at plane p,
  layer 2 a second, lossless HT set. **Today** is the served one-layer codestream.
* **Layer 1** is the main header and the first tile-part; **the whole** is both layers, and must decode to the source.
* **The proxy** (the protocol's, not a visually lossless threshold): under every window in the series' header, at
  least 99 % of in-window 8-bit codes within ±1 of the exact frame's; samples as stored where there is no window.
  *At full size* compares pictures as decoded; *at display scale* after area-resampling both to a 1 000-pixel long
  side (§Stage 1). A set is at the proxy when every frame is.
* **A cell** is one link (plain, 5, 20, 50 Mbit/s) at one CPU throttle (1×, 4×); **today exact** the time from the
  fill's issue until every frame of today's arm is exact; **A/A** today's arm against itself under another name.
* **Operating points** of two sets, named before stage 3 as the protocol words them: the smallest p at ≥ 40 dB and
  the largest p at the proxy, both on the series' full-size PSNR and proxy. As written, the first is p = 1 on every
  set (it would be the largest p if "smallest" meant fewest bytes; that reading is not taken here), and the second
  exists only on `dbt12_c`, `dbts_a2`, `dbts_a5`, `dbts_c1`, `dbts_c3`, `dbts_c5` (p = 1) and `rf_fluoro` (p = 2).

### The host, and where it saturates

4 vCPU (KVM, Intel Xeon @ 2.80 GHz), 15 GB, a container; headless Chromium 153.0.8010.12 (Playwright's). The rig as
§Stage 3 sets it. The unshaped `plain` cell `VOID`ed on all 48 volume visits and 110 of 132 cine visits (the relay
late, as [`../../docs/rig-limits.md`](../../docs/rig-limits.md) says an unshaped flight is), so it is dropped and nothing
is claimed above 50 Mbit/s; 19 shaped cine visits `VOID`ed, none on the volumes. **At 50 Mbit/s and 4× the one-set arm
is decode-bound** (its whole decodes ×1.27–1.44 of today's frame, stage 2) while today's arm is still link-bound;
that cell measures the layered decode on three slowed cores, which is the shape's own cost on such a CPU.

### Stage 0, the layered decoder

[`layers/layered.patch`](layers/layered.patch) over OpenJPH 0.31.0 (built by [`layers/decoder.sh`](layers/decoder.sh),
native and as WASM with the client's wrapper and [`wasm/levels.patch`](wasm/levels.patch)): with more than one
layer in COD, each LRCP tile-part's packets are read with tag trees, Lblock and pass counts kept across layers (T.800
B.10), each block's passes are cut into HT segments (T.814 B.2), and the last HT set whose cleanup has bytes is kept,
its missing MSBs raised by the sets before it (B.3, S_skip). A one-layer codestream takes OpenJPH's own path untouched.
The writer is §Quality layers, built's, its one-layer output checked equal to `ojph_compress`'s on every frame.

* `lab/decode-bench/parity.mjs` with `VARIANT=layered` on `g512 c512 g8 s512 s12 sat256 cine512` (8 frames each):
  `PARITY OK` ([`rows/layers-measured/stage0-parity.txt`](rows/layers-measured/stage0-parity.txt)). The delivered build
  was rebuilt by `inside.sh` on the host (no Docker here) and matched `manifest.sha256`.
* [`layers/stage0.mjs`](layers/stage0.mjs) on **every coding of every frame: 1 337 frames × 8 shapes = 10 696
  codings**, all passing: the layered whole through the WASM decoder equals the source's sha256; its layer-1 prefix
  equals the picture computed from the coefficients, which OpenJPEG 2.5.4 also gives from the prefix's own bytes
  (10 696/10 696); the smallest prefix giving layer 1 (binary search) is the whole first tile-part, one byte less
  failing; today's codestream decodes as the delivered build decodes it (picture, range, frame info), every frame.
  OpenJPEG cannot read the layered whole (§Quality layers, built), so **the whole's exactness is single-decoder**.
* **Mutants**, 30 749 of 30 751 caught: a byte in the middle of layer 2 flipped (whole not exact), layer 1 three bytes
  short (not layer 1), S_skip dropped through the native decoder's `OJPH_LAB_MUTATE_SKIP` (two sets' whole not exact —
  S_skip is 0 in layer 1, so it changes the whole, not layer 1 as the protocol's list puts it); `--mutate truth`
  fails every digest check. **Two flips missed**, each a byte OpenJPH does not read: `dbts_a1` frame 37 `twosets6`,
  whose byte flipped in today's own codestream leaves unpatched OpenJPH's decode unchanged too; `dbts_b3` frame 58
  `oneset`, a refinement byte none of whose eight bits changes the decode. Neither is a byte the patch drops.

### Stage 1, bytes and quality per layer

[`layers/stage1.py`](layers/stage1.py), every frame of the 23 sets; quality as §Stage 1 defines it, against the
source at its stored depth; full table per set and shape in [`rows/layers-measured/stage1.md`](rows/layers-measured/stage1.md).

The 15 volumes, 994 frames (ranges over volumes; PSNR over the series):

| shape | layer 1 ÷ today, % | whole ÷ today | layer 1 PSNR, dB · SSIM | in-window codes off by > 1, worst window | volumes at the proxy, full size · display scale |
| --- | --- | --- | --- | --- | --- |
| one set | 77.1–85.4 | ×0.985–0.990 | 57.4–72.2 · 0.9979–1.0000 | 0.08–9.43 % | 5 · 8 of 15 |
| two sets, p = 1 | 73.2–84.9 | ×1.732–1.849 | 57.4–72.2 · 0.9967–1.0000 | 0.09–9.47 % | 5 · 8 of 15 |
| two sets, p = 2 | 45.4–69.6 | ×1.456–1.697 | 53.3–68.2 · 0.9931–0.9999 | 1.41–28.10 % | 0 · 1 of 15 |
| two sets, p = 3 | 23.2–53.7 | ×1.235–1.540 | 47.6–62.6 · 0.9624–0.9997 | 11.51–56.98 % | 0 · 0 of 15 |
| two sets, p = 4 | 6.0–36.5 | ×1.065–1.369 | 42.5–55.9 · 0.8445–0.9982 | 38.93–77.29 % | 0 · 0 of 15 |
| two sets, p = 5 | 1.2–18.7 | ×1.014–1.191 | 37.1–49.2 · 0.6459–0.9917 | 65.32–85.28 % | 0 · 0 of 15 |
| two sets, p = 6 | 0.5–5.4 | ×1.007–1.060 | 31.6–44.7 · 0.5021–0.9792 | 77.04–90.47 % | 0 · 0 of 15 |
| two sets, p = 7 | 0.3–1.2 | ×1.004–1.017 | 25.3–41.5 · 0.4359–0.9667 | 83.73–96.90 % | 0 · 0 of 15 |

One set is at the proxy at full size on `dbts_a2`, `dbts_a5`, `dbts_c1`, `dbts_c3`, `dbts_c5` — all 12-bit — and on
none of the five 10-bit `dbts_b*`. The cine-like sets:

| set | one set: layer 1 % · whole · PSNR · codes off by > 1 · frames at the proxy (full) | two sets at the proxy (full), whole |
| --- | --- | --- |
| `dbt12_ea1141` | 84.2 · ×0.989 · 68.9 dB · 3.55 % · 0/29 | none |
| `dbt10_ea1141` | 79.8 · ×0.986 · 57.1 dB · 9.55 % · 0/24 | none |
| `dbt12_c` | 84.6 · ×0.989 · 71.5 dB · 0.16 % · 68/68 | p = 1 ×1.845 |
| `dbt10_d` | 78.7 · ×0.985 · 56.9 dB · 9.31 % · 0/48 | none |
| `rf_fluoro` | 83.7 · ×0.988 · 68.1 dB · 0.00 % · 18/18 | p = 1 ×1.836, p = 2 ×1.667 |
| `mr_ispy1` | 88.1 · ×0.991 · 93.3 dB · 20.27 % · 0/58 | none |
| `mr9_ispy2` | 98.8 · ×1.000 · 73.1 dB · 42.66 % · 0/34 | none |
| `usb_cine` (lossy-sourced) | 96.0 · ×0.998 · 46.2 dB · 19.81 % · 0/64 | none |

(`mr_ispy1` stores 16 bits for 0–1765, so its dB read high; its window is narrow enough that one sample value moves
a code.) **No two-sets layer reaches the proxy with the whole under ×1.45 of today's bytes on any set.**

### Stage 2, decode

[`layers/decode/run.mjs`](layers/decode/run.mjs): the lab decoder in a module worker, 2 rounds, 1× and 4×, the first
16 frames of the 23 sets; arms today's whole frame (A), A′, each shape's layer 1 alone, and each shape's layer 1 then
its whole from scratch. **38 272/38 272 pictures exact** (`--mutate`: 0/104). Today's frame on the volumes: 11.6–50.5
ms at 1×, 50–269 ms at 4×. × A, the median of round-paired ratios, range over sets
([`rows/layers-measured/stage2-decode.md`](rows/layers-measured/stage2-decode.md)):

| arm | the 15 volumes, 1× | 4× | cine-like and `usb_cine`, 1× | 4× |
| --- | --- | --- | --- | --- |
| A′ | ×0.99–1.02 | ×0.94–1.03 | ×0.98–1.01 | ×0.78–1.73 |
| one set: layer 1 | ×0.98–1.04 | ×0.98–1.09 | ×1.01–1.17 | ×0.71–1.79 |
| one set: the whole | ×1.28–1.49 | ×1.27–1.44 | ×1.00–1.45 | ×0.99–1.50 |
| one set: layer 1, then the whole | ×2.31–2.51 | ×2.28–2.50 | ×2.12–2.50 | ×1.77–2.64 |
| two sets p = 1: layer 1 | ×0.97–1.03 | ×0.98–1.06 | ×1.01–1.20 | ×0.91–1.35 |
| p = 1: the whole | ×1.03–1.06 | ×1.02–1.11 | ×1.00–1.05 | ×0.72–1.74 |
| p = 1: layer 1, then the whole | ×2.02–2.10 | ×1.99–2.17 | ×2.06–2.25 | ×1.70–2.48 |
| p = 4: layer 1 | ×0.70–1.00 | ×0.69–1.05 | ×0.74–1.01 | ×0.56–1.70 |
| p = 7: layer 1 | ×0.34–0.59 | ×0.31–0.58 | ×0.31–0.58 | ×0.27–0.75 |
| p = 7: the whole | ×1.00–1.03 | ×0.94–1.10 | ×0.99–1.03 | ×0.66–1.05 |
| p = 7: layer 1, then the whole | ×1.35–1.60 | ×1.30–1.61 | ×1.29–1.58 | ×1.13–1.85 |

The small frames' 4× ranges (A′ ×0.78–1.73) are the throttle's quantum, not decode. One set's whole costs ×1.3–1.5:
its SigProp and MagRef passes run on top of a cleanup that is itself nearly a whole frame's.

### Stage 3, delivery

The total-time rig as §Stage 3 runs it, entries layer-major ([`layers/delivery/make_frames.py`](layers/delivery/make_frames.py)):
entry i frame i's layer 1, entry F + i its second tile-part and EOC, the two concatenating to the layered codestream;
[`layers/delivery/decoder.js`](layers/delivery/decoder.js) decodes both through the product's own module
(`client/decode/htj2k.js`) over the layered lab build. Arms: today's (`htj2k`, the delivered build), A′, two sets at
the operating points (p = 1 everywhere; p = 2 also on `rf_fluoro`), and **one set, which the protocol's arm list does
not name but its rule needs**: whether one set's exact series is within ×1.10 cannot be read otherwise. The AV1
preview arm belongs to the ladder's clause and was not run. **Rounds: 3 on the volumes, 2 on the cine-like sets** (Williams
order, a fresh server, relay and browser a visit), n = 3 kept a cell on the volumes and 1–2 on the cine-like sets; the protocol's n = 12 was not
reached, and no MDL is computed at this n. 816 visits, **every frame exact and every layer-1 preview its stage-1
digest in every one**.

The five series with a one-set layer 1 at the proxy, or the stage-3 volumes (seconds from the fill's issue, medians of
rounds; ratios the median of round-paired ratios; full tables [`stage3-volumes.md`](rows/layers-measured/stage3-volumes.md),
[`stage3-cine.md`](rows/layers-measured/stage3-cine.md), and with the `VOID`s kept beside them):

| series, link, CPU | n | today exact s | one set: first s · every frame at the proxy, full size s (÷ today exact) · exact ÷ today | two sets p = 1: exact ÷ today | A/A p90 |
| --- | --: | --: | --- | --: | --: |
| `dbts_a1` 5 Mbit 1× | 3 | 110.52 | 2.50 · not at the proxy · ×0.988 | ×1.836 | 0.000 |
| `dbts_a1` 5 Mbit 4× | 3 | 110.59 | 2.65 · not at the proxy · ×0.988 | ×1.836 | 0.002 |
| `dbts_a1` 20 Mbit 1× | 3 | 27.78 | 0.77 · not at the proxy · ×0.988 | ×1.832 | 0.000 |
| `dbts_a1` 20 Mbit 4× | 3 | 27.89 | 0.92 · not at the proxy · ×0.987 | ×1.828 | 0.002 |
| `dbts_a1` 50 Mbit 1× | 3 | 11.27 | 0.47 · not at the proxy · ×0.988 | ×1.821 | 0.002 |
| `dbts_a1` 50 Mbit 4× | 3 | 11.34 | 0.60 · not at the proxy · ×1.106 | ×1.817 | 0.007 |
| `dbts_b1` 5 Mbit 1× | 3 | 175.03 | 3.10 · not at the proxy · ×0.985 | ×1.794 | 0.000 |
| `dbts_b1` 5 Mbit 4× | 3 | 175.25 | 3.45 · not at the proxy · ×0.985 | ×1.794 | 0.001 |
| `dbts_b1` 20 Mbit 1× | 3 | 43.94 | 1.07 · not at the proxy · ×0.985 | ×1.791 | 0.001 |
| `dbts_b1` 20 Mbit 4× | 3 | 44.15 | 1.43 · not at the proxy · ×0.987 | ×1.788 | 0.001 |
| `dbts_b1` 50 Mbit 1× | 3 | 17.76 | 0.66 · not at the proxy · ×0.986 | ×1.783 | 0.003 |
| `dbts_b1` 50 Mbit 4× | 3 | 18.02 | 1.07 · not at the proxy · ×1.162 | ×1.770 | 0.006 |
| `dbts_c1` 5 Mbit 1× | 3 | 115.18 | 1.91 · 97.34 (0.845) · ×0.989 | ×1.841 | 0.000 |
| `dbts_c1` 5 Mbit 4× | 3 | 115.23 | 2.11 · 97.41 (0.846) · ×0.989 | ×1.841 | 0.000 |
| `dbts_c1` 20 Mbit 1× | 3 | 28.93 | 0.72 · 24.49 (0.846) · ×0.989 | ×1.837 | 0.001 |
| `dbts_c1` 20 Mbit 4× | 3 | 28.98 | 0.90 · 24.55 (0.847) · ×0.991 | ×1.836 | 0.000 |
| `dbts_c1` 50 Mbit 1× | 3 | 11.74 | 0.44 · 9.95 (0.849) · ×0.993 | ×1.827 | 0.001 |
| `dbts_c1` 50 Mbit 4× | 3 | 11.80 | 0.62 · 10.10 (0.855) · ×1.152 | ×1.821 | 0.003 |
| `dbt12_c` 5 Mbit 1× | 2 | 105.79 | 1.86 · 89.49 (0.846) · ×0.989 | ×1.844 | 0.000 |
| `dbt12_c` 5 Mbit 4× | 2 | 105.83 | 1.99 · 89.58 (0.846) · ×0.990 | ×1.844 | 0.000 |
| `dbt12_c` 20 Mbit 1× | 2 | 26.59 | 0.70 · 22.51 (0.847) · ×0.990 | ×1.852 | 0.000 |
| `dbt12_c` 20 Mbit 4× | 2 | 26.66 | 0.85 · 22.63 (0.849) · ×0.991 | ×1.838 | 0.002 |
| `dbt12_c` 50 Mbit 1× | 2 | 10.80 | 0.40 · 9.16 (0.848) · ×0.989 | ×1.828 | 0.001 |
| `dbt12_c` 50 Mbit 4× | 2 | 10.87 | 0.61 · 9.27 (0.854) · ×1.123 | ×1.822 | 0.003 |
| `rf_fluoro` 5 Mbit 1× | 2 | 15.18 | 0.90 · 13.01 (0.857) · ×0.988 | ×1.831 | 0.000 |
| `rf_fluoro` 5 Mbit 4× | 2 | 15.21 | 0.97 · 13.05 (0.858) · ×0.989 | ×1.829 | 0.001 |
| `rf_fluoro` 20 Mbit 1× | 2 | 3.93 | 0.37 · 3.32 (0.845) · ×0.990 | ×1.801 | 0.001 |
| `rf_fluoro` 20 Mbit 4× | 2 | 3.95 | 0.48 · 3.35 (0.849) · ×0.990 | ×1.801 | 0.004 |
| `rf_fluoro` 50 Mbit 1× | 2 | 1.72 | 0.33 · 1.48 (0.858) · ×0.991 | ×1.733 | 0.002 |
| `rf_fluoro` 50 Mbit 4× | 2 | 1.78 | 0.44 · 1.53 (0.857) · ×1.037 | ×1.693 | 0.008 |

**The rule, applied** (docs/decode/README.md §HTJ2K progressive protocol, Rule, second clause: "A quality shape is
interesting if one reaches the proxy at full size with the whole ≤ 1.10× today's bytes and exact series time;
otherwise it is closed with its numbers"). The clause names no series and no cells; it is applied per series and per
kept cell, strict and with the A/A spread (a bound b missed only past b × (1 + p90 |A′/A − 1|)), and the two read the
same everywhere here:

* **One set: interesting.** On `rf_fluoro`: every frame's layer 1 at the proxy at full size, the whole ×0.988, the
  exact series ×0.988–1.037 — holds in all 6 kept cells. On `dbts_c1` and `dbt12_c`: proxy and bytes hold (×0.989),
  and the exact series is ×0.989–0.991 in 5 of 6 cells but ×1.152 and ×1.123 at 50 Mbit/s 4×, past the bound with
  the spread (p90 0.003). On `dbts_a2`, `dbts_a5`, `dbts_c3` and `dbts_c5` it is at the proxy too, but stage 3 did not run them; on the other 16 sets its layer 1 is not at the proxy. Read over every cell, as the ladder's
  clause is read, it holds on `rf_fluoro` alone.
* **Two sets: closed.** Wherever a layer 1 reaches the proxy (p ≤ 2) the whole is ×1.45–1.85 of today's bytes, and its exact
  series ×1.56–1.85 of today's in every kept cell.

**Against the predictions** ("one set, two layers closed (layer 1 ≥ 0.8 of the bytes); two sets closed at the proxy,
its 37–45 dB previews within 1.02× of the bytes but not visually lossless"). One set: layer 1 is 77–99 % of the bytes
(≥ 0.8 on 22 of 23 sets) as predicted, but the rule has no clause on layer 1's share, so "closed" is **refuted** by the
rule as written. Two sets closed: **held**. Its previews within ×1.02: p = 6–7 give 25–45 dB on the volumes at ×1.004–1.06
of the bytes, none at the proxy — held in part (p = 7 alone is within ×1.02, at 25–42 dB).

**What the clause does not ask.** One set's layer 1 is 77–99 % of today's bytes, so every frame is at the proxy at
0.845–0.858 of today's exact series, 14–16 % sooner, at the cost of a whole that decodes ×1.3–1.5 (stage 2); it gives
no cheap first picture (×0.75–1.09 of today's first frame, 0.33–2.67 s for today's on those three series). Whether that is worth a decoder that reads
layers, which no open decoder does, is the owner's; a product binding would be structural, so proposed separately.

### Commands

```bash
lab/av1/fetch_data.sh dbts_a1 … dbts_c5 dbt12_ea1141 dbt10_ea1141 dbt12_c dbt10_d rf_fluoro mr_ispy1 mr9_ispy2 usb_cine
lab/htj2k-progressive/layers/build.sh && lab/htj2k-progressive/layers/decoder.sh    # writer's block coder; layered decoder
# native OpenJPH 0.31.0 and OpenJPEG 2.5.4, and the delivered build, as §Quality layers, built's commands
W=lab/.av1-work/q
for s in <set> …; do lab/av1/.venv/bin/python lab/htj2k-progressive/layers/stage1.py $W lab/av1/data/$s; \
  node lab/htj2k-progressive/layers/stage0.mjs $W/$s; done          # --mutate truth: every digest check fails
VARIANT=layered node lab/decode-bench/parity.mjs lab/.av1-work/fx/decode_*   # fixtures: gen_htj2k_fixtures.sh, FRAMES=8
lab/av1/.venv/bin/python lab/htj2k-progressive/layers/summary1.py $W/* --json stage1.json
NODE_PATH=$(npm root -g) node lab/htj2k-progressive/layers/decode/run.mjs --rounds 2 --out decode.json   # stage 2
node lab/htj2k-progressive/layers/decode/summary.mjs decode.json
lab/av1/.venv/bin/python lab/htj2k-progressive/layers/delivery/make_frames.py $W lab/.av1-work/qrig dbts_c1:oneset,twosets1 … rf_fluoro:oneset,twosets1,twosets2
NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --frames lab/.av1-work/qrig --sets dbts_a1,dbts_b1,dbts_c1 \
  --links plain,r5000,r20000,r50000 --throttles 1,4 --per-frame --rounds 1 --first-round $r --out rig-q-dbt.jsonl
lab/av1/.venv/bin/python lab/htj2k-progressive/layers/summary3.py rig-q-dbt.jsonl lab/.av1-work/qrig $W
```

Python packages as §Quality layers, built (scikit-image 0.25.2; Pillow 13.0.0 here).
