# versions — the newer tools against the pinned ones

Queue row 57 (VERSIONS) of [`docs/av1/queue.md`](../../../docs/av1/queue.md): what each tool's releases after
our pin gain or break for lossless, high bit depth, monochrome, decode speed or WASM. The verdict per tool is in
[`docs/av1/README.md`](../../../docs/av1/README.md) §Measured here; this file holds the commands, the sources
read and the cells.

```bash
lab/av1/tools.sh && lab/av1/item/build.sh            # libaom 3.15.1, native dav1d, ingest's in-process check
lab/decode-bench/fetch_decoder.sh                    # the shipped OpenJPH package (arm htj2k)
lab/av1/versions/build.sh                            # everything below "built", ~40 min on 4 cores
lab/av1/fetch_data.sh ffdm_a ffdm_b syn2d_a syn2d_b dbt12_ea1141 dbt10_ea1141 dbtproj_ge dbtproj_holo \
  usb_cine usb_cine_rgb ct_lidc
P=lab/av1/.venv/bin/python D=lab/av1/data
$P lab/av1/versions/aom_bytes.py lab/.av1-build lab/.av1-work/aom-bytes $D/ffdm_a@cpu0,allintra:7 …  # SETS below
$P lab/av1/versions/make_frames.py lab/.av1-build lab/.av1-work/versions $D/ffdm_a@cpu0 …            # SETS below
NODE_PATH=$(npm root -g) node lab/av1/versions/decode.mjs --rounds 6 --out decode.json
node lab/av1/versions/ojph_deep.mjs                  # --mutate must fail every cell
```

**Built** (`build.sh`, nothing committed): dav1d 1.5.4 and OpenJPH 0.31.0 and 0.32.0 to WASM under emscripten
3.1.74 (the pin) and 6.0.11 (emsdk tag, commit `dd8e2563`), dav1d's development head (`7f12cf23`, 2026-09-30)
under 6.0.11, libaom's development head (`4cea455c`, 2026-10-06; its `aomenc` still names itself 3.15.1), and
Chrome for Testing's headless shell 154.0.8037.92 (SHA-256 `636aa5c7…6f9`) beside Playwright's Chromium 141.
Commits and checksums are in `build.sh`, which refuses a mismatch.

**Sets.** The breast series and one control, the first 4 frames each (`ffdm_b` and `syn2d_a` have 2): `ffdm_a`,
`ffdm_b`, `syn2d_a`, `syn2d_b`, `dbt12_ea1141`, `dbt10_ea1141`, `dbtproj_ge`, `dbtproj_holo` (14 bits, split at
12), `usb_cine`, `usb_cine_rgb`, and `ct_lidc`. Presets: cpu0, and the shipped one where rows 14 and 33 set it
(`dbt12_ea1141` allintra 5, `dbt10_ea1141` good 6, `dbtproj_*` allintra 7, `ct_lidc` allintra 6); the others
have none, so allintra 7 stands in.

## What each release says (read 2026-10-07)

**libaom.** No release after 3.15.1 (tag 2026-09-21; `aom-releases` and the tags hold nothing newer). Its main
branch has 70 commits since. None names lossless; the ones that could reach a lossless item are the encoder's
RD changes for high bit depth (`df49183d` transform search and skip for HBD sharpness, `a39b3a41` variance-aware
RD penalties, `f9faa216` trellis tweaks, `38bf46ed` sub-block variance in RD), all 2026-09-21 to 10-05.

**SVT-AV1.** No release after v4.2.0 (2026-07-14). 176 commits on master since; the lossless ones are an RTC
build guard (`8de4b131`, `CONFIG_ENABLE_LOSSLESS`), and the rest is RTC IntraBC, x86 SSE4.1 tiers and Arm
kernels. Row 28's finding stands unmeasured again: 4:2:0 at 8 and 10 bits only, never smaller than libaom.

**dav1d.** No release after 1.5.4 (2026-07-14). 30 commits on master to 2026-09-30, nearly all x86 and AArch64
assembly, which the WASM build does not compile (`-Denable_asm=false`). The C changes are `854dd6f4` (decode_b),
`028ea64` and `7f12cf2` (temporal motion vectors), `99444f1` and `aa09a63` (loop-filter masks; a lossless
frame is not filtered) and `d01a3ff` (self-guided restoration, off in lossless). So the head is expected to tie on lossless intra;
measured below.

**OpenJPH 0.32.0** (2026-09-17). For WASM decode, one change: the SIMD block decoder's UVLC suffix mask
(`0xF` → `0xFF`, `96f6d39`), which let bits of quad 1's suffix leak into quad 0's `u_q` on rows past the first
pair. The commit says 24-bit reversible code-blocks failed under `-msimd128` while the scalar build decoded
them. It needs quad 1's 5-bit suffix ≥ 16, so `u_q` ≥ 21 and a code-block of ≥ 22 magnitude bit-planes; a
16-bit reversible 5/3 sample's detail coefficients carry at most ~18. `ojph_deep.mjs` decodes 16-bit noise, a
one-pixel 0/65535 checkerboard and 8×2 blocks: exact through all four WASM builds (12/12), and a flipped truth
sample fails all twelve. The rest of 0.32.0 is NLT types 2 and 4, TLM across segments, POWER8, float qfactor and
a truncated-stream fix. The encoder's codestreams are byte-identical to 0.31.0's but for the version in the COM
segment.

