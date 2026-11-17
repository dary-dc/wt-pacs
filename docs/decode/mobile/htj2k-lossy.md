# A lossy HTJ2K view, decoded by OpenJPH-WASM, on a phone's browser

*Queue row MOBILE-OPT-HTJ2K-LOSSY, 2026-11-15 (`claude/work-ledger:docs/queue-client-2026-11-14.md`, amendments 20
and 21, the rows appended by MOBILE-DECODE-OPTIONS): the optimal-quality view coded as lossy HTJ2K (DICOM
`1.2.840.10008.1.2.4.203`) and decoded by the client's OpenJPH-WASM build, as [`new-options.md`](new-options.md) §5
argues it; worked out as its advocate, then its disadvantages. Every choice stays the owner's.*

Labels, as [`new-options.md`](new-options.md): **(S)** a source quoted verbatim, listed in §11 with its revision;
**(R)** a result of this repository, by its file; **(M)** measured by this row, rows in
[`lab/av1/htj2k-lossy/rows/`](../../../lab/av1/htj2k-lossy/rows/); **(D)** derived here, the arithmetic written out;
**(T)** theory, not measured. Fixtures and limits: §12. **Nothing was run on a phone.**

## 1. What it shows

* **Bytes: no gain over the AV1 view, and a loss at equal error** (M, Cell B, 19 DBT volumes). Where the worst frame
  reaches the noise rule's strict bar (e_N ÷ σ = 1.00), HTJ2K-lossy takes **0.85–1.47× the AV1 view's bytes, median
  1.05** (interpolated, D); at that point its in-window error is **1.05–1.17× the view's, median 1.13**. At the AV1
  view's own Q 8 G 8 error, HTJ2K-lossy needs **1.28–1.45× its bytes, median 1.36** (17 volumes). Against the exact
  frame it is **0.083–0.160 of the bytes, median 0.134**, at the 1.00 bar.
* **Decode: slower than the lossless frame, faster than dav1d-WASM** (M, Cell D, one cloud host, node 22, one thread,
  two runs). The client's OpenJPH-WASM decodes a lossy frame in **1.12–1.21×** the time of the same frame lossless,
  at 6.3–7.7× fewer bytes: the irreversible path costs more than the block decoder saves. Against the AV1 view
  through the client's dav1d-WASM fallback it takes **0.41–0.50×**. Against WebCodecs AV1 (the product's first route)
  it was not timed on one host; by the earlier cloud ratio it would be 0.64–0.98× (D, from cloud rows of two hosts,
  §5.2).
* **On the phone, by those ratios, ~93–154 ms a `dbts_b1` frame** (T), against the phone's measured AV1 133–135 ms (R):
  no faster, possibly slower. Unmeasured; §10.
* **Checked, but only by one build** (§3, M, Cell E). The same `.wasm` gives the same samples in node and in headless
  Chromium on 48 of 48 lossy frames, as the WebAssembly specification says it must for this code (D from S3); the
  native x86 `ojph_expand` differs from it by ±1 on 190–777 samples a frame on every one of the 48 (its conversion
  rounds ties to even, the WASM one away from zero, S4). So the ingest's digest must come from the shipped WASM build,
  and an OpenJPH bump re-checks or recomputes every view's digest.
* **Its real advantages are elsewhere**: the stored depth with no cut (S1), one decoder and one route for both
  pictures, no WebCodecs or engine differences, every frame intra, and the exact series' resolution levels: a decode
  at the screen's size, which no AV1 route has (§6, T for lossy frames).
* **What it gives up**: every hardware route, and a digest independent of the decoder (§8).

Predictions against outcomes (§4, §5): P1 hit, P2 hit, P3 hit interpolated and missed on the tested ladder alone,
P4 hit, P5 missed on 5 volumes, **P6 missed** (the decode is slower, not 0.45–0.80), P7 hit, P8 hit, P9 hit.

## 2. The route, at its best

