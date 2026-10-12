# checkcost

What the exactness checks cost a frame in today's client, per decoder path, in Chromium and Firefox: the XXH3-64
check after decode, the second decode a failed check triggers, and the cache read's re-check. Queue row 151
(CHECKCOST) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md); the reading is in
[`docs/adr/exactness-in-production.md`](../../../../docs/adr/exactness-in-production.md) §9.

```bash
lab/av1/tools/tools.sh && FRAMES=1 lab/scripts/gen_htj2k_fixtures.sh g160 && ingest/coded-frames/build.sh
client/decode/wasm/build/build.sh                       # the product's OpenJPH and dav1d builds, and hash-wasm's XXH3
lab/av1/fetch_data.sh mr_ispy1 dbtproj_ge ffdm_d
D=lab/av1/data
lab/av1/.venv/bin/python lab/av1/exact/checked/make_frames.py lab/.av1-build lab/.av1-work/checkcost \
  $D/mr_ispy1 $D/dbtproj_ge $D/ffdm_d --frames 4
NODE_PATH=$(npm root -g) node lab/av1/exact/checkcost/run.mjs --firefox .../firefox --rounds 6 --out rows.jsonl
NODE_PATH=$(npm root -g) node lab/av1/exact/checkcost/run.mjs --firefox .../firefox --rounds 1 --passes 1 --mutate --out m.jsonl  # exits 1
node lab/av1/exact/checkcost/run.mjs --summary rows.jsonl
```

**Frames.** The first 4 frames of three sets through the product's ingest (`exact/checked/make_frames.py`), as the
served HTJ2K and as the optimized AV1 payload, each frame's XXH3-64 from the ingest's metadata: MR 512² (11 bits in
16), tomosynthesis projections 1914×2572 (14-bit), a mammogram 3328×4096 (12-bit). The MR and the mammogram split to
a top of ≤ 10 bits, which WebCodecs takes; the projections' 12-bit top goes to dav1d-WASM alone.

**Arms.** The page runs the product's `client/decode/decoder.js` unchanged, three instances a set and path; the
time is its own `decodeEnd − decodeStart`, around the decode and the check:

* `off` — no digests: the decode alone, `exact: "unchecked"`;
* `on` — the series' digests: decode, then XXH3 before the frame is posted;
* `fault` — `on`, with row 145's `sample` fault (`decode/fault.js`: one byte of the first decode's output flipped),
  so every frame is checked, fails, is decoded again on the other path and checked again;
* `xxh3` — the hash alone, hash-wasm's build as the decoder loads it, in a worker of its own, over the `off` frame's
  shared samples (`check`) and over a plain copy of them (`recheck`: a cache read hands back an `ArrayBuffer`;
  no cache exists yet, so this is the prediction the row asks for, timed on the same buffers).

`decode/` holds `decoder.js` and `wasm` as links to the product's and wraps the codec modules as `lab/faultbench`
does. A path is chosen as the product chooses it, except that a decode message with `first: "av1-dav1d"` keeps an
AV1 payload's first decode off WebCodecs (the call the second decode makes, `avoid = "av1-webcodecs"`), so Chromium
times dav1d-WASM on payloads WebCodecs would take, with WebCodecs still there for the second decode. Firefox runs
`htj2k` and `av1-dav1d`: its WebCodecs refuses these payloads (row 145).

**Order and truth.** A fresh browser a round and engine, the engines in a Williams order (`lab/order.mjs`); in a
page, sets and paths in the round's order, and the three arms of every frame in a Williams order of their own. Each
arm's first decode warms its decoders, the second path's included, and is not timed. Every delivered frame's
samples are held to the SHA-256 written from the encoder's input when the set was fetched; the `xxh3` worker holds
its digests to the ingest's. `--mutate` changes one hex digit of every digest and every SHA-256: every frame is then
not exact and the run exits 1.

**Pins.** Node 22.22.0; Playwright 1.56.1's Chromium 141.0.7390.37 (`--chrome` overrides); Firefox 157.0.1
(conda-forge `firefox-157.0.1-hee9eb32_0.conda`, SHA-256 `f1b53de2…4d7127f35`, by micromamba 2.9.0, as
`delivery/total-time` pins them); the decoders as `client/decode/wasm/build/manifest.sha256` pins them (OpenJPH
0.31.0, dav1d 1.5.4, emscripten 3.1.74); hash-wasm 4.12.0 (`fetch_xxh3.sh`); libaom 3.15.1 and OpenJPH 0.31.0 for
the ingest. Nothing built or fetched is committed.
