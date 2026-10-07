# jxl

Lossless JPEG XL at every effort 1–7 and `--faster_decoding` 0–4, in WASM and decoded natively by the browsers,
against the served HTJ2K. Queue row 63 (JXL) of [`docs/av1/queue.md`](../../../docs/av1/queue.md); the verdict is in
[`docs/decode/README.md`](../../../docs/decode/README.md) §JPEG XL and [`docs/av1/README.md`](../../../docs/av1/README.md)
§Measured here.

```bash
lab/av1/embed/build.sh                          # libjxl 0.12.0 native and WASM (row EMBED's build)
lab/av1/versions/build.sh                       # Chromium 154's headless shell, pinned (row VERSIONS)
lab/decode-bench/fetch_decoder.sh               # OpenJPH, the shipped package
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160   # builds ojph_compress once
lab/av1/fetch_data.sh usb_cine us_liver dbt10_ea1141 dbt12_ea1141 ffdm_a dbtproj_holo mg16_cbis
D=lab/av1/data
lab/av1/.venv/bin/python lab/av1/jxl/encode.py lab/.av1-build lab/.av1-work/jxl --frames 8 \
  $D/usb_cine $D/us_liver $D/dbt10_ea1141 $D/dbt12_ea1141 $D/ffdm_a $D/dbtproj_holo $D/mg16_cbis   # ~4 min
export FIREFOX_PATH=...                         # the engines: below
node lab/av1/jxl/run.mjs --probe --codings jxl-e7-f0,jxl-e1-f0       # every native path, every engine
node lab/av1/jxl/run.mjs --rounds 1 --throttles 1 --codings $(every e and f)   # the sweep, ~15 min
node lab/av1/jxl/run.mjs --rounds 6 --engines chromium154+jxl,firefox+jxl \
  --codings jxl-e1-f0,jxl-e2-f0,jxl-e7-f3,jxl-e7-f0 --out rows.json
node lab/av1/jxl/run.mjs --rounds 1 --throttles 1 --mutate hash      # must fail every arm
```

**Engines.** Each is launched as a process that opens the page, as row XBROWSER launched them
([`../xbrowser`](../xbrowser/README.md)):

| engine | build | JPEG XL |
| --- | --- | --- |
| `chromium141` | playwright 1.56.1's Chromium 141.0.7390.37, the lab's pinned engine | no decoder in the binary |
| `chromium154`, `chromium154+jxl` | Chrome for Testing 154.0.8037.92 headless shell (row VERSIONS' pin, SHA-256 `636aa5c7…aed096f9`) | jxl-rs 0.6 (`third_party/rust/jxl/v0_6` in the binary), off by default; `+jxl` is `--enable-features=JXLImageFormat` |
| `firefox`, `firefox+jxl` | Firefox 157.0.1 (BuildID 20261005135250), conda-forge `firefox-157.0.1-hee9eb32_0.conda` (SHA-256 `f1b53de2…4d7127f35`), micromamba 2.9.0 (`micromamba-2.9.0-0.tar.bz2`, SHA-256 `8761c382…f13040dd`) | off by default; `+jxl` sets `image.jxl.enabled` |
| `webkit` | WebKitGTK 2.52.6, Ubuntu 24.04 `libwebkit2gtk-4.1-0` `2.52.6-0ubuntu0.24.04.1`, its MiniBrowser under Xvfb | not built in: the library links no libjxl |

Row XBROWSER recorded micromamba 2.9.0's checksum as `8761c382…a3e8515`; the same file fetched on 2026-10-07 ends
`…f13040dd`. conda-forge now serves Firefox 157.0.1 for 157.0.

**The codings** (`encode.py`): each set's first 8 frames (fewer where the set has fewer) from the PGM/PPM HTJ2K is
coded from. HTJ2K is OpenJPH 0.31.0 in the served profile; JPEG XL is `cjxl -d 0 -e E --faster_decoding=F
--num_threads=0` (libjxl 0.12.0), E 1–7, F 0–4. Every codestream is decoded by `djxl` (or `ojph_expand`) and matched
with the series' checksum; an inexact one is recorded. Four at a time, one thread each, so the encode times are a
loaded core's.

**The probe** (`run.mjs --probe`, `page.js`): each set's first frame through `<img>` drawn to a canvas, through
`createImageBitmap`, through a canvas read as `rgba-float16`, and through WebCodecs' `ImageDecoder`, compared sample
by sample with the fetched frame (its bytes matched to its checksum first). An 8-bit output is scaled back to the
source's range to give the largest error in source units.

**The timing** (`run.mjs`): a set's frames decoded in order, the clock from the first codestream handed in to the
last frame's samples out; one warm-up frame untimed. *WASM* is row EMBED's worker (libjxl 0.12.0, 625 KB `.wasm`,
single-threaded with SIMD; OpenJPH the shipped package) and hashes every frame against the checksums. *Native* is
`createImageBitmap`, `drawImage`, `getImageData` per frame on the page — the samples a viewer could window — and is
hashed the same way, so only 8-bit frames can match. Each (engine × throttle) cell is a fresh browser in a Williams
order every round (`lab/order.mjs`); arms rotate inside it. 4× is `lab/scripts/cpu_throttle.mjs` on the browser's
process tree, once the page has loaded. This container: 4 cores, not a phone.

## Bytes

Each coding's bytes over the set's HTJ2K bytes; every one of the 37 frames × 35 codings exact:

RESULTS_BYTES

## The engines

RESULTS_PROBE

## Decode time

RESULTS_TIME

**Checked.** Mutated, every check failed: `encode.py`'s exactness check one off on every sample, 36/36 codings of
`usb_cine` and `dbt12_ea1141`; RESULTS_MUTATE
