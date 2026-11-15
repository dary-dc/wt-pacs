# HTJ2K only, in software, on a phone's browser

*Queue row MOBILE-OPT-HTJ2K-SOFTWARE, 2026-11-15, option 3 of MOBILE-DECODE-OPTIONS' brief
(`claude/work-ledger:docs/queue-client-2026-11-14.md`, amendments 19 and 20): every frame the exact HTJ2K frame,
decoded by the client's OpenJPH-WASM build, checked by its XXH3, at full precision, and no optimal-quality view at
all; worked out as its advocate, then its disadvantages. Theory and sources; nothing run on a device, a GPU or a
coder. Every choice stays the owner's.*

Labels, as [`new-options.md`](new-options.md): **(S)** a source quoted verbatim, listed in §9 with its revision;
**(R)** a result of this repository, by its file; **(D)** derived here, the arithmetic written out; **(T)** theory,
not measured. Fixtures behind every (R): three timed DBT volumes of one dataset (`dbts_a1`, `dbts_b1`, `dbts_c1`);
synthetic sets and seven other breast series for the decode profile; no ultrasound cine; 4-core cloud hosts without a
GPU, headless Chromium, software decode; one Android 16 phone (Chrome 157), one home link, one evening, three AV1
decoders, its core count not recorded. **No HTJ2K frame has been timed on a phone.**

## 1. What it shows

* **It is the only option that needs nothing new.** The client already fetches, decodes, checks and paints exact
  HTJ2K frames (the *Lossless* path); this option makes that path the only one. One codec, one decoder, one digest
  definition, one transfer syntax a PCS stores (DICOM's HTJ2K Lossless RPCL, S1), no coding error, no "visually
  lossless" bar, no *not as coded* label, no WebCodecs probe and no decoder lost by a hidden page.
* **Precision and the check are those of the stored frame** (S2, S3, R): the reversible path is integer arithmetic,
  which WebAssembly defines deterministically, so one build gives the same samples on every engine; the ingest's
  digest over them is today's exact-frame digest.
* **Its decode on a phone is unmeasured; the prediction is 78–127 ms a `dbts_b1` frame** (§3, T): the phone's AV1
  software decode (133–135 ms, R) divided by the cloud's measured ratio of the AV1 view to the product's HTJ2K frame
  on `dbts_b1` (1.06–1.74, R). Below or near AV1's, never shown above it on any host.
* **Its cost is bytes**: 4.6–14.6× the view's at Q 8 and 3.6–10× at the noise rule's Q (§4, R, D). With three
  decoders at the predicted speed it needs ~405–665 Mbit/s of goodput before the decode, not the wire, bounds a fill
  of `dbts_b1` (D); below that every fill is the wire's, and on a median mobile link (103 Mbit/s, the link profiles'
  world median) a `dbts_b1` fill is ~8.3 s against the view's ~2.25 s (D).
* **Its levers are already measured in the cloud** (§5, R): two decoder threads ×0.70–0.83 a frame from 1914×2572 up
  at 4×; three stripes ×0.60–0.68; a resolution prefix at a quarter of the bytes and ×0.27–0.31 of the decode.
* **A finding beside it** (§6): the shipped OpenJPH 0.31.0 predates upstream's commit "Fixes CVE-2026-111151"
  (0.33.0, a code-block buffer sized for an odd number of rows), S4. The bump is the owner's.

## 2. The route as the product runs it

*The decoder.* OpenJPH 0.31.0 (`c68064d0`), built by `client/decode/wasm/build/inside.sh` with `-O3 -msimd128
-fexceptions`, one thread, a 4 MB initial heap; the range taken in the pack; XXH3-64 with SIMD128 beside it (R,
`docs/decode/README.md` §The build, as delivered). Under emscripten OpenJPH's own CMake turns its WASM SIMD code on:
"this cmake script builds only WASM SIMD code by default, if desired, a non-SIMD build can be generated using the
OJPH_DISABLE_SIMD option" (S4, `CMakeLists.txt`), and the profile found the block decoder running as
`ojph_decode_codeblock_wasm` (R, §Faster HTJ2K in the browser). OpenJPH's status page: "SIMD instructions are also
employed for WebAssembly (Emscripten-based), which is now widely supported in most browsers" (S4, `docs/status.md`).

