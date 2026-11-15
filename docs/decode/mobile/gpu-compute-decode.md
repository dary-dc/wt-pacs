# Decode on a phone's GPU through WebGPU compute

*Queue row MOBILE-OPT-GPU-COMPUTE, 2026-11-15: option 4 of MOBILE-DECODE-OPTIONS' brief
(`claude/work-ledger:docs/queue-client-2026-11-14.md`, amendments 19 and 20), worked out as its advocate. Theory and
sources; nothing run on a device, a GPU or a coder here. Read beside [`new-options.md`](new-options.md).*

Labels: **(S)** a source quoted, listed in §9 with its revision; **(R)** a result of this repository, by its file;
**(D)** derived here, the arithmetic written out; **(T)** theory, not measured. Fixtures behind every (R): three timed
DBT volumes of one dataset (`dbts_a1` 1142×1785, `dbts_b1` 2560×3328, `dbts_c1` 976×2513, `docs/FIXTURES.md`), the
breast series of the WebGPU decoder's exactness run (§2), 19 DBT volumes for bytes; 4-core cloud hosts without a GPU
(SwiftShader runs WGSL on the CPU, so **no GPU time is claimed from this repository**); one phone (Chrome 157), one
home link, one evening.

## 1. What it shows

* **The option is further along than its brief assumes.** "Feasibility only, no build" was asked; a WebGPU HTJ2K
  decoder is already built in the lab and exact: `lab/av1/decode/webgpuht`, 1 158 / 1 158 frames exact on the twelve
  synthetic sets and five breast series up to 3328×4096, one frame or a batch of frames a dispatch, four mutants each
  caught (R, [`../README.md`](../README.md) §A WebGPU block decoder, built; [`../levers-protocol.md`](../levers-protocol.md)
  §L3). What is unknown is only its time, on any GPU.
* **It is the only option on either list that is fast in hardware *and* produces the samples itself**: full
  precision (the reversible 5/3 path is integer arithmetic, exact on every conformant WGSL implementation, §4), every
  frame checkable against the existing digest, window/level and every tool on the true samples (§5).
* **The checked GPU route is the reversible (lossless) one.** WGSL lets an implementation reassociate and fuse
  floating-point operations (S2), so an irreversible 9/7 synthesis in `f32` is not bit-reproducible across GPUs and
  cannot meet a digest computed at ingest (D). A GPU lossy view would need a lossy form decoded with integer
  arithmetic; MOBILE-OPT-HTJ2K-LOSSY's row decides whether one exists at acceptable bytes.
* **Its cost is bytes, not decode.** The stream is the exact series: `dbts_b1` 2 148 203 B a frame, 4.63× the view's
  ~464 KB (R; D). A fill of it is wire-bound below ~382 Mbit/s of goodput against today's view's effective 45 ms a
  frame (§6, D). It wins where the link is fast or the frame is asked for exactly; the link decides, not the decoder.
* **Ships today:** WebGPU in Chrome on Android 12+ with Qualcomm and ARM GPUs (the Galaxy S23's SoC is a Snapdragon 8 Gen 2,
  R, `claude/hw-decode:docs/decode/hardware.md`), in Safari on iOS 26; **not** Firefox on Android, **not** Samsung Xclipse GPUs (S4, S5). The decoder is a
  lab tool; the painter is WebGL2 and would have to be WebGPU to paint without a read-back (§5): structural, a design
  for review.
* **One line asked of this row** (new-options §6.1): AV1 with entropy decoding in WASM and reconstruction in WebGPU
  compute, §8, named and not evaluated.

## 2. The best version of it (T, each part sourced or measured where marked)

1. **The stream** is the exact series as stored: lossless HTJ2K, the reversible 5/3, cleanup passes only (OpenJPH's
   encoder writes no SigProp or MagRef pass, R, `../README.md` §Faster HTJ2K in the browser). Nothing new at ingest,
   no second stream, no depth cut: "up to 16 bits a component" is what the built decoder takes (R).
