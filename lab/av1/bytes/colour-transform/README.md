# rgbnative — the colour transform on natively stored colour ultrasound

Queue row 97 (RGBNATIVE) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md): the RGB rule of
[`docs/av1/payload-format.md`](../../../../docs/av1/payload-format.md) (JPEG 2000's reversible colour transform, RCT) was sized
on `us_liver`, which its header says was coded lossily (row DATAGUARD). Here it is measured against GBR and HTJ2K on
colour ultrasound stored natively and uncompressed: six sets of eight stills, one collection and one image size each
(`usrgb_*`, [`docs/FIXTURES.md`](../../../../docs/FIXTURES.md) §AV1 data, every one `sound`).

```bash
lab/av1/tools/tools.sh && VARIANTS=simd client/decode/wasm/dav1d/build.sh && ingest/coded-frames/build.sh
client/decode/wasm/fetch_openjph.sh
lab/av1/fetch_data.sh usrgb_apollo usrgb_crc usrgb_aml usrgb_mel usrgb_lca usrgb_stad
P=lab/av1/.venv/bin/python W=lab/.av1-work/rgbnative
$P lab/av1/bytes/colour-transform/make_frames.py lab/.av1-build $W lab/av1/data/usrgb_*            # cpu0, ~40 min on 4 cores
NODE_PATH=$(npm root -g) node lab/av1/delivery/split-rule/decode.mjs --frames $W --rounds 8 --out decode.json
```

**`make_frames.py`** writes each set as HTJ2K (the served profile, decoded back and checked) and as payloads through
`ingest.py` in GBR (`plain`) and RCT (`optimized`), each payload decoded back natively before it is written, at cpu0
(RGB ships at cpu0); `decode.mjs` is row SPLITTIME's harness, which takes any variant the manifest names.

**The stills.** Single frames, Lossy Image Compression `00`, explicit VR little endian, Image Type `…\0011` (2-D with
colour flow) on 42 of 48, `…\0001` (2-D) on the rest; colour pixels (R, G, B not all equal) a median 0.1–5.9 % a
set, 51 % on `usrgb_crc`. Selection: of the first 25 US series of each CC BY collection in IDC v24, the RGB, unflagged,
single-frame ones, grouped by collection and size; a set is a group of at least eight, colour flow first, then
by object key. A handful of stills is not a cine.

## Measured (2026-10-08)

Bytes over HTJ2K's on the same eight stills, and RCT over GBR; decode is ms a frame in the product's decoder worker,
headless Chromium 141, 8 rounds, 1× and 4× interleaved, HTJ2K the median of round medians and each variant the median of
round-paired ratios to it, 1× · 4×. Every payload exact natively; **2 304/2 304 frames exact** in the browser (RGB 4:4:4
is dav1d-WASM's: WebCodecs takes no High profile). `--mutate sample` and `--mutate truth` each turned every variant to 0
exact.

| set | still | GBR / HTJ2K | RCT / HTJ2K | RCT / GBR | HTJ2K, ms | GBR | RCT |
| --- | --- | --: | --: | --: | --- | --- | --- |
| `usrgb_apollo` | 960×720 | 1.302 | **0.705** | 0.541 | 16.0 · 67 | 2.86 · 2.56 | **2.27 · 1.78** |
| `usrgb_crc` | 1024×768 | 1.087 | **0.716** | 0.659 | 25.7 · 104 | 2.57 · 2.60 | **2.29 · 2.11** |
| `usrgb_aml` | 1164×873 | 1.046 | **0.651** | 0.622 | 24.2 · 110 | 2.75 · 2.38 | **2.15 · 1.78** |
| `usrgb_mel` | 1400×1050 | 1.531 | **0.944** | 0.617 | 25.7 · 111 | 3.56 · 3.43 | **2.90 · 2.21** |
| `usrgb_lca` | 1400×1050 | 1.522 | **0.922** | 0.606 | 31.5 · 135 | 3.28 · 3.15 | **2.72 · 2.29** |
| `usrgb_stad` | 1552×970 | 1.122 | **0.692** | 0.617 | 30.1 · 130 | 2.64 · 2.15 | **2.12 · 1.41** |

**RCT beats GBR on every set: 0.54–0.66 of its bytes, and 0.65–0.94 of HTJ2K's, against GBR's 1.05–1.53.** It
decodes in 0.78–0.90 of GBR's time at 1× and 0.65–0.78 at 4× (faster in every one of the 96 set-rounds), yet no AV1 variant is as fast as HTJ2K in any round:
RCT is 2.1–2.9× HTJ2K's time a frame at 1× and 1.4–2.3× at 4×. Why AV1 gains a third over HTJ2K here, against row
LLSIZE's 4 % on `us_liver`, is not measured.
