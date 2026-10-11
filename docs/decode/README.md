# Decode — codestream to pixels

[`../adr/disk-access.md`](../adr/disk-access.md) owns how a frame is brought in and `../transport/` how it is sent. This owns what
happens after it arrives: turning a codestream into samples, what that costs, and where those
samples live. How to run each bench is in its own directory, `lab/decode-bench/README.md` first;
this file holds the numbers and the reasons. Every millisecond here is container-measured unless it
says otherwise — §What these numbers are not.

## The decoder

OpenJPH, through the `@cornerstonejs/codec-openjph` WASM build (wrapper MIT, OpenJPH BSD-2-Clause).
`client/decode/wasm/fetch_openjph.sh` pulls a pinned version from npm and records the tarball's
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

A bench that checks each variant against pixels it decoded itself cannot fail: flipping one byte of
every decoded frame **did not fail that check**, because the corruption reached the oracle and the
variant alike. Every bench here checks against the `.sha256` the generator wrote from the encoder's
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
So `finish`'s sign extension in `client/decode/decoder.js` is idempotent on this decoder's
output. The source build was wrong (§A build of our own).

*Corrected 2026-10-03:* the pass shifted by `16 − bits`, and JS shifts are 32-bit, so it left a raw
12-bit pattern as it was — a no-op, not an extension; it held only because the package extends
first. It shifts by `32 − bits` now, skipped when the sample fills its container, and
`client/decode/htj2k.test.mjs` holds it to raw patterns. On `ct512` it changes 0 of 87 frames
before and after the fix.

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
goes through one decoder object**, as `client/decode/decoder.js` holds it — until 2026-09-20 the
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

Four variants, one binary each, interleaved with the order rotated, 12 timed rounds of 87 frames, one
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
differences across variants inside a run are claimed; the absolute ms are not comparable with any other
table here.

