
### What each path allocates

L18. On a phone, allocation churn is a cost in its own right whatever it does to the clock, and the
premise this was first written on was backwards. Both paths hand on a buffer allocated per frame —
the default one copies the frame out of WASM memory into a fresh `Uint8Array`, byob reads straight
into one — so byob adds no per-frame allocation. What differs is *before* that: the default reader
receives every read as a new chunk the browser allocated and copies it into a reused receive buffer
in WASM memory, while byob fills one caller-owned buffer across its reads.

**byob allocates less, and `byob-min` less again.** One 237-frame fill of 512×512 16-bit frames
(92.8 MB of codestreams), five rounds per arm, arms rotated each round, `lab/scripts/read_path_alloc.cjs`:

| arm | collections per fill | per frame | JS heap high-water |
| --- | ---: | ---: | ---: |
| default | 338 [305 … 350] | 1.43 | 71.4 MB [70 … 75] |
| `byob` | **201** [185 … 257] | 0.85 | 67.7 MB [67 … 68] |
| `byob-min` | **165** [158 … 188] | 0.70 | 66.2 MB [66 … 67] |

**−40.5 % collections for `byob` and −51.2 % for `byob-min`, fewer in 5 of 5 paired rounds each.**
The heap high-water moves with it and the ranges do not overlap: default never came in under 70 MB
and neither byob arm ever reached it. That is the shape the corrected premise predicts — the saving
is the per-read chunks the default reader is handed, and `byob-min`'s larger reads remove more of
them, which agrees with the read counts already recorded above (4.70 → 2.00 reads on a 250 KB frame).

**A free list is not the answer to this, because this is not byob's problem.** The lane asked what
one would need if byob's churn turned out material. It is the *smaller* of the two, so the design
is not written: a free list would help the default path more, and both paths would still allocate
the frame buffer they hand on. If one is ever wanted, the question it has to answer is the same for
either path — which thread hands the buffer back, and when the consumer is known to be done with it
— and that is exactly what the pipeline redesign is deciding
([`../proposal-downloader.md`](../proposal-downloader.md)).

**Instruments, and one substitution.** `--js-flags=--trace-gc` emits nothing in this Chromium
(141, headless) — not to the browser's stderr, not to the renderer's, with `--single-process` and
`--enable-logging=stderr` both tried — so collections are counted from the `disabled-by-default-v8.gc`
trace category over CDP instead, which does work. The heap high-water is
`performance.memory.usedJSHeapSize` under `--enable-precise-memory-info`. CDP's `HeapProfiler`
sampler reads **1.10 MB in every arm**, identical: it samples the JS heap, and the buffers these
arms differ over are `ArrayBuffer` backing stores, which it does not weigh. That figure is reported
only to say it settles nothing — the collections and the high-water are what carry the finding.

**Counts, not timing.** Nothing here is a millisecond, so nothing here needs the rig. All three arms
are the same `wasm-pack` build of the same source, differing only in the feature flag, and every run
delivered 237 of 237 frames.
# Decode — codestream to pixels

`disk-access/` owns how a frame is brought in and `transport/` how it is sent. This owns what
happens after it arrives: turning a codestream into samples, what that costs, and where those
samples live.

## The decoder

OpenJPH, through the `@cornerstonejs/codec-openjph` WASM build (wrapper MIT, OpenJPH
BSD-2-Clause). `lab/decode-bench/fetch_decoder.sh` pulls a pinned version from npm and records
the tarball's checksum; nothing is committed, so provenance is the checksum rather than trust in
bytes in this repo. That build reports SIMD level 1, which OpenJPH returns only from its WASM SIMD
build, so SIMD is already on and is not a lever. Its WASM reports `OpenJPH Ver 0.31.0.`, which is
the release `lab/scripts/gen_htj2k_fixtures.sh` builds its encoder from.

It is a **decoder only** — no encoder ships in it. `lab/scripts/gen_htj2k_fixtures.sh` therefore
builds OpenJPH from source for `ojph_compress` and encodes synthetic images, so a fixture can be
made anywhere from nothing. The profile is part 15, reversible 5/3, 5 levels, 64×64 code-blocks,
RPCL, one layer, one tile per frame.

Because the profile is reversible, a decode must reproduce the encoder's input exactly. The
generator writes a `.sha256` of each frame's samples beside its codestream, and every bench here
checks against that rather than against an oracle it decoded itself — §Ground truth says why.

## Heap, measured

Six fixture sets, 87 frames each, decoded sizes from 50 KB to 8 MB
(`lab/scripts/gen_htj2k_fixtures.sh g160 g256 g512 c512 g1024 g2048`). Heap is
`HEAPU8.length`: the module's whole linear memory, which is what an instance costs the host.

**Every instance costs 50.0 MB, at every frame size, before it has decoded anything.**

| decoded frame | 1 instance | 2 | 3 | 4 |
| --- | --- | --- | --- | --- |
| 50 KB … 8 MB | 50.0 MB | 100.0 MB | 150.0 MB | 200.0 MB |

