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

### What adopting it costs

The build is smaller, not larger — 299,838 bytes of `.wasm` + `.js` against the package's 358,022,
and 329,366 for the shared variant. The cost is not size, it is ownership:

* A pinned emscripten (3.1.74 here) and a pinned OpenJPH tag become build inputs, and a CI step has
  to build WASM, which nothing in this repository does today.
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

## What these numbers are not

* **Every millisecond above is container-measured** and is reported, not decided on. The heap
  figures, the byte-exactness and the build-flag findings are not timing and are safe.
* **Nothing has been measured on a phone**, which is the target and the only place the memory
  question is finally settled.
* **Retention is not measured.** Every bench here releases each frame, so it measures a decoder
  and not a viewer. A pipeline that holds frames changes the sign of the copy comparison: copying
  holds the heap *plus* every retained buffer, keeping holds one heap. The 86 MB retained figure
  this file used to carry has not been reproduced and is not quoted.
* **The clamp is not exercised by the organic fixtures.** None of them reaches its ceiling, so a
  mutant that clamped one count low passed all six. `sat256` is a full-range ramp that hits exactly
  0 and exactly 65535 and does catch it; §Ground truth has the rest.
* **The fixtures are synthetic and compress poorly at 16 bits** — the generator's grain is a
  fraction of full scale, which is a few counts at 8 bits and several hundred at 16, so the
  greyscale sets sit near 0.8:1 rather than the ratio a real series gives. Decoded size, which is
  what every table above is indexed on, is exact regardless; decode *time* is not, and is another
  reason not to lean on the millisecond columns.

## Open

* **Retained-frame residency**, which is the viewer's question rather than the decoder's.
* **Anything on a phone.**

## The BYOB read path

`client/transport-wasm` can read media frames with a BYOB reader instead of the default one
(`byob`, `byob-min`, `byob-count`, all off by default). It removes both compressed-frame copies:
the frame is read straight into its own JS buffer and no byte passes through WASM memory.

On time it is a tie — both fixtures, both cells, route-matched. `byob-min` adds `read(view, {min})`
and is also a tie, because the receive stream already coalesces: reads per frame fall only from
2.30 to 2.00 on a 49 KB frame and 4.70 to 2.00 on a 250 KB one.

**Not adopted, for one reason.** The first frame of a session costs about 12 ms more on this path,
reproduced across two independent campaigns, in the worse direction on 8 of 8 rounds with
non-overlapping ranges. It is undiagnosed; the places to look are acquiring a BYOB reader on a
fresh stream, and the first per-frame buffer allocation against a cold allocator. Until that is
explained the path stays behind its feature.

It is kept because adopting it would **delete** more than it adds: the default path needs a
partial-frame state machine, a compaction heuristic and a reserve policy to reassemble frames from
chunks that do not align with them, all of which BYOB makes unnecessary — about 140 lines removed
against 93 added. That argument is independent of every measurement above.