*The form is DICOM's own.* PS3.5 (S1, §8.2.14): "Annex A defines three Transfer Syntaxes that reference the HTJ2K
Standard and provide one lossy compression scheme, and two lossless compression schemes"; §10.18: "The HTJ2K Image
Compression Transfer Syntax allows for either lossless or lossy compression to be used at the sender's discretion",
and "All HTJ2K codecs are required by [ ISO/IEC 15444-1 ] to support both reversible and irreversible wavelet and
multi-component transformations." Table 8.2.14-1 gives `1.2.840.10008.1.2.4.203` for MONOCHROME1 and MONOCHROME2 with
Bits Stored "1-38". So a PCS can produce, store and send the view as DICOM, at the stored depth: **no depth cut for
D > 10** (today's AV1 view cuts 12-bit series to 10, `docs/av1/payload-format.md` §Depth cut). The standard also
leaves the operating point to us: "The policies associated with the selection of appropriate compression parameters
(e.g., compression ratio) for HTJ2K lossy compression are also beyond the scope of this Standard" (S1, §8.2.14).

*Its record.* PS3.3 (S2, §C.7.6.1.1.5): "If an image is a compressed version of another image, Lossy Image
Compression (0028,2110) is set to "01", Value 1 of the Attribute Image Type (0008,0008) shall be set to DERIVED, and if
the predecessor was a DICOM image, then the Image shall receive a new SOP Instance UID"; the method's defined term is
"ISO_15444_15 High-Throughput JPEG 2000 Irreversible Compression" (S2, Lossy Image Compression Method (0028,2114)). The
view is then a series of its own beside the exact series, which is today's pairing (`exactSeries`,
`sourceFingerprint`, `docs/av1/payload-format.md` §Optimal quality): nothing in the pairing is AV1's.

*One decoder.* OpenJPH codes and decodes it: its encoder's help reads "-reversible <true | false> If this is 'false',
an irreversible or lossy compression is employed, using the 9/7 wavelet transform" and "-qstep (0.00001...0.5)
quantization step size for lossy compression; quantization steps size for all subbands are derived from this value"
(S4, `src/apps/ojph_compress/ojph_compress.cpp:542–553`); "In reversible compression, quantization is not supported"
(S4, `docs/usage_examples.md:15`). The client's decoder build is the one the exact frame already uses (OpenJPH 0.31.0
in WebAssembly, `client/decode/wasm/built/openjph/`), and it decodes an irreversible codestream unchanged (M, Cell
E: every lossy frame of this row decoded through `client/decode/htj2k.js` as it is). So, against the AV1 view: no
WebCodecs probe, no second decoder in the page, no engine whose AV1 path differs, no decoder lost by a hidden page
(`docs/client/evidence/hidden-page-decode.md`), no group to decode in order (every frame is intra), and the exact
series' resolution levels and stripes (`claude/htj2k-tiles:docs/htj2k-tiles.md`) are the view's too.

*The step.* `-qstep` is relative to the sample range: `-qstep` × 2^b is the base step Δ in source units (M, the
calibration of §4: RMS error 1.2 at Δ 4 and 2.7 at Δ 8 on a `dbts_a1` frame, the scale of a uniform quantizer's
Δ ÷ √12 = 1.15 and 2.31, D). Cell B's rows are named by Δ.

## 3. Checked: the same samples on every engine, but only from one build

The view's check is a digest over the decoded samples, computed at ingest and compared in the client
(`docs/client/evidence/optimal-quality-reconstruction-digest.md`; amendment 1 of the queue file: every frame checked by XXH3). For AV1 that digest holds across decoders because the AV1 specification fixes
the decoded samples. For irreversible HTJ2K nothing fixes them to the bit, and OpenJPH's own tests say so: they accept
an irreversible decode whose MSE is within 1 % of the reference and whose peak error is within 1 (`#define TOL_DOUBLE
0.01`, `#define TOL_INTEGER 1`, and `EXPECT_NEAR(vali, pae[c], TOL_INTEGER)`, S4, `tests/test_executables.cpp:132–133,
225`). So the question is narrower: **does one WebAssembly build give the same samples on every engine?**