**Emscripten** 3.1.74 (2024-12-14) → 6.0.11 (emsdk tag, 2026-10-01; the ChangeLog's last dated entry is 6.0.10, 2026-09-21). What reaches our two decoders: 4.0.0 turns on bulk memory
(`memcpy`/`memset` as `memory.copy`/`fill`), non-trapping float-to-int and BigInt by default; LLVM moves from 19
to 22; 6.0.0 raises the minimum engines to Chrome 85, Firefox 79, Safari 14.1, and 6.0.7 Safari to 15. Relaxed SIMD
stays opt-in (`-mrelaxed-simd`; 6.0.3 adds FMA intrinsics), and neither decoder's C uses intrinsics, so it adds
nothing but auto-vectorisation; threads are unchanged (`-pthread`, `-sUSE_PTHREADS` deprecated in 6.0.1).

**Chromium 141 → 154** (155 is stable on 2026-10-07; its `dav1d_video_decoder.cc` is 154's). The bundled dav1d
moves from `af5cf2b` (1.5.1 + 20) to `52b9d3d` (1.5.4 + 1). The decoder's frame pool now zero-initialises each
buffer it allocates. **12-bit AV1 is still refused, and why is now read:** `VideoDecoder.decode()` checks a key
chunk with libgav1's OBU parser, built with `LIBGAV1_MAX_BITDEPTH=10` in 141, 154 and 155, so a 12-bit sequence
header fails the parse and the chunk is called not key — the `DataError` row WCDEC saw. Monochrome still comes
out as I420 with generated chroma; `max_frame_delay = 1` under `optimizeForLatency` is unchanged.

## libaom's head — bytes (`aom_bytes.py`)

**Byte-identical to 3.15.1 in every cell: 22 cells (11 series × cpu0 and the shipped or stand-in preset), 80/80
items the same bytes**, every item decoded back to its checksum by ingest's in-process dav1d. The RD changes
since the tag do not reach a lossless encode at these presets. The lever was checked: the same ingest with
`AOM_VERSION=3.8.2` writes different bytes (`usb_cine`, allintra 7, 2 frames: 135 590 B against 135 659 B).

## Decode time a frame (`decode.mjs`)

The product's decoder worker in headless Chromium 141 (Playwright's) and 154, 1× and 4× CPU throttle, 6 rounds,
each (throttle × browser) cell a fresh browser in a Williams order per round, arms and sets rotating inside it;
11 series × 4 frames (2 on `ffdm_b`, `syn2d_a`). **8 640/8 640 frames exact.** One decode at a time on a 4-core
container, so the host is not saturated; container times, not a phone's. A ratio is the median of paired round
ratios (each round's median frame), per series; "pooled" is the median over all 66 (series, round) pairs, with
how many of them the new arm was faster.

| arm against its reference | Chromium | 1× pooled [per-series medians], faster | 4× pooled [per-series medians], faster |
| --- | --- | --- | --- |
| OpenJPH 0.31.0, emscripten 6.0.11 / 3.1.74 | 141 | 0.948 [0.894–1.081], 47/66 | 0.942 [0.531–1.018], 42/66 |
| | 154 | 0.960 [0.897–1.092], 45/66 | 0.952 [0.890–1.052], 46/66 |
| OpenJPH 0.32.0 / 0.31.0, both emscripten 3.1.74 | 141 | 0.968 [0.858–1.113], 41/66 | 0.932 [0.777–1.060], 46/66 |
| | 154 | 0.984 [0.911–1.050], 43/66 | 0.974 [0.854–1.175], 35/66 |
| dav1d 1.5.4, emscripten 6.0.11 / 3.1.74 | 141 | 0.981 [0.888–1.028], 45/66 | 0.978 [0.948–1.013], 40/66 |
| | 154 | 1.011 [0.981–1.036], 29/66 | 1.000 [0.899–1.045], 33/66 |
| dav1d head / 1.5.4, both emscripten 6.0.11 | 141 | 1.001 [0.928–1.042], 33/66 | 0.996 [0.985–1.080], 34/66 |
| | 154 | 1.011 [0.962–1.135], 24/66 | 0.994 [0.954–1.158], 35/66 |
| the shipped OpenJPH package, Chromium 154 / 141 | — | 0.918 [0.821–1.133], 49/66 | 0.975 [0.908–1.306], 37/66 |
| the item as the client picks its decoder, 154 / 141 | — | 1.061 [0.895–1.242], 25/66 | 1.066 [0.945–1.373], 21/66 |
| dav1d-WASM (WebCodecs absent), 154 / 141 | — | 1.003 [0.903–1.115], 33/66 | 1.005 [0.936–1.022], 31/66 |

**Reading.** dav1d's head and a newer emscripten tie on dav1d-WASM. OpenJPH under emscripten 6.0.11 is
4–6 % faster pooled, in all four cells, but single series swing 10 % either way, and OpenJPH 0.32.0 against
0.31.0 — one mask in the block decoder, plus NLT and TLM changes in the tile and parameter code that a
plain codestream passes through — moves as much (2–7 %). So 6 rounds do not separate a 5 % gain from this
harness's spread; it is the one lever here worth a longer run. Chromium 154 against 141: dav1d-WASM is the
same; the item as the client decodes it is 6 % slower pooled, most on the 10-bit and 12-bit mammograms
(`syn2d_a` 1.24–1.37, `syn2d_b` 1.20, `ffdm_b` 1.14–1.17), although the 12-bit ones take dav1d-WASM, which
ties when run alone; the cause is not read, and a browser's version is not ours to pin.
