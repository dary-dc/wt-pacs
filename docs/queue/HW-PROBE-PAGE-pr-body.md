# lab/devices: D0's hardware-decode probe

## Question

What does a browser's WebCodecs actually do with the product's AV1 grey streams, per stream form and per
`hardwareAcceleration`, in more detail than "this didn't work" or "this fallback was used"? The owner,
2026-11-14: "we might need to build something independent from the app to test the browser in the phone and get
more specific feedback". Exploratory: it decides nothing on its own (`docs/decode/hardware.md` §17 is its plan).

## What is built

Inside the device kit `lab/devices/` (no product import; `scripts/check_lab_absent.sh` green):

* `hw-units.json` from `make_hw_units.py`: nine lossless temporal units, libaom as the ingest codes them, each
  decoded back by native dav1d before it is written, with its planes' XXH3-64 from the encoder's input. `g8` and
  `g10` (4:0:0), `g8f` and `g10f` (4:2:0, mid-grey chroma, full range), each at 16 × 16 and 256 × 256; `ramp10`
  (256 × 256, every 10-bit level).
* `hwdecode.js`: each unit under `no-preference`, `prefer-hardware` and `prefer-software`, 27 cells, each in a
  worker of its own (`hwdecode-worker.js`); a task that does not answer in 10 s (a decode in 30 s) ends the worker
  and is recorded as `hung`, and a fresh worker decodes again for the next task. Per cell: `isConfigSupported`,
  `configure`, four timed key decodes, the frame's format, size and `colorSpace`, `copyTo` with no format and each
  of the 23 formats the spec lists (per plane the XXH3 against the source's, the count that differ and the largest
  step), WebGL2 `texImage2D(VideoFrame)` into `RGBA16F` and `RGBA32F` and WebGPU `importExternalTexture`, each read
  back as floats (distinct levels, how many equal the source). Then Media Capabilities' `powerEfficient` and the
  environment (WebGL2 and WebGPU adapter info).
* `caps.js`'s D0 carries the report; the runner shows a line a cell. On the phone it is one press (`?run=D0`).
* `hwdecode.test.mjs`: D0 through `collector.py` in headless Chromium, as written and under six mutants.

## How to run

```bash
CHROME_PATH=/path/to/chrome WAIT_S=600 node lab/devices/hwdecode.test.mjs --out target/hw-probe-headless.json
```

On a phone: the kit's runner, `?run=D0`, then `chrome://media-internals` (`kVideoDecoderName`) and `chrome://gpu`
(*Video Acceleration Information*) read by hand (`lab/devices/README.md` §The hardware-decode probe).

## What the headless run showed

Headless Chromium 153 (Chrome for Testing 153.0.8010.12; 141 was not in the container), SwiftShader, software paths
only, no device. Every claim PASS, `paint` SKIP (no path kept more than 256 levels, so this host cannot kill it);
each claim also failed once with the code it checks broken.

* `no-preference` and `prefer-software`: supported, four frames per cell, `I420` or `I420P10`, the frame's own copy
  exact in every judged plane (4:0:0 decodes to a 4:2:0 format, its chroma not judged).
* `prefer-hardware`: unsupported for every unit; `configure` accepted, then `OperationError` and the decoder closed.
* `copyTo` with a format: every YUV and `NV12` target refused (`NotSupportedError`; `I420P10` "doesn't support
  explicit copy to non-RGB format"); the four RGB targets given, none equal to the source's luma.
* Paint: WebGL2 at most 256 levels on both float targets (`ramp10`: 256 of 1024); WebGPU's import fails on
  SwiftShader's fallback adapter ("Instance dropped in popErrorScope") in every cell.

The earlier stall was the test's own: it removed `rows/` before each run, which `collector.py` creates only at
start, so the D0 row's POST failed; fixed, with the test ending its host on any exit.

## Untested

Any phone, any hardware decoder, Chromium 141 itself (its `copyTo({format: "I420P10"})` is the case the worker per
cell exists for; the `hang` mutant stands in for it here), Firefox, WebKit. The phone run stays with the local
session `phone-tests`.
