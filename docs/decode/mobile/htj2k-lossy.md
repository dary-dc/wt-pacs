# A lossy HTJ2K view, decoded by OpenJPH-WASM, on a phone's browser

*Queue row MOBILE-OPT-HTJ2K-LOSSY, 2026-11-15 (`claude/work-ledger:docs/queue-client-2026-11-14.md`, amendments 20
and 21, the rows appended by MOBILE-DECODE-OPTIONS): the optimal-quality view coded as lossy HTJ2K (DICOM
`1.2.840.10008.1.2.4.203`) and decoded by the client's OpenJPH-WASM build, as [`new-options.md`](new-options.md) §5
argues it; worked out as its advocate, then its disadvantages. Every choice stays the owner's.*

Labels, as [`new-options.md`](new-options.md): **(S)** a source quoted verbatim, listed in §11 with its revision;
**(R)** a result of this repository, by its file; **(M)** measured by this row, rows in
[`lab/av1/htj2k-lossy/rows/`](../../../lab/av1/htj2k-lossy/rows/); **(D)** derived here, the arithmetic written out;
**(T)** theory, not measured.

## 4. Cells, pre-registered (2026-11-15, before any cell ran)

Written by the session that runs them, which the row's brief asks ("pre-registered in the row's file before it is
run (its prediction first)"); the standing rule's stronger form (a protocol by a session that measures nothing) is not
met, so a later session may re-run any cell from this text. **Seen before writing this**: one calibration frame each
of `dbts_a1` (frame 28) and `dbts_b1` (frame 25), RMS error and bytes only, to learn the scale of `-qstep` (it is
relative to 2^b: `-qstep` × 2^b is the base step Δ in source units, RMS error 1.2 at Δ 4 on `dbts_a1`, 4.0 at Δ 16
on `dbts_b1`). No e_N, no σ, no other frame or volume.

**Fixtures.** The 19 DBT volumes of `lab/av1/fetch_data.sh` (EA1141; systems A, B, C five each; `dbt12_ea1141`,
`dbt10_ea1141`, `dbt12_c`, `dbt10_d`), checked by their `framesSha256`; every frame; the stored form (no depth cut,
none being needed: §2). One 4-core cloud host without a GPU.

