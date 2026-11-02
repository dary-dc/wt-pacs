# key-parse

The pre-registered protocol of [`docs/decode/README.md`](../../../../docs/decode/README.md) §Safety without the flush:
at G = 1, the product's decoder worker flushed after every unit (`flush`, as shipped) against decoder config
`keyParse` (the key checked by parse, no flush), timed on every frame and sent every mutation, in each engine. The
verdict is written in that section.

```bash
lab/av1/tools/tools.sh                          # libaom 3.15.1, native dav1d 1.5.4
client/decode/wasm/build/build.sh               # the product's dav1d-WASM and XXH3 builds, checked against their manifest
lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1 rf_fluoro us_liver
B=lab/.av1-build W=lab/.av1-work/keyparse D=lab/av1/data P=lab/av1/.venv/bin/python
$P lab/av1/bytes/frame-groups/gop.py $B $W $W/bytes.jsonl $D/dbts_{a1,b1,c1} --encoder aom --groups 1,8 --keep dbts_a1,dbts_b1,dbts_c1
$P lab/av1/bytes/frame-groups/payloads.py $B $W $W/frames $D/dbts_{a1,b1,c1} --groups 1,8
$P lab/av1/decode/key-parse/make_frames.py $B $W/frames $D          # ~1 h on four cores, mostly the cpu0 streams
node lab/av1/decode/key-parse/run.mjs time --rounds 10 --engines chromium141,chromium --out $W/time.json
node lab/av1/decode/key-parse/run.mjs mutate --engines chromium141,chromium,firefox,webkit --out $W/mutate.json
node lab/av1/decode/key-parse/run.mjs time --rounds 1 --engines chromium --sets dbts_b1 --load   # per stream: how busy the host is
# 2026-11-02, exploratory (below): phases, row WCLAT's bare decoder and its 3 cores, traces, CPU time by arm
node lab/av1/decode/key-parse/run.mjs time --rounds 10 --engines chromium141,chromium --out $W/why-time.json
node lab/av1/decode/key-parse/run.mjs bare --rounds 3 --engines chromium141,chromium [--cores 3] --out $W/why-bare.json
node lab/av1/decode/key-parse/run.mjs time --rounds 3 --engines chromium141,chromium --sets dbts_b1,us_liver_intra_t4 --trace $W/traces
node lab/av1/decode/key-parse/run.mjs time --rounds 1 --engines chromium141,chromium --sets dbts_b1 --arms flush --load   # then keyParse
```

