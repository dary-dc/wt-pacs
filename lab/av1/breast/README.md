# breast — the breast family measured as the targets

Queue row 46 (BREAST) of [`docs/av1/queue.md`](../../../docs/av1/queue.md): the breast-family series of
[`docs/FIXTURES.md`](../../../docs/FIXTURES.md) §AV1 data — DBT slices and projections, FFDM, synthesized 2D,
breast ultrasound cine and stills — as AV1 items against HTJ2K, and intra against inter where frames follow one
another (DBT slices by position, cine by time, never re-sorted).

```bash
lab/av1/tools.sh && ARMS=simd lab/av1/dav1d-wasm/build.sh      # libaom 3.15.1, native dav1d, dav1d-WASM
lab/av1/fetch_data.sh dbt12_c dbt10_d dbtproj_c ffdm_c ffdm_d syn2d_c syn2d_d usb_cine usb_cine_rgb usb_still
P=lab/av1/.venv/bin/python W=lab/.av1-work/breast D=lab/av1/data
$P lab/av1/breast/breast.py lab/.av1-build $W $W/bytes.jsonl bytes $D/ffdm_d … --frames 8     # ~2 h
$P lab/av1/breast/breast.py lab/.av1-build $W $W/inter.jsonl inter $D/usb_cine $D/usb_cine_rgb --frames 64
$P lab/av1/breast/breast.py lab/.av1-build $W $W/inter.jsonl inter $D/dbt12_c … --frames 32
$P lab/av1/breast/mutate.py lab/.av1-build $W/mut $D/usb_cine_rgb $D/dbt10_ea1141            # 4 mutations
node lab/av1/splitok/check.mjs $D $W/items                                                    # the reader in Node
node lab/av1/splitok/browser.mjs $D $W/items --engines chromium                               # WebCodecs ≤ 10 bits
NODE_PATH=$(npm root -g) node lab/av1/llsize/time.mjs --work $W/ivf --codings SET:REP.gG-PRESET,… --rounds 10
```

**`breast.py bytes`** writes each series' first N frames as items through `lab/av1/item/ingest.py` (nothing is
written unless native dav1d decodes every item back to its source) in each layout — plain; optimized, the k = 2
split over 8 bits; w10, k = b − 10, where b > 12; RGB plain and RCT — at cpu0 and at the shipped preset, the first
of `allintra` 7, `allintra` 6, `good` 6, `allintra` 5 (row 14's speed order) within 2 % of cpu0's bytes; RGB
ultrasound ships at cpu0. HTJ2K is OpenJPH 0.31.0 in the served profile on the same frames, decoded back and checked.

**`breast.py inter`** codes the optimized representation's streams a group of G = 1, 8 or 16 at a time
(`--kf-min-dist=G --kf-max-dist=G --auto-alt-ref=0`; G = 1 is intra), at cpu0 and `good` 6, decodes each group
alone through native dav1d, merges as the client does and checks every frame; each cell's streams land as IVFs
that `lab/av1/llsize/time.mjs` decodes in order through dav1d-WASM, a decoder a stream, 1× and 4×, interleaved.

**`mutate.py`** breaks the inter check four ways — the low stream dropped from the merge, a group's frames out of
order, the inverse RCT's ⌊/4⌋ as ⌊/2⌋, one sample off by one — and each must make a run inexact.

## Measured (2026-10-05)

*Filled in as the runs finish.*
