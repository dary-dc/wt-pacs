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