2. **The CPU parses, the GPU decodes**, as the published GPU decoder does (S1, §3): "The host CPU decodes precinct
   headers and prepares lists for byte-stream locations inside the HTJ2K codestream; the host CPU then uploads the
   file and the lists to the GPU. This takes a small amount of time, and can be run in parallel with GPU decoding a
   previous frame." The lab's `codestream.mjs` is that parse (R).
3. **The HT cleanup pass as two kernels** (S1, §3): "a single thread is used to decode each codeblock" for MEL and
   VLC (KCUPS1), then "Each thread in a warp decodes two columns of a codeblock; thus, one warp is needed to decode a
   64x64 codeblock" for MagSgn (KCUPS2). Built so (R), with a workgroup-memory scan or `subgroups`.
4. **The 5/3 synthesis and the pack** on the GPU, a thread a line (R); integer only (§4).
5. **A batch of frames a dispatch during a fill**: 13 dispatches and one read-back a batch instead of a frame (R,
   `../README.md` §A WebGPU block decoder, built: 0.15–3.25 dispatches and 0.01–0.25 read-backs a frame), so the GPU's
   fixed costs are paid once a batch; one frame a dispatch for an ask.
6. **The samples stay on the GPU.** The frame check by XXH3-64 in WGSL, eight bytes back (derived in
   `claude/hw10-routes:docs/decode/hardware-10bit.md` §5.4, R: "every block's sum is computed in parallel, then one
   thread runs the chain"; not built); the paint from the same buffer (§5).
7. **The decoded cache** (the OPFS cache of decoded samples, decided 2026-10-10, `docs/client/design.md`) written
   from a `mapAsync` read-back off the paint's path; on SwiftShader that read-back cost 2× the wasm heap's copy on
   frames over 4 MB (R, 31.1 against 15.4 ms at 3328×4096, 1×).
8. **The fallback is the decoder the client already ships**: no adapter, a refused stream (§7), a failed check →
   OpenJPH-WASM, which gives the same samples, since both decode the lossless stream to the source (R, the exactness run of §2).
9. **Possible, not adopted:** 32×32 code-blocks at ingest. S1, §3: "For 4K images with 64x64 codeblocks, this kernel
   underutilizes the GTX1080 card; better utilization can be achieved with 32x32 blocks." `dbts_b1` has about
   (2560 ÷ 64) × (3328 ÷ 64) = 40 × 52 = 2 080 code-blocks of 64² (D; the lab's count for 3328×4096 is 3 352, R), so
   2 080 KCUPS1 threads; 32² gives four times as many. The bytes' cost of smaller blocks on our series is unmeasured.

## 3. Decode time: a cost model (T throughout; nothing is timed on a GPU here)

**Published.** S1, Table 3, the 4K 4:4:4 12-bit sequence, lossless ("ls"), on the low-end card of its Table 1
("GT1030 384 1468 48 ~40": CUDA cores, boost MHz, memory GB/s, attainable GB/s): KCUPS1 "4.43", KCUPS2 "4.88",
"WSYN+Color" "6.15" ms a frame; "Proposed-NR … 62" frames a second. The paper states the table's wavelet as
"irreversible CDF97"; it does not separate the lossless column's.

* Per sample (D): 4.43 + 4.88 + 6.15 = 15.46 ms over 3840 × 2160 × 3 = 24 883 200 samples = **0.621 ns a sample**.
* `dbts_b1`, 8 519 680 samples (D): 0.621 ns × 8 519 680 = **5.3 ms a frame**, on a 2017 desktop card with 48 GB/s
  of its own memory, under CUDA.
* The serial floor (D): KCUPS1 is one thread a code-block; at most 2 080 threads on `dbts_b1`, against the 6 300 of
  S1's 4K frame, so the card is less full and the per-sample figure is optimistic for our frame size. The repository's
  bound took KCUPS1's 4.43 ms as a frame's floor whatever its size (R, `../README.md` §A WebGPU block decoder,
  bounded).
* **The break-even**, against one software AV1 decoder on the phone (133–135 ms a frame on `dbts_b1-q8-g8`, R,
  FILL-SPLIT): the phone's GPU through WebGPU may be up to 135 ÷ 5.3 = **25× slower** than that card's CUDA decoder
  before the GPU route decodes the exact frame slower than software decodes the view (D, ignoring the CPU's parse and
  the dispatches). No official source in this session gives a phone GPU's throughput against the card's; the factor
  is the phone cell's (§7).
* **The CPU left** (R, `../README.md` §The bound): what leaves the CPU is "81–86 % of a frame"; with the samples
  painted from the GPU the JS copy out (10–14 %) leaves too, so the parse and the rest, ~4–5 % of a software decode,
  stay (D from the profile's "rest" column; the lab's parse is JavaScript, not OpenJPH's, so this share is a guess
  to be timed).

**What the phone gains beyond one frame's time** (T): the decode leaves the CPU cores the decoders share, so a fill's
capacity is no longer "more decoders or a faster core" (R, `../README.md` §What a phone would need) but the GPU's.

## 4. Precision and the check

* **Exact by construction.** WGSL integers: "i32 operations use two's complement arithmetic and have defined
  overflow behavior", and "Expressions on concrete integer types that overflow produce a result that is modulo
  2^bitwidth" (S2). The reversible 5/3 synthesis is shifts and adds on integers, so a conformant implementation gives
  one answer on every GPU (D). Measured so on SwiftShader, against OpenJPH, every frame (R).
* **Not so for `f32`.** S2, *Floating Point Rounding and Overflow*: "An implementation may reassociate operations."
  and "An implementation may fuse operations if the transformed expression is at least as accurate as the original
  formulation."; and *Floating Point Evaluation*: "the WGSL fma function may expand to an ordinary multiply (including
  a rounding step) and an add (and another rounding step)". Addition and multiplication are "Correctly rounded", but
  their order and fusion are the compiler's, so a 9/7 synthesis in `f32` can differ by a rounding between two GPUs,
  and a digest from ingest would fail on one of them (D). S1's own wavelet is "32-bit floats".
* **No 64-bit integer**: "WGSL does not have a concrete 64-bit integer type." (S2). The decoder's bit reader is two
  `u32`s (R); XXH3-64's lanes are `vec2<u32>` with carries by hand (R, hardware-10bit §5.4).
* **The check needs no read-back of the frame**: the samples in the storage buffer are the decoder's own, so a hash
  over them is amendment 1's "decoder's exact output samples reach an XXH3", with eight bytes back (T until built).
  On a failure the frame is decoded again by OpenJPH-WASM and the first failure reported (amendment 9).

## 5. Window/level and the tools: all functional, on the true samples

The decoded frame is a buffer of 16-bit samples on the GPU, not a picture (D). A WebGPU fragment shader can read it:
the core limits allow storage buffers in the fragment stage ("maxStorageBuffersInFragmentStage" default "8",
compatibility-mode default "4", S3), or a copy into an integer texture (`"r16uint"` is a core format, S3). So:

* **window/level**: the VOI table on the sample itself, at the source's depth: a 10-bit `dbts_b1` keeps its 1 024
  values, a 12-bit `dbts_a1` its 4 096 (R, `docs/FIXTURES.md`); none of the banding arithmetic of an 8-bit route
  applies (D);
* **zoom, pan, rotate, flip, invert**: geometry and the table, as today's WebGL2 paint does (`docs/client/design.md`,
  the paint module);
* **`valueAt` and measurements**: the true sample, either from a 2-byte `copyBufferToBuffer` and `mapAsync` (one GPU
  round trip, ~3 ms on SwiftShader, R) or from the decoded cache's copy;
* **the cine and frame-change latency**: a frame already on the GPU paints with no upload (T).

**What it needs:** a **WebGPU painter**. Today's paint is WebGL2 (`docs/client/design.md`); a WebGPU buffer cannot be
bound in WebGL, so either the paint moves to WebGPU (the levers protocol named this "structural, not built here",
R, §L3) or every frame is read back and uploaded to WebGL, which gives up the read-back saving (§3, 7). This is a
design change for review, not proposed here.

**Memory** (S3; D): `maxBufferSize` default "268435456 bytes (256 MiB)", `maxStorageBufferBindingSize` "134217728
bytes (128 MiB)". `dbts_b1`'s coefficients as `i32` are 8 519 680 × 4 = 34.1 MB, its samples as 16 bits 17.0 MB:
three frames' coefficients fit one binding. The lab batches up to 256 MB of coefficients (R). A phone's GPU memory is
the system's, so the frames held on the GPU count against the page's memory as today's held frames do (T).

## 6. Bytes, and where the link binds

* **Bytes a frame** (R; D): the exact series, `dbts_b1` 107 410 134 B ÷ 50 = 2 148 203 B = 17.19 Mbit; the view
  ~464 KB = 3.71 Mbit, so **4.63×**; the brief's 4.6–14× across the fixtures.
* **A fill, `max(wire, decode)` a frame** (the rule of LINK-TARGETS, `docs/client/evidence/which-links-a-phone-meets.md`):

  | goodput | exact series on the wire, ms a frame (D) | the view on the wire, ms a frame (D) |
  | ---: | ---: | ---: |
  | 50 Mbit/s | 17.19 ÷ 50 = 344 | 74 |
  | 100 Mbit/s | 172 | 37 |
  | 200 Mbit/s | 86 | 19 |
  | 400 Mbit/s | 43 | 9 |

  Against today's view in software at an effective ~45 ms a frame on the phone (R, FILL-SPLIT; several decoders), the
  GPU route's fill is as fast only where 17.19 Mbit ÷ 0.045 s = **382 Mbit/s** of goodput is sustained, and only if
  the GPU decodes in ≤ 45 ms (D). Against one software AV1 decoder at 135 ms, 17.19 ÷ 0.135 = 127 Mbit/s (D). The
  home Wi-Fi fit (≥ 600 Mbit/s, R, `docs/transport/transport-conclusions.md` §1) clears both; which profiles do is
  LINK-TARGETS' table.
* **An ask for the exact frame** is the same bytes in either design, so there the GPU route's gain is the decode
  alone, unhandicapped by the wire (T): the exact-frame latency the owner's Lossless control waits on.
* **It multiplies with the content crop** (MOBILE-OPT-CONTENT-CROP): fewer samples is fewer bytes, fewer code-blocks
  and a shorter decode, in proportion for the wavelet and the pack (D), less than proportion for the block decoder,
  whose background blocks are already cheap (T).

## 7. Disadvantages, as its advocate lists them

* **Bytes** (§6): the decisive one on slow links. A GPU decoder for a lossy integer form would remove it; none is
  sourced here (§4).
* **Time is unknown on every GPU.** The container has no GPU; the bound's card is a 2017 desktop one under CUDA (S1);
  dispatch costs and `mapAsync` on a phone driver are unmeasured; Safari's `mapAsync` has a filed bug, "waiting on
  unrelated command buffers" (WebKit bug 272804, read through a search excerpt, R, `../levers-protocol.md` [8]).
* **The painter must change** to WebGPU for the route's main saving (§5); structural.
* **Coverage**: S4 lists Chrome on Android with "ARM/Qualcomm/Intel, Android 12+: 121", "Imagination, Android 16+:
  139", "Samsung Xclipse, Android 12+: TBD"; Firefox on Android "Behind a flag … Mozilla expects to do work on
  Android in 2026"; Safari "In macOS Tahoe 26, iOS 26, iPadOS 26, and visionOS 26, WebGPU is supported and enabled by
  default." Every other phone keeps OpenJPH-WASM.
* **`subgroups` is optional**: Chrome 134 made it available (S6: "the subgroups WebGPU feature enabling SIMD-level
  parallelism is now available"); not every adapter offers it, so the workgroup-memory scan, also built and exact, is
  the default (R).
* **The parse's scope**: one tile, one tile-part, one layer, default precincts, code-blocks up to 64², HT blocks, the
  5/3 and the RCT; refinement passes not built; "Anything else is refused by name" (R, the lab README). A stream from
  another encoder (the PCS's) that uses more falls back to WASM; the refusal is safe, not wrong. NVIDIA's CUDA
  decoder shows what full HT support grew to: "v0.7.0 … All code-blocks have to be HT code-blocks with one HT set and
  no refinement", then "v0.10.0 … HTJ2K images with refinement passes (significance propagation and magnitude
  refinement) can now be decoded" (S7).
* **No browser precedent**: no WebGPU or WebGL JPEG 2000 or HTJ2K decoder was found published (searched 2026-10-07,
  R, and again 2026-11-15: a WebGPU *JPEG* decoder exists as a learning project; none for JPEG 2000). The lab's is the
  only one known here.
* **Energy and heat** on a phone: unmeasured anywhere (T).

## 8. AV1 with its reconstruction on the GPU (named only, no evaluation)

AV1's entropy decoding is one adaptive arithmetic decoder a tile, serial within a tile, while its prediction,
inverse transforms and loop filters are integer stages over blocks; the split new-options §6.1 names is entropy
decoding in WASM (dav1d's, say), the rest in WebGPU compute. Integer reconstruction would keep the output exact as
AV1 requires ("decoders shall produce output frames that are identical in all respects", the AV1 specification §7.2,
quoted in new-options §3), so the existing view digest would hold (D). Intra prediction reads neighbouring
reconstructed blocks, so a frame's intra blocks run in wavefronts, not all at once (T). The one published claim found
is a vendor's white paper for a GPU-enabled AV1 decoder, "on average is 30-100% faster than the original libdav1d one"
on game consoles (S8, marketing, no method stated). No open or browser implementation was found. Not evaluated
further: the view is already fast enough to bind on the decode only on the phone, and HTJ2K's code-block independence
(§2) is the cleaner fit for compute.

## 9. The comparison's columns

| column | this option |
| --- | --- |
| decode time on a phone | **unknown**; a bound: 5.3 ms a `dbts_b1` frame on S1's low-end 2017 card (D); breaks even with one software AV1 decoder if the phone's GPU is ≤ 25× slower (D) |
| bytes | the exact series: 4.63× the view on `dbts_b1` (R; 4.6–14× across the fixtures); none added at ingest |
| precision on screen | full, the source's depth (10 or 12 bits here) |
| checked | yes: the decoder's own samples, XXH3-64 on the GPU (not built) or after a read-back; exact on SwiftShader, every frame (R) |
| window/level and tools | all, on the true samples, with a WebGPU painter (§5) |
| ships today | WebGPU: Chrome Android 12+ Qualcomm/ARM (121+), Safari iOS 26; not Firefox Android, not Xclipse (S4). The decoder: a lab tool, exact; the painter: not built |
| what a phone cell must measure | below |

**Phone cells** (asks for the next phone round; the levers protocol's §L3 phone-stage rule already states the bar:
"a warm ask on a breast frame from 931×2124 up, transfer included, is ≤ ×0.70 of the reference in ≥ 8 of 10 rounds,
and a fill is no slower than ×1.01", R):

1. The adapter: `requestAdapter()` result, `subgroups` offered or not, the limits of §5.
2. `lab/av1/decode/webgpuht` on the exact frames of `dbts_a1`, `dbts_b1`, `dbts_c1`: every frame exact, ms a frame
   one frame a dispatch and batched, interleaved with OpenJPH-WASM on the same frames.
3. The `mapAsync` read-back of one 17 MB frame, and of 2 bytes (`valueAt`).
4. Once built: XXH3-64 in WGSL on one frame, against the CPU's.

**What the sources decide alone:** that the reversible route is exact on every conformant WebGPU (S2, R); that a
float synthesis cannot be checked by an ingest digest (S2, D); where WebGPU ships (S3, S4, S5). **What they do
not:** any time on a phone; the read-back's and the dispatches' cost; energy. **Leaning, labelled as one:** worth
the phone cells now, because the decoder exists and is exact: the cells cost a page, not a build. As the fill's route
it wins only on fast links (§6); as the exact frame's decoder, on every link where it is faster than WASM.

## 10. Sources

Fetched 2026-11-15.

* **S1** A. T. Naman and D. Taubman, *Decoding High-Throughput JPEG2000 (HTJ2K) on a GPU*, ICIP 2019, §3 *A GPU-based
  decoder for HTJ2K*, §4, Tables 1 and 3: <https://kakadusoftware.com/wp-content/uploads/ICIP2019_GPU.pdf> (PDF
  SHA-256 prefix `e716d6d99fcd`).
* **S2** WGSL, `gpuweb/gpuweb` at `10be35c70d7b`, `wgsl/index.bs`: integer types and arithmetic expressions,
  *Floating Point Evaluation*, *Floating Point Rounding and Overflow*, *Accuracy of Concrete Floating Point
  Expressions*, *Internal Layout of Values* (64-bit integer):
  <https://github.com/gpuweb/gpuweb/blob/10be35c70d7bfc37e0557f2d0e38ec42742aba63/wgsl/index.bs>.
* **S3** WebGPU, the same commit, `spec/index.bs`: *Limits* (`maxBufferSize`, `maxStorageBufferBindingSize`,
  `maxStorageBuffersInFragmentStage`, each with its default and compatibility-mode default), `GPUTextureFormat`:
  <https://github.com/gpuweb/gpuweb/blob/10be35c70d7bfc37e0557f2d0e38ec42742aba63/spec/index.bs>.
* **S4** gpuweb wiki, *Implementation Status*, `gpuweb/gpuweb.wiki` at `93ed5aafdde2` (2026-11-11): Chromium, Firefox
  and Safari tables: <https://github.com/gpuweb/gpuweb/wiki/Implementation-Status>.
* **S5** Chrome for Developers, *What's New in WebGPU (Chrome 121)*, "Last updated 2024-01-18": "WebGPU is now
  enabled by default in Chrome 121 on devices running Android 12 and greater powered by Qualcomm and ARM GPUs."
  <https://developer.chrome.com/blog/new-in-webgpu-121>. WebKit, *WebKit Features in Safari 26.0* (modified
  2025-10-06): "WebKit for Safari 26.0 adds support for WebGPU." <https://webkit.org/blog/17333/webkit-features-in-safari-26-0/>.
* **S6** Chrome for Developers, *What's New in WebGPU (Chrome 134)*, "Published: February 26, 2025":
  <https://developer.chrome.com/blog/new-in-webgpu-134>.
* **S7** NVIDIA nvJPEG2000 release notes, v0.7.0 and v0.10.0 (the page carries no dates):
  <https://docs.nvidia.com/cuda/nvjpeg2000/releasenotes.html>.
* **S8** A vendor white paper, *Unleashing the power of GPU: the advantages of a GPU-based AV1 decoder*, 2023-07-27
  (PDF SHA-256 prefix `0e4455f04846`): <https://www.luxoft.com/files/pdfs/blog/431998-TC-TMT-Whitepaper-AV1-2023-07-27.pdf>.
