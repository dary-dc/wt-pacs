# speed

Decode time a frame for the same frames as HTJ2K and as AV1 intra, through the product's decoder
worker. Queue row 9 (SPEED) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md); the numbers are in
[`docs/decode/README.md`](../../../../docs/decode/README.md) §AV1, the verdict in
[`docs/av1/README.md`](../../../../docs/av1/README.md) §A1–A2.

```bash
lab/av1/tools/tools.sh && ARMS=simd client/decode/wasm/dav1d/build.sh      # libaom, native dav1d, dav1d-WASM
client/decode/wasm/fetch_openjph.sh                              # OpenJPH, the shipped package
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160  # builds ojph_compress once
lab/av1/fetch_data.sh rf_fluoro mr_ispy1 us_liver
lab/av1/.venv/bin/python lab/av1/decode/per-frame/make_frames.py lab/.av1-build lab/.av1-work/speed \
  lab/av1/data/rf_fluoro lab/av1/data/mr_ispy1 lab/av1/data/us_liver       # ~7 min
NODE_PATH=$(npm root -g) node lab/av1/decode/per-frame/speed.mjs --rounds 16 --throttles 1,4   # ~35 min
NODE_PATH=$(npm root -g) node lab/av1/decode/per-frame/speed.mjs --rounds 1 --throttles 1 --mutate sample
```

**Frames.** The first 18 frames of each row DATA series that AV1 codes without an offset:
fluoroscopy (768², 12-bit), MR (512², 11 bits in 16, signed, coded at 12) and ultrasound
(760×421 RGB 8). HTJ2K is the served profile (a signed series signed in SIZ by `sign_htj2k.py`);
AV1 is libaom 3.15.1, `--lossless=1 --cpu-used=0 --kf-max-dist=0`, one temporal unit a frame — G = 1,
which row SIZE recommends. `make_frames.py` decodes every frame natively (ojph_expand, dav1d 1.5.4)
against the checksum written when the series was fetched before keeping it.

**Arms.** Each runs in a decoder worker of its own, as the downloader runs one: `htj2k` and `av1` are
`client/decode/decoder.js` itself (in Node through `node-worker.mjs`, which supplies the
browser-worker globals), so `av1` is `av1-dav1d.js` on dav1d-WASM `simd`; `webcodecs`
(`webcodecs-worker.js`, Chromium only) is `VideoDecoder` behind the same protocol and output —
one chunk, flushed, copied out and interleaved — on the one set it decodes exactly (8-bit 4:4:4).
A frame's time is the worker's own `decodeStart`–`decodeEnd` stamps: bytes in, the contract's
pixels and range out. One warm-up frame per worker, then 18 frames one at a time, as asks.

**Order.** Every (environment × throttle) cell is a fresh process, the cells in a Williams order
each round (`lab/order.mjs`); sets and arms rotate inside it the same way. 4× is
`lab/scripts/cpu_throttle.mjs` on the whole process tree, which slows a worker where Chromium's own
throttle cannot.

**Checked.** Every decoded frame is hashed against its truth checksum; `--mutate sample` (one bit
of every decoded frame) and `--mutate truth` (one hex digit of every checksum) each turned all 13
(set × arm × environment) cells to 0/18.

**Pins.** Node 22.22.0; playwright 1.56.1's Chromium 141.0.7390.37 (`CHROME_PATH` overrides);
`@cornerstonejs/codec-openjph` 2.4.11 (tarball SHA-256 `b47e4f67…ad105e15e`); dav1d 1.5.4 under
emscripten 3.1.74 (`simd.wasm`, 623 042 B); libaom 3.15.1 and OpenJPH 0.31.0 as `tools.sh` and
`gen_htj2k_fixtures.sh` pin them; numpy 2.4.6 (`lab/av1/requirements.txt`). Nothing built or
generated is committed.