**Content.** The middle 16 slices of `dbts_a1`, `dbts_b1` and `dbts_c1` as `gop.py` codes them (libaom `good` 6, the
optimized representation: a 10-bit top on systems A and C, an 8-bit top on B, each with a 2-bit low stream) and as
`payloads.py` packs them, at G = 1 and, for the mutations, G = 8. Row WCLAT's real intra streams
([`../latency`](../latency/README.md)): the fluoroscopy's top 10 bits (18 × 768², grey) and the ultrasound cine (70 ×
760×421, RGB 8 as G, B, R), at 1, 2 and 4 tile columns, libaom cpu0, each frame coded in an encoder run of its own as
the product codes G = 1 (within 0.01 % of the bytes of WCLAT's one-run streams) and packed as a payload. Each frame's truth is the
SHA-256 of its stored samples, and its XXH3-64 is handed to the worker as the series' digests, so both arms run the
product's per-frame check. A unit coded alone carries `reduced_still_picture_header` = 1, so its frame header has no
`frame_type` to change; the intra-only, `show_existing_frame` and unshown mutations are made on G = 8's full-header key.

**Arms and order.** Both arms are `client/decode/decoder.js` as the product runs it (`worker.js` counts the units and
flushes that reach `VideoDecoder`), dav1d-WASM the product's build, one frame in flight, one warm-up frame. A
frame's time is the worker's `decodeStart`–`decodeEnd`. Each (engine × throttle) cell is a fresh browser opening
`page.js`, the cells in a Williams order every round (`lab/order.mjs`), streams and arms rotating inside each. 4× is
`lab/scripts/cpu_throttle.mjs` on the browser's tree once the page has loaded. The summary is the median over rounds of
each round's mean, and keyParse ÷ flush paired by round; "all streams" is each round's geometric mean over the nine
streams.

**Mutations** (`make_frames.py`), each through both arms after clean frames, a fresh worker per case: at G = 1 frames
0, 8, 9 with the mutation at 8; at G = 8 frames 0–15 with it at 8 (the key of the second group). A delta labelled
key; an intra-only, a `show_existing_frame` and an unshown key frame labelled key; a unit cut by 8 bytes; one coded
with two tile groups and its last dropped (and, as a control that must be exact, whole); a flipped tile byte; a
delimiter alone; another system's whole payload (another sequence header); a slice outside the run coded alone under
the same sequence header; two units swapped (8 and 9 at G = 1, 9 and 10 at G = 8); a unit with an OBU extension. A
send is `refused` (failed by name), `off-digest`, `exact`, `wrong` (shown with other samples: an escape) or
`stalled` (no answer in 30 s). A case is caught when nothing escapes or stalls and the mutated send is refused, off
its digest, or exact from dav1d-WASM after WebCodecs refused it.

**Checked by breaking it.** `--flip` (one bit of every decoded frame) turned every arm to 0 exact; `--no-digests` turned
every well-formed wrong unit (tile byte, foreign and same sequence header, swapped) to `wrong`, in both arms; the
send bound at 1.5 s turned every stall-timer case to `stalled`; and `keyUnit` removed from `av1-webcodecs.js` put the
malformed units on `VideoDecoder` (two units a send, not one) and turned the OBU extension, at G = 1 under
`keyParse`, to not caught.

**Pins.** Node 22.23.4; Chrome for Testing headless shell 141.0.7390.37 and 153.0.8010.12; Firefox 159.0 (Mozilla's
release tarball); WebKitGTK 2.52.6 (Ubuntu 24.04 `libwebkit2gtk-4.1-0` `2.52.6-0ubuntu0.24.04.1`), its MiniBrowser
under Xvfb with `JSC_useSharedArrayBuffer=1`; libaom 3.15.1 and dav1d 1.5.4 as `tools.sh` pins them; the decoder
builds as `client/decode/wasm/build/manifest.sha256` pins them. Nothing built, fetched or generated is committed.

## Measured (2026-10-31)

**Host.** 4 vCPUs (Intel Xeon @ 2.80 GHz, one thread a core), 15 GB, in a container. One frame in flight never
saturates it: over a cell of each stream in Chromium 153 (`--load`), 1.2–1.9 CPUs were busy on average at 1× and
0.7–1.1 at 4×, and no 100 ms sample had all four busy. Nothing here says what several decoders at once would do.

**Exact.** 24 960 of 24 960 frames timed (9 streams × 2 arms × 2 throttles × 2 engines × 10 rounds) came back with
their truth's samples, through WebCodecs in Chromium. `flush` flushed once a unit (twice a split frame) and
`keyParse` never; both sent every unit to `VideoDecoder`.

**Time, ms a frame** (median over 10 rounds of each round's mean; × is keyParse ÷ flush, the median of paired
rounds, and how many of 10 rounds keyParse was faster):

| stream | Chromium 141, 1× | 4× | Chromium 153, 1× | 4× |
| --- | --- | --- | --- | --- |
| `dbts_a1` (1142×1785, 10-bit top) | 113.5 · ×0.955, 7/10 | 460 · ×0.983, 8/10 | 114.0 · ×0.978, 6/10 | 468 · ×0.981, 6/10 |
| `dbts_b1` (2560×3328, 8-bit top) | 241.7 · ×0.964, 7/10 | 948 · ×1.021, 3/10 | 238.4 · ×1.019, 3/10 | 931 · ×1.054, 0/10 |
| `dbts_c1` (976×2513, 10-bit top) | 114.1 · ×0.968, 8/10 | 442 · ×0.996, 5/10 | 113.2 · ×0.981, 6/10 | 454 · ×0.979, 7/10 |
| fluoroscopy top10, 1 tile | 45.1 · ×0.971, 6/10 | 176 · ×0.935, 8/10 | 43.2 · ×0.975, 7/10 | 168 · ×0.975, 8/10 |
| 2 tiles | 30.7 · ×0.933, 7/10 | 101 · ×0.975, 7/10 | 29.6 · ×0.950, 9/10 | 101 · ×0.966, 8/10 |
| 4 tiles | 24.3 · ×0.935, 9/10 | 75.5 · ×1.008, 4/10 | 24.7 · ×0.922, 10/10 | 75.1 · ×0.958, 7/10 |
| ultrasound, 1 tile | 41.8 · ×0.936, 9/10 | 159 · ×0.972, 8/10 | 41.7 · ×0.937, 7/10 | 148 · ×1.025, 2/10 |
| 2 tiles | 29.7 · ×0.948, 9/10 | 103 · ×0.973, 7/10 | 29.4 · ×0.935, 9/10 | 99.5 · ×1.016, 3/10 |
| 4 tiles | 24.2 · ×0.930, 10/10 | 77.0 · ×1.003, 5/10 | 23.8 · ×0.921, 9/10 | 78.5 · ×0.953, 9/10 |
| **all streams** | **×0.951** [0.931–0.973], **10/10** | **×0.980** [0.969–1.002], **9/10** | **×0.955** [0.931–0.985], **10/10** | **×0.993** [0.956–1.012], **7/10** |

`run.mjs time --summary` prints each cell's range over rounds. The time includes the product's per-frame XXH3 check,
in both arms.

**Firefox 159 and WebKitGTK 2.52.6** decode none of the five streams tried through `VideoDecoder`: one round at 1×
on the three DBT runs and the 1-tile fluoroscopy and ultrasound, every frame came from dav1d-WASM in both arms (Firefox hands each ultrasound unit to `VideoDecoder`, then
falls back), so `keyParse` changes nothing there and they were not timed further.

**Mutations** (one round, 1× and 4×, all four engines, 78 cases a cell: 26 on each DBT run, 13 at G = 1 and 13 at
G = 8):

* **No send escaped or stalled** in any engine, arm or throttle: every send settled, the slowest in 2.8 s at 1× and
  4.8 s at 4× (a 4× frame of `dbts_b1` alone takes about 1 s); every control was exact.
* **Chromium 141 and 153, `keyParse`: 75 of 78 caught at each throttle.** At G = 1 all 13 kinds on all three runs:
  the delta, intra-only, `show_existing_frame`, unshown, cut and delimiter units refused by the parse before
  `VideoDecoder` (only the clean low unit reached it), then by dav1d-WASM, in 20–170 ms at 1×; the dropped tile
  group, which the parse passes, refused after the stall timer (2.0–2.2 s at 1×); the
  flipped tile byte, the foreign and the same sequence header and the swapped pair off their digests; the OBU
  extension refused by the parse and decoded exactly by dav1d-WASM. **The three not caught are the OBU extension at
  G = 8**, on each run: inside a group nothing is parsed, and WebCodecs decodes the unit to exactly its truth's
  samples, so it is neither refused nor off its digest.
* **Chromium, `flush`: 72 of 78**, the OBU extension at G = 1 and at G = 8 decoded exactly through WebCodecs. At
  G = 1 each of the seven malformed cases cost one send of 2.1–2.8 s at 1×, the stall timer: mostly the clean frame
  after the unit, which was itself refused in 20–40 ms. Under `keyParse` that frame took 0.2 s.
* **Firefox and WebKitGTK: 78 of 78 in both arms**, all through dav1d-WASM.

**The decision rule, as registered:** drop the flush if every mutation is caught in every browser and the no-flush
arm is faster in at least 9 of 10 paired rounds at both throttles; otherwise keep it, per browser. Speed: Chromium 141
meets it (10/10 and 9/10), Chromium 153 does not (10/10 and 7/10). Mutations: not every mutation is caught in
Chromium 141 or 153 (the OBU extension at G = 8). **So the rule keeps the flush in every browser**: Chromium 141 on
the mutations, Chromium 153 on both, Firefox and WebKitGTK because no stream tried reaches their `VideoDecoder`.

## Why the gain was small and the answer not conclusive (2026-11-02, exploratory)

**Exploratory: these runs decide nothing.** They were made after the 2026-10-31 data, to explain it, on the same
host type (4 vCPUs in a container; one frame in flight, 0.7–1.7 CPUs busy, never all four). Content: `dbts_b1` and
row WCLAT's six fluoroscopy and ultrasound intra streams, coded as above (the ultrasound and fluoroscopy units within
0.002 % of WCLAT's bytes); `dbts_a1` and `dbts_c1` were not re-run. Chromium 141.0.7390.37 and 153.0.8010.12, 1× and
4×, cells in a Williams order as above. Every timed frame of the product's worker was exact (22 400 of 22 400 in
run A). What was run:

