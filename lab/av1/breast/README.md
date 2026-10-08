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
split over 8 bits; over 8 bits row 44's arms d12 (k = b − 12), k3 and w10 (k = b − 10), each where it is a k of its
own (row BREAST's run had w10 only, over 12 bits); RGB plain and RCT — at cpu0 and at the shipped preset, the first
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
dav1d (`ingest.py`'s check: 64 cells written, one of them re-run alone after an OOM kill); through the client's reader
in Node, dav1d-WASM, 64/64 cells and 405/405 frames; in headless Chromium 141, 64/64 cells and 405/405 frames,
WebCodecs taking the 289 whose streams are all ≤ 10 bits and dav1d-WASM the other 116, each as the client should
choose (`splitok/check.mjs`, `splitok/browser.mjs`).

**Intra against inter**, the optimized representation (k = 2 split on DBT, RCT on the RGB cine), in real order,
every frame of every cell exact (42/42 cells, each group decoded alone). Bytes over intra at the same preset, and in
brackets the inter coding over HTJ2K's on the same frames; intra over HTJ2K in the first column:

| series | frames | intra / HTJ2K, cpu0 | G = 8, cpu0 | G = 16, cpu0 | G = 8, good 6 | G = 16, good 6 |
| --- | --: | --: | --: | --: | --: | --: |
| `usb_cine`, grey cine | 64 | 0.888 | **0.560** (0.497) | **0.533** (0.474) | 0.548 (0.495) | 0.521 (0.470) |
| `usb_cine_rgb`, RGB cine | 64 | 0.909 | 0.998 (0.908) | 0.996 (0.906) | 0.982 (0.900) | 0.985 (0.903) |
| `dbt12_c`, DBT 12-bit | 32 | 0.944 | 0.999 (0.943) | 0.998 (0.942) | 1.036 | 1.050 |
| `dbt10_d`, DBT 10-bit | 32 | 0.945 | 0.967 (0.914) | 0.963 (0.911) | 1.021 | 1.032 |
| `dbt12_ea1141`, DBT 12-bit | 29 | 0.942 | 1.036 | 1.054 | 1.018 | 1.020 |
| `dbt10_ea1141`, DBT 10-bit | 24 | 0.944 | 1.026 | 1.026 | 1.003 | 0.998 |

Decode a frame through dav1d-WASM (`simd`, Node, one decoder a stream, groups in order), median of 10 interleaved
rounds [min–max], ms, cpu0's codings; every frame exact (7 350/7 350 at each throttle):

| series | 1× intra | 1× G = 8 | 1× G = 16 | 4× intra | 4× G = 8 | 4× G = 16 |
| --- | --: | --: | --: | --: | --: | --: |
| `usb_cine` | 14.0 [13.0–15.2] | 7.9 [7.4–8.8] | 7.5 [7.1–8.4] | 60.4 [56.5–66.3] | 34.1 [32.6–36.4] | 33.5 [30.1–36.1] |
| `usb_cine_rgb` | 38.8 [37.3–41.3] | 33.5 [32.5–34.6] | 33.7 [32.0–35.1] | 167 [162–175] | 146 [139–153] | 143 [138–151] |
| `dbt12_c` | 189 [184–195] | 190 [185–193] | 192 [188–196] | 801 [777–893] | 820 [798–911] | 824 [816–868] |
| `dbt10_d` | 179 [172–182] | 186 [181–193] | 189 [181–196] | 757 [736–836] | 798 [784–869] | 808 [797–835] |
| `dbt12_ea1141` | 89.8 [87.3–92.4] | 84.5 [81.3–87.4] | 82.6 [78.7–89.2] | 384 [369–404] | 360 [340–401] | 352 [345–375] |
| `dbt10_ea1141` | 115 [107–118] | 106 [102–112] | 107 [99–108] | 478 [471–522] | 449 [435–504] | 457 [436–486] |

* **Inter pays on the grey breast cine, by half**: G = 8 is 0.56 of intra's bytes and G = 16 0.53 — 0.50 and 0.47 of
  HTJ2K's — and decodes in 0.56 of intra's time. **That clip is a lossy MPEG-4 recording**: between frames only
  30–47 % of samples change, by 0.5 on average, because its own inter coding carried unchanged blocks over exactly.
  A scanner's cine would bring new speckle every frame; how much of the half survives that is not measured.
* **Not on the RGB cine** (0.98–1.00 of intra, a gain inside 2 %), whose tint and annotations change 60 % of samples
  a frame, nor on any of the four DBT slice series at G = 8 and 16 (libaom, alt-ref off): 0.963–1.054 at cpu0 and 0.998–1.050 at `good` 6. The one gain over 2 %,
  `dbt10_d` at cpu0 (0.963–0.967), turns into a loss at `good` 6 (1.021–1.032). Intra's 0.942–0.945 of HTJ2K is
  already where the DBT bytes are.
* A group costs random access (docs/av1/README.md §A1); on DBT it buys nothing to pay that with, and decodes within
  −9 to +7 % of intra.
* The host: a container's 4 cores, one decode process at a time, the cgroup throttle at 4×; not a phone.

## Row DATA3's series (2026-10-06)

The nine series of queue row 45 ([`docs/FIXTURES.md`](../../../docs/FIXTURES.md) §AV1 data), through the same
harness and row 43's (`lab/av1/splitok`).

**Exact, every frame at every k of its depth's matrix** (k = max(0, b − 12) … max(b − 8, 4)), at `allintra` 7 — the
fastest shipped preset; cpu0 is in the bytes below, on the first 8 frames: natively 45/45 cells and 2 825 frames
(`splitok/run.py`), through the reader in Node 45/45 and 2 825/2 825. **In Chromium 141, Firefox 157.0 and WebKitGTK
2.52.6** (row 37's builds; micromamba 2.9.0's archive matches row 37's SHA-256 in its first eight hex digits, not in
the last seven it printed, `…13040dd` here) at k = 0, 2, 3, 5 and the film's 6, which hold every series' k = 2, 3 and
b − 10 the matrix allows: 24/24 cells and 1 358/1 358 frames in each engine, WebCodecs taking 830 in Chromium and
dav1d-WASM the rest and everything in the other two, each as the engine should choose.

**Bytes over HTJ2K's**, the first 8 frames (all when fewer), cpu0, and in brackets the shipped preset and its ratio;
an arm equal to another is run once, a refusal is the format's, by name:

| series | b | plain | optimized, k = 2 | d12 | k = 3 | w10 |
| --- | --: | --- | --- | --- | --- | --- |
| `mr9_ispy2`, MR | 9 | 0.913 (allintra 7, 0.931) | 1.024 (allintra 6, 1.042) | **0.910** (good 6, 0.921), k = 0 | 1.002 (allintra 6, 1.014) | = d12 |
| `syn2d_a`, synthesized 2D | 10 | 1.051 (allintra 7, 1.064) | 0.942 (allintra 7, 0.947) | 1.030 (allintra 7, 1.049), k = 0 | **0.938** (allintra 7, 0.950) | = d12 |
| `ffdm_a`, FFDM | 12 | 1.287 (allintra 7, 1.304) | 1.022 (allintra 7, 1.036) | 1.164 (allintra 7, 1.176), k = 0 | **0.989** (allintra 7, 1.003) | = optimized |
| `ffdm_b`, FFDM | 12 | 1.015 (allintra 6, 1.030) | **0.986** (allintra 7, 0.998) | 1.014 (allintra 6, 1.031), k = 0 | 1.031 (allintra 6, 1.044) | = optimized |
| `syn2d_b`, synthesized 2D | 12 | 1.015 (allintra 7, 1.030) | **0.951** (allintra 7, 0.959) | 1.014 (allintra 7, 1.030), k = 0 | 0.968 (allintra 7, 0.982) | = optimized |
| `ct_nlst`, CT, signed | 13 | 1.114 (good 6, 1.135) | 0.995 (allintra 7, 1.012) | 1.038 (allintra 6, 1.057), k = 1 | **0.939** (allintra 6, 0.947) | = k3 |
| `ct_crc`, CT, signed | 13 | 0.902 (good 6, 0.914) | 0.900 (good 6, 0.909) | **0.899** (good 6, 0.911), k = 1 | 0.916 (allintra 6, 0.931) | = k3 |
| `pt15_cptac`, PET | 15 | refused: over 14 bits needs `--split` | refused: the same | 0.997 (good 6, 1.007), k = 3 | = d12 | **0.996** (cpu0: no faster preset within 2 %), k = 5 |
| `mg16_cbis`, film | 16 | refused: the same | refused: a 14-bit top | 1.076 (allintra 7, 1.093), k = 4 | refused: a 13-bit top | **1.001** (allintra 6, 1.012), k = 6 |

* **No one k wins every depth.** Of the five 9–12-bit series the adopted k = 2 is the smallest on two, k = 3 on two
  and k = 0 on the 9-bit MR; at 13 bits k = 3 on one CT and k = 1 on the other; at 15–16 bits w10 — row 44's to rank
  by time.
* **Both 4-view FFDM sets of one vendor are stretched ranges**: `ffdm_a` holds 2 506 values 1–3 apart over 76 %
  zeros, like row 46's `ffdm_d`, and plain AV1 is 1.29 there; split three bits it is 0.989.
* At 15 and 16 bits AV1 at best ties HTJ2K (0.996, 1.001); the 13-bit CTs are 0.899–0.939.