That is the whole table: 24 cells, all of them exactly 50.0 MB per instance, identical in all 5
timed rounds of every cell. Nothing about frame size moves it, and nothing about decoding moves
it — an instance that has never decoded a frame reads the same 50.0 MB as one that has decoded 87
frames of 2048×2048.

**The reason is a build flag, not a high-water mark.** The shipped `openjphjs.wasm` declares its
memory `initial = 800 pages = 50 MB`, `maximum = 32768 pages = 2048 MB`, not shared. 50 MB is
where an instance *starts*. Decoding an 8 MB frame does not reach it, so the memory never grows
and the allocator never has anything to return.

This corrects the framing this file previously carried. "WASM memory only grows, so an instance
climbs to its high-water mark and holds it" is true of WASM in general and false of this build in
particular: it does not climb, it is preallocated. The pool-sizing consequence is unchanged in
shape — N instances really is N×50 MB, permanently — but the cause is a flag that can be changed,
not a property of the decoder that cannot.

### What decoding actually demands

The same OpenJPH release built to WASM here (`lab/decode-bench/wasm/build.sh`), identical except
for `INITIAL_MEMORY`, with growth on. High-water after 87 frames, fresh process per row, every
frame verified against the encoder's input:

| decoded frame | 2 MB floor | 4 MB floor |
| --- | --- | --- |
| 50 KB | 3.56 MB | 4.00 MB (not reached) |
| 128 KB | 3.63 MB | 4.00 MB (not reached) |
| 512 KB | 4.25 MB | 4.00 MB (not reached) |
| 768 KB | 5.44 MB | 5.81 MB |
| 2 MB | — | 8.00 MB |
| 8 MB | — | 24.56 MB |

So an instance wants about **3.5 MB of base plus rather less than 3× the decoded frame**: 3.6 MB
to serve a 50 KB frame, around 4 MB to serve the 512×512×16-bit frame this project's fixtures are
built around, 24.6 MB to serve an 8 MB one. Growth is geometric, so each figure is an upper bound
on the demand rather than the demand itself, and the two floors bracket it — where they disagree
the smaller floor has simply taken one more doubling.

The shipped build's 50 MB is between 2× and 14× more than the work needs, depending on frame size.
**For pool sizing this is the lever**: per-instance cost is set by whoever links the module, not
by the decoder, and a build with a floor matched to the largest frame served would cut it
several-fold at every size this project cares about. Nothing here says the shipped 50 MB is wrong
for its author's purpose — only that it is a choice, and this project can make a different one.

## A build of our own

`lab/decode-bench/wasm/` builds a decoder from OpenJPH source with the same surface as the
package's, so one can stand in for the other. `lab/decode-bench/parity.mjs` is what makes that
claim checkable: it runs both side by side over every fixture and compares the decoded bytes
against each other **and** against the encoder's input, plus every getter the surface exposes.

**609 frames across seven fixture sets, both the plain and the shared variant: byte-identical to
the package, byte-identical to the encoder's input, and identical on every getter.** Both report
`getVersion() = 0.31.0` and `getSIMDLevel() = 1`, so the SIMD path is not silently lost.

**That claim covered unsigned data only, and on signed data the build was wrong** (2026-09-16, F1;
§Ground truth, *Signed*). Its wrapper clamped every component to `[0, 2^B − 1]` regardless of the
sign flag, so a signed component's negatives saturated to 0 — while the package decoded them
correctly. Fixed in `htj2k_decoder.cpp` (the clamp is `[−2^(B−1), 2^(B−1) − 1]` when signed) and
re-run: **87 frames of 16-bit signed and 87 of 12-bit signed, byte-identical to the package and to
the encoder's input.** `parity.mjs` now prints what its fixtures cover, and says so when no signed
set is among them.

### Where to put the floor

Six builds on one ladder, interleaved and rotated — measured one after another they would be the
sequential shape this project has already been wrong with:

| initial | g512 high-water | g512 ms/frame* | g2048 high-water | g2048 ms/frame* |
| --- | --- | --- | --- | --- |
| 2 MB | 4.3 MB | 5.12 | 24.6 MB | 85.01 |
| 4 MB | **4.0 MB** | 5.14 | 24.6 MB | 85.68 |
| 8 MB | 8.0 MB | 5.13 | 24.6 MB | 86.87 |
| 16 MB | 16.0 MB | 5.09 | 24.6 MB | 85.17 |
| 32 MB | 32.0 MB | 5.13 | 32.0 MB | 85.51 |
| 50 MB | 50.0 MB | 5.21 | 50.0 MB | 86.89 |

**The floor costs no time.** Every arm sits within 2.2 % of the best at both sizes, with ranges
that overlap throughout, so nothing here separates them — a small initial heap is not paid for in
milliseconds, at least not at a resolution this container can see.

It does cost memory, and the two profiles want different answers:

