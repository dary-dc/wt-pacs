# The device kit (row DEVICEKIT)

What a device evening needs, so it is setup-free: [`../../docs/devices.md`](../../docs/devices.md) is the plan and
owns every reading; [`evening.md`](evening.md) is the owner's checklist, taps in order.

```text
local machine ──deploy.sh up──▶ Oracle machine
                                 ├─ collector.py, TCP $COLLECT_PORT (8443), the certificate of PUBLIC_NAME
                                 │    /?t=TOKEN → the runner page · /kit.json · /bundles/*.sbnd · POST /collect
                                 └─ wt-pacs-server ×4, D2's arms (arms.json), UDP 4435 4436 4438 4439
phone ── https://PUBLIC_NAME:8443/?t=TOKEN ── the runner page, D0 → D1 → D2, rows in IndexedDB, posted each round
```

| file | what |
| --- | --- |
| `index.html`, `runner.js` | the runner page: link class and mode taps, D0–D2, every row kept in IndexedDB as it lands, posted after every round, a save button |
| `plan.mjs` | the arms, the Williams schedule (`../order.mjs`), quick and full mode, the paired reading shown on the phone |
| `caps.js` | D0: WebTransport and a dial to each arm, isolation, SIMD128, nested module workers, the client's WebCodecs probe per layout, `measureUserAgentSpecificMemory`, the device line, the clock's step |
| `hwdecode.js`, `hwdecode-worker.js`, `hw-units.json` | D0's hardware-decode probe (below): each AV1 form under each `hardwareAcceleration`, every outcome recorded, each cell in a worker |
| `make_hw_units.py` | the probe's units, from ingest's encoder, checked by native dav1d |
| `decode-worker.js` | D1: one arm decodes a set's frames already in memory, each frame timed and checked against the store's XXH3-64 |
| `visit.js` | D2: a fill with an ask for its last frame at half (row 180's shape), then a fresh ask-only session (row 181's), decoding off |
| `sbnd.js` | a bundle read whole in the page |
| `collector.py` | the host: the page and the client's code, the bundles, each arm's transport file and printed settings, the rows; all behind `DEVICES_TOKEN` |
| `arms.json` | D2's four arms: name, UDP port, the server's flags |
| `deploy.sh` | `up`, `fetch DIR`, `down` on the Oracle machine, from the local machine |
| `make_bundles.sh` | each set as `SET.htj2k.sbnd` and `SET.av1.sbnd` through `lab/av1/tools/ingest_coded.py` |
| `dry_run.mjs` | the page through a deployed kit in headless Chromium, quick mode: exits 0 when every visit is exact |

**Quick and full.** Quick is 3 rounds of D1 on `dbt10_ea1141` alone (the largest frames, all three decoders) and
D2's `shared`, `asksfirst` and `iw38400`; the reading prints on the phone as soon as each run ends, marked
provisional. Full is 10 rounds, D1's three sets and D2's four arms (`iw12000` is today's default again: an A/A pair
for the spread). A reading is the median of in-round ratios against the reference arm with their range and n; a pair
either of whose visits is not exact, or failed, is void and dropped (*strict*); the rows keep everything for the
round-paired reading ([`../../docs/av1/queue.md`](../../docs/av1/queue.md) §Protocol).

**Exactness.** D1 checks every decoded frame against the bundle's digests, which ingest took from the encoder's
input. D2 decodes nothing while timed: before its rounds it decodes the whole bundle as fetched and stops unless
every frame is exact, then compares every frame a visit receives with the bundle's bytes. `?mutate` flips a sample
in every D1 frame, so every D1 visit must read not exact.

**Certificates.** The page needs a certificate the phone trusts: `TLS_DIR`'s, for `PUBLIC_NAME`. The arms mint
their own and pin it by hash, unless `SUPPLY_CERT=1` hands them the same certificate; then the transport file
carries no hash and the client dials unpinned (`client/transport/ts/session.ts`). D0 says which a browser needs.
The WASM session (`client/transport/wasm`) always pins; the kit uses the default TypeScript one.

**Nothing identifying is committed** ([`../../docs/devices.md`](../../docs/devices.md) §4): the host, the name, the
token and the certificate come from the environment; `deploy.sh fetch` replaces the host's names in the rows and
fails if one is left.

**Tested in the container** (row DEVICEKIT): `plan.test.mjs`, `collector_test.py` and `deploy/server_start_test.sh` in
the gate, each failing under its mutations; the whole loop — `deploy.sh up` over SSH to the container itself, the
image, the four arms, the collector over TLS, `dry_run.mjs` in quick mode, `fetch`, `down` — as
[`../../docs/devices.md`](../../docs/devices.md) §6 records. Not tested: a phone, the Oracle machine, its security
list, WebKit, Firefox.

## The hardware-decode probe

D0 runs it after the client's own WebCodecs probe; [`../../docs/decode/hardware.md`](../../docs/decode/hardware.md) §17
is its plan. Exploratory: it decides nothing on its own.

**Units** (`hw-units.json`, from `make_hw_units.py`): one lossless temporal unit per form, libaom as the ingest codes
it, decoded back by native dav1d before it is written, with its planes' XXH3-64 taken from the encoder's input.
`g8` and `g10` are 4:0:0, as the product codes grey; `g8f` and `g10f` 4:2:0 with mid-grey chroma at full range, the
form hardware takes; each at 16 × 16 and 256 × 256, since a device codec has a minimum size. `ramp10` is 256 × 256,
4:2:0, every 10-bit level in raster order, 64 samples each.