* **A**, `time`, 10 rounds: both arms as on 2026-10-31, each frame split by the worker's own clock (`worker.js` stamps
  every `decode()`, output, `copyTo` and `flush()`): before `decode()`, to the output, the copy, the flush, and the
  rest (the grey chroma check, the merge, XXH3, the reply).
* **B**, `bare`, 3 rounds: row WCLAT's own method on the same units, a bare `VideoDecoder` on the page, timed from
  `decode()` to the output callback: `flush` (no `optimizeForLatency`, a flush per unit, as WCLAT ran it), `latency`
  (`optimizeForLatency`, no flush, as WCLAT ran it) and `latencyFlush` (`optimizeForLatency`, then a flush after the
  copy: the product's order). A split payload's top unit only. **D** is B with WCLAT's 3 cores (`--cores 3`: the
  browser under `taskset -c 0-2`, and at 4× the tree as a whole on 3 slowed CPUs).
* **C**, `time --trace`, 3 rounds of `dbts_b1` and the 4-tile ultrasound, Chromium's trace over CDP (`media`, V8 GC,
  the worker), and **E**, one arm a cell (`--arms`) with the browser tree's CPU time at the end (`--load`), 3 rounds.

The phase split was checked by breaking it: with the worker's flush stamp removed, the flush arm's flush column read
0.00 and its 1.8 ms moved into the rest (5.69 against 4.21 ms, the 4-tile ultrasound at 1×).