* **512×512** — ship **4 MB**. The decode fits without a single growth, so the heap is 4.0 MB
  against the package's 50 MB: **12.5× less per instance**, which is the whole pool-sizing lever.
* **2048×2048** — ship **4 MB and let it grow**. Every floor at or below 16 MB converges on the
  same 24.6 MB high-water, so starting higher buys nothing: a 32 MB floor ends 7.4 MB heavier than
  a 4 MB one that grew, for no time back. Against the package that is still 2× less.

Growth is geometric, so 24.6 MB is an upper bound on what an 8 MB frame demands, not the demand.

Both figures are reproduced by the retention bench's copy-out arms, and both hold **only while the
pixels leave the heap**: a viewer that keeps them inside it turns the 4 MB floor into the worst of
the builds measured, not the best. §Retention, measured.

### What adopting it costs

The build is smaller, not larger — 299,838 bytes of `.wasm` + `.js` against the package's 358,022,
and 329,366 for the shared variant. The cost is not size, it is ownership:

* A pinned emscripten (3.1.74 here) and a pinned OpenJPH tag become build inputs, and a CI step has
  to build WASM, which nothing in this repository does today. **The emscripten pin is holding about 15 % of decode time**, not only reproducibility: §Faster, measured — and it is not.
* Security and correctness fixes to OpenJPH become ours to track. The package's author does that
  now, and that is a real service to give up.
* `parity.mjs` is the mitigation and should run in CI against the published package: it is what
  turns "we rebuilt it" into "we rebuilt it and it is the same decoder".

**Worth it if the per-instance heap is the binding constraint, which on a phone it is** — 12.5× at
the size this project serves is not a margin a smaller change recovers. Not worth it on any other
ground: it is the same decoder, at the same speed, for slightly fewer bytes.

## Dispatch: first-free against round-robin

The belief this tested: first-free matters when decode times are uneven and is a wash when they are
even. Neither half had been measured. `lab/decode-bench/dispatch.mjs` runs a pool of real decoders,
one per worker thread — dispatch is meaningless without real parallelism — and every frame is
checked against the encoder's input.

Three policies, because two was not enough to answer it:

* **round-robin** assigns frame *k* to worker *k* mod width up front, busy or not. No coordination.
* **first-free** holds the frames and gives the next to whichever worker just reported free. One
  main-thread hop per frame.
* **first-free+1** does the same but keeps each worker one frame ahead, so it never idles waiting
  for that hop. This is the steelman, and without it the comparison prices the hop, not the policy.

Both start from one instant with every frame already available, as a fill has them, so `wait` counts
queueing in both. The split is reported from the median round, not as three medians: medians do not
add, and a split that does not sum is not a split.

**Width 3, 48 frames — 16 per worker:**

| frames | policy | ms/frame* | wait* | decode* | take* | batch ms* | slower in |
| --- | --- | --- | --- | --- | --- | --- | --- |
| uniform | round-robin | 94.38 | 76.70 | 7.83 | 9.86 | 138 | — |
| uniform | first-free | 98.20 | 90.58 | 7.04 | 0.58 | 157 | 8/12 |
| uniform | first-free+1 | 90.32 | 78.32 | 7.54 | 4.46 | 137 | 5/12 |
| mixed | round-robin | 305.02 | 262.11 | 24.68 | 18.23 | 524 | — |
| mixed | first-free | 351.86 | 323.84 | 23.55 | 4.47 | 576 | 11/12 |
| mixed | first-free+1 | 327.38 | 294.23 | 24.63 | 8.51 | 528 | 8/12 |

**Width 3, 9 frames — 3 per worker:**

| frames | policy | ms/frame* | wait* | decode* | take* | batch ms* | slower in |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mixed | round-robin | 125.34 | 67.98 | 47.05 | 10.31 | 276 | — |
| mixed | first-free | 140.29 | 81.09 | 50.32 | 8.88 | 255 | 9/12 |
| mixed | first-free+1 | **123.84** | 54.43 | 52.59 | 16.81 | **221** | 4/12 |

**The belief is half right, and the half that is right is not the interesting half.**

* **Uniform frames are a wash**, as believed — every policy within a few per cent, nothing resolved.
* **Uneven frames on a long queue are also a wash.** Sixteen frames per worker is enough for a
  static assignment's luck to average out, so there is no head-of-line blocking left to fix:
  round-robin's batch time ties first-free+1's (524 against 528) while needing no coordination.
* **The win is on a short queue, and it is makespan, not latency.** At three frames per worker one
  unlucky assignment cannot average out, and first-free+1 finishes the batch 20 % sooner (221
  against 276). Its mean per-frame latency is not better — 4/12, unresolved — because finishing the
  batch sooner and delivering any given frame sooner are different things.
* **Plain first-free is worse than round-robin nearly everywhere** (8/12, 9/12, 11/12). It pays a
  main-thread hop per frame that round-robin does not. What matters is not choosing a free decoder,
  it is never leaving one idle — which is why the lookahead, not the choosing, carries the result.

