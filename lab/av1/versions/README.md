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