One cell of B hung on its first attempt (a `VideoDecoder` output that never came, Chromium 141 at 4×); `bare` now
fails such a frame after 30 s, and the re-run did not repeat it.

### 1 · The size: the flush costs 1.3–2.0 ms a frame at 1×, and WCLAT measured two levers at once

**What the flush costs in the product's worker** (run A, ms a frame, median over 10 rounds of each round's mean; the
flush arm's phases as *out · copy · **flush** · rest*, keyParse's as *out · copy · rest*; × is keyParse ÷ flush,
median of paired rounds, and rounds faster of 10; `dbts_b1`'s phases are run C's, below, because its two decoders
overlap):

| stream | flush | its phases | keyParse | its phases | × |
| --- | --- | --- | --- | --- | --- |
| *Chromium 141, 1×* | | | | | |
| `dbts_b1` | 213.4 | (run C) | 210.1 | (run C) | ×0.984, 8/10 |
| fluoroscopy, 1 tile | 43.0 | 34.5 · 1.39 · **1.34** · 5.68 | 41.8 | 34.9 · 1.43 · 5.16 | ×0.967, 8/10 |
| 2 tiles | 29.4 | 20.4 · 1.36 · **1.33** · 5.67 | 27.0 | 19.8 · 1.34 · 5.27 | ×0.908, 9/10 |
| 4 tiles | 22.6 | 14.0 · 1.27 · **1.29** · 5.55 | 20.5 | 13.8 · 1.29 · 5.00 | ×0.905, 10/10 |
| ultrasound, 1 tile | 38.4 | 31.0 · 0.78 · **1.34** · 4.60 | 36.4 | 31.1 · 0.85 · 4.08 | ×0.962, 8/10 |
| 2 tiles | 27.7 | 20.4 · 0.77 · **1.38** · 4.72 | 26.7 | 21.1 · 0.81 · 4.40 | ×0.976, 10/10 |
| 4 tiles | 21.8 | 14.8 · 0.81 · **1.31** · 4.67 | 20.2 | 14.7 · 0.81 · 4.26 | ×0.910, 10/10 |
| *Chromium 141, 4×* | | | | | |
| `dbts_b1` | 827.1 | (run C) | 828.9 | (run C) | ×0.991, 6/10 |
| fluoroscopy, 1 tile | 156.8 | 136.8 · 1.64 · **4.16** · 14.0 | 153.4 | 135.9 · 1.57 · 15.3 | ×0.979, 7/10 |
| 2 tiles | 92.9 | 73.1 · 1.56 · **3.72** · 14.4 | 87.0 | 70.2 · 1.64 · 15.2 | ×0.924, 9/10 |
| 4 tiles | 71.3 | 49.9 · 1.64 · **4.09** · 15.1 | 68.3 | 48.8 · 1.72 · 17.9 | ×0.959, 7/10 |
| ultrasound, 1 tile | 143.1 | 127.0 · 1.33 · **2.14** · 12.5 | 140.2 | 126.4 · 1.33 · 12.2 | ×0.971, 9/10 |
| 2 tiles | 96.5 | 79.2 · 1.11 · **2.35** · 12.7 | 93.1 | 78.6 · 1.36 · 12.8 | ×0.953, 8/10 |
| 4 tiles | 73.3 | 57.0 · 1.30 · **2.16** · 12.8 | 65.7 | 53.6 · 1.33 · 12.1 | ×0.905, 9/10 |
| *Chromium 153, 1×* | | | | | |
| `dbts_b1` | 215.8 | (run C) | 217.7 | (run C) | ×0.986, 6/10 |
| fluoroscopy, 1 tile | 43.4 | 35.2 · 1.35 · **1.92** · 4.72 | 42.6 | 35.4 · 1.38 · 4.88 | ×0.979, 7/10 |
| 2 tiles | 27.5 | 19.5 · 1.30 · **1.72** · 4.71 | 27.4 | 20.6 · 1.34 · 5.12 | ×0.951, 7/10 |
| 4 tiles | 23.1 | 14.4 · 1.34 · **1.83** · 5.14 | 20.1 | 13.6 · 1.31 · 4.63 | ×0.861, 10/10 |
| ultrasound, 1 tile | 37.8 | 30.9 · 0.75 · **1.96** · 3.91 | 36.7 | 31.6 · 0.75 · 4.00 | ×0.953, 9/10 |
| 2 tiles | 27.4 | 20.4 · 0.71 · **1.95** · 4.11 | 25.3 | 20.2 · 0.73 · 3.93 | ×0.925, 9/10 |
| 4 tiles | 21.7 | 14.9 · 0.71 · **1.76** · 3.88 | 19.2 | 14.4 · 0.70 · 3.89 | ×0.900, 10/10 |
| *Chromium 153, 4×* | | | | | |
| `dbts_b1` | 801.6 | (run C) | 832.5 | (run C) | ×1.038, 0/10 |
| fluoroscopy, 1 tile | 155.1 | 135.1 · 1.95 · **5.27** · 12.4 | 153.2 | 135.3 · 1.84 · 14.8 | ×0.970, 7/10 |
| 2 tiles | 91.7 | 75.0 · 1.63 · **4.68** · 10.0 | 90.8 | 71.8 · 1.80 · 16.7 | ×0.990, 5/10 |
| 4 tiles | 75.7 | 56.4 · 1.62 · **4.93** · 11.0 | 67.2 | 49.2 · 1.74 · 15.5 | ×0.884, 9/10 |
| ultrasound, 1 tile | 133.1 | 121.1 · 0.82 · **3.24** · 8.27 | 137.8 | 123.2 · 0.83 · 12.9 | ×1.032, 2/10 |
| 2 tiles | 92.7 | 78.8 · 0.84 · **3.24** · 9.02 | 91.2 | 77.1 · 0.84 · 12.4 | ×0.986, 8/10 |
| 4 tiles | 72.5 | 58.6 · 0.87 · **3.69** · 8.36 | 67.1 | 53.3 · 0.83 · 12.0 | ×0.926, 10/10 |
| **all streams** | | | | | 141: ×0.942 10/10 at 1×, ×0.961 10/10 at 4×; 153: ×0.938 9/10 at 1×, ×0.972 10/10 at 4× |

