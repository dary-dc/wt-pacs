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

The start page `http://<tether address>:8765/lab/phone/` takes the two addresses, the series' name (for the records),
the gap between loads, the time a fill may take, the load to start at, and the plan, one load a line:
`<tether|wifi> <cubic-restart|bbr> <page|worker> [warm-up]`. It opens filled with §7's amended timed run: four blocks
(tether, Wi-Fi, Wi-Fi, tether), each two warm-ups and three quads in the Williams rows 1 2 3, 1 2 3, 4 1 2, 4 1 2.

**Start** opens the first load. Each load is the viewer at `http://<link's address>:<8765 cubic-restart | 8766 bbr>/
?overlay=1&view=…&beacon=<controller>&run=<the plan>&at=<k>`, so the step crosses origins in the URL. Per load it
waits for the fill's end, checks §7's rule (every frame received, each through `av1-webcodecs`, no error), then
presses **lossless** (the button the reader presses) and waits for *fetching lossless…* then *Lossless*, presses it
again and waits for *Optimal quality*; then the beacon's records leave with a `verdict`, and after the gap the next
load opens. Any failure, or a fill not ended in time, stops the run on that page in red with the reason, recorded in
the beacon. To go on from there, the start page's *Start at load*. The green banner shows the progress.

The runner cannot change the series (the servers' restart) or the link (both addresses are up at once). Not run on a
phone; `run_test.sh` runs both plans below in headless Chromium on loopback.

`run_test.sh` (needs `ingest/tools.sh`'s build and its Python): a synthetic 10-bit pair, 64×48, 20 frames, Q 8 G 8, on
four servers and four static hosts (two controllers, two links as 127.0.0.1 and 127.0.0.2); a four-load plan across
both must run whole with every record right, and with one exact series' server stopped the run must stop at its
first load and say why.

## DevTools over adb, `devtools.py`

For a diagnosis load only, never a counted one (§7's Second amendment: adb shares the tether's cable). The laptop has
no Chrome, so no DevTools window: `devtools.py` speaks the DevTools protocol to Chrome on the phone through
`adb forward tcp:9222 localabstract:chrome_devtools_remote`, with the standard library alone. Needs adb (`--adb`,
default `~/opt/platform-tools/adb`) and USB debugging on.

```bash
python3 lab/phone/devtools.py tabs                                  # the phone's tabs: id and URL
python3 lab/phone/devtools.py console --url "$ORIGIN/?overlay=1&view=worker" --seconds 60 > target/phone-run/console.jsonl
python3 lab/phone/devtools.py eval 'document.getElementById("status").textContent'
python3 lab/phone/devtools.py trace --url "$ORIGIN/?overlay=1&view=page" --seconds 20 --out target/phone-run/page.json
```

`console` opens a fresh tab and prints one JSON line per console call, exception and log entry; the others act on the
first tab (`--tab ID` for another). A trace opens in Perfetto's UI (ui.perfetto.dev) in any browser. Close the tab a
diagnosis used before counting resumes.
