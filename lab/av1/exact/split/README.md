# splitok — the bit split exact at every depth and layout

Queue row 43 (SPLITOK) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md): a sample v, after the
series' offset (−min), coded as top = v ≫ k and low = v & (2^k − 1), each a lossless stream, merged
`(top << k) | low` — proven exact at every depth b = 8…16 and every k a per-depth rule could pick,
k = max(0, b − 12) … max(b − 8, 4), unsigned and signed, through every decoder and engine, before any
rule is adopted. Correctness only, nothing timed. The format it widened is
[`docs/av1/item-format.md`](../../../../docs/av1/item-format.md); the verdict is in
[`docs/av1/README.md`](../../../../docs/av1/README.md) §A3.

```bash
lab/av1/tools/tools.sh && ARMS=simd client/decode/wasm/dav1d/build.sh      # libaom 3.15.1, native dav1d, dav1d-WASM
P=lab/av1/.venv/bin/python W=lab/.av1-work/splitok
$P lab/av1/exact/split/merge_test.py                                # the writer's split and merge, every v
node client/downloader/av1.test.mjs                             # the reader's, every v; the golden matrix
$P lab/av1/exact/split/make_sets.py $W/sets                         # the synthetic sources, ~1 s
$P lab/av1/exact/split/run.py lab/.av1-build $W/sets $W/items       # cpu0 and allintra 7, native check; ~25 min
node lab/av1/exact/split/check.mjs $W/sets $W/items                 # the reader in Node, ~10 s
FIREFOX_PATH=... node lab/av1/exact/split/browser.mjs $W/sets $W/items   # three engines (row 37's), ~1 h
$P lab/av1/exact/split/make_sets.py $W/large --large                # 1914×2572 and 4096×5120, 2.5 GB
$P lab/av1/exact/split/run.py lab/.av1-build $W/large $W/litems --presets allintra:7   # ~2.5 h
$P lab/av1/exact/split/run.py lab/.av1-build lab/av1/data $W/real --presets cpu0,shipped  # ~7 h, cpu0 dominates
$P lab/av1/exact/split/mutate.py lab/.av1-build $W/sets $W/items    # 19 mutations, ~10 min
```

