# grey420

8-bit grey coded as full-range 4:2:0 with mid-grey chroma instead of 4:0:0, so Firefox's WebCodecs returns it
exactly (row XENGINE: Firefox refuses monochrome, and expands limited-range grey on its way to RGB). Queue row 80
(GREY420) of [`docs/av1/queue.md`](../../../docs/av1/queue.md); the decision is in
[`docs/av1/item-format.md`](../../../docs/av1/item-format.md).

```bash
lab/av1/tools.sh && ARMS=simd lab/av1/dav1d-wasm/build.sh && lab/av1/item/build.sh
lab/decode-bench/fetch_decoder.sh
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160      # builds ojph_compress once
client/transport-ts/build.sh
lab/av1/fetch_data.sh usb_cine usb_still
P=lab/av1/.venv/bin/python W=lab/.av1-work/grey420
for s in usb_still usb_cine; do
  $P lab/av1/item/ingest.py lab/.av1-build lab/av1/data/$s $W/ingest/$s.mono
  $P lab/av1/item/ingest.py lab/.av1-build lab/av1/data/$s $W/ingest/$s.420 --grey8 420
  $P lab/av1/item/ingest.py lab/.av1-build lab/av1/data/$s $W/ingest/$s.htj2k --codec htj2k
done
$P lab/av1/grey420/make_frames.py $W/ingest $W/frames usb_cine usb_still
export FIREFOX_PATH=...                    # Firefox 157.0.1, as lab/av1/jxl/README.md installs it
node lab/av1/xbrowser/run.mjs --rounds 10 --throttles 1,4 --engines chromium,firefox --frames $W/frames --out decode.json
for r in $(seq 0 9); do
  NODE_PATH=$(npm root -g) node lab/av1/total/run.mjs --frames $W/frames --engines chromium,firefox \
    --arms htj2k,mono,420 --rounds 1 --first-round $r --out total.jsonl
done
NODE_PATH=$(npm root -g) node lab/av1/total/run.mjs --frames $W/frames --engines chromium,firefox --arms htj2k,mono,420 --summary --out total.jsonl
```

**Series.** The two 8-bit grey series the lab holds, every frame: the breast ultrasound cine (`usb_cine`,
64 × 512²) and the stills (`usb_still`, 29 × 276×305). **Arms**, each written by `ingest.py` (optimized
representation, cpu0) and checked exact natively before it is written: `htj2k`, the served profile; `mono`,
today's 4:0:0; `420`, `--grey8 420`. In the decode harness `mono.d` and `420.d` are the same items with
`VideoDecoder` removed, so dav1d-WASM. Each arm reaches the decoder the product picks: in Chromium both AV1
arms go to WebCodecs; in Firefox `mono` fails its `g8` probe and goes to dav1d-WASM, `420` passes `g8f`.

**Pins.** Chromium 141 (Playwright 1.56.1's), Firefox 157.0.1 (conda-forge `firefox-157.0.1-hee9eb32_0.conda`,
SHA-256 `f1b53de2…4d7127f35`, micromamba 2.9.0 SHA-256 `8761c382…f13040dd`), libaom 3.15.1, dav1d 1.5.4 and
dav1d-WASM as `tools.sh` and `dav1d-wasm/build.sh` pin them, OpenJPH as `fetch_decoder.sh` pins it. Nothing
fetched, built or generated is committed.

## Bytes

| series | HTJ2K, B | 4:0:0 / HTJ2K | 4:2:0 / HTJ2K | 4:2:0 / 4:0:0 | a frame |
| --- | --: | --: | --: | --: | --: |
| `usb_cine` | 4 992 262 | 0.8886 | 0.8903 | **1.00199** | +138 B |
| `usb_still` | 1 322 469 | 1.0013 | 1.0036 | **1.00225** | +103 B |

The chroma costs a constant ~100–140 B a frame: +0.20–0.23 % here, against row XENGINE's +0.07 % on the
ultrasound's 760×421 green plane at libaom's default tuning.

## Decode (2026-10-07)

`lab/av1/xbrowser`'s harness: the product's decoder worker, one frame at a time after a warm-up frame, every frame
hashed against its source's checksum; 10 rounds, each engine × throttle cell a fresh browser in a Williams order,
sets and arms rotated inside it. **Every frame exact in every cell: 18 600/18 600** (93 frames × 5
arms × 2 engines × 2 throttles × 10 rounds). ms a frame, median of round medians [range]; then 4:2:0 over 4:0:0 through the decoder the product picks,
median of round-paired ratios [range], rounds slower:

| engine | | series | HTJ2K | 4:0:0 (product) | 4:2:0 (product) | 4:2:0 / 4:0:0 |
| --- | --- | --- | --: | --: | --: | --: |
| Chromium | 1× | `usb_cine` | 3.94 | 12.9 WebCodecs | 14.3 WebCodecs | 1.09 [0.92–1.29] 8/10 |
| | | `usb_still` | 1.38 | 8.59 WebCodecs | 8.63 WebCodecs | 1.07 [0.85–1.29] 7/10 |
| | 4× | `usb_cine` | 12.8 | 36.1 WebCodecs | 41.5 WebCodecs | 1.13 [0.86–1.31] 9/10 |
| | | `usb_still` | 1.55 | 22.9 WebCodecs | 23.1 WebCodecs | 1.02 [0.84–1.18] 7/10 |
| Firefox | 1× | `usb_cine` | 3.23 | 14.6 dav1d-WASM | 15.8 WebCodecs | 1.04 [0.91–1.77] 7/10 |
| | | `usb_still` | 1.84 | 9.31 dav1d-WASM | 9.95 WebCodecs | 1.02 [0.87–1.34] 6/10 |
| | 4× | `usb_cine` | 12.3 | 60.0 dav1d-WASM | 42.7 WebCodecs | **0.70** [0.56–1.19] 2/10 |
| | | `usb_still` | 2.20 | 34.4 dav1d-WASM | 23.7 WebCodecs | **0.71** [0.58–0.81] 0/10 |

* **In Chromium 4:2:0 is a cost**: WebCodecs decodes and copies the constant chroma, 2–13 % a frame. Through
  dav1d-WASM alone (`420.d` against `mono.d`) it is 5–13 %, the chroma's decode plus the reader's check that every
  chroma sample is mid-grey.
* **In Firefox it buys WebCodecs, which pays only on a slow CPU**: 0.70–0.71 of dav1d-WASM's time at 4×, and
  1.02–1.04× at 1×, where the RDD process's texture upload and `BGRX` copy outweigh the faster decode.
* AV1 stays 3–15× HTJ2K's decode in both engines either way.

One decoder at a time on four cores: nowhere near the host's saturation. Containers, not phones.

## Total time

*Running.*

**Checked.** The reader's new paths each failed a test when broken: dav1d-WASM refusing 4:2:0, a wrong mid
value, three planes returned for grey (`av1.test.mjs`); no range check, no R = G = B check, no grey from RGB, and
the `g8f` layout read as `g8` (`av1.test.mjs`); the chroma check always passing let YUV colour through in both
decoder paths (`dispatch-rig.ts`, 2 of 750 failed).