So: uneven decode times are necessary for dispatch to matter, and not sufficient. What decides it
is **frames per decoder**, and a viewer scrubbing a few frames at a time is the case where it does.

**Where this host saturates.** Four cores. Width 4 puts a worker on every core with the main thread
contending, and the answer moved when it did; widths 2 and 3 agree with each other and are quoted
here. Nothing is claimed at width 4 or above.

**One artefact worth naming**, because it produced a confident wrong answer first: a mixed workload
built as a repeating cycle of three sizes, dispatched round-robin across three workers, gives each
worker one size and reverses the result. The sizes are a seeded shuffle now. A periodic workload
whose period shares a factor with the pool width is not a mixed workload.

## The copy, measured

`getDecodedBuffer()` returns a view into the module's heap (`buf.buffer === M.HEAPU8.buffer`),
so copying out is `.slice()` and not copying out is handing the view on. Both arms read the same
two samples, so the difference between them is the copy and nothing else. Interleaved, order
rotated each round, 8 timed rounds (`lab/decode-bench/copy_cost.mjs`).

| decoded frame | copy cost | copy slower in | as a share of the decode |
| --- | --- | --- | --- |
| 50 KB | 0.071 ms | 8/8 | 17 % |
| 128 KB | 0.114 ms | 8/8 | 12 % |
| 512 KB | 0.272 ms | 8/8 | 7 % |
| 768 KB | — | 6/8, unresolved | — |
| 2 MB | 0.599 ms | 8/8 | 4 % |
| 8 MB | 3.018 ms | 8/8 | 5 % |

Container-measured; see §What these numbers are not. The 768 KB row is the colour fixture and
came out 6/8, which this project does not call a result, so it is left out rather than dressed up.

Two shapes, both against the assumption the open question was written on. The copy is **not**
linear from the bottom: 164× the frame size buys 42× the copy cost, because a fixed per-call cost
of roughly 0.05 ms dominates below about 512 KB. And past that it is close to linear, which means
the copy is a **shrinking share of the decode** as frames grow — 17 % at 50 KB down to about 5 %
at 8 MB. Whatever the argument for avoiding the copy is, it gets weaker with frame size, not
stronger.

## Shared memory, measured

The same source, the same toolchain, two builds differing only in `-pthread`: one plain, one whose
heap is a `SharedArrayBuffer` (asserted at runtime in the bench, not assumed). Both verified
bit-exact against the encoder's input. 8 timed rounds, interleaved, order rotated.

| decoded frame | plain | shared | shared slower in |
| --- | --- | --- | --- |
| 50 KB | 0.45 ms | 0.42 ms | 0/8 |
| 128 KB | 0.99 ms | 0.95 ms | 2/8 |
| 512 KB | 3.73 ms | 3.66 ms | 2/8 |
| 768 KB | 9.41 ms | 8.85 ms | 1/8 |
| 2 MB | 15.46 ms | 14.74 ms | 0/8 |
| 8 MB | 62.59 ms | 61.83 ms | 2/8 |

Container-measured. **No shared-memory tax is visible at any frame size.** The shared arm is never
slower at the median and is slower in at most 2 rounds of 8 anywhere; several rows' ranges
overlap, so the honest reading is *no tax detectable*, not *sharing is faster*. Heap was identical
between the arms in every row.

This does not reproduce the finding this file used to carry, that the shared-memory tax and the
copy saved were the same size and cancelled. On these fixtures, on this toolchain, the copy costs
something that grows with frame size and the tax does not appear at all. That is one arm of a
two-arm claim measured somewhere else, so it is a failure to reproduce rather than a refutation —
and a container cannot adjudicate a millisecond. It does mean the pairing should not be quoted as
settled in either direction.

## Faster, measured — and it is not

L17 asked whether the decoder can be made faster, since during a fill the decode queue sets the
finish and more decoders is not an option on the target device. Every arm below passed
`parity.mjs` against the package and the encoder's input before it was timed; an arm that is not
byte-identical is not an arm. Interleaved, arm order rotated each round.

**Nothing here makes it faster.** The one lever that moved the clock was a *regression* the lane
did not ask about, and the one build flag that helps exactly undoes it.

### The toolchain is the lever, and it points backwards

`docs/decode/README.md` records the build as emscripten **3.1.74**. Rebuilt unchanged with
**6.0.9**, the same source and flags decode measurably slower:

| against the 3.1.74 build | 512 KB | 768 KB | 8 MB |
| --- | ---: | ---: | ---: |
| emscripten 6.0.9, `-O3` | **+15.6 %** (0/8 rounds faster) | +6.5 % (1/6) | **+16.0 %** (0/6) |
| emscripten 6.0.9, `-O3 -flto` | −1.2 % (7/8) | +2.2 % (3/6) | −1.6 % (4/6) |

Two readings, and the second is the one that matters:

* **A newer emscripten costs 6.5–16 %** on this decoder, in the wrong direction, and the round
  counts are as one-sided as they can be — 0 of 8 and 0 of 6 at the two sizes where it is largest.