**Cells**: each unit under `no-preference`, `prefer-hardware` and `prefer-software`, configured with the client's
codec string for it (`codecString`, `client/decode/av1-payload.js`). Per cell: `isConfigSupported`'s answer;
`configure`'s outcome; four key decodes, each a frame and its ms, or the error's name and message, or a timeout;
the decoder's state after; the first frame's `format`, coded size and `colorSpace`; `copyTo` with no format and
with each of the 23 formats the spec lists, each its layout and, per plane, the samples' XXH3-64 (the frame check's
own, `client/decode/xxh3.js`) against the source's, the count of samples that differ and the largest step, or the
exception; then the two paint paths, WebGL2 `texImage2D(VideoFrame)` into `RGBA16F` and `RGBA32F` read back as
floats, and WebGPU `importExternalTexture` read by a compute pass into an `f32` buffer: the distinct red values
(more than 256 means more than 8 bits reached the shader) and how many equal the source's luma in its own steps.
Media Capabilities' `powerEfficient` per codec string sits beside them, the engine's own hint of a hardware path.

**Nothing blocks the run.** Each cell runs in a worker of its own; a task that does not answer in 10 s ends the
worker, is recorded as `hung`, and a fresh worker decodes again for the next task. Headless Chromium 141 needs it:
`copyTo({format: "I420P10"})` of a 10-bit software frame never returns and holds the thread that called it.

**On the phone**, D0 is one press (`?run=D0` presses it). The page cannot see which decoder ran: read it by hand
from `chrome://media-internals` (the player's `kVideoDecoderName`) and `chrome://gpu` (*Video Acceleration
Information*), and keep both beside the report.

**The test** drives D0 through `collector.py` in headless Chromium, software paths only (`CHROME_PATH` the binary,
`WAIT_S` the wait for each run's D0 row, 600 for the whole set; `BASE_ONLY=1` the unmutated run alone):

```bash
CHROME_PATH=/path/to/chrome WAIT_S=600 node lab/devices/hwdecode.test.mjs --out target/hw-probe-headless.json
```

It checks every cell's outcome is recorded and each `?mutate=` turns its check: `plane` (a byte of each copy
flipped: every judged copy inexact), `expected` (wrong digests: the source check fails), `codec` (an invalid
string: no frame, each cell says why), `unit` (half the unit overwritten: no frame exact), `hang` (`copyTo` to
`I420P10` spins forever: recorded as `hung`, a fresh worker decodes again, the later formats keep their outcomes),
`paint` (read back at 8 bits: a path that kept more than 256 levels keeps 256 or fewer; SKIP where none did).

**Tested** 2026-11-14 in headless Chromium 153 (Chrome for Testing 153.0.8010.12; 141 was not in the container),
SwiftShader for WebGL2 and WebGPU, software paths only, no device: every claim PASS, `paint` SKIP, in 3.5 min on
the container's CPUs; each claim also failed once with the code it checks broken. What the run read:

* `no-preference` and `prefer-software`: supported, four frames per cell, `I420` or `I420P10`; the frame's own
  copy exact in every judged plane (luma of all 18 cells, chroma of the 4:2:0 ones); 4:0:0 decodes to a 4:2:0
  format with its chroma not judged.
* `prefer-hardware`: `isConfigSupported` false for every unit, `configure` accepted, then `OperationError`
  ("Unsupported configuration") and the decoder closed.
* `copyTo` with a format: every YUV and `NV12` target refused (`NotSupportedError`; `I420P10` "doesn't support
  explicit copy to non-RGB format", not a hang as in 141; the `…AP12` names a `TypeError`, not in this enum);
  `RGBA`, `RGBX`, `BGRA`, `BGRX` given, none equal to the source's luma.
* Paint: WebGL2 into `RGBA16F` and `RGBA32F` at most 256 levels, `ramp10` 256 of 1024; WebGPU's
  `importExternalTexture` on SwiftShader's fallback adapter "Instance dropped in popErrorScope" in every cell.
* Media Capabilities: supported and smooth, `powerEfficient` false, for every unit.

Not tested: any phone, any hardware decoder, Chromium 141 itself, Firefox, WebKit.

Remake the units only when the encoder changes (`ingest/tools.sh`'s build and its Python):

```bash
python3 lab/devices/make_hw_units.py ingest/.build
```


### Asks from HW10-ROUTES, for the device session (not built)

From `claude/hw10-routes:docs/decode/hardware-10bit.md` §9, the cells its top routes need; the code is the device
session's to change, or not:

* **The phone's codec list** (route 1, native MediaCodec): every AV1 decoder `MediaCodecList` reports, with
  `isHardwareAccelerated()`, its AV1 profile levels and its `colorFormats`, and whether `COLOR_FormatYUVP010` is
  among them. A page cannot read it; the device session picks the means (a small app or a shell).
* **`g10f` under `prefer-hardware`** on the phone and on a desktop GPU: predicted `format` null and `copyTo()`
  "Operation is not supported when format is null." on desktop, `BGRX` on the phone; the decoder's name from
  `chrome://media-internals` beside it.
* **`ramp10` on both paint paths**: predicted at most 256 levels on WebGL2 too, now from source (§6 there), not
  unknown.
* **Chromium 141's `copyTo({format: "I420P10"})`**: by 141's source the call throws, falls through into the RGB
  converter and reaches a fatal `NOTREACHED()`, which crashes the renderer (§3 there; not reproduced: 141 is not in
  the container). If so it is not a hang, a worker cannot contain it, and the harness should record a page crash
  as that cell's outcome and run it last.
