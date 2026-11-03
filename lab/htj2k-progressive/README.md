# htj2k-progressive

The pre-registered protocol of [`docs/decode/README.md`](../../docs/decode/README.md) §HTJ2K progressive protocol,
pre-registered, run by a separate session; the reading and the rule's verdict are in the same file, §HTJ2K progressive,
measured. Only the ladder was built: the lab writer for one set, two layers and for two sets was not, so those shapes
are answered by the protocol's §3 derivation and marked so there.

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
NODE_PATH=$(npm root -g) node lab/htj2k-progressive/decode/run.mjs --rounds 6 --out $W/decode.json   # stage 2
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
