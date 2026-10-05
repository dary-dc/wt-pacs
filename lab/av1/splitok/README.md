# splitok — the bit split exact at every depth and layout

Queue row 43 (SPLITOK) of [`docs/av1/queue.md`](../../../docs/av1/queue.md): a sample v, after the
series' offset (−min), coded as top = v ≫ k and low = v & (2^k − 1), each a lossless stream, merged
`(top << k) | low` — proven exact at every depth b = 8…16 and every k a per-depth rule could pick,
k = max(0, b − 12) … max(b − 8, 4), unsigned and signed, through every decoder and engine, before any
rule is adopted. Correctness only, nothing timed. The format it widened is
[`docs/av1/item-format.md`](../../../docs/av1/item-format.md); the verdict is in
[`docs/av1/README.md`](../../../docs/av1/README.md) §A3.

```bash
lab/av1/tools.sh && ARMS=simd lab/av1/dav1d-wasm/build.sh      # libaom 3.15.1, native dav1d, dav1d-WASM
P=lab/av1/.venv/bin/python W=lab/.av1-work/splitok
$P lab/av1/splitok/merge_test.py                                # the writer's split and merge, every v
node client/downloader/av1.test.mjs                             # the reader's, every v; the golden matrix
$P lab/av1/splitok/make_sets.py $W/sets                         # the synthetic sources, ~1 s
$P lab/av1/splitok/run.py lab/.av1-build $W/sets $W/items       # cpu0 and allintra 7, native check; ~25 min
node lab/av1/splitok/check.mjs $W/sets $W/items                 # the reader in Node, ~10 s
FIREFOX_PATH=... node lab/av1/splitok/browser.mjs $W/sets $W/items   # three engines (row 37's), ~1 h
$P lab/av1/splitok/make_sets.py $W/large --large                # 1914×2572 and 4096×5120, 2.5 GB
$P lab/av1/splitok/run.py lab/.av1-build $W/large $W/litems --presets allintra:7
$P lab/av1/splitok/run.py lab/.av1-build lab/av1/data $W/real --presets cpu0,shipped
$P lab/av1/splitok/mutate.py lab/.av1-build $W/sets $W/items    # 19 mutations, ~10 min
```

**`make_sets.py`** writes, per b and signedness, one set a geometry — 16×16, 17×13, 1 wide, 1 high,
65×127, 256×256 — of seven frames: a ramp (every value of the range at 256×256), all zero, all max,
a zero/max checkerboard, uniform noise, a smooth gradient and the range's two extremes in rows; and a
`pad` set of four real-looking frames over the upper three quarters of the range, one with a border at
its minimum, so the offset is the series'. Every set spans its b bits. `--large` writes the ramp, the
noise and the extremes at 1914×2572 (the 14-bit projections) and 4096×5120 (a mammogram's). Each
frame's SHA-256 is written as it is made; a signed source of 8 bits is stored as 8-bit.

**`run.py`** codes every set at every k of its depth through `lab/av1/item/ingest.py --split K`, which
writes nothing unless native dav1d decodes each item back to its source; a colour set in its plain and
optimized shapes. `shipped` is each real series' fastest preset within 2 % of cpu0 (rows 14 and 33).

**`verify.js`** (Node and the browsers' worker) runs an item through `client/downloader/av1.js` with
each decoder module wrapped: it names the decoder that gave the item's pictures, checks each stream's
picture, when it is returned, against the stream planned from the source, and the merged frame's
SHA-256 and range against the source's. `browser.mjs` serves the items to Chromium, Firefox and
WebKitGTK launched as row 37 launched them (`lab/av1/xbrowser`, `webkit+sab`) and holds the decoder each
item took against the one its engine should choose: WebCodecs in Chromium where every stream is ≤ 10
bits, dav1d-WASM otherwise and in the two others.

## Checked (2026-10-05)

*Filled in as the matrix runs.*

**Pins.** libaom 3.15.1, dav1d 1.5.4 (native and emscripten 3.1.74 `simd.wasm`) as `tools.sh` and
`dav1d-wasm/build.sh` pin them; numpy 2.4.6; Node 22.22.0; the engines of `lab/av1/xbrowser`
(Chromium 141.0.7390.37, Firefox 157.0 from conda-forge, SHA-256 `a379ab49…63195ee`, WebKitGTK 2.52.6,
`.deb` SHA-256 `3b3f7e2c…8108ac03`), each checked here against row 37's checksum. Nothing built,
fetched or generated is committed but the golden matrix (`client/conformance/av1/items/matrix/`).