So the flush waits **1.3–2.0 ms a frame at 1× and 2.1–5.3 ms at 4×** on these streams, nearly the same whatever the
frame's size: 3–9 % of a 20–43 ms frame at 1×, 1.3 % of `dbts_b1`'s one decoder (2.7–3.5 ms of 213–219 ms, run C).
A fixed cost a frame, so its share falls as frames grow (*derived* from these rows). It is fixed because Chromium
does not just drain on `flush()`: it re-initialises the decoder. `DecoderTemplate::OnFlushDone` ends with
"// Processing continues in OnInitializeDone()." and calls `Traits::InitializeDecoder( *decoder(), is_flush ?
low_delay_ : …` (`third_party/blink/renderer/modules/webcodecs/decoder_template.cc` at tags 141.0.7390.37 and
153.0.8010.12), and `Dav1dVideoDecoder::Initialize` begins "// Clear any previously initialized decoder.
CloseDecoder();" before opening dav1d again (`media/filters/dav1d_video_decoder.cc`, both tags). The traces agree:
one `Dav1dVideoDecoder` initialisation per flush (117 = 107 flushes + 10 configures in a cell). At 4× the rest of a
frame in Chromium 153 is 2.4–6.7 ms longer under keyParse on the small streams, which takes most of the flush's
saving back there; Chromium 141 shows no such shift. Its cause was not traced.