**Mutants**, `parity.mjs` over c512 → g512 → s512 → sat256. Caught: the interleave stride `comps −
1` (c512 87/87); the contiguous loop one sample short (87/87 on each one-component set — this is
what licenses dropping the zero-fill, since a byte nobody writes keeps the previous frame's value);
`bitsPerSample` kept stale across a shape change, but only because a colour set runs first — on
`g512` alone it passes, hence the coverage line. **Not caught: `restart()` removed entirely** — 348
frames byte-identical. Bytes are not what `restart()` protects; parity cannot gate D11.

### Where to put the floor

Six initial heaps — 2, 4, 8, 16, 32, 50 MB — interleaved and rotated, a fresh decoder per frame
(`wasm/heap_curve.sh`). **The floor costs no time**: every variant within 2.2 % of the best at both
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

**The 4.8 MB is the wrapper's, not one variant's.** Re-read on the merged binary with three variants in one
process — `base` (destroy and placement-new every frame), `d11` (`restart()` alone), `merged`
(adopted) — at `INITIAL_MB=4`, 6 repeats × 6 rounds: **4.8 MB grey and 7.0 MB colour on all three,
36 readings without spread.** *Corrected:* the reason once given — that the codestream's arena lifts
a reused decoder off the floor — is wrong, since the variant that discards the arena every frame reads
the same. What reuse keeps is the decoder object's other buffers.

**The arena shows when the frame size grows.** One decoder, `g512` then `c512`, 6/6: **7.7 MB with
`restart()`** (`d11` and `merged` alike) against **5.8 MB for `base`**, because the grey arena is
still held when the colour frame allocates. The other order reads 7.0 MB on all three. So a decoder
reused across shapes is budgeted at **7.7 MB**, and every heap figure here is a peak, which is
order-dependent whenever sizes differ.

**Behind the downloader** (three decoders, `?decoder=source` on the campaign page, 3 rounds
interleaved): the decode variant is **161.4 MB on the package and 16.3 MB on the 4 MB build**, with fill
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

**The product builds its own decoders** (queue row DECODERBUILD): [`client/decode/wasm/build`](../../client/decode/wasm/build/README.md)
builds OpenJPH 0.31.0 through this wrapper and dav1d 1.5.4's `simd` arm in a Debian container pinned by digest,
with no network, every input checked by commit or sha256, every embedded path mapped. The page and the gate load
only what [`manifest.sha256`](../../client/decode/wasm/build/manifest.sha256) pins. The OpenJPH build, `-O3
-msimd128 -fexceptions`, `INITIAL_MEMORY=4MB`, one thread, with the range in the pack:

```
f6f5dce5a61e3db0d4b0e2e13357a73a21224fff9f77422195200300735315a4  openjph.js    55,158 B
16e10b1413be14daa004cbe3a326317ed5a5612aa80545c3c8e30ca61ac72fc0  openjph.wasm 246,209 B
```

* **Exact.** `parity.mjs` on nine sets, 783 frames — 8-bit colour ×2, 8-bit grey, 16-bit unsigned ×3, 16-bit
  signed, 12-bit signed ×2 — byte-identical to the package, to the encoder's input, on every getter, and its packed
  range identical to the JS pass. The 107 AV1 payloads of the contract set decode exact through the dav1d build in
  Chromium 141, Firefox 157.0.1 and WebKitGTK 2.52.6 with `SharedArrayBuffer` on
  (`lab/decode-bench/av1-engines/run.mjs`); WebKitGTK as shipped has none, the known limit (§AV1 in WebKit and Firefox).
* **Reproducible.** Built from two clones at different paths with different caches, all eight outputs are
  byte-identical. Without `-ffile-prefix-map` the OpenJPH `.wasm` differs and carries the build's paths; dav1d's does
  not (its release build embeds none).
* **Checked.** Mutants: grey frames made unranged in the wrapper fail parity's range check on `g8`, 87 of 87; a
  descriptor over another build's `.wasm` or glue is refused by `wasm-glue.js` (`wasm-glue.test.mjs`), and with the
  check removed the test fails; a sample flipped after each AV1 decode takes every engine to 0/107.

**Through the downloader** (`lab/decode-bench/builds.mjs`): `g512`, 87 frames of 512² 16-bit grey, three decoders,
headless Chromium 141 on 4 cores, a fresh browser a visit, 10 rounds with the units Williams-ordered, every frame's
sha256 against the encoder's input (all exact). Median [range]; × the package paired by round (rounds faster):

| | package | the build, one thread | the code-block pool (queue row HTJ2KMT), one helper |
| --- | ---: | ---: | ---: |
| fill 1× | 553.9 ms [513–667] | ×0.927 (9/10) | ×0.993 (5/10) |
| fill 4× | 1 789.5 ms [1 644–1 922] | ×0.941 (7/10) | ×1.007 (5/10) |
| cold ask 1× | 38.7 ms [33–47] | ×0.715 (10/10) | ×0.682 (10/10) |
| cold ask 4× | 102.0 ms [89–145] | **×0.732 (10/10)** | **×1.078 (3/10)** |
| JS + WASM, a fill | 157.4 MB | 21.7 MB | 21.9 MB |
| renderer peak PSS, a fill 1× | 246 MB [240–251] | 239 MB [237–246] | 250 MB [245–255] |

A first campaign of the package and the pool alone read the same: fills ×0.973 and ×0.999, the cold ask ×0.690 at 1×
and ×1.285 at 4× (2/10). **Adopted: the single-threaded build**, faster than the package in every cell and 7× lighter
in JS and WASM; the package stays as `parity.mjs`'s reference. The renderer's PSS barely moves because the
package's 50 MB heaps are reserved more than touched. The 4× asks are this host's cgroup throttle, not a phone.

*Corrected:* this section said the delivered build was the `deliver` variant of `lab/decode-bench/wasm/build.sh`,
before the range in the pack (`openjphjs.wasm` `19d11a75…`, 245,456 B), and that the code-block pool's threaded build was
adopted as the delivered one. Neither was ever loaded by a page. The pool is not shipped: on 512² frames it ties
fills and loses the cold ask at 4×, where it starts its helper; the pool's gains were on frames from 1914×2572
up, on a decoder already running (§Code-blocks on threads, measured).

## Threads

One multithreaded instance at N threads against N single-threaded ones **cannot be asked of OpenJPH
0.31.0** without writing the threading: `src/core/` contains no thread, mutex or atomic, so one
frame's decode is serial by construction; the only threading is a frame-level pool in the
`ojph_stream_expand` app, which upstream's CMake excludes under emscripten. Where parallelism inside
one frame could go, and what it would buy, is §The decode tail on a slow CPU (b). *Since built:* a
patched pool of code-block helpers, §Code-blocks on threads, measured.

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
`perDecoder` (2) frames and the next goes to the one with fewest (`client/transport/downloader.js`,
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

**The 4 MB floor is right if and only if the pixels leave the heap.** In the copy-out variants the heap
holds only transients — 4.0 MB on the 512×512 series, 24.6 MB on the 2048×2048 one, reproducing
§Where to put the floor.

* **Pool size costs each instance its floor**: copying out, each extra instance adds **+50.9 MB on
  the package in every series**, against +6.6, +4.8 and +25.3 MB on the 4 MB build.
* **A `SharedArrayBuffer` destination costs nothing**: within 0.1 MB of a plain one in all 72 cells.
* **Reusing one decoder object costs 1.2, 0.8 and 12.5 MB** per instance over one per frame — one
  live `decoded_` plus `encoded_` — never large.

**The mutant.** Keeping a frame the next decode overwrote looks like a win in memory.
`mutate=heap-reused` makes the kept arrangement reuse one decoder: **`MISMATCH ×86` of 87**, memory
collapsing from 476 MB to 3.0 MB, copy-out variants clean. The ground-truth check is what stands between
this table and a fiction.

**What this is not.** Headless Chromium 141, 4 vCPU, synthetic fixtures; memory, not time. This
instrument counts heap, which for an untouched floor is more than is resident (§Heap). Nothing on a
phone. *Corrected:* an 86 MB retained figure this file once carried was never reproduced and is not
quoted.

## What a decoder worker costs, resident

A dedicated worker is a thread in the page's renderer, so its cost is a **slope in the worker
count**: the same page decodes the same series at `decoders=1` and `decoders=3`, and the answer is
`(RSS₃ − RSS₁) / 2`. `lab/decoder-memory/`, 87 × 512×512 × 16-bit, the wrapper as delivered,
interleaved with variant and count order rotated, a fresh context per run, every frame checked. Chrome
148, peak from `VmHWM`, settled after `measureUserAgentSpecificMemory()` with the workers alive.

**A decoder worker costs 5.9 MB [5.2–7.0] resident, of which 5.7 MB is its own JS+WASM heap**
(`client/decode/decoder.js` as shipped, two frames in flight; n = 6, median [range]).

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
reading, which had made every variant read 2 MB. **The whole client, ablated the same way**
(`path=downloader`, a real session against `series-server`, the page keeping every frame, n = 4):
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
* **Pixels**: 0 mismatches in 44 cells. `client/contract/ring.ts` holds the mechanism against
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
evaluated as text, so no cache could attach — describes `client/decode/decoder.js`, not this
harness, whose page loads the glue by `<script src>` with no `wasmBinary` and so already streamed.
The load-time gain across variants is the HTTP cache plus the JavaScript code cache on the glue.

This may be §The BYOB read path's unexplained ~12 ms: frame 0 here is 11.8–16.9 ms against a 3 ms
steady state. Not confirmed — a different path and rig.

## Instantiating by streaming

V8 caches compiled WebAssembly only for a **streaming** compile of a module served as
`application/wasm`, and what it caches is tiered-up code. The product hands Emscripten a
`wasmBinary`, which forbids that. `decoder.js` took `decoder.streaming`; given it, no binary was
passed and the glue's own `WebAssembly.instantiateStreaming` ran. **The default is unchanged**, and
the option, a tie with no caller, was removed 2026-10-03; code:
`git show archive/arms-2026-10-03:client/downloader/decoder.js`. The lab variant below keeps its own copy.

`lab/decode-first-frame/variants.mjs`, 5 rounds interleaved, a fresh persistent profile per variant, three
visits each: **a tie.** Streaming's wins on frame 0 are 2/5, 2/5, 1/5 on `g512` and 4/5, 4/5, 2/5 on
`cine512` across the three visits, and no cell holds its sign. **The WASM cache never engages**:
across 60 visits and five configurations — the host as is; `Cache-Control: public, max-age=31536000,
immutable`; sixty decodes and a fifteen-second settle; `--no-wasm-lazy-compilation`; the buffer variant
as control — `Code Cache/wasm` held nothing but its index, and a CDP trace shows
`wasm.TopTierCompilation` every visit and no `v8.wasm` cache event.

**The JavaScript cache does engage**: `Code Cache/js` gains the glue's 63 336 B entry on visit 2 and
deserializes it on visit 3; with the HTTP cache that is the whole 22.9 → 13.1 ms fall in time to a
ready decoder. **The product does not get it**: `decoder.js` evaluates the glue through `new
Function` in a module worker. Moving the glue onto a cacheable script is the larger lever, not
measured. Output is byte-identical on both paths (`variants.mjs --parity`; 12-bit signed not covered).

If the cache ever engages: `deploy/nginx` gives `Cache-Control` only to content-hashed names, which
the decoder's is not, and `new Function` would need `unsafe-eval` under a CSP. Desktop, headless.

## Warming the decoders

If the first frames are slow because the engine tiers the decoder over them, that cost can be
**moved**: decode a frame in each decoder while the session is still opening.
`client/decode/decoder.js` took `warmup`, a codestream URL fetched beside its own WASM compile
and decoded through the path a real frame takes, before that decoder answered `ready`. `decodersUp`
gates dispatch on `ready`; nothing reached the session. **Removed on 2026-10-03** by the owner's
ruling: it moves only per-frame waits, not the page's clock (below). The option, its rig clause,
`lab/decoder-warmup/` and the frames' `ready` stamp are at tag `archive/downloader-opts-2026-10-03`;
the numbers stay here.

`lab/decoder-warmup/` (removed, at the tag): four variants interleaved with the order rotated, 12 rounds, a 12-frame fill on
three decoders, a fresh page and session per visit, loopback. **none** · **mismatch** (the other
set's shape) · **mismatch-sized** (the other shape at the matching sample count) · **match**. The
shipped frames: `colour-8.j2c`, 160×160×3 8-bit, 6 708 B; `grey-16.j2c`, 160×160 16-bit, 38 331 B.
Frames 0–2 are one per decoder. Medians in ms, `(k/12)` rounds better than `none`:

| set | variant | frame 0 | frame 1 | frame 2 | frames 3–11 | 12 decodes |
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
  sample count the matching variant gains only 2–3 ms more. The first frames want samples to tier on.
* **The shape decides the frames after them, against you on colour**: a mismatched warm-up leaves
  `cine512`'s frames 3–11 at 14.4–14.7 ms against 10.22 with **no warm-up**, disjoint ranges. A
  product that ships a warm-up must pick it from the series' metadata
  (`client/README.md`).
* **It does not reach the page's clock on this box.** The decoders answer `ready` later by about
  what the frames save: frame 0 at the page 119.3 → 130.0 ms (cine, 2/12) and 119.1 → 120.6 (grey,
  6/12) on loopback, and 522 → 555 ms at a 40 ms round trip (`lab/scripts/link_impair.py`).

**Mutants.** Moving the warm-up *after* `ready` was not caught — the warm-up still finished before
the first bytes, so the gate on `ready` is not load-bearing on this box (4 rounds; nothing changed
on it). Removing the `try` around it was not caught either, because the wrapper never throws; the
`catch` is load-bearing now that `decodeFrame` checks the header (§A frame that did not decode).

**What this is not.** Loopback and a userspace relay on a four-core box with other work: only
within-round differences are claimed. At 40 ms only frame 0 is a cold decoder's first frame. 12-bit
signed has no shipped warm-up frame; the warm-up's size is §Sizing the warm-up.

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

### Sizing the warm-up

On the lab's transport the session is ready early and the warm-up was judged not to reach the page
(above). The workstation's other transport dials longer — a session ready ~1.5 s after navigation on
an 80 ms link, by its measurement — so the question becomes what a warm-up costs, what it saves, and
how long an idle window it needs. `lab/decoder-warmup/size.mjs` (removed, at tag `archive/downloader-opts-2026-10-03`)
(cloud-queue row 85): one decoder (the package), a fresh browser context per sample, compiled from a buffer as
`decoder.js` does, then the warm-up, then the series' frames 0–5; 12 rounds, variants and 1× / 4× rotated
inside each; every frame checked against the encoder's input. Warm-ups: the shipped 160² frame
(`w160`), a 512² 16-bit grey one (`w512`, CT only — at 512² the colour one is the series' own frame
0), and a frame of the series' own shape and content (`own`, its frame 86). Medians in ms; `s1`, `s2`
what it saves on the decoder's first and second frame; every variant faster on frames 0+1 in 12/12 rounds.

| set | cpu | compile | variant | warm-up | frames 0 / 1 / 2 | s1 | s2 | frame 0 breaks even at | hidden at |
| --- | --: | --: | --- | --: | --- | --: | --: | --: | --: |
| cine512 | 1× | 9.4 | none | — | 17.2 / 12.3 / 6.5 | | | | |
| | | | **w160** | **6.5** | 12.8 / 10.3 / 6.8 | 4.5 | 2.0 | **2.1** | **6.5** |
| | | | own | 17.3 | 12.5 / 5.9 / 4.5 | 4.7 | 6.4 | 12.6 | 17.3 |
| | 4× | 32.2 | none | — | 71.5 / 32.8 / 19.0 | | | | |
| | | | **w160** | **28.3** | 47.6 / 30.9 / 21.3 | 23.9 | 1.9 | **4.4** | **28.3** |
| | | | own | 72.8 | 36.1 / 23.0 / 20.4 | 35.4 | 9.8 | 37.4 | 72.8 |
| ct512 | 1× | 10.0 | none | — | 10.6 / 5.6 / 5.6 | | | | |
| | | | **w160** | **6.0** | 5.9 / 5.4 / 5.9 | 4.8 | 0.2 | **1.3** | **6.0** |
| | | | w512 | 10.9 | 4.8 / 5.2 / 5.4 | 5.8 | 0.4 | 5.1 | 10.9 |
| | | | own | 10.8 | 6.2 / 5.8 / 5.6 | 4.4 | −0.1 | 6.3 | 10.8 |
| | 4× | 39.8 | none | — | 45.1 / 26.3 / 16.3 | | | | |
| | | | **w160** | **27.8** | 24.3 / 26.3 / 16.1 | 20.9 | 0.0 | **6.9** | **27.8** |
| | | | w512 | 45.0 | 20.7 / 19.5 / 12.6 | 24.4 | 6.8 | 20.6 | 45.0 |
| | | | own | 47.5 | 24.9 / 18.4 / 12.1 | 20.2 | 8.0 | 27.2 | 47.5 |

The break-even is the idle window between the decoder's compile and its first frame's bytes at which
frame 0 is no later with the warm-up: the warm-up's cost less `s1`. From that window up to the
warm-up's cost the first frame is sooner by part of `s1`; past it, by all of it.

* **The shipped 160² frame is the one to ship.** It buys nearly all of what a warm-up buys on the
  first frame for a third to a half of what a larger one costs: **6.0–6.5 ms a decoder at 1×, 28 ms
  at 4×**, saving 4.5–4.8 and 21–24 ms on frame 0. A larger or own-shape frame also warms the second
  frame (6–10 ms at 4×), and costs 45–73 ms to do it.
* **The window it needs is short.** Frame 0 breaks even at **1–2 ms of idle window at 1×, 4–7 ms at
  4×**, and the warm-up is wholly hidden at 6.5 / 28 ms. A dial that leaves the decoders ~1.5 s
  before the first byte — the workstation's figure for its other transport — hides it 20–250 times
  over, on every variant here; the lab's own loopback leaves it none (above).
  Per transport, the stamp below reads the window directly.
* **From the third frame on, the shipped frame moves nothing**; only the larger ones take ~4 ms more
  off CT's frame 2 at 4×.
* **What the pool saves** is three decoders' first two frames: with `w160` about 20 decoder-ms per
  fill on colour at 1× and 77 at 4× (CT 15 and 63), paid for with 18–85 decoder-ms of warm-up in the
  idle window. The workstation's ~190 decoder-ms is its own measurement, not reproduced here.

**The `ready` stamp** (removed with the option). Every frame carried `stamps.decoderReady`, the moment its decoder's
`ready` reached the downloader, beside `lastByte` and `dispatched`: `lastByte − decoderReady` is the
window a warm-up had, per frame, on whatever transport the page runs. `dispatch-rig.ts` holds it to
no sooner than a stand-in decoder's delayed `ready` and never after the frame's dispatch; a stamp
taken at the worker's creation, one never copied, and one taken after dispatch each fail.

**What this is not.** One decoder on the page's main thread, not three workers sharing four cores;
the headless shell; the package decoder; 4× is a cgroup quota whose tick shows in the 4× ranges. The
host is not saturated at one decoder. The table says what a warm-up costs; the option is gone
(§Warming the decoders).

## A frame that did not decode

The wrapper reports nothing: it logs an `ojph error` and returns, and `decoder.js` reuses **one**
`HTJ2KDecoder` across every frame. Decoder 2.4.11, one reused object, the two 160² codestreams
the dispatch rig decodes (`client/contract/frames/`, the warm-up frames until 2026-10-03):

| input | `getFrameInfo()` | `getDecodedBuffer().length` | the pixels |
| --- | --- | ---: | --- |
| `colour-8.j2c`, 6 708 B | 160x160x3@8 | 76 800 | the frame |
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
passes both; only a per-frame `.sha256` oracle sees it. Contract:
`anUndecodableFrameIsAFailureNotAFrame` in `client/contract/dispatch-rig.ts`, real decoder,
which the gate requires (`run_browser.sh` exits 2 without `vendor/openjph`).

## The range pass

The decoder worker writes pixels into a `SharedArrayBuffer` and then walks them again to sign-extend
and take the sample range (`htj2k.js`, `finish`, in `decoder.js` until the decoder-worker rework, queue row 49). Folding the range into the copy was priced,
interleaved, 400 repeats: `set()` plus a range pass 1 104 µs against one loop doing both 1 175 µs on
512×512×3 8-bit (**1.06× slower** folded), 497 against 583 µs on 512×512 16-bit (**1.17×**).
**Folding loses**: a native `set()` memcpy plus a read-only loop beats one hand-written copy loop.
Do not fold it on the assumption that one pass beats two. *Corrected:* the pass was first put at
10–25 % of a decode; in a decoder worker during a fill it is **21–31 % of the frame** at every
throttle (§The decode tail on a slow CPU). The lever that remains is not walking the pixels at all —
§The range in the pack. (In C++ the answer was the other one: the wrapper's zero-fill wrote bytes
nobody reads, and removing it won — §The wrapper's two passes.)

**The pass itself, in two loops** (the decoder-worker rework): one loop that tested `shift` on every sample cost an
unsigned frame 24 ms on 2560×3328 in Node where a loop without the test takes 14 (−15 to −44 % over
unsigned and signed 8, 12 and 16-bit, each its own process) — V8 does not hoist the invariant branch.
`finish` now has a loop per case; in the decoder worker it took HTJ2K's decode 12–21 % down on every grey
series (§The decoder worker's hand-off).

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
answers `getRange()` (`client/contract/range-glue.js`); always-pass and never-pass each fail one.

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
  1×, noise at 4–6×. *Since skipped there* — §An 8-bit colour frame takes no range. The 16-bit WASM
  medians at 4–6× swing both ways on 4–12 ms of work — the throttle's tick; the decoder-time and ask
  columns are the claim.

### An 8-bit colour frame takes no range

Nothing reads an 8-bit colour frame's range — its window comes from the tags — so neither side takes
one there (cloud-queue row 83). `pack` has a template flag `Ranged`, and the min/max run only under it: `false`
for an unsigned 8-bit 3-component frame, `true` for everything else, 16-bit always; the loops are
otherwise the old ones, with no runtime `if`. `getRange()` is empty (min > max) for such a frame, and
`decoder.js` gives it the sample type's range, 0..255, with no pass, whichever decoder it holds
(`unranged`, which must match the wrapper's test).

**Bit-exact.** `parity.mjs` over c512, g8, g512, s12, s512 and sat256, 522 frames: pixels identical to
the package and the encoder's input; `getRange()` identical to `finish()` wherever a range is taken
and empty wherever `unranged` holds, so the two tests cannot drift apart. `g8`, 512² 8-bit grey, is
new: the one 8-bit frame that still takes a range. Mutants, each caught: min −1 and max +1 (522/522),
the range read from the narrowed unsigned sample (s12 and s512, 174), the skip widened to 8-bit grey
in the wrapper or in `unranged` (g8, 87), `unranged` never true (c512, 87); the wrapper with the range in the pack (cloud-queue row 80) itself
fails on c512 alone. In the gate, `dispatch-rig.ts` holds `decoder.js` to 0..255 on the colour
160² frame through the package (pixels 0..199) and through `range-glue.js` (which answers −7..7);
the constant dropped or one short fails both.

**The WASM call** (`build_variants.mjs`, Node, container, 20 timed rounds rotated, two runs led by either
variant; medians, ms/frame):

| set | before the range in the pack | the range in the pack | no range for 8-bit colour |
| --- | ---: | ---: | ---: |
| c512, colour | 6.117 · 6.129 | 6.322 · 6.263 | 6.148 · 6.187 |
| g512, 16-bit | 2.498 · 2.484 | 2.520 · 2.469 | 2.454 · 2.463 |
| g8, 8-bit grey | 1.807 · 1.813 | 1.821 · 1.820 | 1.799 · 1.825 |

* **Colour is back to the figure before the range in the pack**: against the range in the pack, 18/20 and 14/20 rounds faster (−2.8 %,
  −1.2 %); against the wrapper before it, a tie (10/20 in the second run). On this host the pack's
  min/max was 0.1–0.2 ms, under the 5 % bar; the workstation's 0.5 ms is its own figure.
* **16-bit keeps the win of the range in the pack**: its code is unchanged and the WASM call ties; the win was never in
  the call but in `decoder.js` taking `getRange()` instead of walking the pixels, which it still does.
  Only the WASM call was timed here.

**In the product's decoder** since §The build, as delivered.

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
  binary. `build_variants.mjs`, Node, 9 rounds, colour / 16-bit: from source (emscripten 3.1.74) `-O3`
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

**On a host with only cgroup v2** (no `/sys/fs/cgroup/cpu`) the same cap is `cpu.max` `1000 1000×rate`
per thread. A v2 thread may move only inside its process's threaded domain, so each process of the
tree moves first into a per-run domain and its threads into that domain's threaded children; the
caller's cgroup must be delegated: `systemd-run --user --scope -p Delegate=yes node …`. On the
workstation (Chrome 148, 2026-10-02): 267 / 1 097 ms page thread, 268 / 1 206 ms worker at 1× / 4×
(`--check`); with the cap written nowhere, 4× reads 277 / 272 — the mutant is caught.

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
its range pass — identical JavaScript in every variant — is also faster 7/7 (−13 %, −15 %), so part of
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
*Built in the lab since (the HTJ2K decode profile, queue row FASTHTJ2K):* two threads take 9–31 % off a frame, four 40 % on the
largest frames only — §Faster HTJ2K in the browser.

**(c) What in the worker scales with the throttle.** Nothing faster than the decode: bytes in,
header and pixels out stay under 1 ms at every throttle. **But the range pass is the largest
per-frame cost after the decode** — 21–31 % of a frame in its decoder at every throttle. Keeping its
min and max as integers rather than doubles from ±Infinity
([`range.mjs`](../../lab/decode-tail/range.mjs), a browser worker, 7 rounds): colour 3.36 → 2.58 ms
(6/7), 16-bit 1.52 → 1.26 (5/7), signed 12-bit 2.45 → 2.20 (5/7) — not changed. Not walking the
pixels at all was built: §The range in the pack.

## Faster HTJ2K in the browser

Queue row FASTHTJ2K: where a frame's decode goes on real series, what GPU decoders move, and the
CPU levers left. [`lab/av1/decode/htj2k-profile`](../../lab/av1/decode/htj2k-profile/README.md) runs it.

**Where the time goes.** OpenJPH 0.31.0 with names kept, headless Chromium 141, the first 8 frames
of seven series, 5 rounds at 1× and at 4× (one core), V8's sampling profiler, 560/560 frames exact.
Self time by stage, % of a frame's decode plus its copy out of the heap, medians:

| series | decode ms 1× / 4× | copy out ms 1× | HT block decode | code-block to line | inverse wavelet | colour | wrapper pack | copy out (JS) | rest |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| fluoroscopy 768², 12-bit | 4.9 / 21.7 | 0.7 | 66 | 6 | 6 | — | 5 | 12 | 5 |
| MR 512² | 2.6 / 11.7 | 0.3 | 70 | 6 | 6 | — | 4 | 10 | 4 |
| ultrasound 760×421 RGB | 6.4 / 27.9 | 0.5 | 58 | 7 | 9 | 2 | 10 | 7 | 7 |
| CT 512², signed | 2.6 / 10.0 | 0.3 | 70 | 6 | 5 | — | 4 | 10 | 4 |
| cone-beam 512², 13-bit | 2.7 / 10.5 | 0.3 | 69 | 6 | 5 | — | 5 | 10 | 5 |
| tomosynthesis 614×1359 | 5.5 / 25.1 | 0.9 | 61 | 7 | 7 | — | 6 | 14 | 5 |
| projections 1914×2572, 14-bit | 46.3 / 204 | 5.6 | 68 | 6 | 6 | — | 5 | 11 | 4 |

The shares hold at 4× within 1–3 points. **The HT block decoder is 55–70 % of a frame; the inverse
wavelet 5–10 %, the colour transform 2 % on RGB.** The block decoder is already OpenJPH's WASM SIMD
one (`ojph_decode_codeblock_wasm`), and only cleanup passes reach it: the encoder writes no SigProp
or MagRef pass, so a refinement-pass lever has nothing to act on. This agrees with §The decode tail
on a slow CPU (b) on synthetic sets (70–76 % blocks, 7–9 % wavelet).

**What GPU decoders move — sources.** Read through search excerpts where the hosts were refused, and
marked so. nvJPEG2000 decodes HTJ2K only as one cleanup pass per block, "no refinement" (its release
notes; *excerpt only*; *corrected by the GPU-decoder reading (queue row GPU):* refinement passes since v0.10.0, the release notes read
in full 2026-10-07). Kakadu's ICIP 2019 paper decodes HTJ2K on a GPU with the CPU parsing the
codestream into code-block lists and the GPU doing block decoding and wavelet synthesis, reporting
"block coding speedup of ~10× (lossy) to ~40× (lossless)" and 4K 4:4:4 12-bit lossless at 402 frames/s
on a GTX 1080 — measured with the irreversible 9/7 wavelet, not this profile's 5/3 (*excerpt only*;
no per-stage breakdown found; *corrected by the GPU-decoder reading:* read in full, the paper has one, below, and its
10×–42× is the HT block coder's speed over the classic one on a 4-core CPU, not a GPU's gain). GPU work on classic JPEG 2000 puts ~90 % in block coding and calls the
inverse DWT's share small (*excerpts only*). **No WebGPU or WebGL JPEG 2000 or HTJ2K decoder was
found**, open or published. WebGPU itself is in Chrome on Android 12+ since 121 (ARM, Qualcomm and
Intel GPUs; Imagination since 139, Samsung Xclipse not yet) and on by default in Safari from iOS 26;
Firefox on Android has it off (gpuweb's implementation-status page and MDN's compatibility data,
read 2026-10-05). WGSL has the exact integer arithmetic a 5/3 inverse needs (`>>` on `i32` is
arithmetic, overflow wraps), with no optional feature.

**A WebGPU wavelet: not built — the evidence says it cannot pay.** Removing the wavelet and colour
transform outright saves at most 6–12 % of a frame. Handing them to a GPU means every subband out as
32-bit integers and every sample back: on the projections 19.7 MB up and 9.8 MB down a frame, three
times what the JS copy out already moves in 5.6 ms, to save 2.8 ms (6 % of 46.3). It would also end
OpenJPH's line-by-line pull, which keeps a few lines resident, for a whole frame of subbands per
decoder. Moving the block decoder too is a port of the HT cleanup decoder to WGSL with no browser
precedent: unbounded, and still paying the read-back. The container has no GPU: Chromium offers no
adapter, and with flags only SwiftShader, which runs on the CPU, so a shader here could be checked
for exactness and never timed.

**CPU levers, ranked.** Build flags, a newer emscripten, LTO, `wasm-opt`, relaxed SIMD, Wasm
exceptions, the wrapper's two passes, decoder reuse and the range pass were tried before
(§Faster, §The wrapper's two passes, §The decode tail, §The range in the pack) and are not repeated.

1. **Code-blocks decoded in parallel inside a frame — built in the lab and measured.** A row of
   code-blocks decoded by the caller and 1 or 3 helper threads (`cb-threads.patch` at
   `subband::pull_line`), each variant in a worker, one frame at a time, 6 rounds Williams-ordered,
   2 688/2 688 frames exact, two mutations caught 56/56. × the plain build, paired by round:

   | series | 2 threads 1× | 4 threads 1× | 2 threads 4× | 4 threads 4× |
   | --- | ---: | ---: | ---: | ---: |
   | fluoroscopy | 0.82 (6/6) | 0.83 (5/6) | 0.85 (6/6) | 0.92 (6/6) |
   | MR | 0.71 (5/6) | 0.89 (6/6) | 0.91 (4/6) | 0.81 (4/6) |
   | ultrasound RGB | 0.89 (5/6) | 0.99 (3/6) | 0.84 (4/6) | 0.99 (3/6) |
   | CT | 0.71 (6/6) | 0.84 (6/6) | 0.77 (5/6) | 0.93 (4/6) |
   | cone-beam | 0.77 (6/6) | 0.82 (4/6) | 0.77 (6/6) | 0.81 (4/6) |
   | tomosynthesis | 0.84 (6/6) | 0.87 (5/6) | 0.81 (6/6) | 0.87 (4/6) |
   | **projections** | **0.70 (6/6)** | **0.59 (6/6)** | **0.69 (6/6)** | **0.61 (6/6)** |

   Two threads take 9–31 % off a frame; four help only on the 4.9 M-sample projections (46 → 26 ms
   at 1×, 195 → 122 ms at 4×) and lose to two everywhere else — a row of a small subband has few
   blocks, and the row is the unit of hand-off. The ideal, with 65–76 % of a frame parallel, is
   0.62–0.68 at 2 threads and 0.43–0.51 at 4. `-pthread` alone costs nothing that separates (0.78–1.08,
   the sign changing by series). **It is an ask's lever, not a fill's:** during a fill three decoders
   already hold the cores (§The decode tail), so helpers only share them. It needs a cross-origin
   isolated page, which the product's consumer already requires, and 1–3 more threads per decoder
   worker (memory not measured).
2. **The copy out of the heap — bounded, 7–15 %** of a frame at every throttle (0.3 ms on 512², 5.6
   on the projections at 1×). The decoded samples would have to be written where the page reads them;
   with `-pthread` the heap is already a `SharedArrayBuffer`, but a frame retained past the next
   decode still needs its own buffer. Not built.
3. **The wrapper's pack — bounded, 4–10 %**, the most on RGB, whose three-component interleave
   `-msimd128` does not take (§The wrapper's two passes). A shuffle-based interleave could take part
   of the 10 %. Not built.
4. **OpenJPH 0.32.0 — nothing to time.** Against 0.31.0 its WASM block decoder differs by one mask
   in the UVLC suffix split (`0xF` → `0xFF`, a bug fix); the wavelet and colour code are unchanged
   for WASM. Every frame here was already exact on 0.31.0.

**A WebGPU block decoder, bounded** (the GPU-decoder reading). [`lab/av1/decode/webgpu`](../../lab/av1/decode/webgpu/README.md) runs the
measured part.

*How the GPU decoder does it* — Naman and Taubman, "Decoding high-throughput JPEG2000 (HTJ2K) on a GPU",
ICIP 2019, read in full 2026-10-07. The CPU parses precinct headers into lists of code-block byte-stream
offsets and uploads them with the codestream. The HT cleanup pass is then two kernels, made possible by its
layout — MagSgn grows forward, MEL forward, VLC backward: **KCUPS1** decodes MEL and VLC with *one thread per
code-block*, serially, writing each quad's significance, EMB patterns and offset as one 32-bit word; **KCUPS2**
decodes MagSgn from those words with *one warp per 64² block*, a thread to two columns, since MagSgn has no
dependence across a row. SPP and MRP, when present, ride in the same two kernels; a lossless codestream has
neither (nor do ours, by the HTJ2K decode profile). The wavelet (9/7, 32-bit float) and colour transform are one fused
kernel writing 16-bit interleaved samples; all-zero blocks are skipped in it. Lossless 4K 4:4:4 12-bit, ms a
frame on a 384-core 2017 card / a 2 560-core 2016 card: KCUPS1 4.43 / 0.52, KCUPS2 4.88 / 0.73, wavelet and
colour 6.15 / 1.19 — 62 / 402 frames/s. The authors note 64² blocks *under-use* the larger card in KCUPS1: its
6 300 blocks are 6 300 threads. On the GPU the wavelet is 40–50 % of the time, not the CPU's 5–10 %: it is
bandwidth, not arithmetic. nvJPEG2000 (release notes read 2026-10-07; they carry no dates): HT decode from
v0.7.0 with one cleanup pass only, refinement passes from v0.10.0, "10–50 %" faster then; v0.11.0's HT
encoder needs the 5/3 wavelet. No other GPU HTJ2K decoder was found published since 2019 (searched
2026-10-07), nor any WebGPU or WebGL one.

*What a port to WebGPU needs.* Nothing the method uses is missing: workgroup memory for the VLC table, and
the `subgroups` feature for a warp's column split (Chromium 141 offers it, even on SwiftShader). Not native:
64-bit integers (a bit reader is two `u32`s) and byte addressing (storage buffers are `u32`; bytes are
shifts). A port is two cleanup kernels and a 5/3 integer synthesis; nothing of OpenJPH's WASM carries over.

*Code-blocks a frame, the parallelism KCUPS1 gets* (5 levels, 64²; the 4K count reproduces the paper's
6 300): MR 512² 70, ultrasound RGB 309, tomosynthesis 614×1359 247, `dbt12_c` 931×2124 563, projections
1914×2572 1 307, `syn2d_d` 2394×2850 1 804, `ffdm_d` 3328×4096 3 352, 4K 4:4:4 6 321.

*Transfer, measured.* Headless Chromium 141 on SwiftShader, the codestream up and the frame back into a
buffer the page keeps, against today's copy out of the wasm heap; 8 rounds × 7 passes interleaved, per-round
medians [range], 1 344/1 344 frames exact both variants, a one-bit mutation caught in every cell:

| frame | MB back | heap 1× | WebGPU 1× | heap 4× | WebGPU 4× |
| --- | ---: | ---: | ---: | ---: | ---: |
| 512² 8-bit | 0.3 | 0.20 [0.10–0.20] | 2.95 [2.80–3.10] | 0.20 [0.10–0.20] | 7.0 [4.3–11.1] |
| 614×1359 | 1.7 | 0.80 [0.70–1.20] | 4.00 [3.90–4.30] | 1.15 [1.00–4.00] | 11.9 [9.0–21.8] |
| 931×2124 | 4.0 | 2.00 [1.90–2.60] | 5.75 [5.50–6.60] | 11.4 [8.3–14.4] | 20.9 [16.5–24.1] |
| 1914×2572 | 9.8 | 5.40 [5.10–5.60] | 11.3 [10.0–13.1] | 24.3 [21.0–29.3] | 53.4 [46.3–63.0] |
| 2394×2850 | 13.6 | 7.65 [7.20–9.40] | 16.1 [14.6–17.7] | 33.8 [32.4–43.0] | 71.3 [66.7–73.4] |
| 3328×4096 | 27.3 | 15.4 [15.2–18.6] | 31.1 [29.6–32.9] | 67.7 [62.6–72.4] | 144 [137–149] |

WebGPU's way back costs **2× the heap's copy on every frame over 4 MB** (8/8 rounds each) and about 3 ms
more at 1× on small frames, 7–12 ms at 4×: a fixed `mapAsync` round trip to the GPU process. SwiftShader's
own copies run on the CPU, so a phone driver's are not in this; no shader is timed.

*The bound.* What leaves the CPU is the block decoder, code-block to line, the wavelet, colour and pack —
81–86 % of a frame (the HTJ2K decode profile; `*` the projections' per-sample time and shares scaled to a
frame not profiled). Saved = that − the GPU's time − the extra transfer above. The GPU's time two ways from
the 384-core card's lossless kernels: *throughput*, per sample (0.62 ns); *floor*, KCUPS1 as one block's
serial latency (4.43 ms whatever the frame, as if that card's 6 300 resident threads waited on one) plus the
rest per sample. % of a frame saved, ideal (GPU free) / throughput / floor:

| series | frame ms 1× / 4× | 1× | 4× |
| --- | ---: | ---: | ---: |
| tomosynthesis 614×1359 | 6.4 / 29 | 31 / 23 / −44 | 44 / 42 / 28 |
| `dbt12_c` 931×2124 `*` | 21 / 92 | 67 / 61 / 42 | 75 / 73 / 69 |
| projections 1914×2572 | 52 / 229 | 74 / 68 / 61 | 72 / 71 / 69 |
| `syn2d_d` 2394×2850 `*` | 72 / 318 | 73 / 67 / 63 | 73 / 72 / 71 |
| `ffdm_d` 3328×4096 `*` | 144 / 635 | 74 / 68 / 67 | 73 / 72 / 71 |
| MR 512², control | 2.9 / 13 | −9 / −14 / −166 | 34 / 32 / −1 |

**The bound clears 15 % on every breast frame from 931×2124 up — 42–67 % at 1× even at the floor — and loses
on 512² at 1× whatever the GPU's speed**: the round trip alone is a frame's decode there. Unlike code-block
threads it is a fill's lever as well as an ask's: it takes the work off the cores the decoders share. **Not
measured, and not measurable here:** the container has no GPU, and SwiftShader runs WGSL on the CPU, so a
port could be checked for exactness and never timed. The bound's GPU is a 2017 desktop card running CUDA; a
phone's GPU through WebGPU, and the dispatch cost of two kernels a frame, are unknown, and 4× is the
container's emulation of a phone's CPU with the GPU left at full speed. What would settle it: the two
cleanup kernels and a 5/3 synthesis in WGSL, exact against OpenJPH on SwiftShader here, then timed on a
phone with WebGPU (Chrome Android 121+, iOS 26) — the owner's, as the AV1 option sweep's phones are (queue row 29).

**A WebGPU block decoder, built** (queue row WEBGPUHT). [`lab/av1/decode/webgpuht`](../../lab/av1/decode/webgpuht/README.md)
decodes an HTJ2K frame on WebGPU after the packet headers are parsed on the CPU: the cleanup pass as the two kernels
above — MEL and VLC a thread a code-block; MagSgn a workgroup a code-block, quad rows in order (a row's exponent bound
needs the magnitudes above it) and each row's bit offsets an exclusive scan, through workgroup memory or `subgroups` —
then the 5/3 synthesis a thread a line, and a pack to the samples OpenJPH emits. Run as `levers-protocol.md` §L3 states
it, on SwiftShader in headless Chromium 141, every frame against the checksum written when its input was made: the
twelve synthetic sets (87 frames each, `parity.mjs`'s nine among them) and every frame of the five sound breast series
(tomosynthesis 614×1359 and 931×2124, 29 and 68; projections 1914×2572, 9; synthesized 2D and full-field, 4 each):

| arm | frames exact | dispatches a frame | read-backs a frame |
| --- | ---: | ---: | ---: |
| one frame a dispatch, workgroup scan | 1 158 / 1 158 | 13 | 1 |
| one frame a dispatch, subgroups | 1 158 / 1 158 | 13 | 1 |
| a batch a dispatch, workgroup scan | 1 158 / 1 158 | 0.15–3.25 | 0.01–0.25 |
| a batch a dispatch, subgroups | 1 158 / 1 158 | 0.15–3.25 | 0.01–0.25 |
| mixed: frame k of all 17 sets in one batch, k = 0…3, each scan | 136 / 136 | 0.76 | 0.06 |

A batch is 13 dispatches — 2 cleanup, 2 per wavelet level, 1 pack — and one read-back, holding up to 256 MB of
coefficients: 87 frames of 512², 4 of 3328×4096. The mixed batches put 160² to 3328×4096, 8 to 16 bits, signed and
unsigned, grey and RGB in the same dispatches. **L3-P1 and L3-P2 held; the container stage passes.** Checked: one
byte flipped after decoding, the lifting's rounding constant 2 → 1, a code-block written one row down, and the scan
made inclusive (each scan) took every arm to 0 / 580 on `g8`, `c512`, `s12` and `dbt12_ea1141`; the subgroup lane
check inverted counted faults on every scan. *Not built:* the refinement passes — no code-block here has one (OpenJPH's
encoder writes the cleanup pass alone), so none could be checked; a stream with them is refused. *No time is claimed:*
SwiftShader runs WGSL on the CPU. The phone stage's rule is §L3's, unchanged, and waits for the owner's phones.

**What a phone would need.** For an ask: the thread pool, at two helpers, is the one lever measured
here, worth 9–31 % of a frame and 30–40 % on the largest; nothing else bounded exceeds 15 % (*corrected
by the GPU-decoder reading:* a ported block decoder bounds higher, unmeasured). For a fill: more decoders or a faster core —
no lever here adds capacity (*the GPU-decoder reading:* a ported block decoder would). WebGPU on a phone (Chrome
Android 121+, iOS 26) leaves the 55–70 % in the block decoder on the CPU unless the HT decoder is
ported, and the bytes to and from the GPU cost more than the wavelet it would take; ported, it bounds at
42–67 % of a breast frame from 931×2124 up (§A WebGPU block decoder, bounded). None of this is
measured on a phone; the 4× cell is the container's emulation (§A slow CPU, emulated).

## Code-blocks on threads, measured

Queue row HTJ2KMT: the lab pool of §Faster HTJ2K in the browser (`lab/av1/decode/htj2k-profile/cb-threads.patch`, a row of code-blocks
decoded by the caller and 1 or 3 helpers) measured on frames from 512² to 3328×4096, through the product's
decoder worker in a fill, and in memory. [`lab/av1/decode/htj2k-threads`](../../lab/av1/decode/htj2k-threads/README.md) runs it.

**A frame** — an ask on an idle decoder. Headless Chromium 141 on 4 cores, each build in a worker, the
first 4 frames of eight series, 10 rounds × 3 passes, Williams-ordered; 2 560/2 560 frames exact. ms a
frame, median of round medians; × the single-threaded build paired by round (rounds faster):

| series | 1 thread 1× | 2 threads 1× | 4 threads 1× | 1 thread 4× | 2 threads 4× | 4 threads 4× |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| MR 512² | 3.9 | ×0.88 (6/10) | ×0.88 (7/10) | 16.4 | ×0.91 (7/10) | ×0.92 (6/10) |
| fluoroscopy 768² | 8.0 | ×0.94 (5/10) | ×0.96 (6/10) | 30.6 | ×0.81 (9/10) | ×0.88 (8/10) |
| ultrasound 760×421 RGB | 9.1 | ×0.95 (6/10) | ×1.09 (3/10) | 45.3 | ×0.93 (9/10) | ×0.99 (6/10) |
| tomosynthesis 614×1359 | 8.6 | ×0.93 (6/10) | ×1.03 (5/10) | 36.2 | ×0.98 (7/10) | ×1.02 (4/10) |
| tomosynthesis 931×2124 | 15.7 | ×0.89 (7/10) | ×1.16 (4/10) | 68.4 | ×0.95 (8/10) | ×0.97 (6/10) |
| projections 1914×2572 | 63.2 | **×0.70 (10/10)** | **×0.62 (9/10)** | 308 | **×0.70 (10/10)** | **×0.62 (10/10)** |
| synthesized 2D 2394×2850 | 61.3 | **×0.74 (9/10)** | **×0.74 (9/10)** | 267 | **×0.79 (10/10)** | **×0.73 (10/10)** |
| full-field 3328×4096 | 74.1 | ×0.94 (6/10) | ×0.84 (6/10) | 337 | **×0.83 (10/10)** | **×0.87 (10/10)** |

`-pthread` alone: ×0.88–1.15, the sign changing by series, as the HTJ2K decode profile found (queue row FASTHTJ2K). **Two threads take
17–30 % off every frame from 1914×2572 up at 4×, in every round**; under that the gain is 2–19 % and not in
every round. Four threads beat two only on the projections and lose to them under 1914×2572.

**A fill** — the total-time measurement's harness (queue row TOTAL), whole series through the product's downloader and three decoder
workers on 3 cores (helpers share cores with other decoders), 50 Mbit and `lte-good`, 10 rounds,
9 600/9 600 frames exact; 329 of 640 visits VOID on the relay's timing, so these are all visits, each
cell n = 10 (the VOID-dropped medians agree). Every frame on the page, × the single-threaded build:

| series | 2 threads 50M 1× | 2 threads 50M 4× | 2 threads LTE 4× | 4 threads 50M 4× | package 50M 4× |
| --- | ---: | ---: | ---: | ---: | ---: |
| fluoroscopy 18 × 768² | ×1.000 | ×0.997 | ×1.000 | ×1.007 | ×1.005 |
| tomosynthesis 29 × 614×1359 | ×0.998 | ×1.001 | ×1.001 | ×1.004 | ×1.013 |
| projections 9 × 1914×2572 | ×0.997 | ×0.987 (9/10) | ×0.994 (9/10) | ×0.990 | ×1.015 |
| full-field 4 × 3328×4096 | ×0.998 | **×0.975 (10/10)** | ×0.987 (9/10) | ×0.983 | ×1.084 |

**On these links the wire is a fill's clock** (1.7–14.7 s) and threads move it by under 3 %, the most on
the largest frames at 4×, slower nowhere. The package the product loads today is 0.5–8 % slower than the
same OpenJPH built here (§The range in the pack), the most on the largest frames at 4×.

**Memory** — the AV1 memory measurement's method (queue row FOOTPRINT), 1 and 3 workers, `ffdm_d` and `dbtproj_ge`, 250/250 frames exact;
n = 1–2 rounds (the run stopped at its time limit). RSS slope a worker: single-threaded 40.6 and 25.9 MB,
**2 threads +2.2 and +2.5 MB**, 4 threads +6.3 and +6.9 MB. The page's JS+WASM measure is 9 MB higher a
worker with threads on the mammograms (57.9 against 48.6 at one worker), equal on the projections.

**Adopted: two threads, one helper, as the delivered build** (§The build, as delivered); four are not —
more memory, and slower than two under 1914×2572. A decoder worker loads a threaded build with no other
change than `htj2k.js` handing it its glue's URL for its helper (without it the helper starts from the
decoder worker's own script and the series never fills). The product's harnesses still load the package
until a consumer delivers the build. **It is an ask's lever:** a fill on these links gains ≤ 3 %.

*Corrected (the product's decoder build, queue row DECODERBUILD):* not delivered. Through the downloader on 512² frames the pool tied fills and lost a
cold ask at 4× (×1.078 against the package, where the single-threaded build is ×0.732), so the product's build is
single-threaded (§The build, as delivered). Whether to ship the pool for series from 1914×2572 up is the owner's.

**The helper started after ready** (queue row HELPERSTART, `levers-protocol.md` §L1 on `claude/av1`, run as written;
[`lab/decode-bench/helper-start`](../../lab/decode-bench/helper-start/README.md)). Three arms: the delivered build
(*ref*), row HTJ2KMT's pool (*pool*), and the pool linked with `-sPTHREAD_POOL_DELAY_LOAD=1` (*late*: the same
`.wasm`, a glue that answers ready without waiting for its helper Worker, which still starts beside it). `g512` and
the 14-bit projections (9 × 1914×2572), 10 rounds, Williams-ordered; loopback is the downloader on 4 cores, the
relay row TOTAL's harness on 3 with the relay on the fourth. **Every frame exact**: 17 400/17 400 on loopback and
the relay's fills, 30/30 cold asks on `lte-good`. Round 5's `g512` loopback block failed and was run again alone. Median [range] ms; × ref paired by round (rounds faster):

| cell | ref | pool | late |
| --- | ---: | ---: | ---: |
| ready, three decoders, `g512` 1× | 55.0 [47–221] | ×1.308 (1/10) | ×1.061 (3/10) |
| ready, 4× | 153.4 [136–167] | **×1.355 (0/10)** | ×1.138 (3/10) |
| cold ask `g512` loopback 1× | 22.0 [16–25] | ×1.182 (2/10) | ×1.058 (4/10) |
| cold ask `g512` loopback 4× | 63.5 [46–81] | ×1.158 (4/10) | ×1.187 (1/10) |
| cold ask `g512` `lte-good` 4×, strict · round-paired | 416 [402–428] | ×0.993 · ×0.995 | ×1.039 · ×1.021 |
| warm ask `g512` 1× | 8.9 [7.9–12.3] | ×0.916 (8/10) | ×1.029 (4/10) |
| warm ask `g512` 4× | 15.2 [9.3–34.5] | ×0.816 (7/10) | ×1.135 (4/10) |
| cold ask projections 1× | 121.5 [117–141] | ×0.935 (7/10) | ×1.017 (5/10) |
| cold ask projections 4× | 465.8 [435–513] | ×0.887 (9/10) | ×0.880 (8/10) |
| warm ask projections 1× | 106.3 [86–130] | **×0.757 (8/10)** | ×0.808 (7/10) |
| warm ask projections 4× | 418.8 [348–558] | **×0.721 (8/10)** | ×0.836 (8/10) |
| fills, 8 cells (50 Mbit, `lte-good`; 1×, 4×) | 6.0–14.4 s | ×0.987–1.001 | ×0.987–1.004 |

`VOID` on the relay: 8 of 30 cold asks, 5–7 of 30 fill visits on `lte-good`, 0–1 on 50 Mbit; strict and round-paired
readings agree on every verdict below. Against the predictions: P1 not held — the pool's cold ask at 4× is ×1.16,
under the ×1.35–1.60 the earlier campaign read, and *late* ×1.19, not ×0.97–1.03; the pool's start does sit on the
ready path (+58 ms at 4×, 10 of 10 rounds), and *late* takes only part of it off (×1.14). P2 held for the pool
(×0.99), not for *late* (×1.02–1.04). P3 held for the pool (×0.72–0.76), not for *late* (×0.81–0.84). P4 held for the
pool at 1× (×0.92), under its range at 4× (×0.82); *late* is slower than ref (×1.03–1.14). P5 held: no fill moves by
more than 1.3 %. **The rule: L1 does not hold** — *late*'s cold ask is ≤ ×1.03 in 4 and 2 of 10 rounds at 1× and 4×
(8 needed), its warm ask on the projections ≤ ×0.85 in 6 and 7 (8 needed); its fills pass. The pool's loss is not
refuted as the helper's start (it stays ≤ ×1.03 on `lte-good`). Why the deferred helper also gives back warm gain is
not measured. Containers, not phones; nothing ships, and the pool decision stays the owner's.

### A coarser hand-off unit, measured

Queue row COARSEPOOL, the decode levers protocol (`claude/av1`) §L4 as written: the pool handed a whole subband or
every subband of one resolution instead of a row of code-blocks, each at 2 threads
(`lab/av1/decode/htj2k-profile/cb-unit.patch`, [`lab/av1/decode/htj2k-threads`](../../lab/av1/decode/htj2k-threads/README.md)
§A coarser hand-off unit). The frame bench above, the first 4 frames of `g512` and the five breast sets, 10 rounds ×
3 passes at 1× and 4×, Williams-ordered, every build at the product's 4 MB initial heap; 1 920/1 920 frames exact, no
run failed, `VOID` does not apply (no relay). × the single-threaded build paired by round (rounds faster); heap is the
worker's WASM memory after its set:

| series | 1 thread 1× | row 1× | subband 1× | resolution 1× | 1 thread 4× | row 4× | subband 4× | resolution 4× | heap: 1 thread / row / subband / resolution |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| g512 512² | 3.48 | ×0.80 (9/10) | ×0.70 (10/10) | ×0.68 (10/10) | 16.9 | ×0.86 (8/10) | ×0.71 (8/10) | ×0.70 (10/10) | 4.0 / 4.8 / 7.0 / 7.0 MB |
| tomosynthesis 614×1359 | 6.84 | ×0.85 (8/10) | ×0.79 (8/10) | ×0.78 (8/10) | 35.0 | ×0.84 (8/10) | ×0.68 (10/10) | ×0.71 (10/10) | 6.4 / 6.4 / 11.1 / 11.9 |
| tomosynthesis 931×2124 | 13.7 | ×0.87 (10/10) | ×0.84 (8/10) | ×0.76 (10/10) | 65.5 | ×0.93 (9/10) | ×0.77 (10/10) | ×0.82 (9/10) | 10.2 / 11.9 / 20.8 / 20.8 |
| projections 1914×2572 | 56.4 | ×0.68 (10/10) | ×0.69 (10/10) | ×0.70 (10/10) | 279 | ×0.71 (10/10) | ×0.68 (10/10) | ×0.66 (10/10) | 28.3 / 29.6 / 51.2 / 49.4 |
| synthesized 2D 2394×2850 | 49.9 | ×0.77 (9/10) | ×0.81 (10/10) | ×0.79 (9/10) | 252 | ×0.75 (10/10) | ×0.73 (10/10) | ×0.70 (10/10) | 28.3 / 32.6 / 67.8 / 61.3 |
| full-field 3328×4096 | 64.9 | ×0.84 (10/10) | ×0.81 (10/10) | ×0.79 (9/10) | 317 | ×0.78 (10/10) | ×0.73 (10/10) | ×0.77 (10/10) | 47.8 / 57.0 / 118.3 / 111.0 |

**The rule's verdict: the row unit stays.** Both coarser units meet ×0.80 on 512² (subband 7/10 rounds at both
throttles; resolution 7/10 at 1×, 10/10 at 4×) but neither is 0.03 under the row's ratio on every large series in
8 of 10 rounds: at 1× on the projections the subband was in 3/10 and the resolution in 2/10 (they tie the row there);
at 4×, 3–7/10. **Predictions:** L4-P1 the row ×0.80 and ×0.86, under the predicted 0.88–0.95; the coarser units
×0.68–0.71, held. L4-P2 the row ×0.68–0.84 against 0.70–0.79, held on four of six cells; the coarser units reach
"toward ×0.65" only on the projections at 4× (×0.66). L4-P3 not held: at 1914×2572 the coarser units hold
**~20–22 MB** more than the row, not ~15, and the subband costs as much as the resolution, because OpenJPH pulls
every band of every resolution line by line from the start, so a unit decoded at once is the whole frame's
coefficients held at 4 bytes a sample (+54–61 MB on the full-field mammogram). The gain on small frames (×0.70 against
the row's ×0.80–0.86) is real in this container; whether it is worth 2–3 MB on 512² is the owner's, and the
little-core case is a phone's (§L4).

## Encoder settings

Queue row HTJ2KENC: does another OpenJPH 0.31.0 setting cut lossless bytes or browser decode against the
served profile (64² blocks, 5 decompositions, RPCL, no precincts)? [`lab/av1/bytes/htj2k-settings`](../../lab/av1/bytes/htj2k-settings/README.md)
runs it on the first 8 frames of nine series (3 of the two over 4 M samples): 35 settings, every frame
exact natively and in Chromium.

**Bytes**, over the served profile's (range over the nine series):

| decompositions | 32² | 64² | 32×128 | 128×32 |
| --- | --- | --- | --- | --- |
| 3 | 0.999–1.072 | 0.991–1.063 | 0.990–1.062 | 0.992–1.067 |
| 4 | 1.005–1.022 | 0.997–1.012 | 0.996–1.011 | 0.998–1.017 |
| 5 | 1.008–1.010 | 1 | 0.999–1.003 | 0.998–1.004 |
| 6 | 1.006–1.010 | 0.997–1.002 | 0.996–1.003 | 0.998–1.003 |

**No setting is 0.5 % under the served profile on any series but the 256² PET, where 3 decompositions
save 0.9 %** (0.27 MB); the best per series is 0.990–1.000. LRCP's bytes equal RPCL's on every cell (one
layer, one tile: only the packet order differs); precincts of 128² cost 0.05–0.07 %, of 256² 0–0.02 %.
**`imagecodecs`' defaults are the served profile's but for SIZ**: its `htj2k_encode` declares the array's
container depth, so a 12- or 14-bit series is coded as 16-bit, for 1.0000–1.0017 of the bytes and no
decode change; the colour transform on RGB is the same.

**Decode** a frame, the product's worker and package, 10 rounds interleaved, 1× and 4×: block size,
decompositions 3–6, LRCP, precincts and the `imagecodecs` variant are each within the round-to-round spread of
the served profile: the median paired ratio is 0.80–1.37 and every one of the 162 ranges spans 1; on the
mammogram and the projections, where decode is the clock (88 ms a frame at 1×, 355 ms at 4×), it is
0.95–1.06 at 1× and 0.98–1.10 at 4×. 12 400/12 400 frames exact.

**Total time**, the setting with the fewest bytes overall (6 decompositions, 0.997–1.000 of the whole
series' bytes) against the served one on the total-time measurement's fixed links (queue row TOTAL): **×0.99–1.02, a tie in every cell**
(fluoroscopy, the 12-bit volume and the mammogram, 5/20/50 Mbit, 1× and 4×, n = 8–10, 21 of 360 visits
`VOID`), every frame exact.

**Kept: the served profile.** No setting wins on total time, and two of the levers cost elsewhere: LRCP
puts every resolution's packets after the first layer's, which a one-layer stream makes the same as
RPCL in bytes but which §A prefix draws a smaller image's resolution prefix would lose with more layers,
and fewer decompositions shorten the ladder §A frame at the level the screen needs reads. A container's
decode, not a phone's.

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

*Corrected (the level-decode measurement, queue row RESLEVEL, 2026-10-07):* "byte-identical" above is to the same package's decode of the whole
codestream at that level, not to an independent decoder — and the package's level output is not exact on its own
(§A frame at the level the screen needs). The byte shares stand; they do not depend on the clamp.

## A frame at the level the screen needs

Queue row 59 (RESLEVEL), [`lab/av1/decode/resolution-level`](../../lab/av1/decode/resolution-level/README.md): the breast series in the served
profile, each decoded at the most reduced level whose long side still holds 1 000 pixels (level 1; level 2 on the
3328×4096 mammograms), exact at that size, the whole frame after.

**The package's level output is not exact as it comes.** At a reduced level the reversible 5/3 low band leaves the
samples' range — up to 1 439 on a 10-bit frame, −303 below — on 9 of 10 series. OpenJPEG 2.5.4's `-r` clamps it to
[0, 2^B − 1], as does an independent 5/3 analysis of the source samples (`ll.py`); the package's
`decodeSubResolution` clamps at 0 and at the 16-bit container only, so 15 of 35 frames came back with samples above
2^B − 1 (22–1 585 a series). **A clamp to 2^B − 1 after the call makes it exact**: 35/35 frames identical to both
witnesses, from the whole codestream and from its prefix. A level picture is grey here; the clamp for a signed or
colour series is not measured.

**Bytes.** The smallest exact prefix is 25.8–29.0 % of a frame at level 1 on all nine level-1 series and 7.0–7.5 % at
level 2 (`ffdm_d`, 0.35 of 4.81 MB) — the curve of §A prefix draws a smaller image, at ~2:1 content. Today's
codestreams (RPCL, one layer, one tile) already hold it as a prefix: no re-encode.

**Decode** (headless Chromium 141, n = 10, interleaved): a level-1 picture from its prefix costs ×0.27–0.31 of the
whole frame's decode through the product's module at 1× and 4×, level 2 ×0.08 (1×: `ffdm_d` 102 → 8.2 ms, `ffdm_a` 59 → 17 ms;
4×: 445 → 37, 250 → 73 ms); 2 100/2 100 pictures exact.

**On the total-time measurement's links** (queue row 23; 5/20/50 Mbit, `lte-good`, `wifi-home`, 1× and 4×; 13 rounds, paired n = 5–13 a cell, under 10
in 9 of 50, 5 200/5 200 frames and 2 600/2 600 level pictures exact): four views or slices a fill, every level picture
first, every whole frame after, through the product's downloader and a lab decoder worker. Against today's fill:

| | 3328×4096 FFDM, level 2 | 2560×3328 FFDM, 2394×2850 synthesized 2D, level 1 | DBT slices, level 1 |
| --- | --- | --- | --- |
| first exact picture on screen | ×0.09–0.27 | ×0.26–0.49 | ×0.23–0.69 |
| every frame on screen | ×0.06–0.15 | ×0.23–0.50 | ×0.30–0.47 |
| every frame exact at full size | ×0.99–1.02 | ×0.99–1.01 | ×1.00–1.04 |

Sooner in every paired round of every cell on the first two lines; the whole is a tie, since a prefix and its rest
are the same bytes. At 5 Mbit a 3328×4096 study is on screen in 2.6 s, not 31.6, and the first view in 0.63 s, not
7.3. The wire is the clock throughout: 4× moves no ratio by more than 0.10. Container-measured on a loopback relay,
not a phone; the proposal is in [`../adr/resolution-fitting-for-large-frames.md`](../adr/resolution-fitting-for-large-frames.md) §7.

## Region decode, measured

Queue row REGIONDECODE, `levers-protocol.md` §L2's container half (on `claude/av1`):
[`lab/av1/decode/region`](../../lab/av1/decode/region/README.md). OpenHTJ2K v0.19.0 built to WASM decodes (a) a
1080×2400 viewport at 1:1, alone, and (b) one asked frame in k horizontal stripes on k idle decoder workers, each
writing its stripe into a `SharedArrayBuffer`. The reference is the delivered OpenJPH recipe, one thread
(§The build, as delivered). Headless Chromium 141 on 4 cores, 10 rounds, Williams-ordered, the first 4 frames of each
set, 3 timed passes after a checking pass. **2 800/2 800 decodes exact**: every region and stripe against the same
rectangle of the encoder's input, every assembled frame against the set's checksum. ms from the ask to the last
rectangle written, the median of round medians; × an arm paired by round (rounds under it):

| series | OpenJPH 1× | OpenHTJ2K whole | viewport, corner | viewport, centre | 3 stripes | 3 stripes, × the pool | OpenJPH 4× | 3 stripes 4× |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `g512` | 5.4 | ×1.30 | — | — | ×0.99 (5/10) | — | 17.0 | ×1.08 (4/10) |
| tomosynthesis 614×1359 | 10.1 | ×1.18 | — | — | ×0.85 (7/10) | — | 42.0 | ×0.71 (8/10) |
| tomosynthesis 931×2124 | 19.4 | ×1.13 | ×1.23 (0/10) | ×1.18 (1/10) | ×0.90 (8/10) | — | 90.0 | ×0.76 (10/10) |
| projections 1914×2572 | 85.3 | ×1.14 | ×1.19 (0/10) | ×1.19 (3/10) | ×0.70 (10/10) | ×0.95 (7/10) | 387 | **×0.62 (10/10)** |
| synthesized 2D 2394×2850 | 72.9 | ×1.21 | ×1.06 (3/10) | ×1.07 (1/10) | ×0.70 (10/10) | ×0.87 (8/10) | 359 | **×0.60 (10/10)** |
| full-field 3328×4096 | 96.5 | ×1.31 | ×0.82 (10/10) | ×0.86 (7/10) | ×0.74 (10/10) | ×0.88 (9/10) | 456 | **×0.68 (10/10)** |

At 4× the viewport on 3328×4096 is ×0.84 (corner) and ×0.97 (centre) of OpenJPH's whole frame, and 2 stripes
×0.70–1.17. Against OpenHTJ2K's own whole frame, 3 stripes are ×0.47–0.49 at 4× on the three large series and
×0.57–0.60 at 1×; the viewport ×0.60–0.69 on 3328×4096 and ×0.90–1.04 under it.

**A viewport costs its rows, not its area.** OpenHTJ2K's row range skips the code-blocks above and below the region,
but its column range only narrows the wavelet: every block of every row the region reaches is decoded, and at the
coarse levels a block's 64 rows span up to 2 048 of the frame's. So the viewport decodes 72 % (corner) and 84 %
(centre) of a 3328×4096 frame's code-block bytes for 19 % of its area, 95–100 % below that; the same count bounds the
bytes it would need to fetch, and today's codestreams (one precinct per resolution) cannot be fetched by region at all.
OpenHTJ2K is also ×1.13–1.41 OpenJPH's time on the whole frame, so (a) loses to the reference on every series but
3328×4096. **Stripes are a pool without threads** that beats today's pool (×0.77–0.85 at 4×, 10/10): 3 workers take
the large frames to ×0.60–0.68 of the reference at 4×, decoding 1.13–1.17× the code-block bytes (the overlaps).
Under 1914×2572 they gain less, and on `g512` nothing.

**By §L2's rule, region decode is not worth a design here:** every region and stripe is exact, but (a) on 3328×4096
is ×0.82–0.97 of the reference against ≤ 0.40, and (b) at k = 3 is ×0.68 (full-field) and ×0.62 (projections) at 4×
against ≤ 0.60, ×0.60 on the synthesized 2D; it is faster than today's pool on all three. A decoder that skips blocks
outside the columns, or precincts in the stored layout, would change (a); neither is measured, and the layout is the
owner's. Container-measured; what a phone's cores do with three busy workers is not.

## The BYOB read path

Retired; code in history at `6e9c126`. The WASM client's BYOB reader (`byob`, `byob-min`) read each
frame straight into its own JS buffer. Time tied on both fixtures and cells, and `byob-min` tied too;
a session's first frame cost about 12 ms more in 8 of 8 rounds, not from acquiring the reader. It
allocated less — 338 → 201 (`byob`) → 165 (`byob-min`) collections per 237-frame fill, 5/5 rounds —
but a free list on the default path was never designed. `byob-min` errored instead of naming a
truncation (117/120 contract). The TypeScript client's `readMin` is a separate path, still open
([`../CLIENTS.md`](../CLIENTS.md) §Reading a frame whole).

## AV1

### WebCodecs, what it decodes exactly

Headless Chromium 141.0.7390.37 (the lab's), Linux container, no GPU, 2026-10-03
(`lab/av1/exact/webcodecs/`). 24 lossless libaom streams, 256×192, 8 frames each: 4:0:0, 4:2:0, 4:2:2 and
4:4:4 (identity matrix, GBR) × 8/10/12 bit × intra-only and inter (one keyframe, seven inter
frames). Each frame's planes are hashed against the encoder input's SHA-256; native dav1d 1.4.1
reproduces all 24, so a miss would be the browser's. That holds per stream, not per encoder: on
other content libaom 3.8.2's inter 10- and 12-bit frames were not exact (the dav1d-WASM exactness check, queue row WASM).

| | 8 bit | 10 bit | 12 bit |
| --- | --- | --- | --- |
| 4:0:0 (Main / Professional) | exact, `I420` | exact, `I420P10` | **refused** |
| 4:2:0 (Main) | exact, `I420` | exact, `I420P10` | **refused** |
| 4:2:2 (Professional) | exact, `I422` | exact, `I422P10` | **refused** |
| 4:4:4 GBR (High) | exact, `I444` | exact, `I444P10` | **refused** |

Exact means 8/8 frames, every plane, intra and inter alike, with `no-preference` and
`prefer-software`. Mutated, every cell fails: a flipped sample in the copy, a wrong ground-truth
hash, a corrupted payload byte (to native dav1d).

* **12 bit is refused before the decoder sees it**: `decode()` throws `DataError: A key frame is
  required` on the stream's first chunk, which is a keyframe with its sequence header. 8- and 10-bit
  4:2:2 are Professional profile too and decode, so it is the depth, not the profile — the check
  that classifies a chunk as key does not take a 12-bit sequence header. *Read since (the newer-versions survey, queue row VERSIONS):*
  `decode()` parses a key chunk with libgav1's OBU parser, built with `LIBGAV1_MAX_BITDEPTH=10` in
  Chromium 141, 154 and 155, so the parse fails and the chunk is called not key
  ([`lab/av1/tools/newer`](../../lab/av1/tools/newer/README.md)).
* **`isConfigSupported` does not tell**: it answers `true` for every 12-bit string, and for strings
  the AV1 spec forbids (profile 0 with 4:4:4 or 12 bit, profile 1 with 4:2:0); only profile 1 with
  4:0:0 is `false`. So a client learns what this decoder takes by decoding a known frame, not by
  asking — the warm-up frame (§Warming the decoders) can be that frame.
* **`prefer-hardware` is unsupported** for every config here (no GPU); nothing about a hardware
  decoder's read-back follows.
* **A 4:0:0 stream comes back as three planes**: `I420`, the chroma filled with the mid value (128,
  512), `colorSpace` reported BT.709 limited range. Only plane 0 is the image; `copyTo` costs the
  chroma's half again.
* **GBR comes back as `I444`, planes in G, B, R order**, `colorSpace.matrix` `null` (not `"rgb"`),
  sRGB transfer, full range. The samples are untouched; the conversion to RGBA is the client's.
* **The decoder holds two frames until `flush()`**: 8 temporal units unflushed give 6 frames, 3
  give 1, 2 give 0 or 1, 1 gives **0**. One chunk, no flush, is an empty decode. Temporal
  delimiters make no difference (stripped: same 24 results). A decoder serving one frame at a time
  has to flush each, and a flush wants a keyframe next — fine at a group of 1.

What this cannot say: anything about a phone, Safari, a GPU decoder, or a Chromium other than 141.

### dav1d-WASM, the decoder the client runs

dav1d 1.5.4 under emscripten 3.1.74, `-msimd128`, one thread, 623 KB `.wasm` (238 KB gzipped), is
exact against two native dav1d builds on every frame tried — 8/10/12-bit, 4:0:0 and 4:4:4, intra and
inter ([`client/decode/wasm/dav1d`](../../client/decode/wasm/dav1d/README.md)). It is what `av1-dav1d.js` runs
for an AV1 series, flushed before each frame (G = 1: [`docs/av1/adr-unit.md`](../av1/adr-unit.md)
§2), and the dispatch variant decodes all six shapes through the downloader to their source's checksum.
Unlike WebCodecs it takes 12 bits and returns one frame per unit with no `flush()` to wait on. It
is 5–10× slower than OpenJPH on the same frames (§Decode time against HTJ2K).

### WebCodecs, the decoder the client runs where it is exact

Queue row WCDEC (2026-10-03). `av1-webcodecs.js` sits beside `av1-dav1d.js` behind the same
contract, and `decoder.js` takes it only for a series that says `depth` ≤ 10 (every stream it codes,
[`docs/av1/adr-unit.md`](../av1/adr-unit.md) §2) in a browser with `VideoDecoder`; any other AV1
series, one that does not say its depth included, gets dav1d-WASM. Each unit is one key chunk,
flushed (G = 1), the decoder configured as `av01.0.04M.10` whatever the stream — Chromium decodes
from the in-band sequence header, and four strings tried gave the same frames for every shape. *Corrected
(the derived codec string, queue row CODECSTR, 2026-10-07):* each stream is now configured with the string of its own sequence header;
the same frames, the same decoder on every series ([`lab/av1/exact/codec-string`](../../lab/av1/exact/codec-string/README.md)); a
split frame's two units go to two `VideoDecoder`s at once and are merged as
dav1d's are, by the shared `av1-frame.js`. What it refuses where dav1d refuses, from the frame
alone: anything but `I420`/`I420P10` with every chroma sample mid-grey (4:0:0) or
`I444`/`I444P10` with no matrix reported (GBR). That last is weaker than dav1d's check —
`colorSpace` does not distinguish the identity matrix from an unspecified one — so a 4:4:4 stream
with matrix 2 would pass here and fail there. *And the other way (the total-time measurement, queue row TOTAL):* an identity stream
that is not also tagged sRGB (primaries BT.709, transfer sRGB) is reported as matrix `bt709`, limited
range, and refused here on every frame although dav1d takes it — libaom's `--matrix-coefficients=identity`
alone, as every lab encode before the total-time measurement. So an RGB series meant for WebCodecs is coded with all three
tags; ffmpeg's `-colorspace rgb` writes them. *Corrected (the derived codec string):* `colorSpace` echoes the codec
string's colour fields, not the stream's, so with the full string configured the check reads
`matrix_coefficients` from the sequence header, as dav1d's does: both weaknesses are gone, and an
identity stream without the sRGB tags decodes here exactly.

The dispatch variant (headless Chromium 141) checks, every frame against its source's checksum and its
range against its own samples: 8/10-bit grey and RGB through WebCodecs, every unit counted reaching
it; the same frames with `VideoDecoder` removed, and 12-bit grey and RGB with it present, through
dav1d-WASM with none reaching it; 13-bit split, 13-bit signed and 16-bit signed split frames
through both; a frame of a group, an empty unit, a non-AV1 file, YUV 4:2:0 and 4:4:4 colour, a cut
keyframe and a decoder closed under a frame refused by both, the next frame exact; and one decoder
taking its frames one at a time. 17 mutations of the new code each failed a check. One did not and
is equivalent here: reading `codedWidth` for `visibleRect` — Chromium 141 reports them equal, odd
sizes included. G > 1 (one flush a group) waits on the group-as-item path (queue row GOP). *Built since (§WebCodecs without a flush),
below: a group goes through WebCodecs with no flush inside it.*

### WebCodecs without a flush

Queue row WCLAT ([`lab/av1/decode/latency`](../../lab/av1/decode/latency/README.md)), 2026-10-04, headless Chromium 141.
With `optimizeForLatency: true` **each unit gives its frame before the next is sent, exact**. That
held on every depth and layout WebCodecs takes (8 and 10 bits; 4:0:0, 4:2:0, 4:2:2, 4:4:4), intra
and G = 8, and on 1, 2 and 4 tile columns: 784 of 784 frames against the encoder's input. With
neither the option nor a flush, no unit gave its frame. Those are the frames held until `flush()` (§WebCodecs, what it decodes exactly). A flush per unit
cannot carry a group: after a flush the next unit must be a keyframe.

Skipping the flush makes a frame 7–20 % faster at 1× and 3–28 % at 4×, intra, 10 interleaved rounds
(every frame exact). A keyframe still needs one, though, or a unit labelled key that is not a
keyframe decodes against the frame before it. That is how `inter.av1` passed as pixels in the first
build. Flushing before every keyframe costs what flushing after did, and 5–15 % more at 4× on tiled
frames. So **the decoder flushes at a group's end**, which at G = 1 is every frame, as before. It
flushes before a keyframe only when a cut group is still held, and never inside a group. Tiles help
here too: Chromium gives dav1d 2–4 threads by coded height, and 4 tile columns take a frame from 33
to 15 ms at 1× and from 118–135 to 66–70 ms at 4×, for −0.6 to +0.4 % bytes.

`decoder.js` now hands a ≤ 10-bit series in groups to WebCodecs. A unit that gives neither a frame
nor an error would stall its decoder. Chromium does this on a one-byte or delimiter-only delta, so
after 2 s the unit is flushed and fails by name, and the rest of its group fails with it. The
dispatch variant checks four things, each through WebCodecs and through dav1d-WASM:

* a G = 8 colour series, every frame exact and all 20 units reaching WebCodecs (none with
  `VideoDecoder` removed);
* a delimiter-only unit at frame 3, which fails frames 3–7 while 8–19 stay exact;
* frame 9's bytes sent as a keyframe to a decoder holding frames 0–4, refused;
* G = 1 unchanged: the refusals above still hold.

Taking groups away from WebCodecs, dropping the stall guard, and dropping the flush before a held
keyframe each failed a check. Dropping the flush at a group's end failed none, and is not meant to:
the flush before the next keyframe then covers it, at the cost measured above.

### A split payload through two decoders

Behind decoder config `mixed` (queue row MIXDEC, [`lab/av1/decode/mixed`](../../lab/av1/decode/mixed/README.md)), a split payload
whose top is over 10 bits sends its 8-bit low unit to WebCodecs' `low` decoder before dav1d-WASM decodes the
top in the worker; the low falls back to dav1d-WASM wherever WebCodecs fails it or its `g8` probe fails, and
a failed top waits for its low to settle so no low is left in flight for the next payload. Headless Chromium 141,
10 rounds interleaved: the low is 17–54 % of the frame under dav1d-WASM, and mixed takes all of it off — 0.46–0.87
of today's decode at 1× and 4× alike — while staying 1.04–2.16× w10's. Exact in Chromium, Firefox 157 and
WebKitGTK 2.52 (the last two through dav1d-WASM, as their probes send them). Off by default.

### AV1 in WebKit and Firefox

Queue row XBROWSER ([`lab/av1/exact/engines`](../../lab/av1/exact/engines/README.md)), 2026-10-05: the client's path
as it is — `decoder.js` takes `av1-webcodecs.js` for a series that says `depth` ≤ 10 where
`VideoDecoder` exists, dav1d-WASM otherwise — on the first 4 frames of all nine series and an 8-bit
grey set, in every layout of the AV1-alone codings (queue row LLSIZE), against OpenJPH in the same engine. Chromium 141,
Firefox 157.0 and WebKitGTK 2.52.6 (stock builds; Playwright's were refused), headless in a
container, 6 interleaved rounds at 1× and 4×. Desktop engines, not phones: iOS WebKit decodes
through the platform's media stack, not GStreamer.

* **dav1d-WASM and OpenJPH are exact in every engine**: 408/408 and 240/240 frames a cell, every
  layout, signed CT included; dav1d-WASM 4.1–9.6× OpenJPH at 1× and 3.9–10.0× at 4× (every AV1 variant
  slower in 732/732 paired rounds), each engine within 0.85–1.22× of Chromium's time on the same variant (median
  1.01–1.06). The `simd` build loads everywhere — all three validate WASM SIMD. Without SIMD it
  would not compile, and neither would OpenJPH: both `.wasm` files fail `wasm-validate
  --disable-simd`, so an engine without it loses HTJ2K with AV1.
* **WebCodecs as the client chooses it is exact in Chromium only.** Chromium: 240/240 frames,
  2.6–5.0× OpenJPH (dav1d-WASM 5.0–9.9× on the same sets). Firefox: `VideoDecoder` exists and
  `isConfigSupported` says true for Main 8 and 10, but every monochrome stream is refused
  (`EncodingError: The given encoding is not supported`) and 4:4:4 comes back as 8-bit `BGRX` —
  exact for 8-bit GBR, read as RGB, and 8 bits of a 10-bit RCT stream — which `read()` refuses.
  *Since the engine read-back study (queue row XENGINE):* `read()` takes 8-bit GBR as RGB, below.
  Ordinary 4:2:0 also comes back as `BGRX`. WebKitGTK: every AV1 unit fails (`Decode error`),
  ordinary 4:2:0 controls included. GStreamer's libaom `av1dec` refuses WebKit's `alignment=frame`
  caps. **So in both every series that says `depth` ≤ 10 fails every frame, 0/240 a cell**: the
  8-bit grey, the 10-bit tomosynthesis, the ultrasound and every split whose top is ≤ 10 bits.
  There is no fallback: a WebCodecs refusal is the frame's failure, not a turn to dav1d. Series
  coded over 10 bits are unaffected. *Since the unified payload format (queue row 39, UNIFY):* the choice is per payload behind a per-layout probe, and
  a payload WebCodecs fails on is decoded by dav1d-WASM — built and checked in Chromium, not re-run in
  Firefox or WebKitGTK.
* **WebKitGTK leaves `SharedArrayBuffer` off** under cross-origin isolation (Safari turns it on),
  so as shipped every frame of every codec fails — `Can't find variable: SharedArrayBuffer`, HTJ2K
  included, 0/148. With `JSC_useSharedArrayBuffer=1` it decodes as above.

What would make the choice right, proposed and not built: `typeof VideoDecoder` and
`isConfigSupported` decide nothing (Firefox and WebKitGTK both say true and decode none of these
shapes). The worker would decode a tiny lossless keyframe of the series' layout and depth at init,
check its samples, and fall back to dav1d-WASM on any difference, refusal or format it cannot read.

### Why, and what would make it exact

Queue row XENGINE ([`lab/av1/exact/engine-readback`](../../lab/av1/exact/engine-readback/README.md)), 2026-10-07. The causes are read from the
sources of the engines measured (Firefox at `FIREFOX_157_0_RELEASE`, WebKit at `webkitgtk-2.52.6`). Each
cause was then tested on the same engines with every layout a client could hand `VideoDecoder`, two real
frames each, every plane against the encoder's input. Codec strings made no difference: the derived codec
string (queue row CODECSTR) and `av01.0.04M.10` gave the same frames in every cell.

| layout | Chromium 141 | Firefox 157 | WebKitGTK 2.52.6 | WebKitGTK + `dav1ddec` |
| --- | --- | --- | --- | --- |
| 8-bit grey, 4:0:0 (the product's) | exact, `I420` | refused | decode error | no format |
| 8-bit grey, 4:2:0 mid-grey chroma | exact, `I420` | `BGRX`, off by ≤ 20 | decode error | `I420`, wrong copy at 760 wide, exact at 768 |
| the same, **tagged full range** | exact, `I420` | **exact, `BGRX`** | decode error | as above |
| 10-bit grey, 4:0:0 or 4:2:0 | exact, `I420P10` | refused, or `BGRX` (8 of 10 bits) | decode error | decode error, or no format |
| 8-bit GBR (the product's colour) | exact, `I444` | **exact, `BGRX`** | refused (`av01.1`) | refused (`av01.1`) |
| 10-bit 4:4:4 (the reversible transform) | exact, `I444P10` | `BGRX`, 8 of 10 bits | refused (`av01.1`) | refused (`av01.1`) |

Firefox's two exact rows hold for all 256 values in every plane (two synthetic ramps).

**Firefox 157.** WebCodecs decodes in the RDD process, and there the bundled FFmpeg comes before dav1d's own
module (`PDMFactory::CreateRddPDMs`). FFmpeg's libdav1d wrapper returns monochrome as `GRAY8`/`GRAY10`
(`libdav1d.c`). Gecko's plane geometry (`SetChromaPlaneGeometryFromAVFormat`) knows no grey format and treats
it as 4:2:0 with no chroma, so the copy fails and the decoder closes with `EncodingError`. Everything that does
decode reaches the page as 8-bit `BGRX`, whatever its depth or layout. `DecoderAgent` gives the decoder the
image bridge as its compositor, so the RDD uploads each picture to a texture
(`RemoteVideoDecoderParent::ProcessDecodedData`), and the frame's format is the texture's, RGB
(`GuessPixelFormat`). An identity 4:4:4 stream passes through that conversion untouched. Grey with mid-grey
chroma comes back as R = G = B = Y only at full range; at limited range the expansion moves it by up to 20.
`copyTo({ format })` converts to RGB alone. Even a planar image would lose its depth: Gecko's image formats
have no 10-bit YUV (`ImageUtils`). Two preferences were tried. `media.rdd-process.enabled` false removes
WebCodecs AV1 (every configuration unsupported), and `media.rdd-ffvpx.enabled` false changes nothing. **So in
Firefox 157 no 10-bit layout can be exact, and 8-bit can, as GBR or as full-range 4:2:0 grey.**

**WebKitGTK 2.52.6.** Three faults stack.

1. WebCodecs takes only `av01.0` strings (`isSupportedDecoderCodec`), so every 4:4:4 stream, being High
   profile, is refused at `configure`. The derived codec strings make that refusal visible up front, where
   the old fixed string let it fail later as a decode error.
2. The decoder is handed `video/x-av1, alignment=frame` with no parser in front (parsers are inserted for
   H.264 and H.265 only), and Ubuntu's one AV1 decoder, libaom's `av1dec`, takes `alignment=tu` alone. Every
   unit fails.
3. With gst-plugin-dav1d's `dav1ddec`, which takes `frame`, ranked first, the frames decode, but only `I420`,
   `I422`, `I444`, `NV12`, `A420` and 8-bit RGB have a WebCodecs format (`convertVideoFramePixelFormat`). Grey,
   10-bit and GBR frames come back with none, and `copyTo` refuses them. `copyTo` itself handles only `NV12`,
   `I420` and RGBA ("FIXME: Handle I422, I444…"). It also reads an even-width `I420` frame's luma at the frame's
   width rather than at GStreamer's stride (`bytesPerRowY`), so the 760-wide frame (stride 768) comes back
   wrong from row 66 on, while 416 of its 421 rows match the input read at 768, and the 768-wide frame is exact.

So on WebKitGTK at most an 8-bit 4:2:0 frame whose width equals the decoder's stride can be exact, and only
with a decoder that is not installed by default. Nothing to adopt.

**Safari, from the same source; not run here.** On Cocoa, WebCodecs AV1 sits behind the preference
`WebCodecsAV1Enabled`. Its status is preview and it is off by default everywhere but the GStreamer ports
(`UnifiedWebPreferences.yaml`). Where it is on, it decodes in software through libwebrtc's dav1d
(`LibWebRTCVPXVideoDecoder`, type AV1), which refuses anything but 8-bit 4:2:0
(`layout != I420 || bpc != 8`) and returns `NV12`. No hardware decoder is on that path. Exactness on a phone
therefore waits on a device run (§Open), and at best covers the same
8-bit 4:2:0 grey.

**Built: the client reads 8-bit GBR as RGB.** `av1-webcodecs.js` takes a `BGRX` or `RGBX` frame of a
4:4:4 identity stream and splits it into the G, B and R planes it was coded in. Grey returned as RGB is still
refused. The per-layout probe now passes `c8` in Firefox, so an 8-bit colour series decodes there through
WebCodecs. Through the product's worker (`lab/av1/exact/engines`, the ultrasound's first 4 frames, 10 interleaved rounds)
every frame stays exact against the source's checksum, 40/40 per cell. A frame takes 0.77× dav1d-WASM's time
on the same frames at 1× (range 0.67–1.12, faster in 9 of 10 rounds) and 0.62× at 4× (0.56–0.71, 10 of 10):
58 against 79 ms, and 190 against 300 ms. One decode at a time on 4 cores, nowhere near the host's saturation;
a container's times, not a phone's. Chromium is unchanged: it returns `I444`, and its frames and choice stay as before. Three
mutations failed the new checks: G and B swapped, the RGB path removed, and grey taken as RGB.

**Proposed: 8-bit grey coded as full-range 4:2:0.** *Built and measured since (queue row GREY420), not adopted:* every reader path takes it as grey, Firefox's frames reach the page through WebCodecs exactly, and its slow-CPU fills gain 13–26 % on fast links while Chromium's lose 0.2–3.4 % ([`docs/av1/payload-format.md`](../av1/payload-format.md) §8-bit grey as 4:2:0). The ingest would code 8-bit grey with mid-grey
chroma and the full-range flag instead of 4:0:0. The cost is +0.07 % bytes on the ultrasound's grey (+0.06 %
at 10 bits). The client would take `BGRX` with R = G = B as grey. Chromium still returns `I420` with neutral
chroma, which `read()` already takes. In Firefox this would make every 8-bit grey series exact through
WebCodecs, and with it every split's 8-bit low stream (§A split payload through two decoders). It changes what the
store holds for those series, so it is the owner's call
([`docs/av1/payload-format.md`](../av1/payload-format.md)). Neither Firefox's tops over 8 bits nor anything in
WebKitGTK can follow without the engines changing: grey and high-depth formats in Gecko's FFmpeg path and
`VideoFrame`, and in WebKit a parser before the decoder, the grey and high-depth formats, an `I444` copy and
the stride fix.

### Decode time against HTJ2K

Queue row SPEED ([`lab/av1/decode/per-frame`](../../lab/av1/decode/per-frame/README.md)), 2026-10-03. The first 18 frames of three
real series (the public series set, queue row DATA), each as the served HTJ2K and as lossless AV1 intra (libaom 3.15.1 `cpu-used`
0, G = 1 as the lossless-bytes measurement recommends, queue row SIZE). Every variant is the product's decoder worker — `decoder.js` with the
OpenJPH package, `decoder.js` → `av1-dav1d.js` with dav1d-WASM `simd` — or WebCodecs behind the
same protocol and output, timed by the worker's own decode stamps (bytes in, the contract's pixels
and range out), one frame at a time after a warm-up frame. 16 rounds, each (environment × throttle)
cell a fresh process in a Williams order, sets and variants rotated inside it. **7 488 of 7 488 timed
frames exact** against the series' checksums; flipping one bit of every decoded frame, or one digit
of every checksum, turns all 13 cells to 0/18.

ms a frame, median over rounds of each round's median [range of the round medians]; × is AV1 over
HTJ2K, paired by round:

| set | env | throttle | HTJ2K, OpenJPH | AV1, dav1d-WASM | × | AV1, WebCodecs | × |
| --- | --- | --: | --: | --: | --: | --: | --: |
| fluoroscopy 768², 12-bit | Node | 1× | 7.99 [6.99–10.9] | 71.5 [69.3–74.4] | **8.9** | — | |
| | | 4× | 30.6 [23.7–36.2] | 300.6 [288.5–312.3] | **9.7** | — | |
| | Chromium | 1× | 9.78 [8.44–13.4] | 70.1 [65.3–74.3] | **7.1** | refuses 12 bits | |
| | | 4× | 34.8 [31.6–40.1] | 290.6 [275.7–312.9] | **8.1** | | |
| MR 512², 11 bits (AV1 at 12) | Node | 1× | 4.30 [3.76–7.17] | 26.9 [25.3–28.5] | 6.3 | — | |
| | | 4× | 16.1 [13.2–16.4] | 106.6 [92.6–112.8] | 6.9 | — | |
| | Chromium | 1× | 4.88 [4.66–5.88] | 26.2 [23.8–27.6] | 5.4 | refuses 12 bits | |
| | | 4× | 16.8 [13.8–28.1] | 103.8 [97.0–111.9] | 6.1 | | |
| ultrasound 760×421, RGB 8 | Node | 1× | 7.26 [6.50–8.42] | 48.5 [44.6–51.3] | 6.5 | — | |
| | | 4× | 26.4 [18.9–32.2] | 203.8 [189.9–225.6] | 7.6 | — | |
| | Chromium | 1× | 7.86 [7.58–8.47] | 48.4 [45.4–52.3] | 6.1 | 33.6 [31.2–37.0] | **4.2** |
| | | 4× | 28.5 [25.5–32.9] | 196.9 [185.3–226.0] | 6.9 | 115.4 [108.4–128.2] | **4.1** |

* **AV1 is slower in every round of every cell**: the smallest of 224 paired ratios is 3.6×. The
  earlier desktop figure of ~10× (docs/av1/README.md §Prior evidence, not reproduced here) is the right size: 5–10× here
  for dav1d-WASM, worst on the 12-bit fluoroscopy, and the throttle widens it slightly.
* **The cost is dav1d's, not the copy-out**: `_av1_decode` alone is 67.5, 23.8 and 42.6 ms of the
  ~71, ~26 and ~46 ms a frame in Node (one pass of 18 frames, not interleaved), so `av1-dav1d.js`'s
  interleave and range pass are 6–12 %.
* **WebCodecs is the faster AV1 path where it is exact** — 1.4–1.9× faster than dav1d-WASM (median 1.55, 32/32 rounds), still
  4.1–4.2× OpenJPH — and that is only 8- and 10-bit (§WebCodecs): of these series, the ultrasound.
* Where the host saturates: one decoder at a time on four cores, so nothing here contends; three
  decoders in parallel were not run, and the fill figures in `docs/av1/README.md` §Total time multiply a
  single decoder's time out by arithmetic. *Since measured (queue row FILL):* three decoders through the downloader,
  `docs/av1/README.md` §Total time — the arithmetic's verdict holds, its sizes were optimistic.

## JPEG XL

Queue row JXL ([`lab/av1/bytes/jpeg-xl`](../../lab/av1/bytes/jpeg-xl/README.md)), 2026-10-07: lossless JPEG XL (libjxl 0.12.0) at effort 1–7 and
`--faster_decoding` 0–4 against the served HTJ2K, on the first 8 frames of seven sets from 8 to 16 bits; libjxl in WASM
(the embedded-codecs measurement's single-threaded SIMD build, queue row EMBED) and each engine's own decoder, 8 interleaved rounds at 1× and 4× in Chromium
154 and Firefox 157. Container-measured.

* **Exact everywhere it decodes samples.** Every one of 35 codings × 37 frames through `djxl`; 7 040/7 040 timed WASM
  and OpenJPH frames. The lossless-bytes measurement's inexact 12-bit cjxl (0.7.0, queue row SIZE) does not recur in 0.12.0 at any depth up to 16.
* **The browsers return 8 bits.** Native JPEG XL decoding exists in Chromium 154 (jxl-rs, behind `JXLImageFormat`, off
  by default; none in Chromium 141) and Firefox 157.0.1 (behind `image.jxl.enabled`, off), not in WebKitGTK 2.52.6.
  Where it decodes, `<img>`, `createImageBitmap`, `ImageDecoder` (always `BGRX`) and a float16 canvas read all give
  8-bit samples: exact on 8-bit grey and RGB, display pixels above (Firefox rounds; Chromium's `ImageDecoder` is
  within one 8-bit step, its `<img>` within three). Safari has decoded JPEG XL since 17.0 — not tested here.
* **Bytes and decode trade one for the other, and no setting wins both.** Effort 1 is 0.94–1.03 of HTJ2K's bytes at
  1.03–1.91× OpenJPH's WASM decode; e7 with `--faster_decoding=3` 0.91–0.98 at 1.56–2.45×; the default e7 0.81–0.96
  at 5.35–10.0×. The 30 MP 16-bit film scan is 0.53 at e5–7.
* **Native beats libjxl-WASM only at the default effort** (2.2–6.1× OpenJPH, 192 of 192 rounds under WASM), and only on
  8-bit RGB at fast efforts does it beat OpenJPH (the ultrasound, 0.61–1.19×), where the canvas loses nothing.

So JPEG XL earns no place in the decode path: where it saves 5 % of the bytes or more it decodes 1.5–10× slower, the
browsers cannot hand over samples above 8 bits, and the one case where native beats OpenJPH sits behind a flag in both
engines that have it.

## Not yet tried

Queue row DECODEOPT, 2026-10-10: what is left for today's codecs, read from sources and from the decoders' code;
nothing built or timed. Rows 9, 11, 27, 57, 78 and 108–113 hold what was tried — build flags, relaxed SIMD as a flag,
the wrapper's two passes, the range pass, encoder settings (block size and shape, 3–6 decompositions, LRCP,
precincts), code-blocks on threads and coarser units, stripes and region decode, a WebGPU block decoder, decode paced
to the wire, dav1d threads with tiles — and none of it is proposed again. Every gain below is a prediction, not a
measurement, unless it names the row that measured it.

**What the code says.**

* **OpenJPH has no ARM SIMD.** At 0.31.0 (`c68064d`) and at upstream's head (`6238b0e`, 2026-10-06) the
  `OJPH_ARCH_ARM` branch of every dispatch — block decoder (`ojph_codeblock_fun.cpp`), wavelet
  (`ojph_transform.cpp`) and colour (`ojph_colour.cpp`) — is empty, so a native ARM build runs the scalar block
  decoder and wavelet; x86 gets SSSE3 and AVX2 block decoders and SSE2 to AVX-512 wavelets, POWER gets VSX. Its
  status page says SIMD "for Intel and ARM" may come later [1]. The WASM build has its own SIMD block decoder,
  wavelet and colour (`*_wasm.cpp`), which an engine lowers to NEON on a phone: **in the browser a phone gets
  OpenJPH's SIMD; natively it does not.** SIMDe 0.8.2 implements the WASM SIMD128 API in C with NEON paths (203
  NEON branches in `simde/wasm/simd128.h`) [2], so the `*_wasm.cpp` kernels could compile natively on ARM unchanged
  — not tried.
* **OpenJPH skips PLT and TLM on read** (`ojph_codestream_local.cpp`: "Skipping TLM/PLT marker segment"), and its
  core has no threads at either commit. Markers that let a decoder seek buy OpenJPH nothing; they matter only to a
  decoder that decodes or fetches part of a frame (§Region decode, measured).
* **dav1d-WASM is C only.** dav1d 1.5.4 (`54706fc`) has hand-written x86 and ARM assembly for everything a
  lossless frame uses — the entropy decoder (`msac.S`: `msac_decode_symbol_adapt4/8/16_neon`, `hi_tok`), the 4×4
  Walsh–Hadamard at 8 and 16 bits (`inv_txfm_add_wht_wht_4x4_16bpc_neon`), intra prediction — and none for WASM;
  `-msimd128` is auto-vectorisation (`client/decode/wasm/dav1d/README.md`). Native dav1d with its assembly, one
  thread and process start included, read 46.9 ms on a `cpu-used` 6 fluoroscopy stream where dav1d-WASM read 70–72 ms
  on the `cpu-used` 0 one in row SPEED — different streams, runs and harnesses, so ~0.65 of WASM is a hint, not a ratio ([`lab/av1/README.md`](../../lab/av1/README.md)
  §What each costs the decoder; §Decode time against HTJ2K). A lossless frame is 66–84 % entropy decoding, serial
  within a tile (row DECSPEED), which bounds what any SIMD can take.

**What the platforms say.** WASM SIMD is in Chrome 91, Firefox 89 and Safari 16.4; relaxed SIMD in Chrome 114 and
Firefox 145, Safari only behind a JavaScriptCore flag; threads everywhere [3]. Wider vectors (Flexible Vectors) are a
phase-1 proposal [4]: 128 bits is the browser's width for the foreseeable future. §The decode tail found `-mrelaxed-simd`
leaves OpenJPH's binary byte-identical, so relaxed SIMD pays only through hand-written intrinsics, and then not in
Safari. Hardware AV1 decode on Apple ships from the iPhone 15 Pro's A17 Pro and M3 (secondary sources quoting Apple's
2023 announcement; Apple's own page not read) [5]; Android guarantees Main 8/10 at level 4.1 (row SWEEP). Whether any
hardware decoder returns a lossless 4:0:0 or split stream exactly is unknown until a device runs it (§Open).

**The source of "~570 MB of coded queue on tomosynthesis" was not found** in any branch's docs, lab READMEs or
history (searched 2026-10-10); what is known is that the compressed queue grows whenever decoders fall behind the wire,
read from the code, and that a reader pause is proposed, not built ([`../ARCHITECTURE.md`](../ARCHITECTURE.md)
§Memory).

**Left, ranked by expected gain on the target** (phones; an ask and a fill both count; *large* is 1914×2572 and up):

| # | lever | where | mechanism | expected | decides it |
| --- | --- | --- | --- | --- | --- |
| 1 | **Tiles as independent codestreams** for large frames: k horizontal tiles, each stored as its own HTJ2K codestream, decoded by k idle OpenJPH workers into one shared frame | browser and native; an ask | row REGIONDECODE's stripes, ×0.60–0.68 of OpenJPH at 4× on large frames, paid OpenHTJ2K's ×1.13–1.41 slower decoder and 1.13–1.17× the block bytes for overlaps; tiles have neither, and need no threads and no second decoder | ×0.45–0.60 of today's ask at 4× on large frames, k = 3; bytes +0.2–1.5 % (the wavelet stops at a tile's edge; unmeasured); a fill unchanged | P-TILE below; a change to the store's format — structural, the owner's |
| 2 | **OpenJPH under a newer emscripten** (6.0.11 against the pinned 3.1.74) | browser; every frame | code generation | ×0.94–0.97 a frame, fill and ask (row VERSIONS: 0.94–0.96 pooled, inside a 2–7 % spread at 6 rounds — "the one lever worth a longer run") | P-EMSDK |
| 3 | **OpenJPH's SIMD on native ARM**: the `*_wasm.cpp` kernels through SIMDe, or a NEON port | native phone and Apple Silicon | the empty ARM dispatch above | without it a native ARM decode is predicted 1.3–2.0× the browser's on the same phone; with it, at or under the browser's | P-ARM, before row NATIVEPLAN's first timing |
| 4 | **The copy out of the heap and the RGB pack** | browser; every frame | samples written once, where the page reads them; a shuffle interleave for three components (row FASTHTJ2K's ranks 2 and 3, bounded, never built) | ×0.88–0.95 grey, ×0.82–0.92 RGB | P-COPY |
| 5 | **Decoders started on first need**, never retired | browser; a fill's CPU and an ask's start | row DECODEPACE: today's dispatch decodes on one decoder in 9 of 12 cells, and what pacing saved was starting the two never used | fill ×0.99–1.01; decoder CPU ×0.85–0.98; wake-ups fewer; cold ask unchanged | P-START |
| 6 | **The reader pause** (bound the coded queue; QUIC flow control stops the server) | browser and native; memory | decoders slower than the wire hold the series' coded bytes | peak memory bounded at the pause's size on a fill where decode is the clock; time ×1.00–1.02 | memory, not time; a row of its own if a phone's memory binds |
| 7 | **The WebGPU block decoder natively** through wgpu, painting from the GPU | native | row WEBGPUHT's WGSL runs unchanged on Metal, Vulkan and D3D12; a native painter drops `mapAsync`'s read-back, which on SwiftShader cost 2× the heap copy on frames over 4 MB | the bound's *ideal* column, 67–75 % of a large frame (§A WebGPU block decoder, bounded); unmeasured on any GPU | row NATIVEPLAN; §L3's phone stage first |
| 8 | **Relaxed SIMD, hand-written** in the HT block decoder's swizzles and the wavelet | browser, not Safari | fewer instructions per lane shuffle on x86; on ARM most relaxed ops lower as the strict ones | ≤ 3 % a frame; two builds to ship | not proposed |
| 9 | **dav1d's entropy decoder in WASM SIMD** | browser, AV1 only | `msac`'s CDF search vectorised, as its NEON does | ≤ 0.65 of dav1d-WASM's time by the native hint, still 3–6× OpenJPH | not proposed while no series is served as AV1 (`../codecs/README.md` §Which series AV1 is for) |
| 10 | **Hardware AV1 on a phone** (A17 Pro and later, Android SoCs) for 8- and 10-bit streams and the top10+low split | phones | a fixed-function decoder | unknown; exactness first | a device run (§Open) |

*Not a lever:* decoding an ask's lower resolutions while its last bytes arrive — the last resolution is ~¾ of the
samples and of the decode, and §A frame at the level the screen needs already draws a level picture first; PLT and TLM
for OpenJPH (it skips them).

**Other lossless codecs, listed, not explored.**

* **JPEG-LS** (CharLS, in WASM as `@cornerstonejs/codec-charls`): as good as or better than JPEG 2000 on breast
  tomosynthesis, over 4–5:1, unless multi-slice JPEG 2000 is used (Clunie, RSNA 2012 [6]); CodSpeed's simulated runs
  of Cornerstone's codecs show ~16–20 ms for a 512² CT frame (simulated instruction counts, not wall time; search
  excerpts only) [7]. A DICOM transfer syntax; no resolution prefix.
* **Tomoz**: no published codec under that name was found (searched 2026-10-10); a codebook-based tomosynthesis
  patent exists [8]. Listed as not found.
* **TCT** (tri-plane context trees, Bai et al., arXiv 2608.13897, 2026-08-14): lossless volumetric coding learned per
  input, no network weights, "on par with recent DNN-based methods", "fast coding speeds" (abstract read) [9]; its
  per-slice decode of 0.05–0.06 s against JPEG-LS's 0.02–0.03 s is from a search excerpt of its Table VI, not read.

**Proposed measurements** (none queued; each in the container first, every frame against the encoder's input,
interleaved, n ≥ 10, `g512` and the five sound breast series):

* **P-TILE.** k = 2 and 3 horizontal tiles on the large series, each tile its own codestream in the served profile.
  Predictions: bytes +0.2–1.5 %; a warm ask on k idle workers ×0.45–0.60 of the reference at 4×, ×0.55–0.70 at 1×;
  ×1.00–1.03 on one worker. *Rule:* worth a store-format proposal when every frame is exact, bytes ≤ +1.0 %, and the
  k = 3 ask is ≤ ×0.60 at 4× on every large series in ≥ 8 of 10 rounds and under three stripes' ratio (row
  REGIONDECODE); otherwise not, naming the cell.

  *Measured 2026-10-11, queue row TILEMEASURE* ([`lab/av1/decode/tile`](../../lab/av1/decode/tile/README.md), raw
  `raw/tile.jsonl`). The run is REGIONDECODE's harness, rounds and pins: headless Chromium 141 on 4 cores, 1× and 4×,
  10 rounds Williams-ordered, the first 4 frames of `g512` and the five breast series, 3 timed passes after a checking
  one. The arms differ only in what each worker decodes: the `ref` build (sha256 `65c1501a…`) on 1 or k workers, and
  row REGIONDECODE's three OpenHTJ2K stripes (`6e0c00f2…`). **2 640/2 640 asks exact**, each tile and each frame
  against the encoder's input. `--mutate flip`, `shift` and `swap` took every arm they touch to 0/4. Each ask is the
  median of round medians, × `ref` paired by round:

  | set | bytes t2 · t3 | ref ms 1× · 4× | t2 1× · 4× | t3 1× · 4× (rounds ≤ ×0.60 at 4×) | t3 ÷ 3 stripes, 4× | t2, t3 on one worker 4× |
  | --- | --- | --- | --- | --- | --- | --- |
  | `g512` 512² | +0.10 · +0.59 % | 5.07 · 14.8 | ×0.587 · ×0.468 | ×0.548 · ×0.300 (10/10) | — | ×1.031 · ×1.085 |
  | 614×1359 | +0.12 · +0.21 % | 9.27 · 33.8 | ×0.565 · ×0.504 | ×0.530 · ×0.413 (10/10) | — | ×0.968 · ×1.050 |
  | 931×2124 | +0.13 · +0.13 % | 18.4 · 74.8 | ×0.648 · ×0.646 | ×0.478 · ×0.476 (10/10) | — | ×1.129 · ×1.041 |
  | **1914×2572** | +0.07 · +0.13 % | 76.6 · 336 | ×0.558 · ×0.555 | ×0.448 · **×0.388 (10/10)** | ×0.627 (10/10 under) | ×1.038 · ×1.080 |
  | **2394×2850** | +0.04 · +0.12 % | 66.7 · 305 | ×0.616 · ×0.569 | ×0.441 · **×0.405 (10/10)** | ×0.682 (10/10 under) | ×1.068 · ×1.043 |
  | **3328×4096** | +0.01 · +0.12 % | 91.9 · 395 | ×0.543 · ×0.565 | ×0.433 · **×0.448 (10/10)** | ×0.650 (10/10 under) | ×0.998 · ×0.996 |

  **The rule passes on every count:** every frame exact, bytes ≤ +0.59 % (bar +1.0 %), and k = 3 at 4× on the three
  large series is ×0.388–0.448 of the reference in 10 of 10 rounds each. It is also under the three stripes' ratio in
  every round: the stripes read ×0.597–0.689 here, as row REGIONDECODE found. So it is worth a store-format proposal,
  which is the owner's (§Blocked in the queue).

  *Predictions:*
  * Bytes +0.2–1.5 %: **lower than predicted**, +0.01–0.13 % at k = 2 and +0.12–0.59 % at k = 3. Only `g512` and
    614×1359 at k = 3 fall in the range.
  * The ask on k workers at 4×, ×0.45–0.60: **held at k = 2** on 5 of 6 sets (931×2124 reads ×0.646). **Beaten at
    k = 3**: ×0.300–0.476, under the range on 5 of 6.
  * At 1×, ×0.55–0.70: **held at k = 2** on 5 of 6 (3328×4096 reads ×0.543). **Beaten at k = 3**: ×0.433–0.548 on
    all 6.
  * One worker ×1.00–1.03: **did not hold**. It reads ×0.97–1.13 at 4× and up to ×1.24 at 1× on 614×1359: k decoder
    calls in turn cost a small frame more than predicted. On the large series it is ×0.99–1.08.

  Container times, not a phone's. Three decoding workers and the page fit the 4 cores, so nothing past k = 3 is
  claimed.
* **P-EMSDK.** OpenJPH 0.31.0 built by the product's recipe under emscripten 6.0.11 and 3.1.74, a frame, a cold ask
  and a fill (50 Mbit, `lte-good`), 1× and 4×. Prediction ×0.94–0.97. *Rule:* adopt when ≤ ×0.97 on every set at 1×
  and 4× in ≥ 8 of 10 rounds and no fill over ×1.01.
* **P-ARM.** On x86 in the container, one native binary per arm over the same frames, process start excluded: OpenJPH
  with `-DOJPH_DISABLE_SIMD=ON`, with its SSSE3 kernels only, and with its `*_wasm.cpp` kernels through SIMDe; and the
  WASM build in Node. Predictions: scalar 1.3–2.0× the SSSE3 arm; SIMDe within ×0.95–1.10 of SSSE3; WASM in Node
  ×1.1–1.5 of SSSE3. *Rule:* if scalar is over ×1.2 of the SIMDe arm, native ARM needs the port before any native
  timing is compared with the browser; then the same three arms on an ARM host (a phone or Apple Silicon, the owner's).
* **P-COPY.** The wrapper writing samples into a buffer the page keeps (a `SharedArrayBuffer` view) and a shuffle
  interleave for RGB, against the delivered build, a frame at 1× and 4×. Predictions as row 4 of the table. *Rule:*
  adopt when ≤ ×0.95 on every set in ≥ 8 of 10 rounds and the page's peak memory is no higher.

  **P-EMSDK and P-COPY, measured 2026-10-11** (queue row EMSDKMEASURE; run from the protocols and rules above alone;
  [`lab/decode-bench/emsdk`](../../lab/decode-bench/emsdk/README.md), [`lab/decode-bench/copy`](../../lab/decode-bench/copy/README.md)).
  Headless Chromium 141 in the container, 10 rounds Williams-ordered, each arm ÷ the delivered build paired by round.
  Every frame was exact against the encoder's input: 8 040 a frame, 480 cold asks and 16 080 filled for P-EMSDK, and
  17 280 for P-COPY. `--mutate sample` and `truth` failed every frame.

  * **P-EMSDK: not adopted.** It fails the rule on a frame and on a cold ask.
    * **A frame, ×median [range], rounds ≤ ×0.97:**

      | set | 1× | 4× |
      | --- | --- | --- |
      | `g512` | ×0.991 [0.92–1.10], 3/10 | ×0.962 [0.40–2.43], 5/10 |
      | tomosynthesis 614×1359 | ×0.989 [0.62–1.14], 3/10 | ×1.061 [0.82–1.29], 3/10 |
      | tomosynthesis 931×2124 | ×0.975 [0.61–1.42], 5/10 | ×0.968 [0.77–1.12], 5/10 |
      | projections | **×0.931, 9/10** | **×0.886, 10/10** |
      | synthesized 2D | ×0.957, 6/10 | ×0.959, 6/10 |
      | full-field | ×0.965, 6/10 | ×0.931, 6/10 |

      The prediction (×0.94–0.97) held in 5 of 12 cells. The newer toolchain gains on the largest frames and nothing
      that separates on the rest.
    * **A cold ask** (`--fill 1`, 50 Mbit and `lte-good`): ×0.960–1.017 by cell, at most 6 of 10 rounds ≤ ×0.97.
      Strict and round-paired agree (72 of 480 visits `VOID`).
    * **A fill:** ×0.995–1.003 by cell. The wire is the fill's clock, so no fill is over ×1.01; that clause holds
      (49 of 480 `VOID`, readings agree).
    * **A recipe fix is owed before any later move.** Emscripten 6.0.2 dropped `wasmBinary` and
      `mainScriptUrlOrBlob` from the default `INCOMING_MODULE_JS_API`. Under 6.0.11 the delivered recipe therefore
      builds a glue that ignores the bytes `wasm-glue.js` checked against the manifest and fetches its own `.wasm`,
      unchecked. The measured arm restores both names; the `.wasm` is the same bytes either way.
  * **P-COPY: not adopted.** It is under ×0.95 in ≥ 8 of 10 rounds in one cell of 14.
    * **Grey sets:** ×0.95–1.05 (`g512` ×0.985 / ×0.863, the tomosynthesis ×0.95–0.97, projections ×0.999 / ×1.028,
      full-field ×0.955 / ×1.049, at 1× / 4×). This refutes the prediction of ×0.88–0.95: the copy the patch removes
      is smaller than the spread.
    * **RGB, on `c512` only** (synthetic, 87 × 512²; no sound RGB set is in the protocol's list): ×0.954 at 1×, 4 of
      10 rounds, and **×0.866 at 4×, 8 of 10**. The prediction (×0.82–0.92) held at 4× only.
    * **`-pthread` alone,** which the shared heap needs: ×0.95–1.06, no cost that separates.
    * **Peak memory** (every frame kept, 3 rounds): no higher, and 5–25 MB lower on the three 4.9–13.6 M-sample sets
      (full-field 588 → 563 MB).
    * The memory clause holds; the time clause fails on every grey set.
* **P-START.** The downloader starting a second and third decoder only when the queue first holds work for them,
  never retiring, against today's, row DECODEPACE's harness and cells. Predictions as row 5 of the table. *Rule:* the
  container stage passes when every fill is ≤ ×1.01 in ≥ 8 of 10 rounds, the cold ask ≤ ×1.02, and decoder CPU
  ≤ ×1.00; energy is a phone's (§L5's phone rule).

  *Measured (row STARTMEASURE, 2026-10-11; [`lab/av1/delivery/total-time`](../../lab/av1/delivery/total-time/README.md)
  §Row STARTMEASURE).* `startOnNeed` on the downloader (a lab flag beside `followQueue`, off by default) against
  today's, the delivered OpenJPH build, row DECODEPACE's cells (whole tomosynthesis 29 × 614×1359 and full-field
  4 × 3328×4096; r20000, r50000, `lte-good`; 1× and 4×) and a cold ask in each (a fresh browser, frame 0 the session's
  first work, timed from the ask). Headless Chromium 141 in a 4-core container; the arms differ in the flag alone
  (same build, `cubic-restart`, quinn's window). 18 Williams-ordered rounds, 864 visits, 120 `VOID` (fills 9 %, asks
  19 %, under the 20 % bar), 7 560/7 560 frames exact. `need` ÷ today, paired by round, strict | round-paired:

  | | fills, median a cell | fill ≤ ×1.01 | decoder CPU | wake-ups | cold ask, median a cell |
  | --- | --- | --- | --- | --- | --- |
  | strict (n 8–18) | ×0.994–1.004 | 11/15–16/16 a cell | ×0.86–0.95 | ×0.18–0.44 | ×0.952–1.026 |
  | round-paired (n 18) | ×0.998–1.003 | 12/18–18/18 | ×0.89–0.96 | ×0.18–0.44 | ×0.948–1.028 |

  Predictions: fill ×0.99–1.01 held; decoder CPU ×0.85–0.98 held; wake-ups fewer held; cold ask unchanged held on
  11 of 12 cells, not on tomosynthesis `lte-good` 4× (×1.026 \| ×1.028, 5/11 and 7/18 within ×1.02). **The container
  stage fails its rule, in both readings**, on two counts: the full-field fill at 4× on r20000 and r50000 is ≤ ×1.01
  in 11/15 and 12/17 strict rounds (13/18, 12/18 paired; medians ×0.994–1.004, spread ×0.92–1.06), under 8 in 10,
  and that one cold ask is over ×1.02. Decoder CPU passes on every cell. Today starts three decoders and uses one in
  8 of 12 fill cells; `startOnNeed` uses one in every cell but tomosynthesis over `lte-good`, where it uses two of today's three. Not measured:
  whether the 4× full-field spread is this lever's or the host's (no A/A arm ran); energy, a phone's.

Sources (read 2026-10-10 unless marked):

1. OpenJPH `docs/status.md` and source at `0.31.0` (`c68064d0`) and `main` (`6238b0ec`) — <https://github.com/aous72/OpenJPH>
2. SIMDe v0.8.2, `simde/wasm/simd128.h`, sha256 `7e2fed8b…ce70b` — <https://github.com/simd-everywhere/simde>
3. WebAssembly feature status, `features.json` (WebAssembly/website `main`), sha256 `c2e06fac…28904` —
   <https://webassembly.org/features/>
4. WebAssembly proposals, phase 1, sha256 `7119f6d1…2fcb` — <https://github.com/WebAssembly/proposals>
5. Bitmovin, "Apple AV1 support" (quoting Apple and HLS's Roger Pantos; search excerpt only) —
   <https://bitmovin.com/blog/apple-av1-support>
6. D. Clunie, "Lossless compression of breast tomosynthesis", RSNA 2012 LL-INS-WE6B (search excerpt only) —
   <https://dclunie.com/papers/RSNA_2012_LL-INS_WE6B_Clunie_MammoTomoCompression.pdf>
7. CodSpeed runs of cornerstonejs/codecs (search excerpt only) — <https://codspeed.io/cornerstonejs/codecs>
8. US patent 12164768, "Medical imaging data compression utilizing codebooks" (title only) —
   <https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12164768>
9. Y. Bai et al., "Practical Lossless Volumetric Medical Image Compression via Tri-plane Context Tree Learning",
   arXiv 2608.13897 (abstract) — <https://arxiv.org/abs/2608.13897>
10. dav1d 1.5.4 source (`54706fc6`) — <https://code.videolan.org/videolan/dav1d>

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
* **WebCodecs AV1 on Safari** — a device run, which at best covers 8-bit 4:2:0 grey (§Why, and what would make it
  exact). The owner tracks the device runs in [`docs/av1/queue.md`](../av1/queue.md) §Blocked.
* The glue evaluated through `new Function`, where no code cache reaches it (§Instantiating by
  streaming). Ranked 2026-10-01 and not queued: a second visit only, ~10 ms per decoder and the
  three in parallel, and off frame 0's path on a link — the decoders are ready about 4–5 round
  trips before frame 0's bytes land (derived from page-open's ladder, not measured), and the
  warm-up's later `ready` did not reach the page's clock either (§Warming the decoders). Its case
  is a CSP without `unsafe-eval`, a deploy decision, or a device cell where the glue's compile is
  no longer hidden.
* A heap floor chosen for first-frame latency; the package's own build re-timed since D10.
* BYOB's ~12 ms first frame, and what an errored stream owes the frame in flight (§The BYOB read
  path).
* Looked at and dropped, not measured: GPU decode (*corrected:* WebGPU now runs in Chrome on Android
  and Safari on iOS 26; dropped instead on the profile's 6–12 % ceiling against its copies, §Faster
  HTJ2K in the browser), fewer decompositions
  (estimated ≤ 0.5 %), a BYOB read into the WASM heap (its memory is not detachable).
