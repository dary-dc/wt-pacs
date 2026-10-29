# opfs-arms

The cache's three arms in the view worker, as [`docs/adr/frame-path.md`](../../docs/adr/frame-path.md) §The cache I/O
in the view worker pre-registers them: **A** a sync access handle in the view worker, **B** the async API there (a file
per frame), **C** the built store worker, `client/viewer/store.js`, on a port the page hands it (`store-port.js`). The
predictions, the cells and the rule are there; no cell's numbers are.

`index.html` is the page: it starts the workers, hands each its ports, and sends the view worker intents only.
`feeder.js` stands in for the decoders, posting checked frames as `SharedArrayBuffer`s at 125 MB/s or on credit.
`view.js` holds the frames, paints them at its own `requestAnimationFrame` (WebGL2 on the transferred canvas), and
writes and reads by one arm, on arrival or after the paint; after the cell it reads back every frame it recorded
written. `probe.js` runs once per engine: what the async API takes and refuses beside a sync handle, in a worker the
page starts and in one that worker starts.

Needs the decoder builds (`client/decode/wasm/built`, for XXH3), Playwright's Chromium, and for Firefox an Xvfb
display (`DISPLAY`) and `FIREFOX_PATH`. It reuses `lab/opfs-cache/browser.mjs` for the browsers and their memory.

```bash
NODE_PATH=$(npm root -g) node lab/opfs-arms/run.mjs --cell late|rate|miss|probe --size 512|2560|3328 [--throttle 1|4] \
  [--engine chromium|firefox] [--rounds 12] [--arms A-arrival,C] [--mutant write-before-paint|drop-writes] [--out rows.jsonl]
node lab/opfs-arms/summary.mjs DIR    # the mutants caught or not, each cell's arms, and each engine's verdict by the rule
```

Rows go to `work/` unless `--out` says otherwise; `work/` is not tracked. A run takes a fresh profile, removed after.
