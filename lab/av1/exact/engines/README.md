# xbrowser

The client's AV1 decode path as it is — `decoder.js` choosing `decode-av1-webcodecs.js` at `depth` ≤ 10
where `VideoDecoder` exists, `decode-av1.js` (dav1d-WASM `simd`) otherwise — in Chromium, Firefox and
WebKit, against its HTJ2K path in the same engine. Queue row 37 (XBROWSER) of
[`docs/av1/queue.md`](../../../../docs/av1/queue.md); the verdict is in
[`docs/decode/README.md`](../../../../docs/decode/README.md) §AV1 in WebKit and Firefox.

```bash
lab/av1/tools/tools.sh && ARMS=simd client/decode/wasm/dav1d/build.sh      # libaom, native dav1d, dav1d-WASM
client/decode/wasm/fetch_openjph.sh                              # OpenJPH, the shipped package
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160  # builds ojph_compress once
lab/av1/fetch_data.sh                                          # every row DATA, CONTENT and TAXO series
D=lab/av1/data
lab/av1/.venv/bin/python lab/av1/exact/engines/make_frames.py lab/.av1-build lab/.av1-work/xbrowser \
  $D/ct_lidc $D/mr_ispy1 $D/us_liver $D/rf_fluoro $D/xa_dynact16 $D/dbt12_ea1141 $D/dbt10_ea1141 \
  $D/dbtproj_ge $D/dbtproj_holo                                # ~20 min on four cores
lab/av1/.venv/bin/python lab/av1/exact/engines/control.py lab/.av1-build lab/.av1-work/xbrowser
export FIREFOX_PATH=...                                         # the engines: below
node lab/av1/exact/engines/run.mjs --caps                            # what each engine offers
node lab/av1/exact/engines/run.mjs --probe --engines chromium,firefox,webkit+sab   # VideoDecoder per shape
node lab/av1/exact/engines/run.mjs --rounds 1 --throttles 1 --engines webkit       # WebKitGTK as shipped
node lab/av1/exact/engines/run.mjs --rounds 6 --engines chromium,firefox,webkit+sab --out rows.json  # ~30 min
```

**Engines.** Playwright's own WebKit and Firefox builds were refused by the container's network
policy (`cdn.playwright.dev`, `playwright.azureedge.net`, `playwright.download.prss.microsoft.com`,
CONNECT 403), so each engine is the stock build, launched as a process that opens the page:

| engine | build | how |
| --- | --- | --- |
| `chromium` | playwright 1.56.1's Chromium 141.0.7390.37 | `--headless=new` |
| `firefox` | Firefox 157.0 (release, BuildID 20260924084938), conda-forge `firefox-157.0-hee9eb32_0.conda` (SHA-256 `a379ab49…63195ee`), installed by micromamba 2.9.0 (`micromamba-2.9.0-0.tar.bz2`, SHA-256 `8761c382…a3e8515`) | `--headless`, a fresh profile |
| `webkit` | WebKitGTK 2.52.6 (Ubuntu 24.04 `libwebkit2gtk-4.1-0` `2.52.6-0ubuntu0.24.04.1`, `.deb` SHA-256 `3b3f7e2c…8108ac03`), its MiniBrowser under Xvfb; GStreamer 1.24 with `gstreamer1.0-plugins-bad` 1.24.2-1ubuntu4, `-good`, `-libav` | as installed |
| `webkit+sab` | the same, with `JSC_useSharedArrayBuffer=1` | WebKitGTK leaves `SharedArrayBuffer` off under cross-origin isolation |

Desktop engines in a container are not phones: iOS WebKit decodes through the platform's media
stack, not GStreamer, and every iOS browser is WebKit.

**Frames** (`make_frames.py`): the first 4 frames of the nine series and `grey8` (the ultrasound's
green plane, 8-bit grey, its checksums written as it is made), in each layout row LLSIZE codes —
`dir` (grey, one stream), `low2` (the two low bits apart), `low3` (13 bits: the top at 10), `gbr`
(RGB as G, B, R), `rct` (the reversible colour transform), each stream libaom 3.15.1 lossless intra,
cpu0, `--tune-content=screen --sb-size=64` — and the served HTJ2K. Every frame is decoded by native
dav1d, merged and matched with the series' checksum before it is written. An arm is `connect`'s
decoder fields: `depth` is the top stream's container, so `decoder.js` chooses as it would; `.d` is
the same file with no `depth`, so dav1d-WASM. CT carries its +2048 `offset`.

**A cell** is one engine at one throttle, a fresh browser opening `index.html`; `page.js` reports
what the engine offers (`--caps`), then runs every set's every arm through `worker.js` — `decoder.js`
itself, its messages carrying how many units reached `VideoDecoder` — one warm-up frame, then each
frame one at a time. The time is the worker's `decodeStart`–`decodeEnd`; each frame is hashed
against its truth. Cells run in a Williams order every round (`lab/order.mjs`), sets and arms
rotate inside each. 4× is `lab/scripts/cpu_throttle.mjs` on the browser's process tree, applied
once the page has loaded. `--probe` hands each WebCodecs arm's first frame straight to
`VideoDecoder` (the product's configuration) and reports what comes back; `control.py`'s ordinary
4:2:0 keyframes, lossy and lossless, 8 and 10 bits, tell an engine that refuses the lossless shapes
from one that decodes no AV1.

**Checked.** `--mutate sample` (one bit of every decoded frame) and `--mutate truth` (one hex digit
of every checksum) each turned every decoded arm in all three engines to 0 exact; the unit counter
left out turned Chromium's WebCodecs arms from 2–4 units a frame to 0; the probe's RGB check with R
and B swapped turned Firefox's exact 8-bit GBR to inexact; `grey8`'s checksum taken from the red
plane stopped `make_frames.py` at its first frame. Whether each module needs WASM SIMD:
`wasm-validate --disable-simd` (wabt 1.0.37, npm tarball SHA-256 `904e3047…c6d43b7`) refuses both
`simd.wasm` and OpenJPH's `openjphjs.wasm`, and passes both with SIMD on.

**Pins.** Node 22.22.0; the engines above; `@cornerstonejs/codec-openjph` 2.4.11 (tarball SHA-256
`b47e4f67…ad105e15e`); dav1d 1.5.4 under emscripten 3.1.74 (`simd.wasm`, 623 146 B); libaom 3.15.1
and OpenJPH 0.31.0 as `tools.sh` and `gen_htj2k_fixtures.sh` pin them; numpy 2.4.6. Nothing built,
fetched or generated is committed.
