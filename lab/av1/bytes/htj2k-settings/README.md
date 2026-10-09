# lab/av1/bytes/htj2k-settings — HTJ2K encoder settings by bytes and decode

Queue row 70 (HTJ2KENC) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md): which OpenJPH encoder
settings minimise lossless bytes and browser decode time, and whether `imagecodecs`' HTJ2K defaults
differ from the served profile. The decision is in [`docs/decode/README.md`](../../../../docs/decode/README.md)
§Encoder settings.

```bash
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160   # OpenJPH 0.31.0, built once
client/decode/wasm/fetch_openjph.sh                                 # @cornerstonejs/codec-openjph 2.4.11
lab/av1/fetch_data.sh rf_fluoro mr_ispy1 us_liver ct_lidc xa_dynact16 dbt12_ea1141 dbtproj_ge ffdm_a pt15_cptac
D=lab/av1/data; W=lab/.av1-work; P=lab/av1/.venv/bin/python
SETS="$D/rf_fluoro $D/mr_ispy1 $D/us_liver $D/ct_lidc $D/xa_dynact16 $D/dbt12_ea1141 $D/dbtproj_ge $D/ffdm_a $D/pt15_cptac"
$P lab/av1/bytes/htj2k-settings/sweep.py $W/htj2kenc $SETS                     # ~40 s on 4 cores
$P lab/av1/bytes/htj2k-settings/report.py $W/htj2kenc/manifest.json
NODE_PATH=$(npm root -g) node lab/av1/bytes/htj2k-settings/time.mjs --rounds 10 --throttles 1,4   # ~25 min
FRAMES=100 $P lab/av1/bytes/htj2k-settings/sweep.py $W/htj2kenc-total $D/rf_fluoro $D/dbt12_ea1141 $D/ffdm_a
client/transport/ts/build.sh
NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --frames $W/htj2kenc-total \
  --arms b64x64-d5-RPCL,b64x64-d6-RPCL --ref b64x64-d5-RPCL --links r5000,r20000,r50000 --rounds 10
```

**Frames.** The first 8 frames of nine series (3 where a frame is over 4 M samples): fluoroscopy
768² 12-bit, MR 512², RGB ultrasound 760×421, CT 512² signed, cone-beam 512², tomosynthesis
614×1359 12-bit, projections 1914×2572 14-bit, a mammogram 2560×3328 12-bit, PET 256².

**Settings** (`sweep.py`), every one reversible 5/3, one layer, one tile:

* code-blocks 32², 64², 32×128 and 128×32 (width × height) × 3–6 decompositions × RPCL and LRCP;
* the served profile (64², 5, RPCL) with precincts of 128² and 256² at every level;
* `imagecodecs`: its encoder's defaults as `htj2k_encode` sets them (imagecodecs 2026.8.16's
  `_htj2k.pyx`, sdist sha256 `03a6add9…278175f`, read, not run). Every coding parameter is OpenJPH's
  own default — 5 decompositions, 64², RPCL, no precincts, the colour transform on RGB — the served
  profile's. The one difference: SIZ declares the array's container depth (`itemsize × 8`), so a
  12- or 14-bit series is coded as 16-bit. That is what this arm codes.

**Checked.** Every codestream is decoded by `ojph_expand` and matched with the checksum written when
the series was fetched, and its COD marker read back against the setting: **315 frames × 35 settings
exact**. The COD check caught `-block_size {x,y}` taking width first (the encoder's help says height);
`MUTATE=1` (one decoded sample flipped) stops the sweep at its first frame.

**Decode time** (`time.mjs`, `index.html`). Each setting one product decoder worker
(`client/decode/decoder.js`, the shipped package) as `lab/av1/decode/per-frame/drive.js` drives one: a
warm-up frame, then every frame one at a time, its time the worker's `decodeStart` to `decodeEnd`,
its pixels hashed against the source's checksum. Every throttle cell a fresh headless Chromium in a
Williams order each round, sets and settings rotating inside; 4× is `lab/scripts/cpu_throttle.mjs`;
10 rounds; median of round medians [range] and the median of round-paired ratios to the served
setting. **12 400/12 400 frames exact.** `--mutate sample` and `--mutate truth` each turned every
cell to 0 exact. A container's times, not a phone's; one browser at a time on 4 cores.

**Total time.** Row TOTAL's harness (`lab/av1/delivery/total-time`) unchanged, with each series' `arms.json`
written by `sweep.py`: two arms, the served profile and the setting with the fewest bytes overall
(6 decompositions), the whole series, the fixed links. `--mutate sample` and `--mutate truth` each
turned both arms to 0 exact.

**Pins.** OpenJPH 0.31.0 (`c68064d`); `@cornerstonejs/codec-openjph` 2.4.11 (tarball sha256
`b47e4f67…ad105e15e`); Node 22.22.0; playwright 1.56.1's Chromium 141. Nothing built, fetched or
generated is committed.
