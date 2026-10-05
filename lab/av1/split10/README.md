# split10

A series over 10 bits as two AV1 streams, decoded in Chromium and merged: top10+low through
WebCodecs (every stream ≤ 10 bits, which WebCodecs takes) against top11+low through dav1d-WASM (a
12-bit stream, which it refuses) and OpenJPH on the same frames. Queue row 13 (SPLIT10) of
[`docs/av1/queue.md`](../../../docs/av1/queue.md); the verdict is in
[`docs/av1/README.md`](../../../docs/av1/README.md) §A3.

```bash
lab/av1/tools.sh && ARMS=simd lab/av1/dav1d-wasm/build.sh      # libaom, native dav1d, dav1d-WASM
lab/decode-bench/fetch_decoder.sh                              # OpenJPH, the shipped package
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160  # builds ojph_compress once
lab/av1/fetch_data.sh ct_lidc xa_dynact16 mr_ispy1 rf_fluoro
lab/av1/.venv/bin/python lab/av1/split10/make_frames.py lab/.av1-build lab/.av1-work/split10 \
  lab/av1/data/ct_lidc lab/av1/data/xa_dynact16 lab/av1/data/mr_ispy1 lab/av1/data/rf_fluoro  # ~30 min
NODE_PATH=$(npm root -g) node lab/av1/split10/split10.mjs --rounds 16 --throttles 1,4         # ~20 min
NODE_PATH=$(npm root -g) node lab/av1/split10/split10.mjs --rounds 1 --throttles 1 --mutate sample
```

**Frames.** The first 18 frames of each set over 10 bits. After the series' offset (CT +2048) a
sample v is taken at b = 13 bits, as `depth.py` takes it: top10+low is v ≫ 3 (10-bit 4:0:0) and
v & 7 (8-bit); top11+low is v ≫ 2 (12-bit, Professional) and v & 3 (8-bit). Each plane is a libaom
3.15.1 stream, `--lossless=1 --cpu-used=0 --kf-max-dist=0 --monochrome`, one temporal unit a frame.
A frame's file is `[u32le top length][top unit][low unit]` — a lab framing, not a proposal for the
store. HTJ2K is the served profile. `make_frames.py` decodes every unit alone with native dav1d,
merges and matches the checksum written when the series was fetched before keeping the frame.

**Arms**, each a decoder worker of its own behind `decoder.js`'s protocol, the frame's time its
`decodeStart`–`decodeEnd` stamps (bytes in; merged samples, signed where the series is, and the
range out):

| arm | decoder | how |
| --- | --- | --- |
| `htj2k` | OpenJPH | `client/downloader/decoder.js` itself |
| `wc-t10` | WebCodecs, two `VideoDecoder`s (`av01.0.00M.10…` and `.08…`, mono) | `split-worker.js`; both units in flight at once, each flushed and copied out whole (`I420P10`, `I420`: chroma included) |
| `dav1d-t10` | dav1d-WASM `simd`, one instance | `split-worker.js`; unit after unit, merged from the decoder's picture |
| `dav1d-t11` | the same | the same, on top11+low |

`dav1d-t10` is there to split the decoder's share from the split's. One warm-up frame per worker,
then 18 frames one at a time, as asks.

**Order.** Every throttle cell is a fresh browser, in a Williams order each round
(`lab/order.mjs`); sets and arms rotate inside it. 4× is `lab/scripts/cpu_throttle.mjs` on the
browser's process tree.

**Checked.** Every merged frame is hashed against its truth checksum. Mutated, each turned its
cells to 0/18: `--mutate sample` and `--mutate truth` (16/16 cells each), the top plane shifted one
bit too far in the worker (12/12 split cells), the offset not undone (CT, the one set with one; 3/3),
and in `make_frames.py` the native merge shifted (exits). Reading `copyTo`'s byte stride as a sample
stride, a real bug on the way, made `wc-t10` 0/18 on every set.

**Pins.** As [`../speed`](../speed/README.md): Node 22.22.0, playwright 1.56.1's Chromium
141.0.7390.37, `@cornerstonejs/codec-openjph` 2.4.11, dav1d 1.5.4 under emscripten 3.1.74
(`simd.wasm`, 623 042 B), libaom 3.15.1 and OpenJPH 0.31.0. Nothing built or generated is committed.