**Why WCLAT saw more.** Row WCLAT's `flush` variant was configured without `optimizeForLatency` and its `latency`
variant with it ([`../latency`](../latency/README.md) `page.js`, `CONFIG`), so its ×0.80–0.93 is two levers at once.
The product's worker sets `optimizeForLatency: true` in both arms (`client/decode/av1-webcodecs.js`, `configure`), so
only the flush is left to save. Chromium reads the option as dav1d's frame delay: "// We only want 1 frame thread in
low delay mode, since otherwise we'll require at least two buffers before the first frame can be output. if
(low_delay) { s.max_frame_delay = 1; }" (`dav1d_video_decoder.cc`, both tags). The specification makes it a hint:
"Hint that the selected decoder SHOULD be configured to minimize the number of EncodedVideoChunks that have to be
decoded before a VideoFrame is output" (W3C WebCodecs, §7.6 `optimizeForLatency`). Run B separates the two levers on
the same units (ms from `decode()` to the output; *flush* as WCLAT ran it, then latency ÷ flush with 4 cores (B) and
with WCLAT's 3 (D), then `latencyFlush`'s own wait for its flush):

| stream | WCLAT: flush · ×, 2026-10 | Chromium 141: flush · × (B) · × (D) · flush wait | Chromium 153: the same |
| --- | --- | --- | --- |
| *1×* | | | |
| fluoroscopy, 1 tile | 33.1 · ×0.93 | 33.4 · ×0.97 · ×1.02 · 1.61 | 34.3 · ×0.95 · ×0.99 · 1.86 |
| 2 tiles | 19.9 · ×0.84 | 20.6 · ×0.94 · ×0.92 · 1.35 | 20.7 · ×0.93 · ×0.98 · 1.78 |
| 4 tiles | 14.8 · ×0.80 | 14.4 · ×0.99 · ×0.96 · 1.37 | 15.8 · ×0.89 · ×0.96 · 1.67 |
| ultrasound, 1 tile | 32.8 · ×0.86 | 32.3 · ×0.93 · ×0.97 · 1.39 | 32.3 · ×1.01 · ×0.97 · 1.77 |
| 2 tiles | 20.8 · ×0.87 | 20.7 · ×0.98 · ×0.93 · 1.35 | 21.7 · ×0.95 · ×0.93 · 1.83 |
| 4 tiles | 15.6 · ×0.85 | 15.4 · ×0.94 · ×0.93 · 1.33 | 15.4 · ×0.97 · ×0.99 · 1.67 |
| `dbts_b1`, top unit | — | 162.0 · ×0.78 · ×0.76 · 2.47 | 156.1 · ×0.79 · ×0.72 · 2.80 |
| *4×* | | | |
| fluoroscopy, 1 tile | 135 · ×0.93 | 130.1 · ×1.05 · ×1.06 · 3.27 | 133.6 · ×0.98 · ×1.06 · 3.80 |
| 2 tiles | 80.8 · ×0.88 | 130.5 · ×0.53 · ×0.56 · 3.36 | 82.3 · ×0.86 · ×0.74 · 4.62 |
| 4 tiles | 69.6 · ×0.72 | 75.1 · ×0.75 · ×0.81 · 4.78 | 117.5 · ×0.43 · ×0.79 · 3.65 |
| ultrasound, 1 tile | 118 · ×0.97 | 110.9 · ×1.08 · ×1.10 · 2.38 | 113.2 · ×1.11 · ×1.11 · 2.83 |
| 2 tiles | 84.0 · ×0.87 | 91.3 · ×0.86 · ×0.94 · 2.47 | 98.7 · ×0.80 · ×0.98 · 3.11 |
| 4 tiles | 65.8 · ×0.80 | 76.6 · ×0.70 · ×0.71 · 2.14 | 78.5 · ×0.66 · ×0.72 · 2.79 |
| `dbts_b1`, top unit | — | 541.9 · ×0.91 · ×0.86 · 10.6 | 551.5 · ×0.87 · ×0.88 · 9.69 |

