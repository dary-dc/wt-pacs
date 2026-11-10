# one-worker — can one dedicated worker hold the whole frame path?

A throwaway probe, not a product cell. It asks whether a single dedicated worker can hold, at the same
time, a WebGL2 context on a transferred `OffscreenCanvas`, OPFS sync access handles,
`requestAnimationFrame` and the `WebTransport` constructor — and what one frame step costs there,
and whether the worker keeps painting while the page's main thread is blocked.

## What was run

* `page.html` transfers a canvas to `worker.js`; the worker creates the WebGL2 context, opens the OPFS
  directory and a sync access handle, and reports `typeof requestAnimationFrame` and `typeof WebTransport`
  (no server is dialled).
* **A step from disk.** For 512×512, 614×1359 and 2560×3328 16-bit frames (0.5, 1.67 and 17 MB), 12 files
  per size of random samples are written to OPFS once. Each step then times, in the worker:
  `getFileHandle` + `createSyncAccessHandle` (*open*), `read` into one reused `ArrayBuffer` (*read*),
  `close`, `texSubImage2D` into an `R16UI` texture made once per size (*upload*), and one full-screen
  triangle sampling it plus a 1-pixel `readPixels` to wait for the draw (*draw*) — the same upload and
  draw shape as `client/paint/paint-worker.js`. *Step from memory* is a second upload + draw of the same
  buffer right after. 7 rounds, sizes interleaved per round with `lab/order.mjs`, 12 frames per size
  per round; n = 84 per cell.
* **Frames while the page is blocked.** The worker runs a rAF loop that uploads and draws the 512×512 frame
  each tick and counts ticks, and a `setInterval(…, 16)` counter. The page marks, waits one idle second,
  marks, spins `while (performance.now() < t0 + 1000) {}`, marks. Counts are the worker's own, over the
  worker's own clock between marks. Between the second and third mark the worker also `postMessage`s
  once, 500 ms in; the page records when that arrives.

Engine: Chromium 153.0.8010.12 (Playwright 1.63.0 bundle `chromium-1243`), headless, page visible.
Renderer: `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)` —
**software GL**, so the upload and draw numbers are indicative only; a GPU would make them a different
shape, not a scaled copy. Host: a 4-core container, Intel Xeon @ 2.10 GHz, Linux 6.18, 16 GB; indicative
only. Firefox was not run: no binary on `PATH`, none under `/opt/pw-browsers`, `FIREFOX_PATH` unset.

Capabilities, as the worker reported them:
`webgl2: true`, `syncHandle: true`, `requestAnimationFrame: "function"`, `WebTransport: "function"`.
All four coexist in one dedicated worker in this Chromium.

## A step, ms — median [min … max], n = 84 per size

| part | 512x512 | 614x1359 | 2560x3328 |
| --- | --- | --- | --- |
| open | 0.60 [0.30 … 1.40] | 0.60 [0.40 … 2.30] | 0.70 [0.40 … 3.20] |
| read | 1.40 [0.80 … 6.90] | 2.10 [1.50 … 17.50] | 11.30 [9.70 … 86.20] |
| close | 0.20 [0.10 … 0.70] | 0.20 [0.10 … 1.70] | 0.40 [0.20 … 1.50] |
| upload | 0.10 [0.00 … 0.60] | 0.10 [0.00 … 0.80] | 6.05 [4.40 … 78.60] |
| draw | 3.50 [1.60 … 16.70] | 8.55 [3.60 … 33.50] | 46.50 [35.40 … 248.80] |
| **step from disk** (sum) | 5.75 [3.20 … 21.00] | 12.55 [6.40 … 36.80] | 68.75 [53.20 … 397.00] |
| **step from memory** (upload + draw) | 1.95 [1.30 … 7.10] | 5.35 [3.60 … 19.50] | 44.85 [35.50 … 78.30] |

Reading it:

* The OPFS part of a step (open + read + close) is 2.2 ms at 0.5 MB, 2.9 ms at 1.67 MB and 12.4 ms at
  17 MB — about 1.4 GB/s on the read at 17 MB. The files were written moments earlier by the same
  process, so the reads are page-cache-warm: this is the cost of the OPFS path, not of the medium.
* The draw dominates every step here, and that is SwiftShader rasterising 0.26–8.5 Mpx on the CPU. The
  draw inside the disk step reads higher than the one inside the memory step at every size (3.50 vs
  ~1.9, 8.55 vs ~5.3, 46.5 vs ~39); the probe does not separate why (the memory step always follows the
  disk step and re-uploads identical bytes). Not a finding, just visible.
* The worker's `performance.now()` ticks at 0.1 ms, which is why *upload* at the small sizes reads 0.00–0.10.
* The maxima are the first frame after a size change (the canvas is resized) and the host's noise;
  quote the medians.

## Frames while the page is blocked

| second | worker rAF ticks | worker setInterval(16) firings | interval length ms |
| --- | --- | --- | --- |
| page idle | 60 | 63 | 1001 |
| page main thread spinning | 60 | 62 | 1001 |

A 1000 ms synchronous spin on the page's main thread cost the worker's rAF loop nothing: 60 ticks in the
blocked second against 60 in the idle one, each tick an upload and a draw of a 512×512 frame; the
worker's `setInterval(…, 16)` kept firing too (62 vs 63). The second smoke run (`--rounds 2 --frames 3`)
read the same: 60/60 and 63/62.

The `postMessage` the worker sent 500 ms into the block was delivered 1.1 ms after the block ended
(528 ms in flight): queued, not lost — yes, as expected.

## Re-run

```bash
node lab/target-review/one-worker/run.mjs                 # 7 rounds × 12 frames per size, Chromium on SwiftShader
node lab/target-review/one-worker/run.mjs --rounds 2 --frames 3
node lab/target-review/one-worker/run.mjs --browser firefox   # needs FIREFOX_PATH or a /opt/pw-browsers/firefox-* install
```

Run from the repository root; `run.mjs` serves its own folder on 127.0.0.1 and prints the tables above.