* **LTO recovers that and stops there.** Against the 3.1.74 build it is −1.2 %, +2.2 %, −1.6 %:
  three ties, all inside the 5 % bar with overlapping ranges. Against a 6.0.9 build without it, LTO
  looks like a 17.8–21.7 % win — which is what it is worth *if you have already taken the
  regression*, and nothing at all if you have not.

So the pinned emscripten in `wasm/build.sh` is not only a reproducibility device; it is holding
about 15 % of decode time. Moving it is a performance decision.

### What the other arms did

| arm | 512 KB | 768 KB | 8 MB | verdict |
| --- | --- | --- | --- | --- |
| a decoder object reused vs created per frame | −1.6 % (8/8) | +0.6 % (4/8) | −0.6 % (4/8) | **tie** |
| `wasm-opt -O4` over the linked binary | +0.1 % (8/8) | — | — | **tie** |
| a newer OpenJPH | — | — | — | **none exists**: 0.31.0 is the newest tag |
| combinations | — | — | — | nothing won alone, so nothing to combine |

* **The decoder's lifetime is not the lever** the lane guessed it might be — "possibly the largest
  of these". Reusing one object is consistently in the right direction at 512 KB (8 of 8 rounds)
  but by 0.042 ms on 2.7, and it is a wash at the other two sizes. It is still the right default for
  other reasons (`§Retention, measured`), just not for speed.
* **`wasm-opt` has already run.** emcc invokes it at `-O3` during linking, so a second `-O4` pass
  changes the clock by 0.1 % and makes the binary 275 bytes *larger*. Use the emsdk's own `wasm-opt`
  if you try this: binaryen 117 cannot validate 6.0.9's output at all, and `--all-features` produces
  a binary Node will not instantiate.

### What is worth taking, and it is not time

**LTO makes the binary 16 % smaller** — 200 KB against 239 KB for the 3.1.74 build and 233 KB for
6.0.9 without it — at no cost in heap, which is identical across every arm (4.0 MB at 512×512,
24.6 MB at 2048×2048). On a phone that is a download, not a decode, and it is the only unambiguous
gain on this page.

### What this is not

* **Container-measured**, so the millisecond columns are reported and decide nothing; the round
  counts and the byte-exactness are what carry weight. The workstation is the timing rig.
* **A first pass of this measured LTO at −17.8 %** and nearly reported it as a win. It was measured
  against a `plain` build this lane had itself rebuilt with the newer, slower toolchain — a baseline
  of its own making. The table above is against the build the project actually records.
* **The 768 KB colour fixture is the noisy one** here as elsewhere (`§The copy, measured` left its
  row out at 6/8). Its ranges overlap in every arm and it settles nothing on its own.

## Retention, measured

Every section above releases each frame, so each prices a decoder. A viewer keeps what it decoded,
and that was expected to flip the copy comparison: copying out holds the decoder heaps *plus*
every retained buffer, while keeping the pixels where they were decoded holds the heaps alone.

**It does not flip. Copying out is smaller — in all three series, on both builds, at every pool
size.** `lab/decode-bench/retained/` holds every frame of a series to the end and weighs three
places to keep it, in headless Chromium because
`performance.measureUserAgentSpecificMemory()` is the only instrument that counts a WASM heap, a
plain `ArrayBuffer` and a `SharedArrayBuffer` on one scale. It was validated before it was used:
256 MB allocated in a worker reads as +256 MB for each of the three, and dropping the reference
reads as −256 MB, so it collects before it counts. Frame counts are the lane's: 87 × 512×512
colour, 237 × 512×512 16-bit, 64 × 2048×2048 16-bit.

Total renderer memory at the end of the series, one instance, MB — the number a viewer lives with:

| series | pixels held | copy out, 4 MB build | copy out, package | keep in heap, package | keep in heap, 4 MB build |
| --- | ---: | ---: | ---: | ---: | ---: |
| 87 × 768 KB | 65.2 | **108.4** | 152.7 | 161.9 | 517.4 |
| 237 × 512 KB | 118.5 | **217.1** | 263.2 | 310.0 | 1080.7 |
| 64 × 8 MB | 512.0 | **938.7** | 964.2 | 1329.8 | 2042.4 |

Keeping costs 1.42–1.49× the best arrangement on the package build and **2.18–4.78× on the 4 MB
build**. Every retained frame was checked against the `.sha256` the generator wrote from the
encoder's input: 0 mismatches across 120 cells.

**Why keeping loses, and it is not the pixels.** A retained decoder holds its `encoded_` vector as
well as its `decoded_` one, so arrangement 3 keeps every codestream too — 35.5, 92.8 and 400.4 MB
per series. Even measured against that larger floor the heap is not tight, and **WASM memory never
shrinks**, so a heap holds its high-water mark for the life of the instance and every transient
allocation the decoder made along the way is kept forever:

