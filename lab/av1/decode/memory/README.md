# footprint

The AV1 path's memory per decoder worker and its first-use cost, against HTJ2K's, in headless Chromium.
Queue row 38 (FOOTPRINT) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md); the reading is in
[`docs/av1/README.md`](../../../../docs/av1/README.md) §A2.

```bash
lab/av1/tools/tools.sh && ARMS=simd client/decode/wasm/dav1d/build.sh      # libaom, native dav1d, dav1d-WASM
client/decode/wasm/fetch_openjph.sh                              # OpenJPH, the package
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160  # builds ojph_compress once
EMSDK=lab/.av1-build/emsdk INITIAL_MB=4 ARMS=deliver lab/decode-bench/wasm/build.sh   # the adopted wrapper
lab/av1/fetch_data.sh dbtproj_ge us_liver
PRESET=a7 lab/av1/.venv/bin/python lab/av1/decode/high-depth/make_frames.py lab/.av1-build lab/.av1-work/footprint/rep14 lab/av1/data/dbtproj_ge
ARMS=av1,rct lab/av1/.venv/bin/python lab/av1/delivery/total-time/make_frames.py lab/.av1-build lab/.av1-work/footprint/total lab/av1/data/us_liver
NODE_PATH=$(npm root -g) node lab/av1/decode/memory/run.mjs --mode mem --rounds 6 --out mem.jsonl
NODE_PATH=$(npm root -g) node lab/av1/decode/memory/run.mjs --mode first --rounds 12 --out first.jsonl
node lab/av1/decode/memory/summary.mjs mem.jsonl first.jsonl
```

**Series**, the largest frames here: the 14-bit tomosynthesis projections of one system (`dbtproj_ge`,
9 × 1914×2572, 4.92 M samples) and the RGB ultrasound (`us_liver`, 70 × 760×421×3).

**Arms**, each the product's `client/downloader/decoder.js` told what `connect` would tell it:

| arm | frames | decoder |
| --- | --- | --- |
| `htj2k` | the served HTJ2K profile | OpenJPH, the `@cornerstonejs/codec-openjph` 2.4.11 package every AV1 row timed against |
| `htj2k4` | the same | OpenJPH, the adopted wrapper rebuilt from today's source with a 4 MB initial heap ([`docs/decode/README.md`](../../../../docs/decode/README.md) §The build, as delivered) |
| `d12` | the two low bits apart, v ≫ 2 at 12 bits + v & 3 at 8 (row REP14, `--allintra --cpu-used=7`) | dav1d-WASM (`simd`) |
| `w10` | v ≫ 4 at 10 bits + the four low bits at 8 (row REP14) | WebCodecs, two `VideoDecoder`s |
| `rct` | the reversible colour transform, 10-bit 4:4:4 (row LLSIZE, cpu0) | dav1d-WASM |
| `rctwc` | the same frames | WebCodecs |