*The engines* (S5, S6): Chrome turned WebAssembly SIMD on by default at milestone 91, desktop and Android (its
platform-status entry: "Enabled by default", "desktop": 91, "android": 91); Safari 16.4: "In WebAssembly, we've
added support for 128-bit SIMD." Firefox's SIMD is not sourced here; the build decodes exact in Firefox 157 on the
desktop (R, §The build, as delivered).

*Exact by construction.* The DICOM transfer syntaxes this option uses are lossless: "Two Transfer Syntaxes are
specified for High-Throughput JPEG 2000 Image Compression (Lossless Only) (HTJ2KLossless and HTJ2KLosslessRPCL)"
(S1, §10.18), MONOCHROME2 with Bits Stored "1-38" (S1, Table 8.2.14-1), so no depth cut for D > 10. The reversible
5/3 synthesis in the WASM build is integer lifting: `wasm_rev_vert_step32` at the pin is `wasm_i32x4_add`,
`wasm_i32x4_shr`, `wasm_i32x4_sub` (S4, `src/core/transform/ojph_transform_wasm.cpp:324`). WebAssembly's integer
operators are deterministic ("Return the result of adding i1 and i2 modulo 2^N", S3, *Numerics*, `iadd`); its
non-determinism is NaNs' ("Some operators are non-deterministic, because they can return one of several possible
results (such as different NaN values)", S3) and the relaxed operators', which the build does not use (R: "`-mrelaxed-simd`
on a source build produces a byte-identical binary", `docs/decode/README.md` §The decode tail). So the samples are
the same on every engine and CPU (D from S3), which the repository has checked on three engines for 783 frames (R).

*The check.* XXH3-64 over the decoded samples against the ingest's digest, as every exact frame today; the product's
unit **Hp** (decode, pack, XXH3, compare) is timed at 19.8, 57.1 and 20.1 ms a frame at 1× on the cloud host (R,
`docs/client/evidence/decode-speed-of-the-optimal-quality-picture.md`), per sample (D):

| series | samples | Hp at 1× | ns a sample | exact frame (R) | bits a sample (D) |
| --- | --- | --- | --- | --- | --- |
| `dbts_a1`, 1142 × 1785, 12-bit | 2 038 470 | 19.8 ms | 19.8 ÷ 2 038 470 = 9.71 | 67 815 186 B ÷ 56 = 1 210 985 B | 4.75 |
| `dbts_b1`, 2560 × 3328, 10-bit | 8 519 680 | 57.1 ms | 6.70 | 107 410 134 B ÷ 50 = 2 148 203 B | 2.02 |
| `dbts_c1`, 976 × 2513, 12-bit | 2 452 688 | 20.1 ms | 8.20 | 70 668 114 B ÷ 69 = 1 024 176 B | 3.34 |

The HT block decoder is 55–70 % of a frame, the inverse wavelet 5–10 %, the copy out 7–15 % (R, decode profile, seven
series); the decode follows the coded bits, which is why `dbts_a1`, at 4.75 bits a sample, costs the most a sample.

## 3. What it would take on a phone (theory)

