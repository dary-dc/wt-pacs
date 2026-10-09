# fill

A whole series filled through the downloader with its decoders on, against the real server behind
the relay: HTJ2K against AV1 on the same frames. Queue row 11 (FILL) of
[`docs/av1/queue.md`](../../../../docs/av1/queue.md); the reading is in
[`docs/av1/README.md`](../../../../docs/av1/README.md) §Total time.

```bash
lab/av1/tools/tools.sh && VARIANTS=simd client/decode/wasm/dav1d/build.sh      # libaom, native dav1d, dav1d-WASM
client/decode/wasm/fetch_openjph.sh                              # OpenJPH, the shipped package
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160  # builds ojph_compress once
client/transport/ts/build.sh                                   # the client's session bundle
lab/av1/fetch_data.sh rf_fluoro mr_ispy1 us_liver
FRAMES=1000 lab/av1/.venv/bin/python lab/av1/decode/per-frame/make_frames.py lab/.av1-build lab/.av1-work/fill \
  lab/av1/data/rf_fluoro lab/av1/data/mr_ispy1 lab/av1/data/us_liver        # ~15 min
NODE_PATH=$(npm root -g) node lab/av1/delivery/fill/run.mjs --rounds 16 --out rows.jsonl   # ~1 h
NODE_PATH=$(npm root -g) node lab/av1/delivery/fill/run.mjs --rounds 24 --first-round 16 --rates 20000 --out rows.jsonl
NODE_PATH=$(npm root -g) node lab/av1/delivery/fill/run.mjs --rounds 1 --rates 50000 --throttles 1 --mutate sample
```

**Frames.** Every frame of the three series AV1 codes in one stream: fluoroscopy (18 × 768²,
12-bit), MR (58 × 512², 11 bits coded at 12) and ultrasound (70 × 760×421, RGB 8). HTJ2K is the
served profile, AV1 libaom 3.15.1 lossless intra at `cpu-used` 0, one temporal unit a frame —
row SPEED's `make_frames.py` with the frame cap lifted, every frame decoded natively against the
checksum written when the series was fetched. Each (series × codec) is packed as its own series.

**A visit.** Its own `series-server`, relay (`link_impair.py`, 40 ms round trip, a 200-packet queue,
20 or 50 Mbit/s, `--self-timing`) and headless Chromium; the page connects the downloader as the
product does — three decoders, two frames outstanding each, no warm-up — and fills the whole
series once connected. *Received* is the last frame's last byte in the downloader's worker,
*decoded* the last frame's pixels on the page, both from the fill's issue. Every frame's pixels are
hashed against its truth checksum once the fill is done.

**Variants.** `htj2k` is OpenJPH, `av1` is `decoder.codec: "av1"` (row DEC's dav1d-WASM `simd`), and on
the ultrasound, the one series WebCodecs decodes exactly (8-bit), `webcodecs`:
[`../../decode/per-frame/webcodecs-worker.js`](../../decode/per-frame/webcodecs-worker.js) handed to the downloader as
`decoderWorker`. It was a few lines from SPEED's: the `done` reply that returns the wire buffer,
the generation, and one decode at a time on its `VideoDecoder`.

**Order.** The (series × rate × throttle) cells in a Williams order each round (`lab/order.mjs`),
the variants inside each cell the same way, offset by the cell's position. 4× is
`lab/scripts/cpu_throttle.mjs` on the browser's process tree.

**The rig.** Four cores. The relay runs alone on core 3 at `chrt -f 50`; the browser and the
server are on cores 0–2 (`--rig-core`, `--browser-cores`). A visit whose relay prints `VOID` is
dropped and a pair needs both variants: 230 of 784 were, 103 of 448 in the first 16 rounds and more at
20 Mbit, whose fills are longer — so the 20 Mbit cells ran 24 rounds more (`--first-round 16`).
Alone on its core at real-time priority the relay still read p99 up to 58 ms late, which its own
core's load does not explain ([`docs/rig-limits.md`](../../../../docs/rig-limits.md) §6, the VM); the dropped visits' fills
read within 1 % of the kept ones' in most cells.

**Checked.** `--mutate sample` (one bit of every decoded frame) and `--mutate truth` (one hex digit
of every checksum) each turned every variant on every series to 0 exact.

**Pins.** Node 22.22.0; playwright 1.56.1's Chromium 141.0.7390.37 (`CHROME_PATH` overrides);
`@cornerstonejs/codec-openjph` 2.4.11; dav1d 1.5.4 under emscripten 3.1.74 (`simd.wasm`,
623 042 B); libaom 3.15.1 and OpenJPH 0.31.0 as `tools.sh` and `gen_htj2k_fixtures.sh` pin them.
Nothing built or generated is committed.
