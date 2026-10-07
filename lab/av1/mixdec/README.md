# mixdec — a split item's two streams through two decoders

Queue row 47 (MIXDEC) of [`docs/av1/queue.md`](../../../docs/av1/queue.md): the client decodes an item
through one decoder — WebCodecs when every stream is ≤ 10 bits and its probes pass, dav1d-WASM otherwise.
For a split item whose top is over 10 bits, the 8-bit low stream could go to WebCodecs while dav1d-WASM
decodes the top. The bytes do not change; only decode can. The verdict is in
[`docs/av1/README.md`](../../../docs/av1/README.md) §A3 and
[`docs/decode/README.md`](../../../docs/decode/README.md) §AV1.

```bash
lab/av1/tools.sh && ARMS=simd lab/av1/dav1d-wasm/build.sh      # libaom 3.15.1, native dav1d, dav1d-WASM
lab/decode-bench/fetch_decoder.sh                              # OpenJPH, the shipped package
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160  # builds ojph_compress once
lab/av1/item/build.sh                                          # ingest's in-process check
lab/av1/fetch_data.sh ct_lidc xa_dynact16 ct_nlst ct_crc dbtproj_ge dbtproj_holo
P=lab/av1/.venv/bin/python W=lab/.av1-work/mixdec
$P lab/av1/mixdec/make_frames.py lab/.av1-build $W lab/av1/data   # each k at its shipped preset, ~30 min
NODE_PATH=$(npm root -g) node lab/av1/mixdec/run.mjs bound --rounds 10 --out bound.json
NODE_PATH=$(npm root -g) node lab/av1/mixdec/run.mjs decode --rounds 10 --out decode.json
$P lab/av1/mixdec/mixed_arms.py $W                             # kKm beside kK in arms.json
NODE_PATH=$(npm root -g) node lab/av1/total/run.mjs --frames $W --links r20000,r50000 --throttles 4 \
  --rounds 10 --out total.jsonl
# exactness, row 43's synthetic set and the real series, every engine (row 43's harness, --mixed):
FIREFOX_PATH=... node lab/av1/splitok/browser.mjs lab/.av1-work/splitok/sets lab/.av1-work/splitok/items --mixed
```

**The flag.** `mixed: true` in the series' decoder config (`client/downloader/av1.js`; absent, today's
path): a split item whose top is over 10 bits starts its low unit on WebCodecs' `low` decoder — after the
`g8` probe passed — then decodes the top through dav1d-WASM in the worker, and merges the two. A low that
WebCodecs fails or whose probe failed is decoded by dav1d-WASM after the top. A top that fails waits for
its low to settle, so no low is left in flight for the next item.

