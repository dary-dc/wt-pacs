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