| series | what the retained decoders hold | package heap | 4 MB build heap |
| --- | ---: | ---: | ---: |
| 87 × 768 KB | 100.7 MB | 120–200 MB (1.19–1.99×) | 463–513 MB (**4.60–5.10×**) |
| 237 × 512 KB | 211.3 MB | 215–259 MB (1.02–1.23×) | 967–1044 MB (**4.58–4.94×**) |
| 64 × 8 MB | 912.4 MB | 928–1116 MB (1.02–1.22×) | 1589–1723 MB (1.74–1.89×) |

The build that starts at 4 MB has to grow its heap by two orders of magnitude across a series and
ends up carrying four to five times what it holds; the one that starts at 50 MB starts above most
of the demand and stays within a quarter of it. Which is the reverse of §Where to put the floor —
and does not overturn it, because the arrangement that provokes it is the one to avoid.

**The floor stands, for a viewer that copies out.** In the copy-out arms the decoder is deleted per
frame and the heap holds only transients: 4.0 MB on the 237 × 512×512 series and 24.6 MB on the
64 × 2048×2048 one, reproducing the ladder in §Where to put the floor exactly, against the
package's fixed 50 MB. The two decisions are coupled: **the 4 MB floor is right if and only if the
pixels leave the heap.**

**Pool size costs each instance its floor**, and that is nearly all it costs. Copying out, each
extra instance adds **+50.9 MB on the package build in every series** — its initial heap, paid
whether or not it is used — against +6.6, +4.8 and +25.3 MB on the 4 MB build, the last rising
because a 2048×2048 decode's transient working set is larger. This is the pool-sizing lever §Where
to put the floor names, measured with frames retained rather than released.

**A `SharedArrayBuffer` costs nothing.** Arrangements 1 and 2 are within 0.1 MB of each other in
every one of the 72 cells that compare them, so the shared-memory variant is free on this axis
whatever it costs elsewhere (§Shared memory, measured). **Reusing one decoder object rather than
creating one per frame costs 1.2, 0.8 and 12.5 MB** per instance — one live `decoded_` plus
`encoded_` that is never released — always in the same direction, never large.

**The check, and the mutant.** An arrangement that keeps a frame the next decode overwrote is the
failure this lane most needs to catch, and it is invisible in the memory numbers — it looks like a
win. `mutate=heap-reused` makes the retained arrangement reuse one decoder so every frame aliases
the last: it reports **`MISMATCH ×86` of 87** frames, the last being genuinely correct, with memory
collapsing from 476 MB to 3.0 MB. The copy-out arms in the same run stay clean, so the mutant is
targeted and the ground-truth check is what stands between this table and a fiction.

**What this is not.** Container-measured in headless Chromium 141 on 4 vCPU; peak host use was
3.3 GB. Memory, not time — the millisecond column is not quoted and the arms are not interleaved,
because nothing here is a timing claim. Nothing has been measured on a phone, which is where the
memory question is finally settled. The fixtures are the synthetic ones §What these numbers are
not describes, so the codestream totals above are theirs and not a real series'.

## Threads: not buildable from this release

The question was one multithreaded instance at N threads against N single-threaded ones. It cannot
be asked of OpenJPH 0.31.0 without first writing the threading:

* `src/core/` — the codestream decoder itself — contains no thread, mutex or atomic. A single
  frame's decode is serial by construction, so N threads cannot make one frame faster.
* The only threading in the release is a frame-level pool under `src/apps/`, in the
  `ojph_stream_expand` application, not in the library.
* Upstream's own CMake sets `OJPH_BUILD_STREAM_EXPAND OFF` when the compiler is emscripten, so
  the one threaded component is excluded from WASM builds by the project that wrote it.

A threaded arm would therefore mean wrapping the library in a frame-level pool of our own and
building that to WASM — writing the alternative, not measuring it. That is a larger piece of work
than this lane, and the measurements above bound what it could win before anyone starts it: one
pooled instance would replace N×50 MB with one heap, but so would rebuilding the existing decoder
with a smaller floor, at none of the cost.

## Ground truth

The bench originally checked each arm against pixels it had decoded itself with the same code
path. Mutating the decode — flipping one byte of every frame — **did not fail that check**, because
the corruption reached the oracle and the arm alike. A self-built oracle catches divergence
between instances and nothing else.

Every bench here now checks against the `.sha256` the fixture generator wrote from the encoder's
input. Four mutants were run against it and all four failed as they should: a flipped byte, a
truncated buffer, a skipped `decode()` call, and a corrupted view in the copy bench — each
reported 87/87 frames differing and exited non-zero, with the unmutated control clean.

The parity suite was mutated in the build itself rather than in the harness. A getter returning a
wrong constant was caught at once. **A clamp set one count low was not** — and the reason was a
gap in the fixtures, not in the check: no organic fixture contains a sample at its ceiling, so the
clamp is dead code for all of them. `sat256` was added for that, a full-range ramp reaching exactly
0 and exactly 65535; against it the same mutant fails on 87 of 87 frames and the good build passes.
A test that cannot fail is worth reporting as loudly as one that does.

