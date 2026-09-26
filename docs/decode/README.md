# Decode — codestream to pixels

`disk-access/` owns how a frame is brought in and `transport/` how it is sent. This owns what
happens after it arrives: turning a codestream into samples, what that costs, and where those
samples live. How to run each bench is in its own directory, `lab/decode-bench/README.md` first;
this file holds the numbers and the reasons. Every millisecond here is container-measured unless it
says otherwise — §What these numbers are not.

## The decoder

OpenJPH, through the `@cornerstonejs/codec-openjph` WASM build (wrapper MIT, OpenJPH BSD-2-Clause).
`lab/decode-bench/fetch_decoder.sh` pulls a pinned version from npm and records the tarball's
checksum; nothing is committed, so provenance is the checksum rather than trust in bytes in this
repo. Its WASM reports `OpenJPH Ver 0.31.0.` and SIMD level 1, which OpenJPH returns only from its
WASM SIMD build, so SIMD is already on and is not a lever. The product loads this package.

It is a **decoder only**. `lab/scripts/gen_htj2k_fixtures.sh` builds OpenJPH 0.31.0 from source for
`ojph_compress` and encodes synthetic images, so a fixture can be made anywhere from nothing. The
profile is part 15, reversible 5/3, 5 levels, 64×64 code-blocks, RPCL, one layer, one tile per
frame.

**A host with no native C++ toolchain can still generate them.** `ojph_compress` builds under
emscripten, and Node runs it against the real filesystem:

```bash
emcmake cmake -S lab/.openjph-build/src -B /tmp/ojphapp -DCMAKE_BUILD_TYPE=Release \
  -DOJPH_ENABLE_TIFF_SUPPORT=OFF -DCMAKE_EXE_LINKER_FLAGS="-sNODERAWFS=1 -sENVIRONMENT=node -sEXIT_RUNTIME=1"
cmake --build /tmp/ojphapp -j"$(nproc)" --target ojph_compress
# then a one-line `exec node .../ojph_compress.js "$@"` shim at
# lab/.openjph-build/install/bin/ojph_compress, which the generator picks up instead of building
```

It encodes the same bytes: the codestreams differ only in the two version digits of the `OpenJPH
Ver` comment marker, and the ground-truth checksum — taken from the encoder's *input* — is identical
either way. Because the profile is reversible a decode must reproduce that input exactly, and every
bench here checks against it (§Ground truth).

## Content

The first fixture sets were all the generator's `field` mode — a gradient with ellipses and grain —
which compresses **1.28:1** greyscale and **1.84:1** colour. Real cine runs ~16:1 and CT ~2:1, so
those sets carry several times a real frame's coded data and weight every decode number toward block
decoding. Two modes were added (F2, `lab/scripts/gen_frame_pnm.py`), each tuned to its modality's
ratio and byte-exact on both decoders against the encoder's input:

| set | content | ratio |
| --- | --- | ---: |
| `cine512` | a dark sector of correlated Rayleigh speckle, grey but for a ~1 % Doppler patch | **18.2:1** |
| `ct512` | 12-bit-in-16 signed, a textured body on an air background | **1.99:1** |
| `c512`, `g512` | `field` | 1.84:1, 1.28:1 |

* **Per-frame decode falls 44 % on colour** — `cine512` 3.91 ms against `c512` 6.98 ms, the same 768
  KB decoded. `field` colour overstates decode cost by nearly a factor of two.
* **The copy-out's share rises, 6.2 % → 7.8 %** (0.420 ms of 6.821 on `c512`, 0.326 of 4.175 on
  `cine512`): the copy scales with the decoded frame, which is the same size in both.
* **Greyscale at a similar ratio does not move**: `ct512` 3.00 ms against `s12` 3.06 ms, both near
  2:1. The lever is the ratio, not the modality.

## Ground truth

A bench that checks each arm against pixels it decoded itself cannot fail: flipping one byte of
every decoded frame **did not fail that check**, because the corruption reached the oracle and the
arm alike. Every bench here checks against the `.sha256` the generator wrote from the encoder's
input. Four mutants — a flipped byte, a truncated buffer, a skipped `decode()`, a corrupted view in
the copy bench — each report 87/87 frames differing and exit non-zero; the control is clean.

`lab/decode-bench/parity.mjs` compares a build against the package byte for byte **and** against the
encoder's input, plus every getter. A getter returning a wrong constant was caught at once. **A
clamp set one count low was not**, because no organic fixture contains a sample at its ceiling.
`sat256`, a full-range ramp reaching exactly 0 and 65535, was added for that; against it the mutant
fails 87/87. A test that cannot fail is worth reporting as loudly as one that does.

### Signed

Signed 16-bit is ordinary CT data. The encoder's own `-signed true` path saturates negatives before
coding, so nothing it produces is ground truth. The fixture is made the other way round: encoded
unsigned, then the sign bit of each component's `Ssiz` set in SIZ (`lab/scripts/sign_htj2k.py`).
JPEG 2000 level-shifts an unsigned component by 2^(B−1) and a signed one not at all, so the same
coded bits read as signed must decode to `v − 2^(B−1)`. An **independent** decoder confirms it:
OpenJPEG 2.5's `opj_decompress` gives exactly `v − 32768` on a flipped 16-bit frame and `v − 2048`
on a flipped 12-bit one (12-bit two's complement in 16-bit containers; sign-extended, the same
samples), and `ojph_expand` agrees on both. The `.sha256` beside each signed frame is of the
sign-extended little-endian int16 samples, computed from the encoder's input. Sets: `s512` (16-bit)
and `s12` (12-bit in 16).

**The package decodes both signed sets byte for byte and already sign-extends 12-bit samples** —
`getFrameInfo()` reports `bitsPerSample: 12, isSigned: true` and the samples come back −1500 … 952.
So `finish`'s sign extension in `client/downloader/decoder.js` is idempotent on this decoder's
output. The source build was wrong (§A build of our own).

*Corrected:* an earlier record said the package saturates negatives to 32767 and the source build
does not. That was read off codestreams the encoder's `-signed true` path had already damaged; with
a valid signed codestream and an independent truth it was the other way round, and now neither is
wrong. Two mutants: the unfixed build (passes every unsigned set, fails both signed ones), and a
level shift off by one in `sign_htj2k.py`, which fails *bytes vs encoder* while *bytes vs package*
stays identical — the two columns fail independently, which is the point of having both.

## Heap

Heap here is `HEAPU8.length`, the module's whole linear memory. **Every package instance is 50.0 MB,
at every frame size from 50 KB to 8 MB and every pool size from 1 to 4, before it has decoded
anything** — 24 cells, all exactly 50.0 MB per instance in every round
(`lab/scripts/gen_htj2k_fixtures.sh g160 g256 g512 c512 g1024 g2048`, 87 frames each).

**The reason is a build flag.** The shipped `openjphjs.wasm` declares `initial = 800 pages = 50 MB`,
`maximum = 2048 MB`, not shared. Decoding an 8 MB frame does not reach 50 MB, so the memory never
grows. *Corrected:* this file once said an instance climbs to its high-water mark and holds it; this
build does not climb, it is preallocated, so the cost is a flag that can be changed.

**Counted, not resident.** In a browser a package decoder counts ~51 MB of JS heap
(`measureUserAgentSpecificMemory`) but adds only ~4–5 MB to the renderer's PSS: the heap is reserved
and a 512² frame touches little of it ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Resources). Which
of the two a phone kills a tab by is not measured.

### What decoding actually demands

The same OpenJPH release built here (`lab/decode-bench/wasm/build.sh`) with growth on, identical but
for `INITIAL_MEMORY`; high-water after 87 frames, fresh process per row, every frame verified. From
a 2 MB floor: 3.56, 3.63, 4.25 and 5.44 MB for 50 KB, 128 KB, 512 KB and 768 KB frames. From a 4 MB
floor: 4.00 (not reached) up to 512 KB, then 5.81, 8.00 and **24.56 MB** for 768 KB, 2 MB and 8 MB.
About **3.5 MB of base plus rather less than 3× the decoded frame**. Growth is geometric, so each
figure is an upper bound on the demand. The package's 50 MB is 2× to 14× what the work needs:
**per-instance heap is set by whoever links the module, and that is the pool-sizing lever.**

## A build of our own

`lab/decode-bench/wasm/` builds a decoder from OpenJPH source with the package's surface, so one can
stand in for the other; `parity.mjs` is what makes that checkable. **Every frame of every fixture
goes through one decoder object**, as `client/downloader/decoder.js` holds it — until 2026-09-20 the
benches built a fresh decoder per frame, so state carried from one frame to the next was never
exercised. `parity.mjs` prints a coverage line when fewer than two sample shapes ran, and says so
when no signed set is among them.

