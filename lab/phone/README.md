# The phone run's tools

For [`docs/devices.md`](../../docs/devices.md) §7, the demo's phone run; not part of the demo or the product. Both load
only through the viewer's lab gate (`client/viewer/head.js` → [`../viewer/levers.js`](../viewer/levers.js)), so a host
that does not serve `lab/` (the web image) refuses them, and a page without their parameters is unchanged.

## The beacon, `?beacon=<controller>`

The controller the page's servers run (`cubic-restart` or `bbr`), which the page cannot see. Per load it sends, as
JSON records sharing one `load` id:

* `load`, at the fill's end: view, port, controller, the series' `exactSeries` and `lossy`, frame count, frames
  received, the fill time (`fillMs`, from the connect to the last frame, the controller's own), and per frame its
  route, KB on the wire and decode ms (the overlay's three);
* `label` at each change of the quality label (its class: `optimal`, `asking`, `lossless`, `failed`), `lossless` at each
  press of the **lossless** button, `error` for `window.onerror`, `unhandledrejection` and `console.error`.

Nothing is sent during the fill: records wait for its end, then leave in one `navigator.sendBeacon`; later ones wait
for the page to be hidden (or the runner's flush). The page reads the fill's end through the lab's `finished` hook,
which polls every 20 ms and, after the fill, takes each frame's SHA-256 for the ledger: the same in every arm.

`server/dev-server.py --beacon-log FILE` appends each record as one JSON line to FILE; without it the beacon's POST
is refused (404). Two static hosts (8765 and 8766) may append to one file. The records name no address; `port` and
`link` say which origin.

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