### Signed

Signed 16-bit is ordinary CT data and until 2026-09-16 no fixture could exercise it: the encoder's
own `-signed true` path saturates negatives before coding, so nothing it produced was ground truth.
The fixture is made the other way round — encoded unsigned, then the sign bit of each component's
`Ssiz` set in the SIZ marker (`lab/scripts/sign_htj2k.py`). JPEG 2000 level-shifts an unsigned
component by 2^(B−1) before coding and a signed one not at all, so the same coded bits read as
signed must decode to `v − 2^(B−1)`. An **independent** decoder settled whether they do:
OpenJPEG 2.5's `opj_decompress` on a flipped 16-bit frame gives exactly `v − 32768` (range
−21975 … 21863 for an input of 10793 … 54631), and on a flipped 12-bit frame exactly `v − 2048`,
written as 12-bit two's complement in 16-bit containers (its raw writer does not sign-extend;
extending it gives the same samples). OpenJPH's own `ojph_expand` agrees on both, sign-extended.
The `.sha256` beside each signed frame is of the sign-extended little-endian int16 samples the
decoder must emit, computed from the encoder's input.

Against that truth: **the package decodes both signed sets byte for byte, and already
sign-extends 12-bit samples into int16** — `getFrameInfo()` reports `bitsPerSample: 12,
isSigned: true` and the samples come back −1500 … 952, not 12-bit two's complement. So the
downloader's own sign-extension pass (`client/downloader/decoder.js`, `finish`) is idempotent on
this decoder's output rather than load-bearing. **The build in `wasm/` was wrong**: its output on
both signed sets was the truth with every negative clamped to 0, and the cause was the wrapper's
clamp, not OpenJPH. Fixed, both sets are 87/87 identical to the package and to the truth.

Two mutants. The unfixed build against the signed sets is one: it passed every unsigned set and
failed both signed ones, which is what the earlier 609-frame claim could not see. The other is the
truth itself: a level shift off by one in `sign_htj2k.py` fails parity's *bytes vs encoder* column
on a signed frame while *bytes vs package* stays identical — the two columns fail independently,
which is the point of having both.

What this corrects: `cloud-queue.md` §Blocked recorded that the package saturates negatives to
32767 and the source build does not. That was read off codestreams the encoder's `-signed true`
path had already damaged; with a valid signed codestream and an independent truth it is the other
way round, and now neither is wrong.

## A prefix draws a smaller image

L19. The fixtures are encoded RPCL, one layer, one tile, five decompositions, so a frame's bytes
arrive resolution by resolution and a *prefix* is a whole smaller image rather than a damaged
large one. What that prefix costs is the question a slow link asks: how little has to arrive
before something can be drawn.

`lab/decode-bench/prefix_levels.mjs`, four frames per set, medians, over four pixel formats. **Bytes needed** is the
smallest prefix whose decode at that level is byte-identical to decoding the *whole* codestream at
the same level — found by binary search, and mutation-checked at the boundary: one byte short never
reproduces the image, at every level of both sets. The timing columns are interleaved with the
order reversed each repeat.

| set | level | image | bytes needed | of full | decode µs | full decode µs |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `c512` 8-bit RGB | 0 | 512×512 | 428 016 | 100 % | 6 092 | 6 146 |
| | **1** | **256×256** | **97 088** | **22.7 %** | **1 641** | 6 157 |
| | 2 | 128×128 | 21 012 | 4.9 % | 490 | 6 205 |
| | 3 | 64×64 | 4 783 | 1.1 % | 184 | 6 213 |
| | 4 | 32×32 | 1 477 | 0.3 % | 102 | 6 133 |
| | 5 | 16×16 | 662 | 0.2 % | 44 | 5 200 |
| `g512` 16-bit grey | 0 | 512×512 | 410 331 | 100 % | 2 149 | 2 150 |
| | **1** | **256×256** | **99 322** | **24.2 %** | **592** | 2 130 |
| | 2 | 128×128 | 23 765 | 5.8 % | 180 | 2 149 |
| | 3 | 64×64 | 5 927 | 1.4 % | 77 | 2 250 |
| | 4 | 32×32 | 1 713 | 0.4 % | 30 | 2 094 |
| | 5 | 16×16 | 646 | 0.2 % | 41 | 2 240 |
| `s12` 12-bit signed | 0 | 512×512 | 277 427 | 100 % | 1 711 | 1 717 |
| | **1** | **256×256** | **65 898** | **23.8 %** | **478** | 1 728 |
| | 2 | 128×128 | 15 334 | 5.5 % | 148 | 1 686 |
| | 3 | 64×64 | 3 787 | 1.4 % | 54 | 1 700 |
| | 4 | 32×32 | 1 176 | 0.4 % | 30 | 1 712 |
| | 5 | 16×16 | 517 | 0.2 % | 42 | 1 943 |