**Series and arms.** The 13- and 14-bit series of rows 2, 21 and 45: the CT (`ct_lidc`), the cone-beam
(`xa_dynact16`), the two signed CTs (`ct_nlst`, `ct_crc`) and both projection systems (`dbtproj_ge`,
`dbtproj_holo`), every frame. Items are `lab/av1/item/ingest.py --split K` at each (series, k)'s shipped
preset, as rows 44 and 45 found it (`make_frames.py`'s table). `kK` is the item split at k as the client
decodes it today; `kKm` the same file with the flag, only where its top is over 10 bits (13 bits: k = 1,
2; 14 bits: k = 2, 3); w10 is k = b − 10, every stream through WebCodecs.

**`run.mjs bound`** decodes each split item whose top is over 10 bits through dav1d-WASM in a lab worker
(`bound-worker.js`), as `av1.js` does today, timing the top's decode (with its placement), the low's and
the merge apart: the low's share of the frame is the most the flag can save. **`run.mjs decode`** is row
REP14's harness (`lab/av1/speed/drive.js`) over today's, the mixed and the w10 arm and OpenJPH: the
product's decoder worker, one frame in flight, the worker's `decodeStart`–`decodeEnd`. Both hash every
frame against its source's checksum; every throttle cell is a fresh headless Chromium in a Williams order
each round, sets and arms rotating inside it; 4× is `lab/scripts/cpu_throttle.mjs` on the browser's tree.

## The bound (2026-10-06)

Both streams through dav1d-WASM as the client decodes them today, headless Chromium 141, 10 rounds at 1× and
4×, every frame of the six series at each k whose top is over 10 bits: **14 840/14 840 frames exact**. Median
ms a frame (the median over rounds of each round's median), and the low stream's share of the frame — the
median per round of low / (top + low + merge), its range over rounds in brackets:

| series | k | top 1× · 4× | low 1× · 4× | low's share 1× | 4× |
| --- | --- | --- | --- | --- | --- |
| CT, 13 bits | 1 | 21.2 · 91.3 | 8.6 · 36.3 | 0.279 [0.28–0.28] | 0.279 [0.26–0.29] |
| | 2 | 17.8 · 76.2 | 11.2 · 49.3 | 0.372 [0.37–0.37] | 0.375 [0.37–0.39] |
| cone-beam, 13 bits | 1 | 36.3 · 157 | 8.5 · 38.9 | 0.187 [0.19–0.19] | 0.187 [0.18–0.19] |
| | 2 | 29.0 · 125 | 11.2 · 48.4 | 0.272 [0.27–0.28] | 0.271 [0.26–0.29] |
| signed CT (`ct_nlst`), 13 bits | 1 | 40.4 · 173 | 8.5 · 36.5 | 0.171 [0.17–0.17] | 0.169 [0.16–0.17] |
| | 2 | 34.9 · 151 | 11.2 · 49.9 | 0.241 [0.24–0.25] | 0.242 [0.24–0.26] |
| signed CT (`ct_crc`), 13 bits | 1 | 20.9 · 89.3 | 8.6 · 38.9 | 0.282 [0.28–0.28] | 0.285 [0.28–0.30] |
| | 2 | 17.6 · 76.1 | 11.3 · 48.4 | 0.379 [0.38–0.38] | 0.377 [0.37–0.39] |
| projections, system 1, 14 bits | 2 | 445 · 1 944 | 243 · 1 049 | 0.339 [0.33–0.35] | 0.338 [0.33–0.35] |
| | 3 | 373 · 1 571 | 339 · 1 434 | 0.464 [0.45–0.47] | 0.461 [0.45–0.47] |
| projections, system 2, 14 bits | 2 | 189 · 834 | 136 · 591 | 0.405 [0.40–0.41] | 0.401 [0.39–0.41] |
| | 3 | 155 · 680 | 193 · 835 | 0.538 [0.53–0.54] | 0.539 [0.53–0.54] |

**The low stream is 17–38 % of a 13-bit frame's decode and 34–54 % of a 14-bit one's, at 1× and 4× alike.**
It is the noise: its time per sample grows with k (0.033 → 0.043 µs a sample at 1× on 512², k = 1 → 2), and
the top's falls. The merge is 1–3 % of the frame. Decoded beside the top instead of after it, the low could
take up to that share off a frame — if WebCodecs decodes it in no more than the top's time, and if the
cores are free to run both. Containers, not phones.

## Built, and exact

`client/downloader/av1.js` behind `mixed` (above); today's path is unchanged with it off (`av1.test.mjs`).

* **Every frame of the six series at every k of their depth, in three engines** (row 43's harness,
  `lab/av1/splitok/browser.mjs --mixed`, its decoder tag read per stream): 18 cells, 1 113/1 113 frames exact
  and every stream's picture the one planned from the source, in each of Chromium 141, Firefox 157.0.1 and
  WebKitGTK 2.52.6 (`webkit+sab`, as row 37 ran them). Chromium decoded the 742 items whose top is over
  10 bits mixed — the top through dav1d-WASM, the low through WebCodecs — and the 371 w10 items through
  WebCodecs alone; Firefox and WebKitGTK decoded all 1 113 through dav1d-WASM, their `g8` probe failing.
* **Mutations, each caught.** In Node with stub decoders (`av1.test.mjs`, 6): the flag off still mixing; no
  fallback for a failed low; the low decoder handed the top; the top decoder handed the low; the low taken
  from the previous item; a failed top not waiting for its low. In the browsers on the k = 2 cells (6 cells,
  371 frames each): the low from the previous item (1/371 exact), top and low swapped (0/371), WebCodecs'
  low picture read a row down (0/371), the flag off still mixing (371/371 exact but 0/371 decoded as
  expected — the tag catches it), and in Firefox the failed low with no fallback (0/371).

## Decode (2026-10-07)

Through the product's decoder worker, headless Chromium 141, 10 rounds at 1× and 4×, the first 24 frames of
each 13-bit series and every frame of the projections; **12 000/12 000 AV1 frames exact** (and every HTJ2K one).
Median ms a frame, and the median of round-paired ratios [range]; mixed was faster than today in all 120
paired rounds:

| series | k | today 1× · 4× | mixed 1× · 4× | ×today 1× · 4× | ×w10 1× · 4× |
| --- | --- | --- | --- | --- | --- |
| CT, 13 bits | 1 | 20.8 · 82.5 | 15.6 · 61.6 | 0.75 · 0.76 | 1.42 · 1.99 |
| | 2 | 21.1 · 81.2 | 14.8 · 53.5 | 0.68 · 0.66 | 1.30 · 1.71 |
| cone-beam, 13 bits | 1 | 31.3 · 120 | 25.2 · 106 | 0.82 · 0.86 | 1.65 · 2.16 |
| | 2 | 27.2 · 110 | 21.2 · 81.6 | 0.77 · 0.73 | 1.39 · 1.69 |
| signed CT (`ct_nlst`), 13 bits | 1 | 33.1 · 131 | 29.9 · 115 | 0.87 · 0.86 | 1.76 · 2.05 |
| | 2 | 30.3 · 123 | 23.7 · 92.1 | 0.77 · 0.75 | 1.41 · 1.69 |
| signed CT (`ct_crc`), 13 bits | 1 | 19.7 · 81.7 | 15.7 · 58.4 | 0.77 · 0.73 | 1.37 · 1.79 |
| | 2 | 20.1 · 80.8 | 13.7 · 53.7 | 0.67 · 0.63 | 1.21 · 1.59 |
| projections, system 1, 14 bits | 2 | 465 · 1 952 | 306 · 1 337 | 0.66 · 0.67 | 1.56 · 1.65 |
| | 3 | 479 · 1 993 | 261 · 1 082 | 0.54 · 0.54 | 1.30 · 1.39 |
| projections, system 2, 14 bits | 2 | 232 · 976 | 137 · 561 | 0.59 · 0.58 | 1.23 · 1.30 |
| | 3 | 232 · 1 002 | 115 · 461 | 0.49 · 0.46 | **1.04 · 1.07** |

w10 (k = 3 at 13 bits, 4 at 14, every stream through WebCodecs) took 11.6–17.0 ms at 1× and 33–57 at 4× on
the 13-bit series, 113–207 and 442–790 on the projections.

* **Mixed takes the low's whole share off the frame, and a little more.** Its saving matches the bound (CT
  k = 2: the low is 0.37 of the frame, mixed is 0.66–0.68 of it) or passes it (system 2 at k = 3: 0.54 against
  0.46–0.49), at 4× as at 1×: WebCodecs decodes the 8-bit low in another thread in less than the top's time,
  and the worker's thread no longer does it. Ranges over rounds 0.44–0.97 of today; faster in 120/120.
* **It does not catch w10.** Every cell but one is 1.21–2.16× w10; system 2's projections at k = 3 come
  within 4–7 % (0.97–1.14 over rounds, w10 faster in 8 of 10 at 1×, 9 of 10 at 4×). The top over 10 bits
  stays on dav1d-WASM, and that decode alone is slower than both of w10's streams through WebCodecs.
* **HTJ2K at 4× is not quoted** on the 512² series: its 24 frames of ~3 ms finish within the time
  `cpu_throttle.mjs` takes to find a new worker thread (it scans every 10 ms), so in 6 of 40 round-cells it ran
  unthrottled (3.0–3.3 ms). At 1×, and at 4× on the projections, mixed is 3.3–9.1× HTJ2K's decode.
