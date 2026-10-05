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

**Bytes over HTJ2K's on the same frames** (the first 8, or all when fewer), every item exact through native dav1d:
cpu0, and in brackets the shipped preset and its ratio. b is the series' bits after its offset.

| series | b | frames | plain | optimized (k = 2 over 8 bits) | w10 / RCT |
| --- | --: | --: | --- | --- | --- |
| `dbt12_c`, DBT slices | 12 | 8 × 931×2124 | 1.049 (allintra 5, 1.067) | **0.943** (allintra 7, 0.953) | |
| `dbt10_d`, DBT slices | 10 | 8 × 757×2336 | 0.974 (allintra 6, 0.992) | **0.944** (allintra 7, 0.958) | |
| `dbtproj_c`, DBT projections | 14 | 8 × 1914×2294 | 0.963 (allintra 7, 0.979) | **0.962** (allintra 6, 0.979) | w10 0.971 (allintra 7, 0.984) |
| `ffdm_c`, FFDM | 12 | 4 × 1914×2294 | 1.027 (allintra 5, 1.041) | **0.962** (allintra 7, 0.974) | |
| `ffdm_d`, FFDM | 12 | 4 × 3328×4096 | 1.238 (allintra 7, 1.254) | **1.006** (allintra 7, 1.025) | |
| `syn2d_c`, synthesized 2D | 10 | 3 × 1996×2457 | 0.994 (allintra 5, 1.004) | **0.940** (allintra 7, 0.951) | |
| `syn2d_d`, synthesized 2D | 12 | 4 × 2394×2850 | 0.980 (allintra 7, 0.993) | **0.950** (allintra 7, 0.958) | |
| `usb_cine`, ultrasound cine | 8 | 8 × 512² | 0.900 (allintra 5, 0.909) | **0.873** (good 6, 0.888) | |
| `usb_cine_rgb`, ultrasound cine | 3 × 8 | 8 × 512² | 1.066 (cpu0) | | **RCT 0.908** (cpu0) |
| `usb_still`, ultrasound stills | 8 | 8 × 276×305 | 1.012 (allintra 5, 1.018) | 1.002 (good 6, 1.016) | |

* **The optimized item is under HTJ2K on 8 of the 10 series** at cpu0, 0.873–0.962, and on the same 8 at its shipped
  preset, 0.888–0.979. The two where it is not: `ffdm_d` (1.006; 1.025 shipped) and the stills (1.002; 1.016).
* **`ffdm_d` is the one series plain AV1 loses badly on, 1.24.** 72 % of its samples are 0 (the background) and the
  rest hold 2 149 distinct values, 2–3 apart — a stretched range. The k = 2 split takes it to 1.006.
* **On the 14-bit projections the layout barely matters**: plain (which splits two low bits off a 12-bit top), k = 2
  and w10 are within 1 %, k = 2 and plain the smallest.
* **The stills are small crops** (276×305, PNG); why neither codec pulls ahead on them is not measured.
* The shipped preset is `allintra` 7 on 7 of the 10 grey optimized and w10 cells (`allintra` 6 on the projections'
  optimized); the grey cine and the stills need `good` 6. `ffdm_d`'s cpu0 encode of one 13.6 M-sample frame takes 4.2 GB and 512 s; run beside three
  others it was killed for memory and was re-run alone.

**Exact through every decoder path the lab runs** (row 43 is not done, so not its matrix): every item through native
dav1d (`ingest.py`'s check: 65 cells, each written, and one OOM kill re-run); through the client's reader in Node, dav1d-WASM, 63/63 cells and 401/401
frames; in headless Chromium 141, 63/63 cells and 401/401 frames, WebCodecs taking the 285 whose streams are all
≤ 10 bits and dav1d-WASM the other 116, each as the client should choose (`splitok/check.mjs`, `splitok/browser.mjs`).
`ffdm_d`'s re-run cells are checked below.
