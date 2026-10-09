# xengine

Why WebCodecs AV1 is not exact outside Chromium, and what would make it so: each layout a client could hand
`VideoDecoder`, read back by every copy each engine variant offers, against the encoder's input. Queue row 74
(XENGINE) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md); the reading, with its sources, is in
[`docs/decode/README.md`](../../../../docs/decode/README.md) §AV1 in WebKit and Firefox.

```bash
lab/av1/tools/tools.sh                                       # libaom 3.15.1, native dav1d
lab/av1/fetch_data.sh us_liver dbt10_ea1141 rf_fluoro
FRAMES=2 lab/av1/.venv/bin/python lab/av1/exact/engine-readback/make_streams.py lab/.av1-build lab/.av1-work/xengine \
  lab/av1/data/us_liver lab/av1/data/dbt10_ea1141 lab/av1/data/rf_fluoro
# the engines as lab/av1/exact/engines/README.md installs them, and gst-plugin-dav1d (below)
FIREFOX_PATH=... GST_PLUGIN_DAV1D=... node lab/av1/exact/engine-readback/run.mjs --out probe.json      # ~10 min
FIREFOX_PATH=... GST_PLUGIN_DAV1D=... node lab/av1/exact/engine-readback/run.mjs --variants chromium,firefox,webkit-dav1d --mutate
```

**Layouts** (`make_streams.py`), two frames each, libaom 3.15.1 lossless intra, cpu0, one thread, every plane
decoded by native dav1d and matched with the encoder's input before it is written; each plane's checksum is
taken from that input:

| layout | from | coded as |
| --- | --- | --- |
| `g8-mono`, `g10-mono` | the ultrasound's green plane (760×421); the 10-bit tomosynthesis (678×1727) | 4:0:0, as the product codes grey |
| `g8-420`, `g10-420` | the same | 4:2:0 with every chroma sample mid-grey |
| `g8-420-full`, `g8-420-768-full` | the green plane; the fluoroscopy ≫ 4 (768²) | the same, tagged full range (Y4M `XCOLORRANGE=FULL`) |
| `g8-420-768` | the fluoroscopy ≫ 4 | 4:2:0, mid-grey chroma, limited range |
| `g8-gbr` | the green plane | 4:4:4 identity, sRGB-tagged, G = B = R |
| `rgb8-gbr`, `rct10` | the ultrasound | 4:4:4 identity as the product codes 8-bit colour; its reversible colour transform at 10 bits |
| `ramp8-420-full`, `ramp8-gbr` | synthetic, 256×64 | every 8-bit value in every plane, shifted per row and frame |

**Variants** (`run.mjs`), each a fresh browser opening `index.html`: `chromium` (Playwright 1.56.1's 141),
`firefox` (157.0), `firefox-nordd` (`media.rdd-process.enabled` false), `firefox-noffvpx`
(`media.rdd-ffvpx.enabled` false), `webkit` (WebKitGTK 2.52.6 with `JSC_useSharedArrayBuffer=1`) and
`webkit-dav1d` (the same with gst-plugin-dav1d's `dav1ddec` ranked first). `page.js` configures each layout
under two codec strings — row CODECSTR's derived one and the old `av01.0.04M.10` — decodes each unit as a
flushed key chunk, and reads the frame three ways: `copyTo` in the frame's own format, and with
`format: "RGBX"` and `"BGRX"`. A planar copy is exact when plane 0 (grey) or the three planes (4:4:4) hash to
the input's; an RGB copy when every channel of grey is the grey, or G, B and R are the coded planes. Where a
copy differs, `page.js` says how many bytes of plane 0, from which row, by how much.

**Checked.** `--mutate` flips one byte of every copy: all 186 cells that read back went from exact to 0/2. A
miss is told from a decode fault by the bytes: WebKitGTK's 760-wide copy matches the input on 416 of 421 rows
read at stride 768, the decoder's.

**Pins.** Node 22.22.0; the engines and micromamba as [`xbrowser`](../engines/README.md) pins them;
gst-plugin-dav1d 0.13.7 from crates.io (SHA-256 `52614ade…7afb3f6`; dav1d-rs 0.10.4, gstreamer-rs 0.23.7,
rustc 1.97.0) against Ubuntu 24.04's libdav1d7 1.4.1 and GStreamer 1.24.2; libaom 3.15.1 as `tools.sh` pins
it. Sources read: Firefox at `FIREFOX_157_0_RELEASE` (`fdd757a2`), WebKit at `webkitgtk-2.52.6` (`4fb33923`).
Nothing built, fetched or generated is committed.

**Timing the client's change** (`av1-webcodecs.js` reading 8-bit GBR as RGB): the ultrasound's first 4
GBR units from [`xbrowser`](../engines/README.md)'s `make_frames.py`, each wrapped as a payload (header version 1,
8 bits, no split), in a frames directory whose manifest has three arms — `htj2k`, `gbr` (the product's choice)
and `gbr.d` (`webcodecs: false`: `xbrowser/worker.js` removes `VideoDecoder` before `decoder.js` takes its
`init`, so the same payload goes to dav1d-WASM):

```bash
FIREFOX_PATH=... node lab/av1/exact/engines/run.mjs --rounds 10 --throttles 1,4 --engines chromium,firefox --frames DIR --out rows.json
```