*The specification says yes, for this code* (D from S3). "Floating-point arithmetic follows the IEEE 754 standard, with
the following qualifications: All operators use round-to-nearest ties-to-even, except where otherwise specified.
Non-default directed rounding attributes are not supported" (S3, *Numerics › Floating-Point Operations*); the
non-determinism left is NaN payloads ("Some operators are non-deterministic, because they can return one of several
possible results (such as different NaN values)") and the relaxed operators ("The result of relaxed operators are
implementation-dependent, because the set of possible results may depend on properties of the host environment, such
as its hardware", S3, *Relaxed Operations*). OpenJPH's WASM irreversible path at the pin uses neither: dequantisation is
`wasm_f32x4_convert_i32x4` then `wasm_f32x4_mul` (S4, `src/core/codestream/ojph_codestream_wasm.cpp:199–215`), the 9/7
lifting steps `wasm_f32x4_add(d, wasm_f32x4_mul(factor, wasm_f32x4_add(s1, s2)))` (S4,
`src/core/transform/ojph_transform_wasm.cpp:154`), and the conversion back "val + (val >= 0.0f ? 0.5f : -0.5f)" then
`wasm_i32x4_trunc_sat_f32x4` (S4, `src/core/transform/ojph_colour_wasm.cpp:52–62`); no `relaxed` operation appears in its
WASM files (S4, searched). The build is compiled without `-mrelaxed-simd` (R, `docs/decode/README.md` §The
decode tail). A NaN cannot arise from finite coefficients through multiply and add (D), so every operation has one
result, and the same `.wasm` gives the same samples on every conforming engine and CPU.

*Measured* (M, Cell E, §5.3): node 22 and headless Chromium 153 (both V8) agree on every lossy frame; Firefox and
Safari are not on this host, so for them the claim is the specification's alone, and a phone or desktop cell must
measure it (§10).

*But native and WASM differ* (M, Cell E): the native `ojph_expand` on x86-64 and the WASM build disagree by ±1 on a few
hundred samples a frame. The source shows one difference that would do it (T as the cause; not isolated): the x86 conversion sets `_MM_SET_ROUNDING_MODE(_MM_ROUND_NEAREST)`
and uses `_mm_cvtps_epi32` (ties to even, S4, `src/core/transform/ojph_colour_sse2.cpp:122–147`), the WASM one rounds
ties away from zero (above). So the digest is a property of **the decoder build**, not of the codestream:

* the ingest must compute the view's digest with the very WASM build the client ships (run in node or a headless
  engine at ingest), not with the native library it codes with;
* every OpenJPH bump (the CVE fix of 0.33.0 the sibling file names, `htj2k-software.md` §6, is one) needs either a
  proof that the irreversible path's samples did not move, or the views' digests recomputed; a decoder build becomes
  part of the stored view's identity, as no AV1 decoder is;
* a PCS that codes the view with Kakadu or another encoder changes nothing (the codestream is the codestream), but a
  PCS that computes the digest with its own decoder breaks the check.

*The reversible alternative* the brief names (the 5/3 transform with code-block passes cut, so the decode is integer
and any conformant decoder agrees): OpenJPH's encoder does not offer it ("In reversible compression, quantization is
not supported", S4), and its block encoder at the pin codes one pass a code-block (`assert(num_passes == 1);`, S4,
`src/core/coding/ojph_block_encoder.cpp:548`), so a truncation point inside a code-block is not available from OpenJPH
without new encoder code (not built, not measured). Named, not pursued: the WASM build's determinism makes it unnecessary for the check, if the ingest uses that build.

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

## 5. Results (2026-11-15, every cell against its prediction)

Run as §4 wrote them, with no amendment; the one interruption (a restart of Cell B after its first volume, its rows
kept and resumed by the script) changed nothing measured.

### 5.1 Cell B · bytes

Per volume ([`rows/report-b.md`](../../../lab/av1/htj2k-lossy/rows/report-b.md), from `report.py`; every frame of
every volume; AV1 rows at the harness commit, G 8 except the five at G 1). "At 1.00 / 1.03": the largest *tested* Δ
(HTJ2K) or Q (AV1) whose worst frame passes; "interpolated": both codecs' bytes where the worst frame reaches 1.00,
interpolated in log bytes between the tested points around it (D).