**`make_sets.py`** writes, per b and signedness, one set a geometry — 16×16, 17×13, 1 wide, 1 high,
65×127, 256×256 — of seven frames: a ramp (every value of the range at 256×256), all zero, all max,
a zero/max checkerboard, uniform noise, a smooth gradient and the range's two extremes in rows; and a
`pad` set of four real-looking frames over the upper three quarters of the range, one with a border at
its minimum, so the offset is the series'. Every set spans its b bits. `--large` writes the ramp, the
noise and the extremes at 1914×2572 (the 14-bit projections) and 4096×5120 (a mammogram's). Each
frame's SHA-256 is written as it is made; a signed source of 8 bits is stored as 8-bit.

**`run.py`** codes every set at every k of its depth through `ingest/coded-frames/ingest.py --split K`, which
writes nothing unless native dav1d decodes each item back to its source; a colour set in its plain and
optimized shapes. `shipped` is each real series' fastest preset within 2 % of cpu0 (rows 14 and 33).

**`verify.js`** (Node and the browsers' worker) runs an item through `client/downloader/av1.js` with
each decoder module wrapped: it names the decoder that gave the item's pictures, checks each stream's
picture, when it is returned, against the stream planned from the source, and the merged frame's
SHA-256 and range against the source's. `browser.mjs` serves the items to Chromium, Firefox and
WebKitGTK launched as row 37 launched them (`lab/av1/exact/engines`, `webkit+sab`) and holds the decoder each
item took against the one its engine should choose: WebCodecs in Chromium where every stream is ≤ 10
bits, dav1d-WASM otherwise and in the two others.

## Checked (2026-10-05)

* **The split and merge, every value.** Every v of 0…2^b − 1 for b = 8…16, unsigned and signed, at
  every k of 0…8: the writer's plan and merge (`merge_test.py`) 142/142 cells exact, the 20 whose top
  would be over 12 bits refused by name; the reader's `av1-frame.js` (`av1.test.mjs`) 162/162, its
  reported range included. **The reader's old mask fails once the format is widened:** 2^(depth +
  split) − 1 lets a signed container's sign extension through, so 8-bit signed at k = 1…7 and 16-bit
  signed at k = 5 and 7 (cells the old limits refused) came back with a wrong range (9 of 162); the
  mask is now the output container's, 0xFF or 0xFFFF.
* **The synthetic matrix, ≤ 256×256.** 18 depths × signs × 7 sets × 5 k × cpu0 and `--allintra` 7:
  1 260 cells, 8 280 frames, every one exact natively (ingest's check), through the reader in Node,
  and in Chromium, Firefox and WebKitGTK, each stream's picture as planned and each range the
  source's. 920 frames a depth b = 8…16. Chromium took 6 256 through WebCodecs — every item whose
  streams are all ≤ 10 bits, the 1-wide and 1-high frames included — and 2 024 through dav1d-WASM;
  Firefox and WebKitGTK took all 8 280 through dav1d-WASM, as their failed probes send them (row 37:
  Firefox refuses monochrome, WebKitGTK's WebCodecs decodes no AV1); 8 280/8 280 chose as expected in
  each engine. No size or
  depth was refused.
* **The large frames.** 1914×2572 and 4096×5120, the ramp (every value), the noise and the extremes,
  every b, sign and k at `--allintra` 7: 180/180 cells, 540 frames, exact natively, in Node and in
  the three engines — Chromium 408 through WebCodecs and 132 through dav1d-WASM, the two others all
  through dav1d-WASM, each as expected. Not coded at cpu0 (3–20 min a projection frame there, below);
  the real projections were.
* **The golden matrix.** 90 items (32×24, b = 8…16, every k, both signs) in
  `client/conformance/av1/items/matrix/`, exact in Node and through the downloader in Chromium, by
  WebCodecs and by dav1d-WASM; every refusal of `item-format.md`, old and new, matched by its message
  in both.
* **The real series.** All nine of `docs/FIXTURES.md` §AV1 data, every frame, at every k of its
  depth's matrix (the colour ultrasound in its plain and RCT shapes), cpu0 and its shipped preset:
  82/82 cells, 3 310 frames, exact natively, through the reader in Node and in all three engines (every
  k, not only 2, 3 and b − 10) — CT (13 bits, k 1–5) 1 000, cone-beam (13, k 1–5) 640, MR (11, k 0–4)
  580, fluoroscopy (12, k 0–4) 180, tomosynthesis 12-bit (12, k 0–4) 290 and 10-bit (10, k 0–4) 240,
  projections (14, k 2–6) 90 and 150, ultrasound 140. Chromium took 2 254 through WebCodecs and 1 056
  through dav1d-WASM, Firefox and WebKitGTK all 3 310 through dav1d-WASM (Firefox's colour too: it
  returns 4:4:4 as 8-bit `BGRX`, row 37), each as expected.
* **The mutations, 20/20 caught.** In the writer, each refused by ingest's native check: the top
  shifted one bit more and one less, the low mask one bit narrow, the offset dropped and doubled,
  `split` one short and one long in the header; the low mask one bit *wide* still merges exactly
  (the extra bit is the top's own) and is caught only by the reader's plan of each stream (52 of 60
  cells). In the reader, each failing `check.mjs`: the top shifted one more and one less, the offset
  dropped and doubled, top and low swapped, the signed container's mask removed (18 of 60 cells, by
  their range); the inverse RCT's ⌊/4⌋ rounded up fails the golden colour items. Items edited — `split`
  one short and one long, top and low swapped, truncated by a byte — fail or are refused by name. RGB
  coded without its BT.709/sRGB tags: Chromium's 4:4:4 probes fail, the colour goldens never reach
  WebCodecs (the rig's two checks), and an untagged item goes to dav1d-WASM, exact — never a wrong
  colour pass.

**Pins.** libaom 3.15.1, dav1d 1.5.4 (native and emscripten 3.1.74 `simd.wasm`) as `lab/av1/tools/tools.sh` and
`client/decode/wasm/dav1d/build.sh` pin them; numpy 2.4.6; Node 22.22.0; the engines of `lab/av1/exact/engines`
(Chromium 141.0.7390.37, Firefox 157.0 from conda-forge, SHA-256 `a379ab49…63195ee`, WebKitGTK 2.52.6,
`.deb` SHA-256 `3b3f7e2c…8108ac03`), each checked here against row 37's checksum. Nothing built,
fetched or generated is committed but the golden matrix (`client/conformance/av1/items/matrix/`).
