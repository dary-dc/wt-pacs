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