| volume | b | σ median | lossless, B a frame | HTJ2K Δ at 1.00 / 1.03 | AV1 Q at 1.00 / 1.03 | ÷ AV1, tested, 1.00 | 1.03 | ÷ AV1, interpolated, 1.00 | ÷ lossless at 1.00 | AV1 Q 8 e | HTJ2K Δ at that e | ÷ AV1 at that e |
| --- | --: | --: | --: | --- | --- | --: | --: | --: | --: | --: | --: | --: |
| `dbts_a1` | 12 | 11.23 | 1,210,936 | 32 / 48 | G 8: 4 / 8 | 0.56 | 0.94 | 0.99 | 0.131 | 15.85 | 38.3 | 1.39 |
| `dbts_b1` | 10 | 5.48 | 2,148,152 | 16 / 24 | G 8: 8 / 12 | 0.61 | 0.70 | 0.94 | 0.132 | 4.34 | 9.3 | 1.27 |
| `dbts_c1` | 12 | 12.92 | 1,024,129 | 32 / 48 | G 8: 4 / 8 | 0.65 | 0.99 | 1.04 | 0.160 | 16.18 | 38.1 | 1.40 |
| `dbt12_ea1141` | 12 | 11.45 | 499,200 | 32 / 48 | G 8: 8 / 8 | 1.75 | 0.96 | 1.05 | 0.158 | 16.00 | 37.3 | 1.39 |
| `dbts_b2` | 10 | 3.38 | 2,024,914 | 12 / 16 | G 8: 8 / 12 | 0.99 | 1.46 | 1.40 | 0.140 | 4.04 | 9.1 | 1.45 |
| `dbts_c4` | 12 | 15.81 | 627,718 | 48 / 64 | G 8: 8 / 8 | 1.00 | 0.64 | 1.21 | 0.115 | 16.93 | 38.1 | 1.36 |
| `dbts_a3` | 12 | 13.46 | 923,546 | 48 / 64 | G 1: 8 / 9 | 0.91 | 0.68 | 0.91 | 0.083 | 16.78 | 38.4 | 1.31 |
| `dbts_a4` | 12 | 14.17 | 1,696,326 | 48 / 64 | G 1: 8 / 11 | 0.90 | 1.13 | 0.85 | 0.085 | 16.93 | 38.2 | 1.30 |
| `dbts_a5` | 12 | 11.79 | 1,030,130 | 32 / 48 | G 1: 7 / 8 | 1.34 | 0.94 | 0.97 | 0.148 | 16.08 | 38.5 | 1.32 |
| `dbts_b4` | 10 | 5.60 | 1,496,662 | 16 / 24 | G 1: 13 / 16 | 1.50 | 1.23 | 1.05 | 0.124 | — | — | — |
| `dbt10_d` | 10 | 3.91 | 877,748 | 16 / 16 | G 1: 12 / 16 | 1.21 | 1.94 | 1.19 | 0.134 | — | — | — |
| `dbt12_c` | 12 | 14.41 | 954,518 | 48 / 48 | G 8: 8 / 8 | 0.96 | 0.96 | 1.10 | 0.098 | 16.46 | 38.1 | 1.34 |
| `dbts_a2` | 12 | 11.95 | 1,122,616 | 32 / 48 | G 8: 4 / 8 | 0.62 | 0.96 | 1.03 | 0.149 | 16.02 | 38.0 | 1.38 |
| `dbts_c2` | 12 | 14.63 | 1,076,768 | 48 / 48 | G 8: 8 / 8 | 0.92 | 0.92 | 1.12 | 0.098 | 16.33 | 37.7 | 1.31 |
| `dbts_c3` | 12 | 14.50 | 1,349,770 | 48 / 48 | G 8: 8 / 8 | 0.94 | 0.94 | 1.15 | 0.098 | 16.58 | 37.7 | 1.34 |
| `dbts_c5` | 12 | 13.10 | 1,126,553 | 32 / 48 | G 8: 8 / 8 | 1.77 | 0.95 | 0.99 | 0.159 | 16.30 | 38.0 | 1.36 |
| `dbt10_ea1141` | 10 | 4.13 | 568,244 | 16 / 24 | G 8: 12 / 16 | 1.34 | 1.29 | 1.27 | 0.152 | 4.17 | 9.2 | 1.39 |
| `dbts_b3` | 10 | 5.59 | 1,892,622 | 16 / 24 | G 8: 12 / 16 | 1.39 | 1.42 | 1.19 | 0.148 | 4.30 | 9.2 | 1.35 |
| `dbts_b5` | 10 | 3.65 | 1,384,550 | 12 / 16 | G 8: 8 / 12 | 1.02 | 1.44 | 1.47 | 0.142 | 4.08 | 9.1 | 1.43 |