No published HTJ2K decode time on a phone, natively or in WebAssembly, was found (searched 2026-11-15); the HTJ2K
white paper's CPU figures are a desktop's (S7, §7, Table 9: "Throughputs are measured on a 4-core Intel i7-6700
CPU"). So the prediction carries a ratio, labelled so:

```
phone AV1 software, dbts_b1-q8-g8, three decoders (R, fill-bound-on-phone.md)      133–135 ms a frame
cloud W ÷ Hp, dbts_b1 Q 8, G 1 (R, Protocol C):   1× 1.74 · 4× cores 1 1.58 · 4× 1.06
predicted Hp on the phone = 135 ÷ ratio        =  77.6 · 85.4 · 127.4 ms a frame   (T)
three decoders: 3000 ÷ 77.6 = 38.7, 3000 ÷ 127.4 = 23.6 frames a second           (T)
goodput to keep them busy: 38.7 × 2 148 203 B × 8 = 665 Mbit/s; 23.6 × … = 405 Mbit/s (D on T)
```

The carry assumes the phone's software AV1 and OpenJPH-WASM keep the cloud's ratio; neither the phone's AV1 decoder
(dav1d or another) nor its contention between three decoders was recorded, the phone's stream was G 8 against
Protocol C's G 1, and an Arm core's WASM SIMD (lowered to Neon) is not an x86 core's. The link-profiles row derived
the same band from the 1× ratios over three volumes (`claude/link-targets:docs/transport/link-profiles.md`: ~470–660
Mbit/s). It is an order of magnitude, not a number.

## 4. Bytes, and what they do to a fill and an ask

The view against the exact series (R, `docs/client/evidence/optimal-quality-bytes.md`): 0.0685–0.219 at Q 8, so HTJ2K
alone is 1 ÷ 0.219 = 4.6 to 1 ÷ 0.0685 = 14.6 times the view's bytes; at the noise rule's Q (derived there)
0.10–0.28, so 3.6–10×. The view plus a whole exact series is 1.10–1.28× the exact series: an option that fetches both
(arm C2) pays more than this one.

A `dbts_b1` fill, 50 frames, three decoders (D; goodput *G* from the link profiles, `claude/link-targets`, Ookla tile
means of 2026 Q3, which read capacity, not one session; the decode
floor 50 × 77.6–127.4 ÷ 3 = 1.3–2.1 s, T; the view's measured 2.25 s floor, R):

| link (goodput) | HTJ2K only: 859 Mbit ÷ *G* | the view: 185.7 Mbit ÷ *G*, floor 2.25 s | ratio |
| --- | --- | --- | --- |
| home Wi-Fi, measured (≥ 600) | 1.43 s wire, ≈ the 1.3–2.1 s decode | 2.25 s (decode) | ~0.6–0.9 |
| fixed, world median (218) | 3.9 s | 2.25 s | 1.7 |
| mobile, world median (103) | 8.3 s | 2.25 s | 3.7 |
| mobile, world 10th percentile (18) | 47.7 s | 10.3 s | 4.6 |

An ask for a frame not yet stored (D, at 103 Mbit/s, one round trip and the controller's start left out): HTJ2K
2 148 203 × 8 ÷ 103 × 10⁶ = 167 ms on the wire + 78–127 ms decode = 245–294 ms; the view 464 KB, 36 ms + 135 ms = 171
ms. So above ~600 Mbit/s this option is as fast or faster than the view and exact; at a median mobile link it is
~3.7× slower to fill and ~1.4–1.7× slower to an ask; a multi-GB study at 103 Mbit/s is ~78 s a GB (D).

Stored frames cost the same in both: the store holds decoded 16-bit samples, 17 MB a `dbts_b1` frame, and a stored
frame is never decoded again (the OPFS cache, decided).

## 5. Its best case (theory, on measured cloud levers)

* **A threaded decoder for an ask.** The lab's code-block pool at two threads: ×0.70–0.83 a frame from 1914×2572 up
  at 4×, in 10 of 10 rounds, +2.2–2.5 MB a worker (R, §Code-blocks on threads, measured); not shipped, the owner's.
  `dbts_b1` (2560 × 3328) is in that class: 78–127 ms → 55–106 ms if the factor held (T). During a fill the decoders
  already share the cores, so it is an ask's lever, not a fill's (R).
* **Stripes** (OpenHTJ2K, three idle decoder workers): ×0.60–0.68 of the reference at 4× on the three large series (R,
  §Region decode, measured); an ask's lever again, on a different decoder.
* **The resolution prefix.** Today's codestreams are RPCL, one tile; a level-1 picture is 25.8–29.0 % of a frame's
  bytes and ×0.27–0.31 of its decode, exact after a clamp (R, §A frame at the level the screen needs). `dbts_b1` at
  level 1 is 1280 × 1664, about a phone screen's height. "No low-resolution preview" is decided, so it is not proposed
  here; new-options §6.1 carries decode at the screen's size to MOBILE-DECODE-COMPARE, judged so far on bytes and
  waits over links, never on a phone's decode.
* **Decode paced to the wire** (`followQueue`, lab): the fill unchanged, the decoders' CPU ×0.85–0.98 and wake-ups
  ×0.18–0.47 (R, DECODEPACE). On a wire-bound fill, which is this option's normal case below ~400 Mbit/s, the CPU is
  idle most of the fill: the phone's heat and energy is the place it may beat a decode-bound AV1 fill (T, unmeasured).

## 6. Its disadvantages

* **Bytes, on every link below ~400–665 Mbit/s** (§4): the fill and the first picture wait on the wire; cellular data
  per study is 3.6–14.6× the view's.
* **The phone's decode is unknown**; the prediction rests on a ratio carried from a cloud host (§3).
* **A frame's first picture waits for its whole 2.15 MB** unless the prefix is used, which the decision above excludes.
* **The decoder is single-threaded as shipped**; the pool that helps the large frames lost a 512² cold ask at 4×
  (×1.078, R) and is not delivered.
* **The shipped build is behind upstream's security fix.** OpenJPH's tag 0.33.0 is commit `345a8bcd`, "Fixes
  CVE-2026-111151", which changes `src/core/codestream/ojph_codeblock.cpp` so that "the HT cleanup pass writes two
  rows per quad row, so the sample buffer must hold an even number of rows" (S4). The client decodes bytes it
  received, in WebAssembly, which "executes in a memory-safe, sandboxed environment preventing data corruption or
  security breaches" (S3, *Introduction*) of the page; inside the module's memory an overrun can still write samples,
  which the frame check would refuse (T). It applies to the exact frame today, whatever option is chosen. A bump is
  a pin change and a rebuild (`client/decode/wasm/build/README.md`), the owner's.

## 7. The comparison's columns

| column | HTJ2K only, software |
| --- | --- |
| decode time on a phone | **unknown**; 78–127 ms a `dbts_b1` frame predicted (T, §3); cloud 6.7–9.7 ns a sample (R) |
| bytes | the exact series: 4.6–14.6× the view at Q 8, 3.6–10× at the rule's Q (R, D) |
| precision on screen | the stored depth, bit for bit (10 and 12 bits here; DICOM to 38) |
| checked | yes: XXH3-64 over the samples, today's exact-frame digest |
| window/level and tools | all, as today's exact frame: on the samples |
| ships today | yes: the *Lossless* path, every engine with WebAssembly SIMD (Chrome 91+, Safari 16.4+, S5, S6) |

## 8. What a phone cell must measure

1. **Hp on the phone** for `dbts_a1`, `dbts_b1`, `dbts_c1`, frames in memory, one to four decoders (the next round's
   cell 1, `claude/phone-protocol:docs/phone-rows/next-round.md`): it replaces §3's prediction and finds where the
   phone saturates.
2. **Arm B's fill** (HTJ2K alone) on the home Wi-Fi link, every frame checked: the only link where §4 predicts a tie
   with the view.
3. **The pool at two threads**, a cold and a warm ask on `dbts_b1`, against the single-threaded build: whether §5's
   factor holds on a phone's big and little cores.

## 9. Sources

Fetched 2026-11-15. Section numbers are the documents' own.

* **S1** DICOM PS3.5 2026d, §8.2.14 *High-Throughput JPEG 2000 Image Compression* and Table 8.2.14-1, §10.18
  *Transfer Syntaxes for High-Throughput JPEG 2000 Compression* and §10.18.1 *HTJ2K Lossless RPCL*:
  <https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_8.2.14.html>,
  <https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_10.18.html> (read as *current*, which named
  itself 2026d).
* **S2** Recommendation ITU-T T.814 (06/19), *High-throughput JPEG 2000*, <https://www.itu.int/rec/T-REC-T.814/en>
  (the page read; the standard's text was not, so nothing here quotes it).
* **S3** WebAssembly Core Specification, "version 3.0 (2026-11-04)", <https://webassembly.github.io/spec/core/>:
  *Introduction* (`intro/introduction.html`), *Execution › Numerics* (`exec/numerics.html`: the opening paragraph,
  `iadd`, *Relaxed Operations*); the `WebAssembly/spec` repository's head was `943c5df07e84` when read.
* **S4** OpenJPH, `aous72/OpenJPH`: at `c68064d0e4ca` (tag 0.31.0, the shipped pin) `CMakeLists.txt` lines 77–98,
  `docs/status.md`, `src/core/transform/ojph_transform_wasm.cpp:324`; commit `345a8bcd1c7a` (tag 0.33.0), "Fixes
  CVE-2026-111151"; head `97a9579aed20`.
* **S5** Chrome Platform Status, *WebAssembly SIMD*, feature 6533147810332672, read through
  <https://chromestatus.com/api/v0/features/6533147810332672>.
* **S6** WebKit, *WebKit Features in Safari 16.4*, <https://webkit.org/blog/13966/webkit-features-in-safari-16-4/>,
  §JavaScript and WebAssembly.
* **S7** D. Taubman et al., *High Throughput JPEG 2000 (HTJ2K): Algorithm, Performance and Potential*, "Last updated:
  29 May 2020", §7, Table 9: <https://htj2k.com/wp-content/uploads/white-paper.pdf> (as quoted in
  [`new-options.md`](new-options.md) S8; not re-fetched).
