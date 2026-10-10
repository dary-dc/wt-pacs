# Decode levers — protocols and decision rules

Fixed 2026-10-09, before any data. Queue rows HELPERSTART, REGIONDECODE, COARSEPOOL, WEBGPUHT and DECODEPACE
([`../av1/queue.md`](../av1/queue.md)) each run one section as written; LEVERREVIEW reads the numbers against the
predictions. A measuring session is given this file and its rules only. It reports the numbers first, then whether
each prediction held. Section and file references are to `claude/av1-unified`, where the decoders and their harnesses
live; *decode §X* is a section of `docs/decode/README.md` there.

## Rules for every lever

* **Bit-exact, always.** Every sample of every frame, region and stripe is checked against the encoder's input
  checksum written when the input was made, never against a decoder under test. A path that is not exact is reported,
  not timed.
* **Beside today's path, opt-in.** Each arm is a lab build or a lab flag. No product default changes; the gate stays
  green.
* **Interleaved.** Arms Williams-ordered by `lab/order.mjs` in every round, n ≥ 10 rounds, the median and the range
  given, ratios paired by round with how many rounds were faster. Headless Chromium 141 on 4 cores, as row HTJ2KMT
  ran it.
* **4× is the lab's cgroup throttle** (decode §A slow CPU, emulated), not a phone. Every time here is a container's.
* **Sound data only decides** (`lab/av1/data.json`'s provenance). A host that cannot meet its `VOID` bar reports
  strict and round-paired readings, as `queue.md` §Protocol says.
* **Pinned.** Every tool by tag or version, every fetch by checksum; a new decoder or library goes in
  [`../av1/licensing.md`](../av1/licensing.md) with its licence before it is used. Nothing fetched or built is
  committed; the script that makes it is.
* **Mutated.** Every new check is broken on purpose once and seen to fail: one sample flipped in a frame, a region or a
  stripe placed one row off.

**Content.** `g512` (87 frames of 512² 16-bit grey, `lab/decode-bench/builds.mjs`), and the sound breast series row
HTJ2KMT used: tomosynthesis 614×1359 and 931×2124, projections 1914×2572, synthesized 2D 2394×2850, full-field
3328×4096. *Large* below means 1914×2572 and up.

**The reference arm** is the delivered OpenJPH build, single-threaded (decode §The build, as delivered). *Today's
pool* is row HTJ2KMT's two-thread build (`lab/av1/decode/htj2k-profile/cb-threads.patch`, one helper).

## L1 — the pool's helper started off the decoder's ready path

**Hypothesis.** Today's pool loads its helper Worker before the decoder answers ready (emscripten's
`PTHREAD_POOL_DELAY_LOAD` defaults to 0 [1, 2]). That start sits on a cold ask's path when the session is ready
first, as on loopback. Started after ready, with the caller decoding every block alone until the helper joins, the
cold ask costs what the single-threaded build's does, and the warm gain on large frames stays.

**Arms.** Reference; today's pool; the pool with its helper started after the decoder answers ready (by
`-sPTHREAD_POOL_DELAY_LOAD=1` or a helper created on the first decode; the patch's claim loop already lets the caller
take every block).

**Measured.** Through the downloader (`lab/decode-bench/builds.mjs`), on `g512` and one large series:

* the decoder's ready time (worker start to ready);
* a cold ask — a fresh browser, one frame asked — at 1× and 4× on loopback, and at 4× on `lte-good` through the
  relay (`lab/av1/delivery/total-time/run.mjs`'s link);
* a warm ask — one frame asked of an idle decoder after a fill — at 1× and 4×;
* the fill at 1× and 4× on 50 Mbit and `lte-good`.

**Predictions** (× the reference, paired by round):

| # | cell | today's pool | helper after ready |
| --- | --- | --- | --- |
| L1-P1 | cold ask, `g512`, loopback 4× | ×1.35–1.60 (measured ×1.47: ×1.078 and ×0.732 of the package) | ×0.97–1.03 |
| L1-P2 | cold ask, `g512`, `lte-good` 4× | ×0.98–1.02 | ×0.98–1.02 |
| L1-P3 | warm ask, large, 1× and 4× | ×0.70–0.80 | ×0.70–0.80 |
| L1-P4 | warm ask, `g512` | ×0.88–0.95 | ×0.88–0.95 |
| L1-P5 | fill, every cell | ×0.98–1.01 | ×0.98–1.01 |

L1-P1's left cell restates decode §The build, as delivered; the session measures it again beside the new arm.

**Only a phone decides:** whether the cold loss is gone on a phone's real link and how a helper on a little core
changes the warm gain. A container has neither the cores nor the link.

**Decision rule.** *L1 holds* when the helper-after-ready arm's cold ask is ≤ ×1.03 of the reference at 1× and at 4×
on loopback in ≥ 8 of 10 rounds, its warm ask on every large series is ≤ ×0.85 in ≥ 8 of 10 rounds, and no fill
cell is over ×1.02. *The loss is not the helper's start* when today's pool stays over ×1.03 of the reference on
`lte-good` at 4× (L1-P2 refuted). Either way the data goes to the owner's pool decision; nothing ships.

## L2 — region decode: a 1:1 viewport, and one ask in stripes

**Hypothesis.** Code-blocks decode independently and the reversible 5/3 wavelet reaches a few samples, so any
rectangle of a frame can be decoded exactly from the blocks that cover it and a margin. OpenHTJ2K decodes a viewport
region with a row-limited, column-ranged inverse wavelet [3]; OpenJPH has no region decode (decode §A prefix draws a
smaller image). Two uses: (a) a viewport shown at 1:1 decoded alone; (b) one asked frame cut into stripes, one per
idle decoder worker, each writing its stripe into the shared output — parallel decode with no threads and no start.

**Arms.** The reference (whole frame); OpenHTJ2K built to WASM (pinned tag, its licence read and listed first), whole
frame; OpenHTJ2K region decode for (a) and (b). Today's pool where a large series is timed in (b).

**Measured**, every arm exact first:

* (a) a 1080×2400 viewport at the centre and at one corner of each large series and of 931×2124 tomosynthesis: its
  decode alone, warm, 1× and 4×; the codestream bytes the region needs;
* (b) k = 2 and 3 horizontal stripes of one asked frame across k running decoder workers, the frame assembled in
  shared memory: time from the ask to the last stripe written, warm, 1× and 4×, on every content set;
* every stripe and region compared with the same rectangle of the encoder's input; the assembled frame whole.

**Predictions:**

| # | cell | predicted |
| --- | --- | --- |
| L2-P1 | (a) on 3328×4096 (the viewport ~19 % of the frame) | 0.20–0.35 of OpenHTJ2K's whole-frame decode |
| L2-P2 | (a) on 1914×2572 and 2394×2850 | under 0.60 of the whole-frame decode; not sized further |
| L2-P3 | (b) k = 3 on large frames | 0.40–0.50 of a one-worker whole-frame decode by the same decoder |
| L2-P4 | (b) on `g512` and tomosynthesis | not predicted; reported |
| L2-P5 | OpenHTJ2K whole frame against the reference | not predicted; reported, 1× and 4× |

**Not decided here:** what a zoomed view shows first, and the ingest, encoding and layout choices region decode
implies (precincts, tiles, the stored layout). Those are the owner's; this row puts the data on the table.
**Only a phone decides** the gains on a phone's cores.

**Decision rule.** *Region decode is worth a design* when every region and stripe is exact, (a) on 3328×4096 is
≤ 0.40 of the reference's whole-frame decode at 1× and 4× in ≥ 8 of 10 rounds, and (b) at k = 3 is ≤ 0.60 of the
reference on every large series at 4× in ≥ 8 of 10 rounds and no slower than today's pool there. Otherwise not, and
which cell failed is said.

## L3 — a WebGPU HT block decoder

**Hypothesis.** The HT block decoder (55–70 % of a frame) splits into a serial part per block (MEL and VLC) and a
column-parallel part (MagSgn), which a GPU runs as one thread per block and threads per column [4]. Batching many
frames' code-blocks into one dispatch pays the GPU round trip once a batch. WebGPU ships in Chrome on Android 12+
from 121 [5] and in Safari 26 [6]; subgroups, which the column split wants, are not in every engine [7].

**Built** in `lab/`, beside `lab/av1/decode/webgpu` (row GPU's bound): the HT cleanup and refinement passes and the
5/3 synthesis in WGSL, fed the code-blocks of a parsed codestream, one frame a dispatch and a batch of frames a
dispatch.

**Measured, in the container:** exactness only, on SwiftShader through headless Chromium 141 — every frame of
`parity.mjs`'s nine sets and every content set above, one-frame and batched dispatches, with and without subgroups,
against the encoder's input. Dispatch and read-back counts a frame are recorded. **No timing claim:** a container has
no GPU, and SwiftShader runs WGSL on the CPU.

**Predictions:** L3-P1 every frame exact, both dispatch shapes; L3-P2 the batched shape exact on frames of different
sizes and depths in one batch.

**Only a real GPU decides** the time a frame and a batch, the read-back (`mapAsync` has an open WebKit bug that waits
on unrelated command buffers [8]) and the energy: the owner's phones with WebGPU (Chrome Android 121+, Safari 26).
Painting from the GPU's output before the read-back needs a WebGPU painter (today WebGL2): structural, not built here.

**Decision rule.** *The container stage passes* when L3-P1 and L3-P2 hold with the mutants caught; otherwise report
where it is not exact. *Stated now for the phone stage:* worth a product design only if, on each phone measured, a warm
ask on a breast frame from 931×2124 up, transfer included, is ≤ ×0.70 of the reference in ≥ 8 of 10 rounds, and a fill
is no slower than ×1.01.

## L4 — a coarser hand-off unit in the pool

**Hypothesis.** Today's pool hands off one row of code-blocks and stops after each: 18 stops on 512², 123–188 on
mammograms. Handing off a whole subband, or every subband of one resolution, cuts the stops 3–10× and the straggle of
a slow helper, against holding a resolution's coefficients at once (4 bytes a sample).

**Arms.** Reference; today's pool (a row); a subband a hand-off; a resolution a hand-off — each at 2 threads.

**Measured.** Row HTJ2KMT's frame bench (`lab/av1/decode/htj2k-threads`): the first 4 frames of each content set, an
ask on an idle decoder, 1× and 4×, 10 rounds × 3 passes; the WASM heap's high-water a frame for each arm.

**Predictions** (× the reference):

| # | cell | row | subband or resolution |
| --- | --- | --- | --- |
| L4-P1 | 512², 2 threads | ×0.88–0.95 | toward ×0.70 |
| L4-P2 | large, 2 threads | ×0.70–0.79 | toward ×0.65 |
| L4-P3 | heap high-water, 1914×2572 | today's | ~15 MB more for a resolution a hand-off |

**Only a phone decides** the little-core case, where a 2-block row is predicted up to ×1.7 slower with a helper
three times slower than the caller; a container's cores are all one type.

**Decision rule.** *A coarser unit wins in the container* when it is ≤ ×0.80 of the reference on 512² and at least
0.03 under today's pool's ratio on every large series, at 1× and 4×, in ≥ 8 of 10 rounds. Its heap above the
product's 4 MB floor is then a trade-off for the owner, stated in MB. Otherwise the row unit stays.

## L5 — decode paced to the wire during a fill

**Hypothesis.** Where the wire is a fill's clock, decode keeps up with fewer decoders busy at once. Work that cannot
finish the fill sooner costs a phone less energy run slowly on efficient cores, which the scheduler picks by recent
utilisation and energy cost [9, 10, 11].

**Arms.** Today's count, `min(3, hardwareConcurrency)` decoders from the start; *follow the queue* as
`docs/ARCHITECTURE.md` §How many states it — start at one, add one while the decode queue stays non-empty across a
dispatch, retire one left idle — keeping both dispatch clauses (asks first, at most `perDecoder` a decoder). A lab
flag on the downloader, off by default.

**Measured.** Row TOTAL's harness (`lab/av1/delivery/total-time/run.mjs`), whole sound tomosynthesis and full-field
series, 20 Mbit, 50 Mbit and `lte-good`, 1× and 4×: the time to every frame on the page; for the renderer's decoder
worker threads over the fill, CPU busy time (`utime` + `stime` from `/proc/<pid>/task/<tid>/stat`) and wake-ups
(`voluntary_ctxt_switches` from `/proc/<pid>/task/<tid>/status`); the decoders running over time. **Energy is not
measured:** a container has no battery, no core types and no frequency a page can see.

**Predictions:**

| # | cell | predicted |
| --- | --- | --- |
| L5-P1 | fill time where the wire is the clock (20 Mbit and `lte-good`, both throttles; 50 Mbit at 1×) | ×0.99–1.01 |
| L5-P2 | fill time where decode is the clock (50 Mbit at 4× on full-field) | not predicted; the rule applies |
| L5-P3 | CPU busy time a fill | ×0.97–1.03 (the same work) |
| L5-P4 | wake-ups a fill, and decoders busy at once | fewer |

**Only a phone decides** the energy, the lever's purpose: energy per fill, both arms interleaved, on phones with
little cores and on an iPhone.

**Decision rule.** *The container stage passes* when every fill cell is ≤ ×1.01 of today's in ≥ 8 of 10 rounds, CPU
busy time ≤ ×1.03 and wake-ups no more. *Stated now for the phone stage:* worth adopting only if energy per fill is
≤ ×0.95 of today's on every phone measured, with the fill ≤ ×1.01.

## Review (row LEVERREVIEW, 2026-10-10)

Rows HELPERSTART, REGIONDECODE, COARSEPOOL, WEBGPUHT and DECODEPACE ran §L1–§L5 as written on `claude/av1-unified`;
their numbers are in *decode §Code-blocks on threads, measured*, *§A coarser hand-off unit, measured*, *§Region
decode, measured*, *§A WebGPU block decoder, built*, and `docs/ARCHITECTURE.md` §Follow the queue, measured. This
review was written by a session that measured none of them. Every frame, region and stripe of every row was exact.

**L1 — the helper after ready: does not hold; conclusive in the container.**

| # | predicted | measured | |
| --- | --- | --- | --- |
| P1 | pool ×1.35–1.60, *late* ×0.97–1.03 | pool ×1.16, *late* ×1.19 (1/10) at 4×; ×1.18 and ×1.06 at 1× | refuted, both |
| P2 | both ×0.98–1.02 | pool ×0.99, *late* ×1.02–1.04 | pool held, *late* refuted |
| P3 | both ×0.70–0.80 | pool ×0.72–0.76, *late* ×0.81–0.84 | pool held, *late* refuted |
| P4 | both ×0.88–0.95 | pool ×0.92 at 1×, ×0.82 at 4×; *late* ×1.03–1.14 | pool held at 1×, *late* refuted |
| P5 | ×0.98–1.01 | ×0.987–1.004 | held |

The margins are wide (cold ask ≤ ×1.03 in 4 and 2 of 10 rounds against 8; warm 6 and 7), and strict and round-paired
readings agree, so the verdict does not wait on more rounds. The mechanism held only in part: the pool's start does
sit on the ready path (+58 ms at 4×, 10/10), and *late* takes part of it off (×1.36 → ×1.14), but its cold ask at 4×
is no better than the pool's, and it gives back a third of the warm gain on large frames. Why is not measured; a
helper still loading while the first frames decode, on the same throttled cores, is the obvious candidate. The cold
loss the lever was built for was also smaller than the earlier ×1.47 (a ratio of two package-relative readings): the
pool is ×1.16 on `g512` at 4×, and on the 14-bit projections it already wins a cold ask (×0.89–0.94, 7 and 9 of 10).
*Still to measure on a phone:* nothing for *late*; for the pool, its cold and warm asks with the helper on a little
core — the owner's pool decision (§Blocked) has its container data now.

**L2 — region decode: not worth a design; stripes beat the pool; conclusive for (a), narrow for (b).**

| # | predicted | measured | |
| --- | --- | --- | --- |
| P1 | viewport on 3328×4096 0.20–0.35 of OpenHTJ2K whole | 0.60–0.69 | refuted |
| P2 | viewport on 1914×2572, 2394×2850 under 0.60 | 0.90–1.04 | refuted |
| P3 | 3 stripes on large 0.40–0.50 of one worker | 0.47–0.49 at 4×, 0.57–0.60 at 1× | held at 4×, refuted at 1× |
| P4 | reported | `g512` ×0.99–1.08 of OpenJPH; tomosynthesis ×0.71–0.90 | — |
| P5 | reported | OpenHTJ2K whole ×1.13–1.41 of OpenJPH | — |

(a) failed on its mechanism, not its margin: OpenHTJ2K's column range narrows the wavelet but decodes every block of
each row the region reaches, so a 19 % viewport costs 72–84 % of the block bytes; the predictions had scaled with
area. Today's codestreams (one precinct a resolution) cannot be fetched
by region either. (b) missed ≤ 0.60 by 0.02–0.08 on two of three large series at 4× (×0.62, ×0.68; ×0.60 on the
synthesized 2D), 10 of 10 rounds each, so the miss is real but small, and stripes beat today's pool there (×0.77–0.85,
10/10) with no threads. Stripes need OpenHTJ2K, a second decoder ×1.13–1.41 slower on a whole frame, and k idle
workers, which a fill does not leave: an ask's lever only. *Still to measure:* a decoder that skips blocks outside the
columns, or precincts in the stored layout, would change (a) — a re-encode, the owner's; on a phone, three stripe
workers on mixed cores.

**L3 — a WebGPU HT block decoder: the container stage passes; nothing about speed is known.** P1 held (4 768 of 4 768
frames exact, one frame a dispatch and batched, workgroup scan and `subgroups`); P2 held (136 frames in mixed batches
of 160² to 3328×4096, 8 to 16 bits, signed, grey and RGB); four mutants each took every arm to 0 / 580. Conclusive for
exactness on what the ingest writes: OpenJPH's encoder writes the cleanup pass alone, so the refinement passes are
untested and a stream carrying them is refused, not decoded wrong. Untested by design: every time. *Still to measure,
on the owner's phones* (Chrome Android 121+, Safari 26): a warm ask on a breast frame from 931×2124 up, upload and
read-back included, against the reference — ≤ ×0.70 in 8 of 10 rounds — and a fill ≤ ×1.01; Safari's `mapAsync`
stall [8] and which phones expose `subgroups` [7] are read there, not here.

**L4 — a coarser hand-off unit: the row unit stays; conclusive.**

| # | predicted | measured | |
| --- | --- | --- | --- |
| P1 | 512²: row ×0.88–0.95, coarse toward ×0.70 | row ×0.80–0.86, coarse ×0.68–0.71 | coarse held; the row faster than predicted |
| P2 | large: row ×0.70–0.79, coarse toward ×0.65 | row ×0.68–0.84 (in range 4 of 6 cells), coarse ×0.66–0.81 | row mostly held; coarse reaches ×0.66 on the projections at 4× only |
| P3 | +~15 MB at 1914×2572, resolution only | +20–22 MB, subband as costly as resolution; +54–61 MB at 3328×4096 | refuted |

The rule fails: 0.03 under the row on every large series in 2–7 of 10 rounds against 8, and at 1× on the
projections all three units tie. P3's mechanism was wrong: OpenJPH pulls every band of every resolution line by line,
so any unit decoded at once holds the whole frame's coefficients. The row's 512² ratio moves between sessions on the
same bench (×0.80–0.86 here, ×0.88–0.91 in row HTJ2KMT, ×0.82–0.92 in L1's warm ask): a 512² pool gain is not known
closer than ±0.06. *Still to measure on a phone:* the little-core straggle the lever was for (a 2-block row predicted
up to ×1.7 slower with a slow helper) — only if the pool ships.

**L5 — decode paced to the wire: the fill holds, the container stage misses its rule on one cell; the mechanism is not
the one predicted.**

| # | predicted | measured | |
| --- | --- | --- | --- |
| P1 | fill ×0.99–1.01 where the wire is the clock | medians ×0.998–1.002 | held |
| P2 | not predicted (full-field 50 Mbit 4×) | ×1.001, 15/16 | — |
| P3 | CPU busy ×0.97–1.03 | ×0.85–0.98, under the range in 7 of 12 cells | refuted, low |
| P4 | fewer wake-ups and decoders busy at once | wake-ups ×0.18–0.47; busy at once lower in 3 of 12 cells | held |

Tomosynthesis on `lte-good` at 4× is ≤ ×1.01 in 12 of 16 rounds (strict 8 of 11) against 8 of 10, so by the rule as
written the container stage does not pass, both readings agreeing. As evidence against the lever it is weak: the
cell's median is ×1.002 and its last byte arrived at ×1.001, the overshoot in the trace's delivery more than in decode.
P3's refutation is the finding: today's least-busy dispatch already decodes on one decoder in 9 of 12 cells, so the
work is not spread as the hypothesis assumed; what follow-the-queue saves is the start of two decoders never used
(−2 to −15 % CPU, 55–82 % of wake-ups). A decoder started on first need, without retiring, would take most of that and
was not an arm. *Still to measure, on phones* with little cores and an iPhone: energy per fill, ≤ ×0.95 of today's
with the fill ≤ ×1.01; the saving the container shows is a start cost, which a phone's energy may or may not see.

**Across the five.** No lever moves a fill: the wire is its clock on every link measured. For an ask on frames from
1914×2572 up, today's pool (warm ×0.72–0.76, cold ×0.89–0.94) and three stripes on idle workers (×0.60–0.68 at 4×)
are the two container gains; the GPU's is unknown until a phone runs it. Nothing here changes a product default.

## Sources (all read 2026-10-09)

1. Emscripten settings reference, `PTHREAD_POOL_SIZE` and `PTHREAD_POOL_DELAY_LOAD` —
   <https://emscripten.org/docs/tools_reference/settings_reference.html>
2. Emscripten `libpthread.js`, the pool loaded before main and the module posted to each Worker —
   <https://raw.githubusercontent.com/emscripten-core/emscripten/main/src/lib/libpthread.js>
3. OpenHTJ2K README, viewport-region decode and the wavelet's zero-skip — <https://github.com/osamu620/OpenHTJ2K>
4. A. Naman and D. Taubman, "Decoding high-throughput JPEG2000 (HTJ2K) on a GPU", ICIP 2019 —
   <https://kakadusoftware.com/wp-content/uploads/ICIP2019_GPU.pdf>
5. WebGPU in Chrome 121 on Android 12+ — <https://developer.chrome.com/blog/new-in-webgpu-121>
6. WebGPU in Safari 26 —
   <https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/>
7. WebGPU subgroups — <https://developer.chrome.com/blog/new-in-webgpu-134>; MDN browser-compat-data
   `api/GPUSupportedFeatures.json` (<https://github.com/mdn/browser-compat-data>)
8. WebKit bug 272804, `mapAsync` waiting on unrelated command buffers (read through a search excerpt) —
   <https://bugs.webkit.org/show_bug.cgi?id=272804>
9. Linux utilisation clamping, PELT's 32 ms half-life and the ramp — <https://docs.kernel.org/scheduler/sched-util-clamp.html>
10. Linux Energy Aware Scheduling — <https://docs.kernel.org/scheduler/sched-energy.html>
11. Linux energy model — <https://docs.kernel.org/power/energy-model.html>
