# codecstr — the WebCodecs codec string from the stream's own sequence header

Queue row 67 (CODECSTR) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md): `av1-webcodecs.js`
configured every stream as `av01.0.04M.10` (Main, level 3.0, 10 bits), whatever it was. It now configures each
stream with the AV1 codecs parameter string (AV1-ISOBMFF §5) of the keyframe's own sequence header, every
optional field written, and reconfigures only when that string changes. The rule is in
[`docs/av1/payload-format.md`](../../../../docs/av1/payload-format.md) §Decoder choice, per payload.

```bash
lab/av1/tools/tools.sh && VARIANTS=simd client/decode/wasm/dav1d/build.sh      # libaom 3.15.1, native dav1d, dav1d-WASM
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160  # OpenJPH, for ingest's check
ingest/coded-frames/build.sh && lab/av1/fetch_data.sh                 # ingest's in-process check; all 28 series
W=lab/.av1-work/codecstr
lab/av1/exact/codec-string/series.sh lab/.av1-build lab/av1/data $W/real # 2 frames a series, every layout, ~10 min
node lab/av1/exact/codec-string/check.mjs client/contract/av1 $W/real --out $W/strings.json
node lab/av1/exact/codec-string/mutate.mjs client/contract/av1 $W/real
FIREFOX_PATH=... node lab/av1/exact/codec-string/run.mjs $W/strings.json  # isConfigSupported, three engines
FIREFOX_PATH=... node lab/av1/exact/split/browser.mjs lab/av1/data $W/real   # every payload exact, its decoder
```

**`check.mjs`** reads every distinct sequence header of the payloads (and bare units) under its directories
and of `av1-probe.js`, derives the string with `av1-payload.js`, and builds a second one from ffmpeg's reading
of the same bytes: the coded fields as `trace_headers` prints their bits, the inferred ones (bit depth,
monochrome, subsampling, range) from `ffprobe`'s pixel format and range. **`run.mjs`** asks each engine's
`isConfigSupported` for every derived string, the same with level 31, its four-field short form, and the old
fixed string. **`series.sh`** ingests the first 2 frames of each series plain and optimized (allintra:7),
and over 12 bits a 10-bit top beside the default, every payload checked by ingest against its source.

## Checked (2026-10-07)

* **The derivation is ffmpeg's reading.** 91 distinct sequence headers, 419 units — the contract fixtures
  (payloads, bare units, groups, scalable), the four probes, 59 payloads of all 28 taxonomy series, and 8 headers
  aomenc and `svc_encoder_rtc` wrote to reach what ingest never writes (timing info and a decoder model,
  frame ids, High tier at levels 4.0 and 6.3, nine operating points, one with its first point's level edited
  to 3.1): every one equal. Ingest writes reduced still-picture headers whose level libaom sets from the
  picture size — 2.0, 2.1, 3.0, 3.1, 4.0, 5.0 and 6.0 (the 3328 × 4096 and 4366 × 6871 mammograms) — and
  never 31.
* **The engines.** Chromium 141 says true for every string. Firefox 157.0 for every full string, and false for
  the 4:4:4 short forms (`av01.1.00M.08`). WebKitGTK 2.52.6 for every Main-profile string and no High or
  Professional one. Level 31 in place of the derived level changes no answer in any engine, so the level is
  written as the stream codes it, 31 included. Only Chromium decodes these streams exactly through WebCodecs
  (row 37); there every string is supported.
* **Every frame exact, the same decoder.** All 59 taxonomy payloads (115 frames) through `splitok/browser.mjs`:
  59/59 cells exact in Chromium (61 frames WebCodecs, 54 dav1d-WASM, each as expected), Firefox and
  WebKitGTK (115 dav1d-WASM, their probes failing as row 39 found), none falling back. The client before
  this row, on the same payloads in Chromium: the same decoder on every cell. The gate's dispatch rig 720/720.
* **One change of choice, explained.** Chromium reports the codec string's colour on the frame, not the
  stream's: with the full string a YUV 4:4:4 stream (matrix 1) is reported with no matrix, which the old
  check read as identity. The 4:4:4 check now reads `matrix_coefficients` from the sequence header, as
  dav1d's path does. So a 4:4:4 identity stream without the sRGB tags, refused by WebCodecs before ("4:4:4
  with matrix bt709") and decoded by dav1d-WASM, now decodes through WebCodecs, exact (0 of 9 216 samples
  differ, libaom 3.15.1 `--matrix-coefficients=identity` alone). Ingest tags RGB as sRGB, so no served
  series changes decoder.
* **Mutations.** 13 of the derivation (`mutate.mjs`: the decoder-model flag, the tier's threshold, the
  operating point taken, profile 2's depth, monochrome in profile 1, absent colour, sRGB's range, field
  widths, frame ids, the string's letters and fields): each fails `av1.test.mjs` and `check.mjs`. 3 of the
  decoder, each failing the dispatch rig: the fixed string configured, no reconfigure on a new string, the
  4:4:4 check back on the frame's colour. The derivation's first full-header bug (the decoder-model flag
  read without timing info) was found by `check.mjs` on the first group stream.

**Pins.** ffmpeg/ffprobe 6.1.1 (Ubuntu 24.04 `7:6.1.1-3ubuntu5`); the engines of row 37
([`xbrowser`](../engines/README.md)): Chromium 141.0.7390.37, Firefox 157.0 (BuildID 20260924084938,
`firefox-157.0-hee9eb32_0.conda` SHA-256 `a379ab49…63195ee`, micromamba 2.9.0 SHA-256 `8761c382…a3e8515`),
WebKitGTK 2.52.6 (`2.52.6-0ubuntu0.24.04.1`); libaom 3.15.1 as `tools.sh` pins it. Nothing fetched or
generated is committed.