WCLAT's harness reproduces WCLAT's flushed times at 1× within 7 %, but not its gain: ×0.89–1.02 on the small streams
here, against ×0.80–0.93, with 4 cores or 3. Each round's median frame in place of its mean moves these by at most
0.05. Where `optimizeForLatency` matters is the large frame: ×0.72–0.79 at 1× on `dbts_b1`'s top. At 4× the bare
harness is unstable: a flushed decoder's next frame comes out much later when it is sent at once (`latencyFlush` out on the
4-tile ultrasound 108–124 ms against 52–57 without the flush, on the 4-tile fluoroscopy up to 174 against 50–54), but the product's worker shows no such cost (4-tile *out* 49–59 ms in both
arms) because 8–17 ms of its own work separate the flush from the next `decode()`. It may come from the throttle,
which moves each new thread into a slowed group of its own only when its 10 ms poll finds it (*unverified*). WCLAT's
4× range (−3 to −28 %) is that instability's size.

Of the items asked about: **what is timed** (WCLAT, `decode()` to the output; the product, the whole frame, so its
denominator is 4–7 ms larger at 1× on the small streams with the same 1.3–2 ms saved), **the XXH3 check and
`copyTo`** (in the *rest* and *copy* columns, equal in both arms at 1×), **two decoders for a split frame** (each
flushes; their waits overlap, so `dbts_b1` saves one wait of 2.7–3.5 ms, run C), **Chromium's version** (141 and 153
alike at 1×) and **the throttle** (4× tree cap and 3 cores in WCLAT, per-thread cap and 4 cores here) all bear on it.
The main term is the one WCLAT's arms did not share, `optimizeForLatency`, and next to it a gain WCLAT measured at
1× that does not reproduce in the same harness today.

### 2 · `dbts_b1` at 4× in Chromium 153: the decoders run longer, not our worker

Run C, `dbts_b1` (ms a frame; median over 3 rounds of each round's mean; phases of the decoder whose output comes
last, *before · out · copy · **flush** · rest*):

| | flush | its phases | keyParse | its phases | × |
| --- | --- | --- | --- | --- | --- |
| Chromium 141, 1× | 212.9 | 1.55 · 140.5 · 9.80 · **2.73** · 62.1 | 213.3 | 1.72 · 141.4 · 10.1 · 63.3 | ×0.988, 2/3 |
| Chromium 141, 4× | 821.5 | 1.67 · 520.1 · 34.8 · **12.5** · 239.9 | 790.9 | 2.45 · 524.7 · 36.8 · 231.0 | ×0.962, 3/3 |
| Chromium 153, 1× | 218.8 | 1.43 · 138.2 · 9.04 · **3.47** · 66.9 | 219.3 | 1.43 · 141.0 · 8.72 · 67.7 | ×0.987, 2/3 |
| Chromium 153, 4× | 821.2 | 1.71 · 483.9 · 34.4 · **12.8** · 277.1 | 845.5 | 1.79 · 543.2 · 35.1 · 266.4 | ×1.046, 0/3 |

Our worker's share, the copy and the rest, is the same in both arms. What grows is the decode: in Chromium 153 at 4×,
the first of the two decoders' outputs comes a median 417 ms after the top's `decode()` with the flush and 481 ms
without it (51 frames each, Chromium's own trace), the second 480 and 538 ms; Chromium 141 at 4× 466 and 461, and at 1×
both versions 122–127 ms in both arms. The bare decoder shows a trace of it (run B, top unit alone, 4×: `latency`
481.5 against `latencyFlush` 468.2 ms in 153, 489.5 against 492.9 in 141).

It is not more work. The browser tree's CPU time over a cell of one arm (run E, 3 rounds, CPU seconds; the cell's
startup included):

| | flush | keyParse |
| --- | --- | --- |
| Chromium 141, 1× | 7.3 · 7.9 · 7.7 | 7.5 · 7.2 · 7.5 |
| Chromium 141, 4× | 7.9 · 8.4 · 8.1 | 7.7 · 7.7 · 7.7 |
| Chromium 153, 1× | 6.9 · 7.2 · 7.0 | 7.0 · 7.2 · 7.4 |
| Chromium 153, 4× | 7.2 · 7.4 · 7.5 | 7.2 · 7.2 · 7.2 |