Summary (D, over the rows above): interpolated at 1.00, **0.85–1.47, median 1.05** (n 19); tested-only at 1.00,
0.56–1.77, median 0.99, and at 1.03, 0.64–1.94, median 0.96 (n 19: both ladders step ×1.5 in bytes or more near the bar,
so a tested-only ratio mostly reads which rung each codec landed on); at Q 8 G 8's in-window error, **1.28–1.45,
median 1.36** (n 17; `dbts_b4` and `dbt10_d` have no Q 8 row); against the lossless frame at 1.00, **0.083–0.160,
median 0.134**.

**At the bar, the same bytes buy a worse picture** ([`rows/e-at-bar.md`](../../../lab/av1/htj2k-lossy/rows/e-at-bar.md),
`e_at_bar.py`): where each codec's worst frame reaches 1.00, HTJ2K's median in-window error is **1.05–1.17× the AV1
view's, median 1.13** (n 19). The noise rule's bar reads the error in the finest band only; a wavelet coder at large Δ
zeroes that band (e_N → σ) while its error in the coarser bands keeps growing, so the bar ranks the two codecs
alike while their in-window errors differ. The equal-error ratio is the fairer reading of bytes; the noise rule as it
stands would pick a Δ that is visibly coarser than the AV1 view at the same bar (T, not judged by readers).

| prediction (§4) | outcome |
| --- | --- |
| P1 e_N ÷ σ rises with Δ and crosses 1.03 within the ladder | **hit**: every volume, no plateau |
| P2 1.00 crossed at Δ 12–24 (10-bit), Δ 32–64 (12-bit) | **hit**: 12–16 and 32–48 (largest tested Δ passing) |
| P3 at 1.00, 0.7–2.0 of the view's bytes, median 1.2 | **hit** interpolated (0.85–1.47, median 1.05); **missed** tested-only on 4 volumes (0.56–0.65) |
| P4 at Q 8 G 8's e, 0.8–2.0, median 1.3 | **hit**: 1.28–1.45, median 1.36 |
| P5 at 1.00, 0.10–0.35 of the lossless bytes | **missed** on 5 volumes (`dbts_a3`, `a4`, `c2`, `c3`, `dbt12_c`: 0.083–0.098) |

### 5.2 Cell D · decode in the cloud

The middle 16 frames, ten rounds after a warm-up, arms rotated; median ms a frame, interquartile range in brackets;
two runs back to back on the idle host ([`rows/cell-d-*.json`](../../../lab/av1/htj2k-lossy/rows/)).

| volume | Δ | lossless (run 1) | lossy (run 1) | AV1 dav1d-WASM (run 1) | lossy ÷ lossless, runs 1 / 2 | lossy ÷ AV1, runs 1 / 2 | bytes a frame: lossless / lossy / AV1 |
| --- | --: | --: | --: | --: | --: | --: | --- |
| `dbts_a1` | 32 | 16.1 [15.4–20.4] | 18.5 [18.0–21.0] | 44.9 [43.8–50.0] | 1.148 / 1.169 | 0.411 / 0.405 | 1,245,397 / 162,286 / 86,952 |
| `dbts_b1` | 16 | 49.4 [46.1–61.7] | 58.7 [54.8–72.7] | 130.5 [124.7–146.8] | 1.187 / 1.212 | 0.450 / 0.449 | 2,183,073 / 288,349 / 473,588 |
| `dbts_c1` | 32 | 17.7 [16.7–19.1] | 19.8 [19.2–22.1] | 41.9 [39.5–48.9] | 1.115 / 1.159 | 0.472 / 0.496 | 1,053,337 / 166,494 / 92,900 |

* **P6 missed**: lossy ÷ lossless is **1.12–1.21**, not 0.45–0.80. At 6.3–7.7× fewer bytes (D: 1,245,397 ÷ 162,286 =
  7.67; 2,183,073 ÷ 288,349 = 7.57; 1,053,337 ÷ 166,494 = 6.33) the frame decodes slower. Why is not
  profiled here; what the source shows (S4) is that the irreversible path adds a conversion to float per coefficient
  (`wasm_irv_tx_from_cb32`), four lifting steps and a scaling in f32 where the 5/3 has two integer steps, and a
  rounding conversion back (`wasm_irv_convert_to_integer`), all over the full frame whatever the bytes; the white
  paper's 0.78 (S5) was Kakadu on eight threads, not this build (T).