**Parity on the adopted wrapper: six sets, 522 frames** — 8-bit unsigned ×3 (`c512`, `cine512`),
16-bit unsigned (`g512`, `sat256`), 16-bit signed (`s512`), 12-bit signed (`ct512`) — byte-identical
to the package, to the encoder's input, and on every getter, through one decoder object. Both report
`getVersion() = 0.31.0`.

*Corrected:* the first parity claim (609 frames) covered unsigned data only, and **on signed data
the build was wrong** — its wrapper clamped every component to `[0, 2^B − 1]` regardless of the sign
flag, so negatives saturated to 0. Fixed in `htj2k_decoder.cpp` (`[−2^(B−1), 2^(B−1) − 1]` when
signed). And `getSIMDLevel() = 1` on the source build is the wrapper's own `-msimd128`, not the
library's, so parity on that getter is a tautology rather than evidence the library's SIMD is on.

### The wrapper's two passes

Two things between `pull()` and the caller's buffer, both in `htj2k_decoder.cpp`:

* **D11** — `readHeader()` destroyed the `ojph::codestream` and placement-new'd a fresh one every
  frame. `restart()` is the library's own API for this.
* **D10** — `decode()` zero-filled the whole output and then wrote every byte again, in a loop that
  branched on sample width *inside* the per-pixel loop, which stops `-msimd128` taking it.

Four arms, one binary each, interleaved with the order rotated, 12 timed rounds of 87 frames, one
decoder object reused. ms per frame, and rounds of 12 better than `base`:

| set | components | base | +D11 | +D10 | both |
| --- | --- | ---: | ---: | ---: | ---: |
| `g512` 512 KB grey | 1 | 3.438 | 3.428 −0.3 % (10/12) | 3.182 −7.4 % (11/12) | **3.244 −5.6 % (12/12)** |
| `s512` 512 KB signed | 1 | 3.438 | 3.420 −0.5 % (11/12) | 3.194 −7.1 % (11/12) | 3.248 −5.5 % (12/12) |
| `ct512` 512 KB signed, 2:1 | 1 | 2.651 | 2.649 −0.1 % (6/12) | 2.432 −8.3 % (12/12) | **2.447 −7.7 % (12/12)** |
| `c512` 768 KB colour | 3 | 8.447 | 8.292 −1.8 % (9/12) | 8.186 −3.1 % (10/12) | 8.163 −3.4 % (9/12) |
| `cine512` 768 KB colour, 18:1 | 3 | 4.496 | 4.473 −0.5 % (8/12) | 4.538 +0.9 % (2/12) | 4.515 +0.4 % (3/12) |

**D10 is a single-component win and a three-component wash.** One component is written contiguously,
which `-msimd128` can take: 5.5–8.3 % off, 12/12 on all three greyscale sets, and on `g512`
non-overlapping ranges. Three components are written strided, and the two colour sets disagree in
sign; **believe `cine512`**, whose ranges are ±0.05 ms against `c512`'s ±0.28 for the same 768 KB of
output. Why colour does not collect the dropped zero-fill is not established.

**D11 is a tie on the clock** — under 2 %, ranges overlapping, right-direction on 43 of 60 rounds —
adopted because one documented library call replaces a destructor plus a placement-new. Its heap
effect is in §Where to put the floor.

**Where this host saturates.** One thread decodes and the box ran other work throughout, so only
differences across arms inside a run are claimed; the absolute ms are not comparable with any other
table here.

**Mutants**, `parity.mjs` over c512 → g512 → s512 → sat256. Caught: the interleave stride `comps −
1` (c512 87/87); the contiguous loop one sample short (87/87 on each one-component set — this is
what licenses dropping the zero-fill, since a byte nobody writes keeps the previous frame's value);
`bitsPerSample` kept stale across a shape change, but only because a colour set runs first — on
`g512` alone it passes, hence the coverage line. **Not caught: `restart()` removed entirely** — 348
frames byte-identical. Bytes are not what `restart()` protects; parity cannot gate D11.

### Where to put the floor

Six initial heaps — 2, 4, 8, 16, 32, 50 MB — interleaved and rotated, a fresh decoder per frame
(`wasm/heap_curve.sh`). **The floor costs no time**: every arm within 2.2 % of the best at both
sizes, ranges overlapping (g512 5.09–5.21 ms, g2048 85.0–86.9 ms). On `g512` the high-water is 4.3
MB from 2, **4.0 MB from 4**, and the floor itself above that. On `g2048` every floor up to 16 MB
converges on 24.6 MB, so **start at 4 MB and let it grow** — 2× less than the package.

**A reused decoder costs more than the per-frame one, and the product reuses one.** On the adopted
wrapper, one decoder object, each set from a cold module:

| initial | `g512` 512 KB grey | `c512` 768 KB colour |
| --- | --- | --- |
| 2 MB | 5.1 MB | **6.6 MB** |
| 4 MB | **4.8 MB** | 7.0 MB |
| 6 MB | 6.0 MB | 7.3 MB |
| 8 MB | 8.0 MB | 8.0 MB |

Time is again a tie (within 2.1 %). **The floor is 4 MB: a reused 512×512 greyscale decoder costs
4.8 MB, 10× less than the package's 50 MB.** *Corrected:* the headline was once 4.0 MB and 12.5×,
read off the per-frame ladder. 2 MB ends 0.3 MB heavier on grey because it gives back in a larger
growth step what it saves at load; colour prefers 2 MB by 0.4 MB, the smaller effect. The floor is a
link-time parameter: `EMSDK=… INITIAL_MB=2 lab/decode-bench/wasm/build.sh`.

**The 4.8 MB is the wrapper's, not one arm's.** Re-read on the merged binary with three arms in one
process — `base` (destroy and placement-new every frame), `d11` (`restart()` alone), `merged`
(adopted) — at `INITIAL_MB=4`, 6 repeats × 6 rounds: **4.8 MB grey and 7.0 MB colour on all three,
36 readings without spread.** *Corrected:* the reason once given — that the codestream's arena lifts
a reused decoder off the floor — is wrong, since the arm that discards the arena every frame reads
the same. What reuse keeps is the decoder object's other buffers.

**The arena shows when the frame size grows.** One decoder, `g512` then `c512`, 6/6: **7.7 MB with
`restart()`** (`d11` and `merged` alike) against **5.8 MB for `base`**, because the grey arena is
still held when the colour frame allocates. The other order reads 7.0 MB on all three. So a decoder
reused across shapes is budgeted at **7.7 MB**, and every heap figure here is a peak, which is
order-dependent whenever sizes differ.

**Behind the downloader** (three decoders, `?decoder=source` on the campaign page, 3 rounds
interleaved): the decode arm is **161.4 MB on the package and 16.3 MB on the 4 MB build**, with fill
(80.0 ms) and cold ask (86.0 ms) identical to the tenth of a millisecond.

The 4 MB floor holds **only while the pixels leave the heap** — §Retention, measured. Neither ladder
can see a growth inside frame 0; a floor chosen for first-frame latency is a separate measurement,
not taken.

### What adopting it costs

The build is smaller — 299,838 bytes of `.wasm` + `.js` against the package's 358,022 (329,366 for
the shared variant). The cost is ownership:

* A pinned emscripten (3.1.74) and a pinned OpenJPH tag become build inputs, and CI would have to
  build WASM. **The emscripten pin holds about 15 % of decode time** (§Faster).
* Security and correctness fixes to OpenJPH become ours to track, where the package's author does
  that now.
* `parity.mjs` is the mitigation and should run in CI against the published package.