**A quarter of the bytes draws the half-size image**, on both sets: 22.7 % and 24.2 % for level 1.
Below that the curve falls away fast — an eighth-size image is 5 % of the frame and a sixteenth is
about 1 %. Decode time falls with the image rather than with the bytes, roughly ×4 per level.

**Only one of the two decoders can do it, and it is the one that ships.** The package exposes
`decodeSubResolution(level)`; every row above is that call. The source build in
`lab/decode-bench/wasm` binds no equivalent — its wrapper calls `decode()`, which always
reconstructs at full resolution because it never calls OpenJPH's `restrict_input_resolution`. Fed
a level-*r* prefix it does not return a smaller image: it throws, at every level of both sets.

That is not the same as refusing every truncation. The source build has a floor of its own, above
which `decode()` returns a **full-size** image and logs `File terminated early` — never a smaller
one. On frame 0: 307 806 B for `c512` (71.8 % of the frame, ×3.16 the level-1 prefix) and 99 497 B
for `g512` (24.2 %, ×1.00 — 175 bytes above it). So on a slow link the source build offers a
full-size image with detail missing, and only after most of the bytes on colour; the package offers
a correct smaller image after a quarter of them.

**Signed behaves the same, and one of the two signed sets had to.** F1 makes a signed fixture by
encoding unsigned and setting the sign bit in SIZ, so `s512`'s codestream differs from `g512`'s by
**exactly one byte**. Its curve is therefore identical to `g512`'s by construction — a consistency
check that the sign flag does not disturb packet order, not an independent measurement. `s12` is
the one that carries new information: 12-bit samples, a different codestream, and the same shape —
23.8 % at level 1, 5.5 % at level 2, 1.4 % at level 3. **The curve is a property of the codestream's
progression, not of the pixel format.**

**Held, whatever this says.** Handing a frame's first bytes to a decoder before the frame completes
is not built into the clients or the downloader: it waits on a decision about how a smaller first
image is displayed, and that decision is the workstation's.

## What these numbers are not

* **Every millisecond above is container-measured** and is reported, not decided on. The heap
  figures, the byte-exactness and the build-flag findings are not timing and are safe.
* **Nothing has been measured on a phone**, which is the target and the only place the memory
  question is finally settled.
* **Retention is measured now, and the expectation above was wrong** (§Retention, measured). It
  said a pipeline that holds frames changes the sign of the copy comparison. It does not: copying
  out is smaller in all three series and on both builds, because a WASM heap never shrinks and a
  retained decoder holds its codestream as well as its pixels. The 86 MB retained figure this file
  used to carry is still not reproduced and still not quoted.
* **The prefix curve is four frames per set** (§A prefix draws a smaller image), enough for a
  byte-exact claim that is mutation-checked per frame, not enough to call the percentages a
  distribution. The source build's floor is frame 0 only.
* **The clamp is not exercised by the organic fixtures.** None of them reaches its ceiling, so a
  mutant that clamped one count low passed all six. `sat256` is a full-range ramp that hits exactly
  0 and exactly 65535 and does catch it; §Ground truth has the rest.
* **The fixtures are synthetic and compress poorly at 16 bits** — the generator's grain is a
  fraction of full scale, which is a few counts at 8 bits and several hundred at 16, so the
  greyscale sets sit near 0.8:1 rather than the ratio a real series gives. Decoded size, which is
  what every table above is indexed on, is exact regardless; decode *time* is not, and is another
  reason not to lean on the millisecond columns.

## Open

* **Anything on a phone.**

Retained-frame residency was open here until 2026-09-16 and is now §Retention, measured.

## The BYOB read path

`client/transport-wasm` can read media frames with a BYOB reader instead of the default one
(`byob`, `byob-min`, `byob-count`, all off by default). It removes both compressed-frame copies:
the frame is read straight into its own JS buffer and no byte passes through WASM memory.

On time it is a tie — both fixtures, both cells, route-matched. `byob-min` adds `read(view, {min})`
and is also a tie, because the receive stream already coalesces: reads per frame fall only from
2.30 to 2.00 on a 49 KB frame and 4.70 to 2.00 on a 250 KB one.

**Not adopted, for one reason.** The first frame of a session costs about 12 ms more on this path,
reproduced across three independent campaigns, in the worse direction on 8 of 8 rounds with
non-overlapping ranges. **It is not acquiring the reader** (2026-09-15): with a reader per frame
(`--stream-mode per-frame`) the median frame still ties and the cost stays on one frame per
session. Left: the first per-frame buffer allocation against a cold allocator, and that the `byob`
build is a separate WASM module whose first call pays its own compile. Until that is explained the
path stays behind its feature.

It is kept because adopting it would **delete** more than it adds: the default path needs a
partial-frame state machine, a compaction heuristic and a reserve policy to reassemble frames from
chunks that do not align with them, all of which BYOB makes unnecessary — about 140 lines removed
against 93 added. That argument is independent of every measurement above.