* **P7 hit**: lossy ÷ AV1 (dav1d-WASM) **0.41–0.50**.
* **Against WebCodecs AV1** (D, two hosts' cloud rows, labelled so): the AV1 view decodes in 1.24–1.74 lossless frames
  through WebCodecs (R, `docs/client/evidence/decode-speed-of-the-optimal-quality-picture.md`), so a lossy frame takes
  (1.12–1.21) ÷ (1.74–1.24) = 1.12 ÷ 1.74 = 0.64 to 1.21 ÷ 1.24 = 0.98 of the view's time.
* **The phone** (T): the sibling file predicts the lossless `dbts_b1` frame at 78–127 ms on the phone (`htj2k-software.md`
  §3); × `dbts_b1`'s 1.187–1.212 gives 78 × 1.187 = 93 to 127 × 1.212 = 154 ms a lossy frame, against the phone's
  measured AV1 software decode of 133–135 ms (R, FILL-SPLIT). A prediction carried across hosts and builds; only §10's
  cell decides it.
* The host did not saturate: one decode at a time on one thread of four cores; nothing else ran (`uptime` load 0.09 at
  the start).

### 5.3 Cell E · the same samples on every engine

[`rows/cell-e-*.json`](../../../lab/av1/htj2k-lossy/rows/): the middle 16 lossy frames of `dbts_a1`, `dbts_b1` and
`dbts_c1` (the brief's two and one more), SHA-256 of the decoded samples.

| volume | node 22 = headless Chromium 153 | native `ojph_expand` = WASM | samples that differ a frame (of) | largest difference |
| --- | --- | --- | --- | --: |
| `dbts_a1` | 16 of 16 | 0 of 16 | 493–605 (2,038,470) | 1 |
| `dbts_b1` | 16 of 16 | 0 of 16 | 190–239 (8,519,680) | 1 |
| `dbts_c1` | 16 of 16 | 0 of 16 | 603–777 (2,452,688) | 1 |

* **P8 hit**, with the limit that node and Chromium are both V8; Firefox and Safari are not on this host.
* **P9 hit**: every frame differs, by one level on 0.002–0.03 % of its samples (D: 190 ÷ 8,519,680 = 0.0022 %; 777 ÷
  2,452,688 = 0.032 %). The lossless frames of the same volumes are identical between the two (M, the smoke check of
  `dbt12_ea1141`, 0 of 834,426 samples), so the difference is the irreversible path's.

## 6. The series it makes: depth, levels, stripes, pairing, label

* **Depth.** The stored depth, 12 bits on systems A and C, 10 on B (S1, Bits Stored "1-38"); the view's error is the
  coding's alone, not the coding's plus the 12→10 cut, whose rounding is 2^2 ÷ √12 = 1.15 source units RMS (D, the
  depth cut's formula, `docs/queue-client-2026-11-14.md` amendment 14) against σ 11–16 here: small, so the gain is in
  principle more than in bytes. The paint path is the exact frame's (16-bit samples).
* **Levels and stripes.** The same `-num_decomps 5 -prog_order RPCL` as the exact series, so each view frame holds its
  five resolution levels as prefixes, as the exact frame does (`docs/decode/README.md` §A frame at the level the screen
  needs); a fit at a quarter of the frame decodes from a prefix at ×0.27–0.31 of the decode (R, measured there on
  lossless frames; for lossy ones the share is not measured). The stripes of `claude/htj2k-tiles` apply unchanged.
* **Pairing.** Unchanged: a series of its own with `exactSeries` and `sourceFingerprint`; the view's transfer syntax is
  `.203` where the exact series' is `.202` (S1). What changes is the client's dispatch: an HTJ2K frame is today always
  exact, so the decode path must learn that a `.203` frame is a view frame, checked by the view's digest and labelled
  lossy (T; a seam in `client/decode/decoder.js`'s route, not built).
* **Label.** Today's *not as coded* label holds as it is: the view is lossy, its DICOM record says so (S2,
  `(0028,2110)` "01", `(0028,2114)` "ISO_15444_15"), and *✓ Lossless* still means only the exact frame.
* **The step per series.** The ingest takes Δ per series as it takes Q today; the noise rule's choice by e_N ÷ σ reads
  differently for a wavelet coder (§5.1), so the rule that picks Δ is the codecs line's to set, not this file's.

## 7. Decode: published numbers, then ours

No published decode time for lossy HTJ2K on a phone, natively or in WebAssembly, was found (searched 2026-11-15). What
exists is desktop and laptop:

* The HTJ2K white paper (S5, §7, Table 9, "4-core Intel i7-6700 CPU"): HT decoding at "117", "112" and "91" frames a
  second at 1, 2 and 4 bits a sample (4K 4:4:4 12-bit, irreversible 9/7, Kakadu, eight threads): at a quarter of the
  rate the decode takes 91 ÷ 117 = 0.78 of the time (D): the transform does not shrink with the bytes.
* The Code4Lib study (S6): "HTJ2K decoding is about 2x faster for lossy JPEG2000 and ~20% faster for lossless for both
  OpenJPEG and Kakadu", against JPEG 2000 Part 1, on unstated hardware for that figure.
* The Academy Software Foundation's encoding guidelines (S7): "HTJ2K qstep=0.001 4K | 35 fps | 43 fps" on an "M2 MAX
  Macbook Pro" and an "Intel I9-Windows", through OpenRV with 12 threads; the M2 Max is an ARM laptop, not a phone,
  and its decoder and bit depth are not stated.

None of these is OpenJPH in WebAssembly on one thread, and none is a phone. Our own (M, Cell D, §5.2) is the client's
build on one cloud host.

## 8. What it gives up, and its other costs

* **Every hardware route.** No browser route decodes HTJ2K in a hardware video decoder (none is named in WebCodecs'
  codec registry or in the sibling files' sources, `other-codecs.md`, `av1-hardware-unchecked.md`; T as stated, not
  searched further here); the view is software on every device, as the exact frame is, unless a GPU decoder of our
  own is built (`gpu-compute-decode.md`). A phone whose AV1 hardware could paint unchecked (`av1-hardware-unchecked.md`) gains nothing from this
  form. It is the software option, and competes with AV1 in software (`av1-software.md`).
* **Inter prediction.** Measured small for the AV1 view at Q 8 (G 16 against G 1, ±1.2 % bytes, R,
  `docs/av1/payload-format.md` §Optimal quality), so little is lost by coding every frame alone; Cell B compares
  against G 8 so the loss is in the ratio.
* **The digest tied to a decoder build** (§3): the ingest must run the client's WASM build, and an OpenJPH bump re-checks
  or recomputes every view's digest.
* **A rule to pick Δ** (§5.1): the noise rule's bar does not separate wavelet steps the way it separates AV1 Qs.
* **Two lossy forms to support** if AV1 stays for other modalities (cine): two codings, two rules, one more route.
* **The encoder at ingest** is not a cost: coding and decoding a whole volume natively took 1.0–13.4 s a step here
  (Cell B's `code_wall`, M, one process of four), where the quality study's AV1 cells took 12–491 s wall each, encode
  and measure together (R, `claude/depth8:docs/av1/depth-cut-8.md` §8).

## 9. The comparison's columns

| column | this option |
| --- | --- |
| decode time on a phone | **unknown**; predicted 93–154 ms a `dbts_b1` frame (T, §5.2), against AV1 software's measured 133–135 ms; in the cloud 1.12–1.21× the lossless frame and 0.41–0.50× dav1d-WASM's AV1 view (M) |
| bytes | at the noise rule's 1.00 bar 0.85–1.47× the AV1 view's, median 1.05, with 1.05–1.17× its in-window error; at the view's Q 8 G 8 error 1.28–1.45×, median 1.36; 0.083–0.160 of the exact frame (M, D; 19 DBT volumes) |
| precision on screen | the stored depth, 10 or 12 bits, as 16-bit samples to the paint, as the exact frame (S1; no depth cut) |
| checked | yes, by a digest over the samples, **if the ingest computes it with the shipped WASM build**: identical across V8 hosts (M), across engines by the WebAssembly specification (S3, D); not across decoder builds (M, native ±1) |
| window/level and tools | all, on full samples, as on the exact frame today (the same paint path) |
| ships today | the decoder does (the exact frame's build decodes `.203` codestreams unchanged, M); the ingest form, the `.203` route in the client and the view's digest from the WASM build do not (not built) |
| what a phone cell must measure | §10 |

It multiplies with MOBILE-OPT-CONTENT-CROP as every software option does (fewer samples, less decode), and with a
decode at the screen's size (§6), which is its own and not AV1's.

## 10. What a phone cell must measure

One line each, for MOBILE-DECODE-COMPARE to carry as asks:

1. The same 16 `dbts_b1` frames, lossless and lossy at Δ 16, through the client's OpenJPH-WASM on the phone, in one
   worker, interleaved: ms a frame and the ratio (predicted 1.19–1.21, as in the cloud).
2. The same lossy frames' samples' SHA-256 in Chrome on Android, Firefox and Safari on iOS, against the node hashes of
   `rows/cell-e-dbts_b1-chromium.json` (predicted equal, S3).
3. A lossy frame's resolution level 1 decoded from its prefix, against the whole frame (the lossless ratio is
   ×0.27–0.31, R; for a lossy frame unmeasured).

## 11. Sources

Fetched 2026-11-15. Section numbers are the documents' own.

* **S1** DICOM PS3.5 2026d, §8.2.14 *High-Throughput JPEG 2000 Image Compression* and Table 8.2.14-1, §10.18
  *Transfer Syntaxes for High-Throughput JPEG 2000 Compression*:
  <https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_8.2.14.html>,
  <https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_10.18.html> (read as *current*, which named
  itself 2026d).
* **S2** DICOM PS3.3 2026d, §C.7.6.1.1.5 *Lossy Image Compression*, and the Defined Terms for Lossy Image Compression
  Method (0028,2114): <https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.html>.
* **S3** WebAssembly Core Specification, version 3.0 (2026-11-04), <https://webassembly.github.io/spec/core/>:
  *Execution › Numerics* (`exec/numerics.html`: the opening paragraph, *Floating-Point Operations*, *Relaxed
  Operations*) and *Appendix › Profiles* (`appendix/profiles.html`, *Deterministic Profile*); the `WebAssembly/spec`
  repository's head was `943c5df07e84` when read.
* **S4** OpenJPH, `aous72/OpenJPH` at `c68064d0e4ca` (tag 0.31.0, the ingest's and the client's pin):
  `src/apps/ojph_compress/ojph_compress.cpp:542–553`; `docs/usage_examples.md:15`;
  `src/core/codestream/ojph_codestream_wasm.cpp:199–215`; `src/core/transform/ojph_transform_wasm.cpp:136–160`
  (`wasm_irv_vert_step`, line 154); `src/core/transform/ojph_colour_wasm.cpp:52–62`, `301–380`;
  `src/core/transform/ojph_colour_sse2.cpp:122–147`; `src/core/coding/ojph_block_encoder.cpp:548`;
  `tests/test_executables.cpp:132–133, 215, 225`.
* **S5** D. Taubman et al., *High Throughput JPEG 2000 (HTJ2K): Algorithm, Performance and Potential*, "Last updated:
  29 May 2020", §7, Table 9: <https://htj2k.com/wp-content/uploads/white-paper.pdf> (as quoted in
  [`new-options.md`](new-options.md) S8; not re-fetched).
* **S6** G. Robson, S. Cossu, R. Pillay, M. D. Smith, *Evaluating HTJ2K as a Drop-In Replacement for JPEG2000 with
  IIIF*, The Code4Lib Journal 57, 2023-08-29: <https://journal.code4lib.org/articles/17596>.
* **S7** Academy Software Foundation, *Encoding Guidelines*, "HTJ2K - High Throughput JPEG 2000":
  <https://academysoftwarefoundation.github.io/EncodingGuidelines/EncodeHTJ2K.html> (undated page, read 2026-11-15).

## 12. Fixtures and limits

The 19 DBT volumes of one dataset (EA1141; systems A and C 12-bit, B 10-bit; four of a second content), every frame,
stored form; the AV1 view's rows from the quality study's harness (`0a9d33ca`), G 8 on 14 volumes and G 1 on the five
the study did not code. Coding error is measured, not seen: no reader judged either picture. OpenJPH 0.31.0 only, one
set of HTJ2K settings (the exact series', irreversible), one step per volume and no rate control or visual weighting,
which a tuned encoder (Kakadu's, a PCS's) might use to do better than this. Decode on one 4-core cloud host without a
GPU, node 22 and headless Chromium 153 (both V8), one thread, three volumes, 16 frames each; no WebCodecs arm on the same
host; no Firefox, Safari or phone. No breast ultrasound cine, FFDM or other modality.
