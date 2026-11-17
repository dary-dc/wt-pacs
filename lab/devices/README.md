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
| `round.py`, `round.mjs`, `round-page.js`, `beacon.js` | the phone round of `claude/phone-protocol:docs/phone-rows/next-round.md` (below): one press, the laptop's plan behind `GET /next`, each load recorded by the viewer's lab gate |

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

## The round

The phone round of `claude/phone-protocol:docs/phone-rows/next-round.md` (§3 and §10 items 1–5), grown from this
kit and the 11-11 runner (`claude/phone-rows` `1354e67f`, `lab/phone/`): the owner unlocks the phone, opens the
laptop's page and presses **Start** once.

```text
round.py (laptop) ── GET / ─▶ Start ─▶ GET /next ─302─▶ viewer ?round=…&at=k ── its fill, then cell 3's sequence
     ▲  adb between loads, servers per block, the gap                         │ records to the dev server's --beacon
     └──────────────────────────── GET /next?after=k ◀────────────────────────┘
```

* **`round.py PLAN OUT --host http://<laptop>:8780`** refuses to start unless the served tree's `HEAD`, and each
  server's image `org.opencontainers.image.revision` where the plan names an `image`, are the plan's `commit`. Before
  the press it starts one `adb` server, reads `stay_on_while_plugged_in`, sets it to 7, reads it back, and reads
  `logcat` once; after the round (or on SIGTERM) it puts the setting back and stops the servers. Between loads, never
  during one: each Chrome process's `/proc/<pid>/stat` before and after, `logcat` after (then cleared), kept under
  `OUT/adb/`. A block's servers start when its first load is next, each ready by `ready` (a URL that answers) or
  `readyLine` (a line it prints); a block with `rebootAfter` ends with `adb reboot`. A block whose servers do not
  start (not answering, or not printing its line, within `readyS`, 60 s by default; or exited) is recorded `host failed`, each of its loads `load failed` with
  why, and the round goes on to the next block. A page that asks `/next` again for the same load gets the same
  answer, nothing read, waited or rebooted twice. Every step is a line of `OUT/round.jsonl`.
* **The stopping rule** (next-round.md §3): `budgetsS` maps a cell to its budget in seconds of its counted loads'
  own time, each load timed from `load opened` to its page's `/next?after=k`; once a cell's sum passes its budget,
  each of its loads not yet started is recorded `not started` (`why: budget`). A started load always runs to its
  end; the gap, waits for a server and a failed block count toward nothing.
* **The plan** is JSON: `commit`, `gapS`, `fillS`, `afterS?`, `budgetsS?`, and `blocks`, each `{ name, servers: [{
  cmd, ready | readyLine, readyS?, image? }], loads: [{ url, cell, arm, counted?, press?, seq?, steps?, cineS?,
  fault? }], rebootAfter? }`; `url` is the
  viewer with its `view` and `beacon=<controller>`. `roundOrder()` (`round.mjs`) gives next-round.md's order: four
  warm-ups, cell 2's 16 Williams rounds over A, B, C1, C2 with the series alternating, cell 3's 24 ABBA pairs; the
  phone session maps each to its URL and servers.
* **Each load** (`round-page.js`, loaded only through the viewer's lab gate): the screen wake lock asked at load,
  on each return to visible and after each release, every acquire, release and refusal recorded; a ticker every
  250 ms, whose largest gap over 2 s makes the load **VOID: stopped** (the load's own work included: stricter than
  §3's bar, which counts gaps outside it); the fill's record (`beacon.js`); with
  `press=lossless` one exact frame and back; with `seq=view` cell 3's sequence: `steps` frame changes (20) as
  dispatched key presses due at a random 0–250 ms phase, timed from when each was due to its frame's paint, then
  `cineS` (10) of cine painted against due, then one exact frame, each first idle and then with the busy lever (100
  ms of work every 250 ms on the viewer's own thread). A failed load is recorded with why, and the next is taken:
  whatever follows the fill that throws, or has not ended `afterS` (300) after it, fails the load. `fault=throw|hang`
  injects either after the fill, for the headless test; `seq=view` refuses a series under `2 × steps + 1` frames.
* **Not built here** (PHONE-LEVERS, or a product seam): cell 1's in-memory bench, arm C2 and the decoder count;
  `getStats()` at the fill's end and the configure's `hardwareAcceleration` (both inside workers the page cannot
  read); the commit as the page reads it (no such file in the served tree); cell 5's arms; the report cells' ending
  levers. `claude/phone-rows:lab/phone/` (the runner, its start page, its beacon) is superseded by this; its `rows.py`, `losses.py`
  and `read-path.sh` read the 11-11 run and stay on `claude/phone-rows`.

**Tested** in the container: `round.test.mjs`, `beacon.test.mjs` and `round_test.py` (a fake `adb` on PATH) in the
gate, and `round_headless.sh`: headless Chromium against the real viewer, `series-server` and dev servers, on a
synthetic 10-bit pair (64 × 48, 20 frames), twelve loads — a run-commit mismatch stops before load 1, one press runs
the plan, a load made to fail is recorded and the next taken, a throw and a hang after the fill each fail their load
and the next is taken, a stall marks its load VOID, each wake lock outcome
recorded (headless Chromium refuses it: `NotAllowedError`), cell 3's steps, cine and exact frames in both views, the
busy lever on the viewer's thread, `adb` only between loads. Each check also failed once with its code broken. Not
tested: a phone, `adb` itself, `podman` images, Wi-Fi, a page hidden or a screen turned off.
