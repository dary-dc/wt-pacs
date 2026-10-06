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
