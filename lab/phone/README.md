# The phone run's tools

For [`docs/devices.md`](../../docs/devices.md) §7, the demo's phone run; not part of the demo or the product. Both load
only through the viewer's lab gate (`client/viewer/head.js` → [`../viewer/levers.js`](../viewer/levers.js)), so a host
that does not serve `lab/` (the web image) refuses them, and a page without their parameters is unchanged.

## The beacon, `?beacon=<controller>`

The controller the page's servers run (`cubic-restart` or `bbr`), which the page cannot see. The beacon is a switch:
it turns on the product's **load report** ([`docs/adr/telemetry-in-production.md`](../../docs/adr/telemetry-in-production.md)
§8, `client/viewer/load-report.js`) at rate 1, sends it to `/lab/beacon`, and adds the controller, the page's port and,
under the runner, the series' name, the link, `counted`, the step and the runner's `verdict`. It also records
`console.error`, which the product does not watch. Every field and its definition is §8's: one JSON object per load,
with the fill as §7's Second amendment defines it (`fillFrom`, the downloader's dial just before it builds the
optimal-quality session's `WebTransport`, to `fillTo`, the last frame stored, both on `performance.timeOrigin +
performance.now()`; `fillMs` between them; `statusFillMs`, the status line's, beside it, deciding nothing), `routes`,
per frame its route, KB and decode ms, `labels` (each change: `optimal`, `asking`, `lossless`, `failed`), `presses`,
`errors`.

Nothing is sent during the load: the report leaves in one `navigator.sendBeacon` when the page turns hidden (the
runner's navigation to the next load, or a stopped run's end). *Changed 2026-11-11 (TELEMETRY-CLIENT):* it was a list
of records, the first at the fill's end, and the series named by `exactSeries`; the series is now its `source`
fingerprint, and the runner's `series` names it for the run. The runner still reads the fill's end through the lab's
`finished` hook, which polls every 20 ms and, after the fill, takes each frame's SHA-256 for the ledger: the same in
every arm.

`server/dev-server.py --beacon FILE` (the Second amendment's name) appends each report as one JSON line to FILE;
without it the POST is refused (404). Two static hosts (8765 and 8766) may append to one file. The reports name no
address; `port` and `link` say which origin.

## The runner, `lab/phone/`

The start page `http://<tether address>:8765/lab/phone/` takes the tether's address and the Wi-Fi arm's (the laptop's
wired one), the series' name (for the records), the gap between loads (15 s), the time a fill may take, the load to
start at, and the plan, one load a line: `<tether|wifi> <cubic-restart|bbr> <page|worker> [warm-up]`, or `pause <why>`
to hold the next load. It opens filled with §7's Second amendment: four warm-ups (`page`, one per origin, the links
alternating), then six octets of eight counted loads, the links alternating load by load, the tether first in odd
octets, the tether playing Williams rows 1 2 3 4 1 2 and Wi-Fi 3 4 1 2 3 4; it holds before each of the first three
warm-ups for the device counters. **Blocks** fills in the Amendment's blocks instead, the fallback, holding at each
change of link.

**Start** resolves each load to its full origin, `http://<its link's address>:<8765 cubic-restart | 8766 bbr>`, and
opens the first: the viewer at `<origin>/?overlay=1&view=…&beacon=<controller>&run=<the plan>&at=<k>`, so the step
crosses origins in the URL, and a page at another origin than its step's stops. Per load it waits for the fill's end,
checks §7's rule (every frame received, each through `av1-webcodecs`, no error), then presses **lossless** (the
button the reader presses): *Lossless* within 30 s, then pressed again, *Optimal quality* within 10 s. Then the
beacon's records leave with a `verdict`, and after the gap the next load opens, or, before a `pause`, a **Continue**
button. Any failure, or a fill not ended in time, stops the run on that page in red with the reason, recorded in the
beacon; the failed load is not rerun: the start page's *Start at load* takes the next. The green banner shows the
progress.

The runner cannot change the series (the servers' restart). Not run on a phone; `run_test.sh` runs both plans below in
headless Chromium on loopback.

`run_test.sh` (needs `ingest/tools.sh`'s build and its Python): a synthetic 10-bit pair, 64×48, 20 frames, Q 8 G 8, on
four servers and four static hosts (two controllers, two links as 127.0.0.1 and 127.0.0.2, each host its own beacon
file); a four-load plan across both, with a pause, must run whole, each load's records at its own link's address, and
with one exact series' server stopped the run must stop at its first load, say why and name the next.

## The read path, `read-path.sh`

README §The viewer on an Android phone, step 8: on the laptop, each `srv-*` container's read path and its sessions'
rings, from its own log, and SELinux's mode; exit 1 when the servers disagree. `read-path_test.sh` runs it against a
stub `podman`. Not run against a real container under SELinux: that is the phone session's, on the laptop.