**Tools.** OpenJPH 0.31.0 (`c68064d0`, the ingest's pin, `ingest/tools.sh`); the quality harness
`claude/av1-noise-ratio:lab/av1/metrics` at `0a9d33ca` (the commit DEPTH8-MEASURE used), loaded, not copied; the
client's committed OpenJPH-WASM and dav1d-WASM builds (`client/decode/wasm/built/`, checked against its manifest);
node 22; the container's headless Chromium.

### Cell B · bytes at equal coding error (the deciding number)

* **Coding**: each frame as a PGM at its stored depth, `ojph_compress -num_decomps 5 -block_size {64,64} -prog_order
  RPCL -reversible false -qstep Δ/2^b` (the exact series' settings, `ingest/coded-frames/ingest.py` `HTJ2K_ARGS`,
  with the irreversible transform), decoded by `ojph_expand`; bytes are the codestreams' sum. The same frames with
  `-reversible true` give the lossless frame's bytes in the same run.
* **Ladder** in source units: Δ ∈ {8, 16, 24, 32, 48, 64} on 12-bit volumes, {2, 4, 6, 8, 12, 16} on 10-bit.
  **Bracketing** (DEPTH8-MEASURE's A3): while the largest Δ tested passes 1.03, add Δ × 1.5; while the smallest fails
  1.00, add Δ ÷ 1.5; three extensions each at most. Arms interleaved: per volume, Δ ascending.
* **Measure**: the harness's `measure` (`cell.py`) frame by frame against the source at depth b: e_N, σ, e in
  window, MS-SSIM, the displayed levels moved under each header window.
* **The AV1 view**, from committed rows at the same harness commit (not re-coded): the shards and pilot of
  `lab/av1/metrics/rows/` (the view's form `top10` for 12-bit, `10bit` for 10-bit; G 8; Q 1–56); for the five
  volumes no shard holds (`dbts_a3`, `a4`, `a5`, `b4`, `dbt10_d`), DEPTH8-MEASURE's Stage C rows
  (`claude/depth8:lab/av1/depth8/rows/stage-c.jsonl`, G 1 only), so labelled.
* **Read as**: (i) at the noise rule's bar, the largest Δ whose worst frame keeps e_N ÷ σ ≤ 1.00 (and ≤ 1.03), its
  bytes ÷ the AV1 view's at its own highest passing Q at the same bar; (ii) at the AV1 view's Q 8 G 8 error, the Δ
  whose median frame's in-window e equals it, interpolated in log Δ between the two tested Δs around it (D), its
  bytes ÷ the view's; (iii) both ÷ the lossless frame's bytes.

**Predictions** (T, the session's prior; a prior with no source, written to be missed or hit):

* **P1** e_N ÷ σ (worst frame) rises with Δ on every volume and crosses 1.03 inside the ladder and its extensions. If
  it plateaus under 1.03 (a coding that deletes the finest band reads e_N ≈ σ, `which-quality-is-visually-lossless.md`
  §What the measurements show), the bar does not bind and (ii) decides; reported so.
* **P2** The 1.00 bar is crossed at Δ 12–24 on the 10-bit volumes and Δ 32–64 on the 12-bit ones.
* **P3** At the 1.00 bar, HTJ2K-lossy bytes ÷ the AV1 view's bytes lie in 0.7–2.0 on every volume, median 1.2.
* **P4** At Q 8 G 8's in-window e, the same ratio lies in 0.8–2.0, median 1.3.
* **P5** At the 1.00 bar, HTJ2K-lossy bytes ÷ the lossless frame's lie in 0.10–0.35.

### Cell D · decode in the cloud, as ratios on one host

* `dbts_a1`, `dbts_b1`, `dbts_c1`; the middle 16 frames (two groups of 8). Three arms: the **lossless** frame, the
  **lossy** frame at the volume's 1.00-bar Δ (Cell B), and the **AV1 view** at Q 8 G 8 coded by the harness's
  `aomenc` arguments for the view's form. HTJ2K through the client's `client/decode/htj2k.js` and its pinned
  OpenJPH-WASM; AV1 through `client/decode/av1-dav1d.js` and its pinned dav1d-WASM, one thread. Node 22 (V8), the
  coded bytes held in memory, each frame timed alone (performance.now around the decode call; a group's frames in
  order).
* Ten rounds after one discarded warm-up; each round runs the three arms in a rotated order (L-Y-A, Y-A-L, A-L-Y).
  Reported: the median ms a frame per arm, and the ratios lossy ÷ lossless and lossy ÷ AV1 per volume. No time is
  claimed for a phone; WebCodecs (the product's first AV1 route) is absent in node, so the AV1 arm is the fallback's.
* **P6** lossy ÷ lossless in 0.45–0.80 (T: the block decoder is 55–70 % of a lossless frame and follows the coded
  bits, the 9/7 synthesis in f32 costs about the 5/3's; the white paper's 91 ÷ 117 = 0.78 at a quarter of the rate is
  the upper end).
* **P7** lossy ÷ AV1 (dav1d-WASM) in 0.25–0.70.

### Cell E · the same samples on every engine

* `dbts_a1` and `dbts_b1`, the middle 8 frames each, lossy at their 1.00-bar Δ. Decoded by the pinned OpenJPH-WASM
  in node (V8) and in headless Chromium (V8, through the page's worker path), and by native `ojph_expand` (x86-64,
  OpenJPH's own SIMD); SHA-256 of the samples compared frame by frame. Firefox and Safari are not on this host.
* **P8** WASM in node and in Chromium give the same samples on every frame (D from the WebAssembly specification, §3).
* **P9** native `ojph_expand` differs from the WASM build on at least one sample of at least one frame (T: OpenJPH's
  own tests accept an irreversible decode within 1 % of the reference MSE and ±1 of its peak error, §3).