**Memory** (`--mode mem`): each (set, arm, D ∈ 1, 2, 4) is a fresh browser context, cells in a Williams
order each round (`lab/order.mjs`). The page starts D workers, then stops at four checkpoints — *ready*,
*first* (each worker has decoded one frame), *series* (the whole series, under the product's rule: the
least-loaded worker under two in flight takes the next), *again* (the series a second time) — and at each:
every worker's **WebAssembly linear memory**, exact, read by `probe.js`, which `worker.js` imports ahead of
the product's worker to keep each memory it instantiates; the page's
`performance.measureUserAgentSpecificMemory()` (which collects first; the workers' JS+WASM); and the
renderer's RSS from `/proc`, which `run.mjs` reads before resuming the page. The peak is the renderer's
`VmHWM`. A worker is a thread in the renderer, so its resident cost is the RSS slope in D, paired inside
a round, as `lab/decoder-memory`. Pixels are hashed and dropped, not held.

**First use** (`--mode first`): each (throttle, set, arm) is a fresh browser context visited three times:
*cold*, then *cached* and *cached2*, new pages in the same context, so with the browser's HTTP and code
caches as the earlier visits left them. A visit starts one worker, times the `init` message to `ready`
(fetching the module, compiling, instantiating; for WebCodecs, creating and configuring the
`VideoDecoder`s) and then three frames one at a time, each from the `decode` message to its pixels on the
page. *First-use cost* is init + frame 0 − the mean of frames 1 and 2. Whether the `.wasm` came from the
cache is the worker's own resource timing (transfer 0, body > 0). Throttle cells are each a fresh browser
in a Williams order, arms rotating inside; 4× is `lab/scripts/cpu_throttle.mjs` on the browser's tree.

**Checked.** On the projections, `--mutate sample` (a byte of every decoded frame) and `--mutate truth`
(a digit of every checksum) turned every arm to 0 exact in both modes; `--mutate split` (the split one
bit short) turned both AV1 arms to 0 with HTJ2K exact. `probe.js` keeping no memory read 0 MB on every
arm.

## The reading

Memory, 6 rounds each (the two sets ran as separate campaigns); MB a worker; median [range]. *Heap* is
the WebAssembly linear memory at the series' end, the same after a second pass in every cell; *resident*
the renderer's RSS slope from 1 to 4 workers, settled and at its peak (`VmHWM`):

| set | arm | heap after frame 1 | heap | resident | resident peak |
| --- | --- | ---: | ---: | ---: | ---: |
| projections | `htj2k` | 50.0 | 50.0 | 26.1 [26.0–26.3] | 31.4 [31.2–43.7] |
| | `htj2k4` | 20.5 | 28.3 | 24.6 [24.4–25.0] | 30.2 [29.5–31.2] |
| | `d12` | 19.7 | 34.8 | **31.6 [31.2–32.2]** | 33.7 [30.7–36.8] |
| | `w10` | — | — | 6.3 [4.9–7.3] | 58.3 [49.2–62.9] |
| ultrasound | `htj2k` | 50.0 | 50.0 | 7.1 [6.7–7.6] | 9.3 [7.6–16.7] |
| | `htj2k4` | 6.0 | 6.0 | 7.1 [7.0–7.4] | 8.2 [8.0–16.3] |
| | `rct` | 16.4 | 16.4 | **7.6 [7.1–8.5]** | 8.4 [8.1–9.1] |
| | `rctwc` | — | — | 9.7 [6.5–30.0] | 32.4 [30.5–43.2] |

The package's heap is its 50 MB initial memory, mostly mapped and not resident. A WebCodecs worker's
pictures live outside its heap and the page's measure (0.4 MB a worker); from 1 to 2 workers its peak
slope reads 88 and 76 MB.

First use, 12 rounds, ms, median over rounds; *cost* is init + frame 0 − the mean of frames 1–2, the
range over the cold and both cached visits' medians; every cached visit took its `.wasm` from the cache:

| set | arm | init 1× | frames 1–2, 1× | cost 1× | init 4× | cost 4× |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| projections | `htj2k` | 30–36 | 101–102 | 61–65 | 101–107 | 164–187 |
| | `htj2k4` | 30–38 | 67–68 | 69–82 | 96–104 | 215–225 |
| | `d12` | 31–39 | 637–647 | 93–97 | 85–91 | 205–280 |
| | `w10` | 18–28 | 275–289 | 14–27 | 50–58 | 35–73 |
| ultrasound | `htj2k` | 32–38 | 11–13 | 48–53 | 100–115 | 183–195 |
| | `htj2k4` | 31–41 | 13–15 | 45–56 | 98–108 | 171–186 |
| | `rct` | 28–39 | 50 | 65–76 | 84–93 | 200–227 |
| | `rctwc` | 17–24 | 37 | 23–29 | 50–59 | 64–78 |

Per-round ratios of the dav1d arms' cost to `htj2k`'s span 0.1–4.8: the cost is a difference of two
noisy times, so only the ranges above are claimed, not an ordering inside them.

**Read before trusting a number.** Desktop Chromium on a 4-core container, not a phone: a phone's
memory is what the bytes here say, its time is not what the milliseconds here say. `worker.js` adds one
module import in front of the product's worker. The dev server sends no `Cache-Control`, so a cached visit
may revalidate; the column says what happened.

**Pins.** Node 22.22.0, playwright 1.56.1's Chromium 141.0.7390.37, dav1d 1.5.4 under emscripten 3.1.74
(`simd.wasm`, 623 146 B), OpenJPH 0.31.0 (`deliver.wasm`, 246 472 B), `@cornerstonejs/codec-openjph`
2.4.11, libaom 3.15.1. Nothing built, fetched or generated is committed.