**Worth it if per-instance heap is the binding constraint, which on a phone it is expected to be** —
10× is not a margin a smaller change recovers. On any other ground it is the same decoder, for
slightly fewer bytes. How much of D10's pass the package's own build still pays is not measured. How
many decoders a page runs is [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Resources; what each one
costs is this section.

### The build, as delivered

`~/.cache/wt-pacs-decoder-2026-09-20/` on the workstation is the adopted wrapper built for a
consumer to take: `openjphjs.js`, `openjphjs.wasm`, OpenJPH's `LICENSE`, and a `SOURCE.txt`
repeating this.

```
6a9abcc85363adb0864f4d1afed8dc899640a2f51e8945432d25d2069ecf6900  openjphjs.js    55,158 B
19d11a7564ab48112159c1bf8c806fe85ac8df2c9b4f6d78fad11083369ca796  openjphjs.wasm 245,456 B
```

Commit `a28587f`, emscripten 3.1.74, `-O3 -msimd128 -fexceptions`, `INITIAL_MEMORY=4MB`, built by
`EMSDK=… INITIAL_MB=4 ARMS=deliver lab/decode-bench/wasm/build.sh`. The `.wasm` is byte-identical to
the `plain` build of the 522-frame parity run; the glue differs only in the filename it loads. It
exports `OpenJPHModule` where the package exports `Module`, which `decoder.js` handles. **It
predates §The range in the pack**; that win reaches a page only once this is rebuilt from the
current wrapper, and the delivered build is the workstation's.

## A second decoder

"OpenJPH is fast enough" rested on nothing until it was benched against **OpenHTJ2K**, the other
open implementation with WASM SIMD paths for the block coder, the wavelet and the colour transform.
Licence first, because it is a gate: BSD 3-Clause, its bundled `highway` Apache-2.0 — both
permissive. Pinned at **v0.9.1**, `8cf42e90e6f54a51c8247587437c12f96eb131ec`;
`lab/decode-bench/wasm/build_openhtj2k.sh` fetches it (never vendored) and links
`openhtj2k_decoder.cpp` at the same flags, single-threaded, 4 MB, with the same class surface and
`pack<T>()`, so `build_arms.mjs` and `parity.mjs` drive both with no branch. It decodes through
`invoke_line_based_stream()`, the per-row analogue of `pull()`. **It exposes no header surface**
beyond components, sizes, depth, signedness and DWT levels, so the wrapper reads SIZ and COD itself —
~40 lines this project would own. `parity.mjs`'s version check is informational for that reason.

### A second decoder, measured

**Bit-exact:** six sets, 522 frames, byte-identical to the package and to the encoder's input, and
identical on every getter including those read from the markers.

Both through one reused wrapper object, interleaved with the order rotated, 20 timed rounds, 87
frames per set, in two runs led by either decoder: `c512` OpenJPH 8.076 / 8.000 ms against OpenHTJ2K
9.433 / 9.338 (**+16.8 %, +16.7 %**), `g512` 3.212 / 3.159 against 4.728 / 4.703 (**+47.2 %,
+48.9 %**). **40 of 40 rounds to OpenJPH**, every pair of ranges disjoint. From a cold module the first three
frames tier up over the same two frames on both, and OpenHTJ2K's first is 5.1–7.4 ms dearer.

**Heap after 100 frames favours OpenHTJ2K**: 4.8 MB colour / 4.0 MB grey against 7.0 / 4.8. That is
the two libraries' working sets, not `restart()` (§Where to put the floor). `.wasm` is 285,058 B
against 245,447 B.

**One decoder object per codestream is required there.** Re-`init()`ing one `openhtj2k_decoder` —
the shape `decoder.js` holds — **leaks a codestream per frame** (44–52.8 MB after 100 frames, 1.62
GB after two sets' rounds): `j2c_src_memory::alloc_memory()` does not free the previous buffer and
`openhtj2k_decoder_impl::destroy()` is empty. The reused build decoded the same bytes no faster.

**Mutants**, all caught: the interleave stride one short (348 differences, colour only), signed
negatives clamped to 0 (348, signed only), the COD transform byte read backwards (6 surface
differences, pixels untouched).

**Not adopted.** Exact on this content, but **15–17 % slower on colour and 33–49 % on grey**, 39 KB
more `.wasm`, a header surface to supply, and a second codebase to track; 2.2 MB lighter on colour,
where the floor already gets 10×. The decoder in use is the faster of the two open ones on both
shapes. Only 512² was benched; one thread decodes on a box carrying other work, so only the
within-run differences are claimed.

## Faster

**No build lever makes the decoder faster; a newer emscripten makes it slower.** Every arm passed
`parity.mjs` before it was timed; interleaved, order rotated. *Scope, corrected:* this answers what
the *build* can do. What the wrapper source does between `pull()` and the caller's buffer is where
time was found — §The wrapper's two passes.

| against the 3.1.74 build | 512 KB | 768 KB | 8 MB |
| --- | ---: | ---: | ---: |
| emscripten 6.0.9, `-O3` | **+15.6 %** (0/8 rounds faster) | +6.5 % (1/6) | **+16.0 %** (0/6) |
| emscripten 6.0.9, `-O3 -flto` | −1.2 % (7/8) | +2.2 % (3/6) | −1.6 % (4/6) |

* **A newer emscripten costs 6.5–16 %**, 0 of 8 and 0 of 6 rounds faster where it is largest. **LTO
  recovers that and stops there**: three ties against 3.1.74. So the pin in `wasm/build.sh` holds
  about 15 % of decode time, and moving it is a performance decision.
* **A decoder object reused vs created per frame: tie** (−1.6 % 8/8 at 512 KB, a wash elsewhere).
  Reuse stays the product's shape; what it costs is memory (§Where to put the floor).
* **`wasm-opt -O4`: tie** (+0.1 %, 275 B larger) — emcc already runs it at `-O3`. Use the emsdk's
  own `wasm-opt`: binaryen 117 cannot validate 6.0.9's output, and `--all-features` yields a binary
  Node will not instantiate.
* **A newer OpenJPH: none exists**; 0.31.0 is the newest tag.
* **Worth taking, and it is not time: LTO makes the binary 16 % smaller** (200 KB against 239 KB),
  heap identical.

*A baseline of your own making:* LTO first measured −17.8 % against a `plain` build the lane had
rebuilt with the newer, slower toolchain. Record which emscripten a rebuild used and compare against
the pinned one. The 768 KB colour fixture is the noisy one here as elsewhere and settles nothing on
its own. Build arms other than `plain`/`shared` take `EXTRA_FLAGS` (`ARMS=lto EXTRA_FLAGS="-flto"
lab/decode-bench/wasm/build.sh`); a from-source build against the package, and relaxed SIMD, are in
§The decode tail.

## The copy, measured

`getDecodedBuffer()` returns a view into the module's heap, so copying out is `.slice()` and not
copying out is handing the view on. Interleaved, order rotated, 8 timed rounds
(`lab/decode-bench/copy_cost.mjs`), the copy slower in 8/8 at every size but the noisy 768 KB colour
one (6/8, left out): **0.071, 0.114, 0.272, 0.599 and 3.018 ms at 50 KB, 128 KB, 512 KB, 2 MB and 8
MB — 17, 12, 7, 4 and 5 % of the decode.** A fixed per-call cost of ~0.05 ms dominates below ~512 KB
(164× the frame buys 42× the cost); past that the copy is close to linear and a **shrinking share of
the decode** as frames grow. On realistic content the share is larger (§Content). Whether to copy
out is decided by memory, not by this: §Retention, measured.

## Shared memory

The same source and toolchain, two builds differing only in `-pthread` (the shared heap asserted at
runtime), both bit-exact, 8 timed rounds interleaved, 50 KB to 8 MB (plain → shared: 0.45 → 0.42,
3.73 → 3.66 at 512 KB, 62.59 → 61.83 ms at 8 MB). **No shared-memory tax is detectable at any
size**: the shared arm is slower in at most 2 of 8 rounds anywhere, and ranges overlap, so the
reading is *no tax detectable*, not *sharing is faster*. Heap identical.

*Corrected:* this file once carried a finding from elsewhere that the tax and the copy saved
cancelled exactly. It did not reproduce here; that is one arm of a two-arm claim, so a failure to
reproduce rather than a refutation, and it should not be quoted in either direction.

## Threads

One multithreaded instance at N threads against N single-threaded ones **cannot be asked of OpenJPH
0.31.0** without writing the threading: `src/core/` contains no thread, mutex or atomic, so one
frame's decode is serial by construction; the only threading is a frame-level pool in the
`ojph_stream_expand` app, which upstream's CMake excludes under emscripten. Where parallelism inside
one frame could go, and what it would buy, is §The decode tail on a slow CPU (b).

## Dispatch

The belief tested: first-free dispatch matters when decode times are uneven and is a wash when they
are even. `lab/decode-bench/dispatch.mjs` runs a pool of real decoders, one per worker thread, every
frame checked. Three policies: **round-robin** (frame *k* to worker *k* mod width, no coordination);
**first-free** (the next frame to whichever worker just reported free, one main-thread hop per
frame); **first-free+1** (the same, keeping each worker one frame ahead so it never idles on that
hop). All start with every frame available, as a fill has them; the split comes from the median
round so it sums.

Width 3; ms per frame (wait + decode + take), batch ms, and rounds of 12 slower than round-robin:

| queue | frames | round-robin | first-free | first-free+1 |
| --- | --- | --- | --- | --- |
| 16 per worker | uniform | 94.38, 138 | 98.20, 157 (8/12) | 90.32, 137 (5/12) |
| 16 per worker | mixed | 305.02, 524 | 351.86, 576 (11/12) | 327.38, 528 (8/12) |
| 3 per worker | mixed | 125.34, 276 | 140.29, 255 (9/12) | **123.84, 221** (4/12) |

* **Uniform frames are a wash**, and so are **uneven frames on a long queue**: at 16 per worker a
  static assignment's luck averages out, and round-robin ties first-free+1 (524 against 528 ms).
* **The win is on a short queue, and it is makespan, not latency**: at three per worker first-free+1
  finishes the batch 20 % sooner (221 against 276); its mean per-frame latency is not better (4/12).
* **Plain first-free is worse than round-robin nearly everywhere** (8/12, 9/12, 11/12): it pays a
  hop per frame. What matters is never leaving a decoder idle; the lookahead carries the result.

**So the downloader dispatches with lookahead, not plain first-free**: each decoder holds up to
`perDecoder` (2) frames and the next goes to the one with fewest (`client/downloader/downloader.js`,
`nextDecoder`). What decides whether dispatch matters is **frames per decoder**, and a viewer
scrubbing a few frames at a time is the case where it does.

**Where this host saturates.** Four cores; widths 2 and 3 agree and are quoted, width 4 moved the
answer and nothing is claimed at or above it. **A trap:** a mixed workload built as a repeating
cycle of three sizes over three workers gives each worker one size and reverses the result; the
sizes are a seeded shuffle.

## Retained-frame residency

Every bench above releases each frame, so each prices a decoder. A viewer keeps what it decoded, and
that was expected to flip the copy comparison: copying out holds the decoder heaps *plus* every
retained buffer, keeping the pixels in the heap holds the heaps alone.

### Retention, measured

**It does not flip. Copying out is smaller in all three series, on both builds, at every pool
size.** `lab/decode-bench/retained/` holds every frame of a series to the end and weighs three
places to keep it, in headless Chromium, with `performance.measureUserAgentSpecificMemory()` — the
one instrument that counts a WASM heap, an `ArrayBuffer` and a `SharedArrayBuffer` on one scale.
Validated first: 256 MB allocated in a worker reads +256 MB for each kind and −256 MB when dropped.
Pass `--enable-blink-features=ForceEagerMeasureMemory` or each call waits 10–16 s.

Total renderer memory at the end of the series, one instance, MB:

| series | pixels held | copy out, 4 MB build | copy out, package | keep in heap, package | keep in heap, 4 MB build |
| --- | ---: | ---: | ---: | ---: | ---: |
| 87 × 768 KB | 65.2 | **108.4** | 152.7 | 161.9 | 517.4 |
| 237 × 512 KB | 118.5 | **217.1** | 263.2 | 310.0 | 1080.7 |
| 64 × 8 MB | 512.0 | **938.7** | 964.2 | 1329.8 | 2042.4 |

Keeping costs 1.42–1.49× the best arrangement on the package and **2.18–4.78× on the 4 MB build**.
Every retained frame checked against the generator's `.sha256`: 0 mismatches in 120 cells.

**Why keeping loses, and it is not the pixels.** A retained decoder holds its `encoded_` vector as
well as `decoded_`, so keeping also keeps every codestream (35.5, 92.8 and 400.4 MB per series), and
**WASM memory never shrinks**, so every transient allocation along the way is kept too. Against what
the retained decoders hold (100.7, 211.3 and 912.4 MB), the package's heaps are 1.02–1.99× and the 4
MB build's **4.58–5.10×** on the 512² series (1.74–1.89× at 2048²): a build that starts at 4 MB
grows by two orders of magnitude and carries every step.

**The floor stands for a viewer that copies out, and only then.** In the copy-out arms the heap
holds only transients — 4.0 MB on the 512×512 series, 24.6 MB on the 2048×2048 one, reproducing
§Where to put the floor. **The 4 MB floor is right if and only if the pixels leave the heap.**

* **Pool size costs each instance its floor**: copying out, each extra instance adds **+50.9 MB on
  the package in every series**, against +6.6, +4.8 and +25.3 MB on the 4 MB build.
* **A `SharedArrayBuffer` destination costs nothing**: within 0.1 MB of a plain one in all 72 cells.
* **Reusing one decoder object costs 1.2, 0.8 and 12.5 MB** per instance over one per frame — one
  live `decoded_` plus `encoded_` — never large.

**The mutant.** Keeping a frame the next decode overwrote looks like a win in memory.
`mutate=heap-reused` makes the kept arrangement reuse one decoder: **`MISMATCH ×86` of 87**, memory
collapsing from 476 MB to 3.0 MB, copy-out arms clean. The ground-truth check is what stands between
this table and a fiction.

**What this is not.** Headless Chromium 141, 4 vCPU, synthetic fixtures; memory, not time. This
instrument counts heap, which for an untouched floor is more than is resident (§Heap). Nothing on a
phone. *Corrected:* an 86 MB retained figure this file once carried was never reproduced and is not
quoted.

## What a decoder worker costs, resident

A dedicated worker is a thread in the page's renderer, so its cost is a **slope in the worker
count**: the same page decodes the same series at `decoders=1` and `decoders=3`, and the answer is
`(RSS₃ − RSS₁) / 2`. `lab/decoder-memory/`, 87 × 512×512 × 16-bit, the wrapper as delivered,
interleaved with arm and count order rotated, a fresh context per run, every frame checked. Chrome
148, peak from `VmHWM`, settled after `measureUserAgentSpecificMemory()` with the workers alive.

**A decoder worker costs 5.9 MB [5.2–7.0] resident, of which 5.7 MB is its own JS+WASM heap**
(`client/downloader/decoder.js` as shipped, two frames in flight; n = 6, median [range]).

* **Per worker, not per frame in flight**: one frame in flight per worker reads 6.1 [5.6–6.6].
* **Reuse costs 0.81 MB of it**: a decoder object per frame reads 5.6 [5.3–5.7], its WASM heap 4 096
  KiB against 4 928 — the 4.0 against 4.8 §Where to put the floor predicted. It **does not
  accumulate**: the same after 87 frames or 29.
* **A private compiled module costs 0.3 MB**: one `WebAssembly.Module` compiled for all three reads
  5.6 [5.1–6.2], inside the ranges; the engine very likely already shares one compile per
  wire-bytes.
* **Most of the heap is mapped, not resident**: a worker adds only ~2.6 MB before its first decode.

**Calibrated first:** with `ballast=32` every worker touches 32 MB and the slope reads **38.3 MB
[38.3–38.3]**. The calibration caught the harness terminating its workers before the settled
reading, which had made every arm read 2 MB. **The whole client, ablated the same way**
(`path=downloader`, a real session against `exact-server`, the page keeping every frame, n = 4):
**6.1 MB [6.0–6.1] per decoder worker**.

**So a decoder worker of ours does not cost tens of MB**, and neither mechanism that could have made
it so — reuse (0.81 MB) or a private compile (0.3 MB) — is worth taking. Desktop Chrome on a shared
box, one series shape, memory not time, nothing on a phone.

### The wire buffer ring

The large term on the same page is **not** a worker: it is the **per-frame wire buffer** — a fresh
`Uint8Array` copied out of the transport per frame, transferred to a decoder and dead on the other
side, charged in *both* isolates because neither collects during a fill. A private viewer rig sized
it at up to **~130 MB** of renderer peak on a 237-frame 16-bit fill, and a forced collection removed
all of it.

**The ring.** The **transport session** — the only place that knows a frame's length before its
bytes land — keeps a free list of the buffers it has handed out. `connect(url, hash, { wireBuffers:
N })` sizes it; the downloader passes `decoders × perDecoder + 2`, the frames that can be between
the wire and a decoder. A frame is read into a pooled buffer and is a `Uint8Array` **view** of its
own length over it. The decoder transfers `bytes.buffer` back in its `done` or `failed` reply and
the downloader hands it to `session.releaseWireBuffer`. A released buffer is kept only while the
list is under `N`; one smaller than the frame being read is dropped rather than grown.
**`wireBuffers` unset or 0 never retains** — every consumer that does not hand buffers back. A
`decode: false` frame goes to the page and never returns. **The reader is never paused when the list
is empty**; a fresh buffer is allocated, so no consumer that keeps a buffer can deadlock it.

`lab/decoder-memory/` with `path=downloader&hold=1 --wire 0,8`, D=3, the size rotated every round;
peak is `VmHWM`, paired inside each round, MB, median [range]:

| series | peak, one buffer per frame | peak, a ring of 8 | paired | lower in | fill + decode wall | n |
| --- | ---: | ---: | ---: | :-: | --- | :-: |
| 87 × 512² 16-bit | 275.7 [274.1–276.2] | **256.3 [253.9–260.2]** | **−19.2 [−20.9…−16.0]** | 8/8 | 420 [391–463] → 409 [400–471] ms | 8 |
| 87 × 512² colour | 304.7 [304.2–305.3] | **293.9 [292.0–295.7]** | **−10.8 [−12.7…−8.5]** | 8/8 | 678 [650–701] → 653 [630–771] ms | 8 |
| 30 × 512² 16-bit | 195.5 [194.8–196.2] | **192.3 [192.0–192.6]** | **−3.2 [−3.9…−2.5]** | 6/6 | 221 [208–229] → 217 [199–224] ms | 6 |

* **What it costs is a constant; what it saves is the series.** +3.1 MB of counted worker memory at
  30 and at 87 frames, against a peak that falls 3.2, 19.2 and 10.8 MB; settled RSS rises +1.9 to
  +7.7 MB. On a device it is the peak a tab is killed for.
* **The clock does not move** (the ring lower in 4/8, 6/8, 4/6).
* **Pixels**: 0 mismatches in 44 cells. `client/conformance/ring.ts` holds the mechanism against
  **both** session implementations; six mutants, each caught.

**The size stays `decoders × perDecoder + 2`.** 2, 8 and 16 on both shapes, n = 5: **peak does not
move with the size** (every paired range against 8 crosses zero). 16 retains 3.0–4.4 MB more for
nothing. 2 settles 2.5 MB lower but starves the free list, and on colour is slower than 8 in 5 of 5
rounds (+19 ms [15–35] of 657). Frames 87/87 in all 30 cells. Desktop Chrome 148, loopback, 87-frame
series; the rig's 130 MB is a 237-frame fill and the saving is not a constant to carry across.

## The first frame

A decoder just created is slower than the same decoder a few frames later.
`lab/decode-first-frame/`, headless Chromium on a persistent profile, a fresh decoder per visit, 3
rounds, medians. **The first frame costs about four times the steady state**: on `g512` frame 0 is
11.8 ms, frames 1–5 ~4.5, steady 3.0 (**3.92×**); on `cine512` 13.7, 4.3 and 3.8 (**3.57×**) — ~9 ms
on a 512×512 frame, exactly where a user is waiting. **The engine's code cache does nothing to it**:
warm HTTP cache and warm code cache read 3.97× and 4.08× on `g512`, 4.00× and 4.47× on `cine512`,
only ever the wrong way. Tiering is per function with no on-stack replacement, so a warm-up promotes
only the functions it runs — §Warming the decoders.

*Corrected:* the reason first given — that the decoder is instantiated from a buffer and its glue
evaluated as text, so no cache could attach — describes `client/downloader/decoder.js`, not this
harness, whose page loads the glue by `<script src>` with no `wasmBinary` and so already streamed.
The load-time gain across arms is the HTTP cache plus the JavaScript code cache on the glue.

This may be §The BYOB read path's unexplained ~12 ms: frame 0 here is 11.8–16.9 ms against a 3 ms
steady state. Not confirmed — a different path and rig.

## Instantiating by streaming

V8 caches compiled WebAssembly only for a **streaming** compile of a module served as
`application/wasm`, and what it caches is tiered-up code. The product hands Emscripten a
`wasmBinary`, which forbids that. `decoder.js` takes `decoder.streaming`; given it, no binary is
passed and the glue's own `WebAssembly.instantiateStreaming` runs. **The default is unchanged.**

`lab/decode-first-frame/arms.mjs`, 5 rounds interleaved, a fresh persistent profile per arm, three
visits each: **a tie.** Streaming's wins on frame 0 are 2/5, 2/5, 1/5 on `g512` and 4/5, 4/5, 2/5 on
`cine512` across the three visits, and no cell holds its sign. **The WASM cache never engages**:
across 60 visits and five configurations — the host as is; `Cache-Control: public, max-age=31536000,
immutable`; sixty decodes and a fifteen-second settle; `--no-wasm-lazy-compilation`; the buffer arm
as control — `Code Cache/wasm` held nothing but its index, and a CDP trace shows
`wasm.TopTierCompilation` every visit and no `v8.wasm` cache event.

**The JavaScript cache does engage**: `Code Cache/js` gains the glue's 63 336 B entry on visit 2 and
deserializes it on visit 3; with the HTTP cache that is the whole 22.9 → 13.1 ms fall in time to a
ready decoder. **The product does not get it**: `decoder.js` evaluates the glue through `new
Function` in a module worker. Moving the glue onto a cacheable script is the larger lever, not
measured. Output is byte-identical on both paths (`arms.mjs --parity`; 12-bit signed not covered).

If the cache ever engages: `deploy/nginx` gives `Cache-Control` only to content-hashed names, which
the decoder's is not, and `new Function` would need `unsafe-eval` under a CSP. Desktop, headless.

## Warming the decoders

If the first frames are slow because the engine tiers the decoder over them, that cost can be
**moved**: decode a frame in each decoder while the session is still opening.
`client/downloader/decoder.js` takes `warmup`, a codestream URL fetched beside its own WASM compile
and decoded through the path a real frame takes, before that decoder answers `ready`. `decodersUp`
gates dispatch on `ready`; nothing reaches the session. **Off by default, and the numbers below are
why.**

`lab/decoder-warmup/`: four arms interleaved with the order rotated, 12 rounds, a 12-frame fill on
three decoders, a fresh page and session per visit, loopback. **none** · **mismatch** (the other
set's shape) · **mismatch-sized** (the other shape at the matching sample count) · **match**. The
shipped frames: `colour-8.j2c`, 160×160×3 8-bit, 6 708 B; `grey-16.j2c`, 160×160 16-bit, 38 331 B.
Frames 0–2 are one per decoder. Medians in ms, `(k/12)` rounds better than `none`:

| set | arm | frame 0 | frame 1 | frame 2 | frames 3–11 | 12 decodes |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `cine512` 8-bit colour | none | 44.33 [38.2 … 47.4] | 45.15 | 44.41 | 10.22 [9.6 … 11.5] | 229.6 |
| | mismatch | 34.58 (12/12) | 34.51 (12/12) | 33.08 (12/12) | **14.66 [13.7 … 16.9]** | 234.1 |
| | mismatch-sized | 31.50 (12/12) | 31.34 (12/12) | 29.38 (11/12) | **14.39 [13.0 … 16.4]** | 228.6 |
| | **match** | **29.49 [24.0 … 33.4]** (12/12) | 29.21 (12/12) | 27.43 (12/12) | **9.60 [9.3 … 10.4]** | **188.2** |
| `g512` 16-bit grey | none | 37.68 [34.7 … 43.0] | 37.67 | 37.95 | 9.46 [6.9 … 11.7] | 196.4 |
| | mismatch | 20.00 (12/12) | 23.66 (12/12) | 21.47 (12/12) | 9.73 [8.1 … 13.0] | 152.1 |
| | mismatch-sized | 23.73 (12/12) | 23.03 (12/12) | 23.50 (12/12) | 8.91 [8.0 … 12.6] | 153.3 |
| | **match** | **20.74 [17.7 … 22.2]** (12/12) | 20.23 (12/12) | 19.09 (12/12) | 7.95 [6.8 … 9.7] | **134.7** |

* **A warm-up is worth 30–45 % of frames 0–2, and almost none of that is the shape**: at equal
  sample count the matching arm gains only 2–3 ms more. The first frames want samples to tier on.
* **The shape decides the frames after them, against you on colour**: a mismatched warm-up leaves
  `cine512`'s frames 3–11 at 14.4–14.7 ms against 10.22 with **no warm-up**, disjoint ranges. A
  product that ships a warm-up must pick it from the series' metadata
  (`client/downloader/README.md`).
* **It does not reach the page's clock on this box.** The decoders answer `ready` later by about
  what the frames save: frame 0 at the page 119.3 → 130.0 ms (cine, 2/12) and 119.1 → 120.6 (grey,
  6/12) on loopback, and 522 → 555 ms at a 40 ms round trip (`lab/scripts/link_impair.py`).

**Mutants.** Moving the warm-up *after* `ready` was not caught — the warm-up still finished before
the first bytes, so the gate on `ready` is not load-bearing on this box (4 rounds; nothing changed
on it). Removing the `try` around it was not caught either, because the wrapper never throws; the
`catch` is load-bearing now that `decodeFrame` checks the header (§A frame that did not decode).

**What this is not.** Loopback and a userspace relay on a four-core box with other work: only
within-round differences are claimed. At 40 ms only frame 0 is a cold decoder's first frame. The
warm-up's size was not swept, and 12-bit signed has no shipped warm-up frame.

### On a slow CPU

Every browser thread slowed with `lab/scripts/cpu_throttle.mjs` (§A slow CPU, emulated) and a cold
ask added (`SCENARIOS=ask`: a fresh session, no fill, frame 5 asked as it opens). `none` against
`match`, 1× / 4× / 6× and fill / ask rotated inside every round, 7 rounds, both sets, loopback and
40 ms; 336 visits, pixels identical. Medians in ms, `none → match` at 1×, 4×, 6×, and `(k)` rounds
of 7 better with the warm-up:

| rtt | set | frame 0 at the page | cold ask |
| --- | --- | --- | --- |
| 0 | `cine512` | 184 → 181 (3), 396 → **466 (1)**, 594 → **694 (1)** | 132 → 143 (3), 385 → 410 (2), 608 → 624 (3) |
| 0 | `g512` | 162 → 156 (4), 370 → 389 (3), 568 → **666 (2)** | 134 → 130 (6), 409 → 388 (5), 541 → 604 (3) |
| 40 | `cine512` | 449 → 460 (1), 643 → **687 (0)**, 795 → 843 (1) | 461 → **445 (7)**, 621 → **680 (1)**, 778 → 830 (1) |
| 40 | `g512` | 587 → **569 (7)**, 726 → **645 (7)**, 816 → **766 (6)** | 590 → **566 (7)**, 708 → 678 (5), 851 → **758 (7)** |

* **The warm-up always cuts the first three decodes 30–65 %**, 7/7 or 6/7 in every cell — on colour
  at 4× on loopback 139 / 136 / 132 → 79 / 84 / 75 ms, 60–100 ms a frame at 6×.
* **Whether the page sees it is the idle window, and a slow CPU shrinks it.** The warm-up is paid
  before `ready`: at 4× on colour frame 0's wait for a decoder grows 61–81 ms (110 → 171 ms on
  loopback) to save 58–60 ms of decode; on the 16-bit set at 40 ms that wait stays 0. Where the
  first bytes land after the warm-up — the 16-bit set at 40 ms — frame 0 is **50–81 ms sooner at
  4–6×** and a cold ask 30–93 ms sooner. Where they land before — loopback, and the colour cine loop
  (~50 KB frames) even at 40 ms — frame 0 and the ask are **44–100 ms later**.
* **Keep it off by default.** The deciding quantity is the window between the decoders' compile and
  the first frame's bytes, which grows with the round trip and the first frame's size and shrinks as
  the CPU slows. On the target link it is longer than here, which favours the warm-up — arithmetic,
  not measured. A device on the target link, cine loop and 16-bit series, decides it. Dispatch waits
  on all three decoders (`Promise.all` in `downloader.js`); per-decoder readiness is not measured.

## A frame that did not decode

The wrapper reports nothing: it logs an `ojph error` and returns, and `decoder.js` reuses **one**
`HTJ2KDecoder` across every frame. Decoder 2.4.11, one reused object, the two shipped warm-up
codestreams:

| input | `getFrameInfo()` | `getDecodedBuffer().length` | the pixels |
| --- | --- | ---: | --- |
| `warmup/colour-8.j2c`, 6 708 B | 160x160x3@8 | 76 800 | the frame |
| the same, truncated to 60 % or 25 % | 160x160x3@8 | 76 800 | **different, and nothing is reported** |
| 100 B of it, an empty body, a README | **0x0x0@0** | 76 800 | **the previous frame's, byte for byte** |

So an undecodable frame arrives as the **last frame's pixels under the new index**, with `width: 0`
beside them — not as 0 pixels, which is what a *fresh* decoder returns.

**The check is the header, not the length.** `decodeFrame` computes `width x height x components x
(bits > 8 ? 2 : 1)` and throws when that is zero or the decoded buffer is shorter; the worker's
`catch` posts `failed` with the index and generation, so it reaches the consumer as `onError({
frameIndex, reason, generation })` or a rejected `requestExactFrame`, never as a frame. A check on
the length alone catches nothing: the length is the previous frame's. A fresh decoder per frame buys
only what this check buys and gives up reuse; zero-filling the output before each decode is the pass
D10 removed. Neither is taken.

**It refuses nothing real**: 129 real codestreams, all four shapes the product serves, none refused,
each decoded buffer exactly the declared size.

**A truncated codestream is invisible here** (full size, wrong pixels); it is caught on the wire
against the envelope's declared length — [`../CLIENTS.md`](../CLIENTS.md) §A truncated frame is a
failure. The two checks are disjoint on purpose. A codestream the server truncated *before* framing
passes both; only a per-frame `.sha256` oracle sees it. Conformance:
`anUndecodableFrameIsAFailureNotAFrame` in `client/conformance/dispatch-rig.ts`, real decoder,
skipped loudly where `vendor/openjph` is absent.

## The range pass

The decoder worker writes pixels into a `SharedArrayBuffer` and then walks them again to sign-extend
and take the sample range (`decoder.js`, `finish`). Folding the range into the copy was priced,
interleaved, 400 repeats: `set()` plus a range pass 1 104 µs against one loop doing both 1 175 µs on
512×512×3 8-bit (**1.06× slower** folded), 497 against 583 µs on 512×512 16-bit (**1.17×**).
**Folding loses**: a native `set()` memcpy plus a read-only loop beats one hand-written copy loop.
Do not fold it on the assumption that one pass beats two. *Corrected:* the pass was first put at
10–25 % of a decode; in a decoder worker during a fill it is **21–31 % of the frame** at every
throttle (§The decode tail on a slow CPU). The lever that remains is not walking the pixels at all —
§The range in the pack. (In C++ the answer was the other one: the wrapper's zero-fill wrote bytes
nobody reads, and removing it won — §The wrapper's two passes.)

**One copy did go** (S14): `new Uint8Array(m.bytes)` re-wrapped a view that already was one, copying
the codestream for nothing — 5.9 µs at 48 KB to 16.2 at 418 KB, plus a buffer per frame. Removed.

## The range in the pack

The source wrapper clamps and narrows every sample as it packs a line (`htj2k_decoder.cpp`, `pack`);
it now takes the integer min/max of the clamped value there and returns it from `getRange()`. It
already writes signed samples sign-extended, so `decoder.js` takes the decoder's range whenever the
decoder has `getRange` and runs `finish()` otherwise — the package has none and is unchanged.

**Bit-exact.** `parity.mjs` over c512, g512, s12, s512 and sat256, 435 frames: pixels identical to
the package and the encoder's input, `getRange()` identical to `finish()` on the package's pixels.
Mutants, each caught: the colour range from its first component (87/87 differ), one line's range
(348/348), the clamp one short at the top — **reached only by sat256**, now part of the run. In the
gate, `dispatch-rig.ts` holds `decoder.js` to both halves with the package and a stand-in glue that
answers `getRange()` (`client/conformance/range-glue.js`); always-pass and never-pass each fail one.

**What it buys.** [`../../lab/decode-tail/run.mjs`](../../lab/decode-tail/run.mjs), the wrapper
before (`today`) against `built`, both from source at a 16 MB heap through `decoder-split.js`; every
browser thread slowed; c512 and g512 with three asks after the fill; 7 rounds interleaved. Medians,
and rounds `built` was sooner:

| set | throttle | all decoded | one ask | a frame in its decoder | of it the range pass |
| --- | --: | --: | --: | --: | --: |
| c512, colour | 1× | 495 → 361 ms (**−27 %**, 7/7) | 17.1 → 15.8 (−8 %, 5/7) | 12.8 → 8.8 (7/7) | 4.1 → 0.0 |
| | 4× | 1 607 → 1 080 (**−33 %**, 7/7) | 53.6 → 31.4 (**−41 %**, 7/7) | 51.3 → 35.2 (7/7) | 16.1 → 0.0 |
| | 6× | 2 507 → 1 628 (**−35 %**, 7/7) | 82.9 → 52.9 (**−36 %**, 7/7) | 77.9 → 51.0 (7/7) | 24.5 → 0.0 |
| g512, 16-bit | 1× | 248 → 220 (−11 %, 7/7) | 9.1 → 7.5 (−18 %, 6/7) | 6.2 → 4.4 (7/7) | 1.4 → 0.0 |
| | 4× | 749 → 757 (+1 %, 5/7) | 19.6 → 8.3 (**−58 %**, 7/7) | 16.4 → 9.4 (7/7) | 4.2 → 0.0 |
| | 6× | 1 127 → 1 129 (+0 %, 4/7) | 25.6 → 12.8 (**−50 %**, 6/7) | 24.0 → 12.1 (7/7) | 6.5 → 0.0 |

* **The colour fill is decode-bound and takes all of it**: a third off at 4–6×. The 16-bit fill is
  wire-bound at 4–6× and does not move; its asks halve.
* **The pack's min/max is small but not free**: +0.5 ms of WASM (+6.6 %, 1/7) on a colour frame at
  1×, noise at 4–6×. A colour frame shown through a window does not need a range; skipping it there
  is not built. The 16-bit WASM medians at 4–6× swing both ways on 4–12 ms of work — the throttle's
  tick; the decoder-time and ask columns are the claim.

**Not yet in the product's decoder**: §The build, as delivered predates it.

## The decode tail

The workstation's rig saw a colour fill's last byte ~325 ms after the ask and its last frame decoded
~685 ms after it. **The pool is busy the whole fill; the tail is throughput, not scheduling.**
[`../../lab/decode-tail/run.mjs`](../../lab/decode-tail/run.mjs) runs a fill through the downloader
with three real decoders against the server on loopback, driverless Chromium, and splits it from each
frame's stamps (last byte, dispatched, decode start and end, decoder index), charging any idle
decoder with work in reach to where that work sat. §Content's two sets, 87 frames, 7 rounds
interleaved, medians:

| set | wire | last decoded | tail | decode a frame | work per decoder | busy while bytes arrive | idle with work waiting |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| c512, colour | 401 ms | 666 ms | **274 ms** | 17.8 ms | 638 ms | **95 %** | 31 decoder-ms, all between a decoder's own frames |
| g512, 16-bit | 357 ms | 369 ms | 10 ms | 8.8 ms | 317 ms | 85 % | 54 decoder-ms |

Colour needs 638 ms of each decoder against a 401 ms wire, so 45 of 87 frames start after the last
byte; hand-offs lose 1.6 % of the work (a decoder's next frame starts 0.24 ms after its last, p90
0.44). 16-bit decodes faster than it arrives and has no tail. **Decode is the fill's clock on one
content only**: on the rig a 237-frame 16-bit fill ended 15 ms after its last byte.

* **Build flags.** The package (`@cornerstonejs/codec-openjph` 2.4.11) has SIMD128 — 4 450 `v128`
  instructions — and no relaxed SIMD; `-mrelaxed-simd` on a source build produces a byte-identical
  binary. `build_arms.mjs`, Node, 9 rounds, colour / 16-bit: from source (emscripten 3.1.74) `-O3`
  is **−7.9 % / −10.6 %** against the package (7/8, 7/8), `-O2` −11.1 % / −10.5 % (8/8, 8/8), `-Os`
  −8.3 % / −2.0 %; the ranges touch, so it is reported, not decided. In the page the colour fill
  does not separate (682 → 661 ms `-O3`, 4/7). *Nothing changed.*
* **The order frames reach decoders** cannot shorten a throughput-bound finish; at most the ragged
  end, one frame's decode (~18 ms).
* **Starting a frame before its last byte** adds no capacity to a pool busy while bytes arrive.
* **Reusing the pixel buffer** (`lab/decode-tail/decoder-reuse.js`) tied: allocation is not in the
  tail.

**Where the host saturates.** Three decoders, the page, the downloader and the server on four cores:
the colour fill is at the box's limit, which is why the browser cannot separate a 7 % faster
decoder. The first readings of this section, 70–100 ms a colour frame, were taken while stray server
processes held all four cores and were discarded before they were reported.

## The decode tail on a slow CPU

The target is a phone's browser. Container results under an emulated slow CPU, not a phone's.

### A slow CPU, emulated

**Chromium's CPU throttle cannot slow a decoder.** Chrome 141 answers
`Emulation.setCPUThrottlingRate` on a worker target with *"Operation is only supported for pages,
not workers"*, and a loop in a worker runs as fast at 4× as at 1×. Under it a fill is a slow page
beside fast decoders.

[`../../lab/scripts/cpu_throttle.mjs`](../../lab/scripts/cpu_throttle.mjs) instead puts every thread
of the browser's process tree in its own cgroup (v1 `cpu`), capped at 1 ms in every `rate` ms —
page, downloader, decoders and the browser's network stack alike, the server not. One loop, page
thread and worker: 306 / 1 257 / 1 994 ms and 329 / 1 326 / 2 034 ms at 1× / 4× / 6× (`--check`).
**What it cannot do:** the kernel enforces the cap at its tick, so a ~1 ms burst runs nearly full
speed and pays later in a stall of up to ~20 ms. Work lasting many periods — a decode, a range pass
— is slowed faithfully; a sub-millisecond hop between threads is not, so no hand-off is quoted from
it.

### The package, throttled

`run.mjs --throttles 1,4,6 --asks 20,43,66`: a fill of each set, then three frames asked one at a
time on the warm session, through [`decoder-split.js`](../../lab/decode-tail/decoder-split.js) (the
product's worker with stamps inside `decodeFrame`). Two sets × three builds × three throttles,
rotated, 7 rounds. The package, medians:

| set | throttle | wire | all decoded | tail | a frame in its decoder | of it WASM | of it range pass | one ask, of it decoding |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| c512, colour | 1× | 373 ms | 707 | 357 | 18.7 | 11.7 | 5.6 | 25, 17 |
| | 4× | 1 325 | 2 626 | **1 336** | 81.8 | 52.5 | 23.7 | 86, 75 |
| | 6× | 1 995 | 3 757 | **1 783** | 120.1 | 77.9 | 35.7 | 127, 110 |
| g512, 16-bit | 1× | 346 | 384 | 13 | 9.5 | 5.8 | 2.0 | 13, 7 |
| | 4× | 1 318 | 1 343 | 27 | 28.6 | 17.1 | 8.2 | 36, 26 |
| | 6× | 2 107 | 2 146 | 36 | 38.1 | 24.0 | 11.0 | 46, 31 |

* **The throttle moves the wire nearly as much as the decode**: the browser's QUIC stack and the
  downloader are slow threads too. 16-bit is wire-bound at 4–6× (decoders 58–68 % busy); colour
  stays decode-bound.
* **On the target link the wire is slower still — arithmetic, not measured.** 37.2 and 35.7 MB at
  20–50 Mbit is 6–15 s, against 2.5–3.6 s of decoding per decoder at 4–6×. Three decoders keep up,
  so a faster decode buys the fill its last frame and an ask its decoding.

**(a) The builds.** The source build at the tree's wrapper (`a28587f`) and the 4 MB build are
byte-identical to the package and the encoder's input on all 174 frames. Against the package, paired
per round, 7 rounds at each of 1× / 4× / 6×: **nothing separates on an ask** (−10.0 to +4.7 %, no
cell better than 6 of 7). Per-frame WASM moves −1.6 to −3.7 % on colour and up to −12.2 % on 16-bit
at 4–6× (5–6 of 7), which agrees with the Node figure in §The decode tail. The one 7-of-7 result,
the 4 MB build's colour fill at 4× and 6× (**−7.5 %, −5.3 %**), is not claimed as a faster decoder:
its range pass — identical JavaScript in every arm — is also faster 7/7 (−13 %, −15 %), so part of
the gain is a memory effect of the smaller heap or of this rig.

**(b) One frame's code-blocks in parallel — identified, not built.** The seam is
`subband::pull_line` (`src/core/codestream/ojph_subband.cpp`), which decodes a row of code-blocks in
a serial loop, each into its own buffer.
[`profile_decode.mjs`](../../lab/decode-bench/profile_decode.mjs) on a source build with names kept:
decoding code-blocks and turning them into lines is **70 % of a colour frame and 76 % of a 16-bit
one**; the inverse wavelet 7–9 %, the wrapper's pack 10 % / 3 %. A 512² frame with 64² blocks gives
rows of at most 4 blocks, so with 4 threads and no overhead a frame falls to ~0.54 (colour) and
~0.50 (16-bit) of its time — ~24 ms of a 4× colour ask's 86. It would take a parallel loop there
(whether a block's decode touches shared state is unchecked), a `-pthread` build and a thread pool
inside each decoder worker. **During a fill it is more decoders in disguise**: the pool is busy 95 % of a colour fill.
Its one use is an ask on an idle pool, and the range pass is worth as much there with no thread.

**(c) What in the worker scales with the throttle.** Nothing faster than the decode: bytes in,
header and pixels out stay under 1 ms at every throttle. **But the range pass is the largest
per-frame cost after the decode** — 21–31 % of a frame in its decoder at every throttle. Keeping its
min and max as integers rather than doubles from ±Infinity
([`range.mjs`](../../lab/decode-tail/range.mjs), a browser worker, 7 rounds): colour 3.36 → 2.58 ms
(6/7), 16-bit 1.52 → 1.26 (5/7), signed 12-bit 2.45 → 2.20 (5/7) — not changed. Not walking the
pixels at all was built: §The range in the pack.

## A prefix draws a smaller image

The fixtures are RPCL, one layer, one tile, five decompositions, so a frame arrives resolution by
resolution and a *prefix* is a whole smaller image. `lab/decode-bench/prefix_levels.mjs`, four
frames per set, medians. **Bytes needed** is the smallest prefix whose decode at that level is
byte-identical to decoding the whole codestream at that level — binary search, mutation-checked: one
byte short never reproduces the image. Share of the full frame's bytes:

| set | ratio | level 1, 256² | level 2, 128² | level 3, 64² | level 4 | level 5 | decode µs, level 1 / full |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `c512` 8-bit RGB | 1.84:1 | 22.7 % | 4.9 % | 1.1 % | 0.3 % | 0.2 % | 1 641 / 6 146 |
| `g512` 16-bit grey | 1.28:1 | 24.2 % | 5.8 % | 1.4 % | 0.4 % | 0.2 % | 592 / 2 150 |
| `s12` 12-bit signed | — | 23.8 % | 5.5 % | 1.4 % | 0.4 % | 0.2 % | 478 / 1 717 |
| `ct512` CT-like | 1.99:1 | 25.2 % | 6.4 % | 1.8 % | — | — | — |
| **`cine512`** ultrasound-like | **18.2:1** | **48.3 %** | **17.0 %** | **5.9 %** | — | — | — |

**At ~2:1 a quarter of the bytes draws the half-size image; at 18:1 it takes half.** *Corrected:*
the headline was first "a quarter", read off `field` content alone. The curve tracks the compression
ratio — the better content compresses, the less of the codestream the high-frequency subbands take.
In absolute bytes the cine prefix is still far cheaper (23 863 B for 256², against 97 088 B on
`c512`); it is the *fraction* a slow-link policy would read, and it is content-dependent. Decode
time falls with the image, roughly ×4 per level. `s12` is `field` content too; `s512` differs from
`g512` by one byte (the SIZ sign bit), so its identical curve is only a consistency check, and `s12`
is the independent one — **the curve is a property of the progression, not of the pixel format.**

**Only the package can do it.** It exposes `decodeSubResolution(level)`; every row is that call. The
source build binds no equivalent — `decode()` never calls `restrict_input_resolution` — and throws
on a level-*r* prefix. Above a floor of its own it returns a **full-size** image with detail missing
and logs `File terminated early`: on frame 0, 307 806 B for `c512` (71.8 %) and 99 497 B for `g512`
(24.2 %).

**Not built.** Handing a frame's first bytes to a decoder before it completes waits on how a smaller
first image is displayed, and that decision is the workstation's. Four frames per set is enough for
a byte-exact, mutation-checked claim, not to call the percentages a distribution; the source build's
floor is frame 0 only.

## The BYOB read path

`client/transport-wasm` can read media frames with a BYOB reader instead of the default one (`byob`,
`byob-min`, `byob-count`, all off by default). It removes both compressed-frame copies: the frame is
read straight into its own JS buffer and no byte passes through WASM memory.

**On time it is a tie** — both fixtures, both cells, route-matched. `byob-min` adds `read(view,
{min})` and also ties: the receive stream already coalesces, so reads per frame fall only 2.30 →
2.00 on a 49 KB frame and 4.70 → 2.00 on a 250 KB one.

**Not adopted, for one reason.** A session's first frame costs about 12 ms more on this path,
reproduced across three campaigns, worse in 8 of 8 rounds with non-overlapping ranges. **It is not
acquiring the reader**: with a reader per frame (`--stream-mode per-frame`) the cost stays on one
frame per session. Left: the first per-frame buffer against a cold allocator, and the `byob` build
being a separate WASM module whose first call pays its own compile — or §The first frame's tier-up.

It is kept because adopting it would **delete** more than it adds: the default path needs a
partial-frame state machine, a compaction heuristic and a reserve policy, all unnecessary under BYOB
— about 140 lines removed against 93 added.

**A truncated frame is a failure here too**, on `byob`: the head — four bytes of length, four of
index — is read before the body, so a short stream names the frame it lost through the same
`fail_waiter` and reason string ([`../CLIENTS.md`](../CLIENTS.md) §A truncated frame is a failure).

```bash
(cd client/transport-wasm && wasm-pack build --target web --release --features byob)
WTPACS_WASM_PKG=<that pkg> node client/conformance/run.mjs
```

A byob build answers **118/120**: two ring checks are written on buffer identity, and a BYOB read
*transfers* its buffer and hands back a new `ArrayBuffer` over the same memory. The memory is reused
(the ring's view-of-its-own-length check passes); the two are right for the default path and blind
on this one. **`byob-min` does not name a truncation**
(117/120): a byte stream that closes with its `min` unmet **errors** rather than resolving short,
and the count received goes with the descriptor. The default reader swallows a stream error in the
same place, so this is parity, not a gap; naming it is a session-level question nobody has taken.

`client/transport-wasm/pkg/` must hold the **default** build: the conformance fake's
`ReadableStream` is not a byte stream, so a byob build there fails the gate. Byob arms need a
browser.

### What each path allocates

Both paths hand on a buffer allocated per frame — the default copies the frame out of WASM memory
into a fresh `Uint8Array`, byob reads straight into one. What differs is *before* that: the default
reader receives every read as a new chunk the browser allocated and copies it into a reused receive
buffer, while byob fills one caller-owned buffer across its reads. One 237-frame fill of 512×512
16-bit frames (92.8 MB of codestreams), five rounds per arm, arms rotated,
`lab/scripts/read_path_alloc.cjs`: **byob allocates less, and `byob-min` less again** — collections
per fill 338 [305 … 350] default, **201** [185 … 257] `byob` (−40.5 %), **165** [158 … 188]
`byob-min` (−51.2 %), fewer in 5 of 5 paired rounds each; JS heap high-water 71.4, 67.7 and 66.2 MB,
ranges disjoint. *Corrected:* the premise this was first written on was that byob would allocate
more. **A free list is not designed**: byob's churn is the smaller, a free list would help the
default path more, and which thread hands a buffer back, and when, is the wire buffer ring's
question (§The wire buffer ring).

**Instruments.** `--js-flags=--trace-gc` emits nothing in this Chromium (141, headless), so
collections come from the `disabled-by-default-v8.gc` trace category over CDP. The high-water is
`performance.memory.usedJSHeapSize` under `--enable-precise-memory-info`. CDP's `HeapProfiler`
sampler reads 1.10 MB in every arm — it does not weigh `ArrayBuffer` backing stores — and settles
nothing. Counts, not timing, from one `wasm-pack` build per feature flag; 237 of 237 frames every
run.

## What these numbers are not

* **Every millisecond is container-measured** and reported, not decided on. Heap, byte-exactness and
  the build-flag findings are not timing.
* **Nothing has been measured on a phone**, which is the target and the only place the memory
  question is settled.
* **Decode verdicts were ranked where decode is the fill's clock** — the colour cine loop, one ask,
  and the fast end of the target link. On a long 16-bit fill decode hides inside the receive (§The
  decode tail).
* **The fixtures are synthetic.** Decoded size, which the memory tables are indexed on, is exact
  regardless; decode time depends on content (§Content). *Corrected:* this list once put the
  greyscale `field` sets near 0.8:1; their ratio is 1.28:1 (§Content).

## Open

* **Anything on a phone** — including whether a tab is killed by counted or by resident memory.
* The glue evaluated through `new Function`, where no code cache reaches it (§Instantiating by
  streaming).
* A heap floor chosen for first-frame latency; the package's own build re-timed since D10.
* The warm-up's size, and the device cell that decides it (§Warming the decoders).
* BYOB's ~12 ms first frame, and what an errored stream owes the frame in flight (§The BYOB read
  path).
* Looked at and dropped, not measured: GPU decode (nothing runs in a browser), fewer decompositions
  (estimated ≤ 0.5 %), a BYOB read into the WASM heap (its memory is not detachable).
