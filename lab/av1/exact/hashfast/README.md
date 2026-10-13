# hashfast

The frame check's XXH3-64 timed four ways in Chromium and Firefox, every digest held to the ingest's. Queue row 179
(HASHMEASURE) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md), by row 176's protocol; the reading is in
[`docs/adr/exactness-in-production.md`](../../../../docs/adr/exactness-in-production.md) §10, *Measured*.

```bash
client/decode/wasm/build/build.sh                       # the product's decoders and hash-wasm's XXH3
lab/av1/exact/hashfast/build.sh                         # xxHash v0.8.4: xxh3-c.wasm (SIMD128), xxh3-c0.wasm
# row 151's frames, as lab/av1/exact/checkcost/README.md makes them, into lab/.av1-work/checkcost
NODE_PATH=$(npm root -g) node lab/av1/exact/hashfast/run.mjs --firefox .../firefox --rounds 10 --out rows.jsonl
NODE_PATH=$(npm root -g) node lab/av1/exact/hashfast/run.mjs --firefox .../firefox --rounds 1 --mutate --out m.jsonl  # exits 1
node lab/av1/exact/hashfast/run.mjs --summary rows.jsonl
```

**Arms**, each behind hash-wasm's `createXXHash3()` shape (`init().update(bytes).digest("hex")`), each copying its
input into the module's memory 16 KiB at a time:

* `A` — today: hash-wasm 4.12.0's XXH3 over the frame's shared samples, as `client/decode/decoder.js` runs it;
* `B` — `A`'s hasher over an unshared copy of the samples, standing for the decoder's own output before it is copied
  to the shared buffer (the copy is made outside the timing);
* `C` — xxHash v0.8.4's XXH3 (`xxh3.c` around `xxhash.h`), `-O3 -msimd128`: its NEON path through emscripten's
  SIMD128 `arm_neon.h` (`XXH_VECTOR` 4, which each row records);
* `C0` — the same source and build without `-msimd128` (`XXH_VECTOR` 0, scalar).

**Order and truth.** A fresh browser a round and engine, the engines in a Williams order (`lab/order.mjs`); in a page,
the sets in the round's order, each frame decoded once by the product's `decoder.js` (checkcost's `decode/`, HTJ2K)
and its samples held to the SHA-256 written from the encoder's input; then, in a hash worker, one untimed pass of every
arm and `--passes` timed passes, the four arms in a Williams order each pass. Every arm's digest of every pass is
compared with the ingest's. `--mutate` changes one hex digit of every digest and every SHA-256: every frame is then
not exact, no digest matches, and the run exits 1.

**Pins.** Node 22.22.0; Playwright 1.56.1's Chromium 141.0.7390.37 (`--chrome` overrides); Firefox 157.0.1
(conda-forge `firefox-157.0.1-hee9eb32_0.conda`, SHA-256 `f1b53de2…4d7127f35`, by micromamba 2.9.0); emscripten
3.1.74 and its image as `client/decode/wasm/build/pins.sh` pins them; xxHash v0.8.4 at commit `c87183a7…c695e4f0`;
hash-wasm 4.12.0 (`fetch_xxh3.sh`). Nothing built or fetched is committed.