Nor garbage collection: the worker's V8 GC took under 1 ms a frame at 1× and about 2 ms at 4×, the same in either
arm (the trace's `MajorGC` and `MinorGC` on its thread). Nor frame or buffer pools by work done: the CPU time is level. Chromium 153's frame pool
zero-fills new buffers where 141's did not (`FrameBufferPool(/*zero_initialize_memory=*/true)`,
`dav1d_video_decoder.cc` at 153.0.8010.12, against "base::MakeRefCounted<FrameBufferPool>();" at 141.0.7390.37), but a zero-fill would cost
CPU time, and would cost at 1× too. So the same CPU work takes longer only when a persistent decoder runs under the
per-thread throttle in Chromium 153, which reads as scheduling under the lever. Which scheduling was not found
(*unverified*). The trace also shows where our work runs: without a flush there is nothing to wait on, so the whole
rest of the frame runs inside the decoder's output callback (Chromium's `VideoDecoder::Ouput` span, median 17–21 ms
under keyParse against 1.1–1.3 ms with the flush). That moves our work without lengthening it (the *rest* column).

**No fix was built:** the cause is not in our worker. The 8-bit top's size matters only as the frame on which this
shows: 2560×3328, two decoders.

### 3 · The mutation clause: what it should have said

As registered ("Each must be refused by name or fail its digest … drop the flush if every mutation is caught"), the
clause is absolute, so it judges each arm alone. The shipped `flush` arm fails it (72 of 78), and the clause cannot
choose between two arms that both fail. Its three keyParse misses are not misses. They are the OBU-extension unit at
G = 8, and `keyParse` does not act at G = 8, where no unit is parsed (`client/decode/av1-webcodecs.js`: `parsed =
keyParse && length === 1`). That unit's decoded picture is its truth's. The AV1 decoding process drops an OBU for its
extension only when `OperatingPointIdc != 0` ("if ( obu_type != OBU_SEQUENCE_HEADER && obu_type !=
OBU_TEMPORAL_DELIMITER && OperatingPointIdc != 0 && obu_extension_flag == 1 )", AV1 §5.3.1). The extension's
presence is non-conforming ("It is a requirement of bitstream conformance that if OperatingPointIdc is equal to 0,
then obu_extension_flag is equal to 0 for all OBUs that follow this sequence header"). Its decoded output is still
the right picture (*derived*). **It should have been relative to the shipped arm, at G = 1:** no escape and no stall
in either arm, and every mutation the flush catches is caught without it. A mutated unit that decodes to exactly its
truth is reported as exact, not counted as a miss in either arm. G = 8 is a regression check, where both arms must
give the same outcome. The amended protocol says so: [`docs/decode/README.md`](../../../../docs/decode/README.md)
§Safety without the flush.

### 4 · The speed clause: what resolves 2 %

Per-round spread of ln(keyParse ÷ flush) (sd over 10 rounds; *derived* for 2026-10-31 from each cell's range over 10
rounds, the expected range of 10 normal draws being 3.08 sd), the rounds a paired *t*-test needs for 80 % power at
α = 0.05 two-sided, and the chance that "faster in ≥ 9 of 10" passes a true effect of 2 % (*derived*, normal rounds):

| all streams | sd | rounds for 2 % | for 1 % | P(≥ 9 of 10 \| 2 %) |
| --- | --- | --- | --- | --- |
| 2026-10-31, Chromium 141 1× / 4× | 1.43 / 1.09 % | 7 / 5 | 19 / 12 | 0.81 / 0.96 |
| 2026-10-31, Chromium 153 1× / 4× | 1.83 / 1.85 % | 9 / 9 | 29 / 29 | 0.59 / 0.58 |
| run A, Chromium 141 1× / 4× | 1.47 / 2.17 % | 7 / 12 | 19 / 39 | 0.79 / 0.44 |
| run A, Chromium 153 1× / 4× | 4.07 (3.04 robust) / 1.23 % | 35 (21) / 6 | 132 (75) / 14 | 0.13 / 0.91 |

Chromium 153 at 4× measured ×0.993 on 2026-10-31. At that size the rule passes 8 % of the time, and at a true 2 %
gain about 58 %. One stream alone spreads 2.5–8 % (median about 5 %), so it needs 14–130 rounds for 2 % (run A).
The 4.07 is one round of the 1-tile fluoroscopy at 81.6 ms against 37–47. **The 4× throttle is not the main noise:**
the spread at 4× is not larger than at 1× (1.09 against 1.43 % and 1.85 against 1.83 % on 2026-10-31; per stream in
run A a median of 5.1 against 4.8 %). The spread is round to round, a fresh browser each cell. Run A, the same
protocol on 7 of the 9 streams, passed the registered speed clause in both versions (10/10 and 10/10; 9/10 and 10/10),
which the 2026-10-31 run did not. That is the rule's coin flip at these effect sizes.
