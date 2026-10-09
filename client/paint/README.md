# paint

The product's paint sink: a decoded frame drawn into a canvas from a worker, through the DICOM
grayscale pipeline, with fit, zoom, pan, quarter turns and flips. One module, two halves:

| file | runs in | does |
| --- | --- | --- |
| `painter.js` | the page | places nothing itself: transfers the canvas (`transferControlToOffscreen`) to the worker and answers each `paint()` with one promise |
| `paint-worker.js` | the paint worker | WebGL2: uploads the frame, windows it, places it |
| `voi.js` | both | the window table, from PS3.3 |
| `reference.js` | the check | the same contract a second time on the CPU |

```js
import { Painter } from "./client/paint/painter.js";
const painter = new Painter(canvas, { onLost: (why) => status(why) });
await painter.renderer;                                  // rejects when nothing can be painted
await painter.paint(
  { pixels, width, height, bits, components, signed },  // pixels: the consumer's SharedArrayBuffer
  { photometric: "MONOCHROME2", rescale: { slope, intercept },
    voi: { center, width, function: "LINEAR" }, invert: false,
    view: { fit: true, zoom: 1, panX: 0, panY: 0, rotate: 0, flipH: false, flipV: false } });
```

## The contract

**Input.** The frame as the consumer receives it. The samples upload to an integer texture straight from
shared memory: `R8UI` for ≤ 8-bit grey, `R16UI` or `R16I` for 9–16 bits, `RGB8UI` for RGB. Nothing is copied
on either thread. Painting the same frame object again skips the upload. Signed 8-bit, RGB over 8 bits and
any other photometric interpretation are declined by name.

**The pipeline** (DICOM PS3.3 2026d), evaluated in float64 on the CPU into a table indexed by stored code
(`voi.js`). The table has 256 entries up to 8 bits and 65 536 above; a signed code s sits at s + 32 768.

* **Modality LUT as rescale** (C.11.1): x = stored × slope + intercept. A missing, zero or non-finite slope
  is 1; a non-finite intercept is 0.
* **VOI LUT function** (C.11.2.1.2), centre c and width w in modality units, output 0–255:
  * **LINEAR** (C.11.2.1.2.1), w ≥ 1: 0 if x ≤ c − 0.5 − (w − 1)/2; 255 if x > c − 0.5 + (w − 1)/2;
    otherwise ((x − (c − 0.5)) / (w − 1) + 0.5) × 255.
  * **LINEAR_EXACT** (C.11.2.1.3.2), w > 0: 0 if x ≤ c − w/2; 255 if x > c + w/2; otherwise
    ((x − c) / w + 0.5) × 255.
  * **SIGMOID** (C.11.2.1.3.1), w > 0: 255 / (1 + exp(−4(x − c)/w)).
  * A width the function does not allow is refused by name.
* **The code**: a real output y becomes ⌊y + 0.5⌋ clamped to 0–255 (half up), in both implementations.
* **MONOCHROME1** is shown inverted (C.7.6.3.1.2); `invert` flips it again. RGB takes no VOI and is shown as
  stored; it may be inverted.

**Placement**, in device pixels: the canvas's backing store is its CSS size × `devicePixelRatio`. The
display is the image turned clockwise by `rotate` (a multiple of 90), then flipped. Its scale s is
`zoom`, times the fit scale (the largest that shows the whole turned image) when `fit` is on. It is
centred, then rounded down to a whole device pixel, then moved by the pan (CSS px × DPR). Outside the
image the canvas is opaque black.

**How it paints.** Pass 1 windows the frame through the table into an RGBA8 texture at source size
(`texelFetch`, one table lookup per sample). Pass 2 draws one quad that samples that texture `LINEAR`,
`CLAMP_TO_EDGE`. WebGL2 cannot filter integer textures, so bilinear filtering needs the 8-bit picture. A
window change repeats pass 1 without an upload; a view change repeats only pass 2.

**No WebGL2, or a lost context.** The painter reports `lost` with the reason (`onLost`, a rejected
`renderer`) and draws nothing. There is no fallback renderer.

## What is proved, on which renderer

```bash
NODE_PATH=$(npm root -g) node client/paint/voi.test.mjs                 # the formula, by hand
NODE_PATH=$(npm root -g) node client/paint/check.mjs                    # every cell, SwiftShader
NODE_PATH=$(npm root -g) node client/paint/check.mjs --zoom1            # the 1:1 cells only (the gate's)
NODE_PATH=$(npm root -g) node client/paint/check.mjs mutants
NODE_PATH=$(npm root -g) node client/paint/check.mjs bench --rounds 10
NODE_PATH=$(npm root -g) node client/paint/check.mjs --renderer gl      # on a GPU: see below
```

**The formula** (`voi.test.mjs`, 12 tests) is checked against values worked by hand from the
standard's equations. The tests cover each function's edges, the smallest width each allows, a
negative intercept, a signed 16-bit input, MONOCHROME1 with and without invert, and RGB.

**The painter against `reference.js`** (`check.mjs`). The reference computes the same contract
separately: its own placement, mapping each device pixel back to the source, its own float64
bilinear, and its own call for the table.

* **Frames.** From `lab/scripts/gen_frame_pnm.py`, checked against its `.sha256`: 8-bit grey 64², 8-bit
  RGB 61×40 (odd width), 16-bit 80×48 (not square), and signed 12-bit CT 64².
* **Exact cells.** Each window (identity, tight, a LINEAR_EXACT window of width 510 whose outputs land
  on .5, LINEAR_EXACT, SIGMOID, MONOCHROME1, invert, rescaled), each quarter turn, each flip, a turn
  with a flip, and a whole-pixel pan. All at 1:1, at DPR 1 and 2.
* **Fractional cells.** A fractional pan, fit, and zooms 2, 0.5 and 1.37.

On **SwiftShader** (Chromium 141's ANGLE over Vulkan; the cloud has no GPU), 2026-10-08:

* **Every exact cell equals the reference to the code**: 50 cells × 2 DPRs, edges included.
* **The fractional cells differ, as measured, not claimed**: at most 1 code on fit and zooms 2 and 0.5,
  1–2 on zoom 1.37 (0.45–4.0 % of samples), and 1–5 on the fractional pan (0.6–4.0 %). Filtering
  weights in fixed point would explain this; not checked.

**Mutants**, each seen where it fails:

| mutant | caught by |
| --- | --- |
| the signed offset dropped | 15 exact cells (every signed one) |
| the rounding turned the other way; LINEAR and LINEAR_EXACT swapped; the −0.5 of LINEAR dropped; MONOCHROME1 not inverted | `voi.test.mjs`. The table is shared by both renderers, so the cells cannot see it |
| `NEAREST` in place of `LINEAR` | no exact cell (1:1 samples texel centres); 20 fractional cells move, the fractional pan's \|Δ\| 1 → 26 |
| the window after the filter | no exact cell; 10 fractional cells move, \|Δ\| 1 → 8 |
| the quad moved by 1/512 px | nothing on SwiftShader: it needs a fractional cell judged against a GPU's reference |

**The GPU proof is a later local step.** On a machine with a GPU, `check.mjs --renderer gl` prints the
renderer string first (headless defaults to software). Every exact cell must still equal the
reference to the code. The fractional cells must stay within the same bounds as above, or the
difference must be explained. **Until that run, the fractional zooms are unproved.**

## What it costs

`check.mjs bench`: a 512² signed 12-bit frame on a 512² canvas, and a 4096×3072 16-bit frame fit into
768×576, each on a new frame (upload, window, place) and on a window change (window, place). The four
variants run interleaved (`lab/order.mjs`) over 10 rounds, on SwiftShader on this container's 4 cores. Every
number is the software renderer's.

ms a paint, median [min–max]. *Worker* runs from the message to the draw having executed (a one-pixel
`readPixels` waits for it; `gl.finish()` alone returned early on SwiftShader). *Page* is the
synchronous cost of `paint()` on the main thread.

| | worker | page | round trip |
| --- | --- | --- | --- |
| 512², new frame | 8.47 [6.39–10.92] | 0.10 [0.05–1.52] | 8.83 [6.98–11.33] |
| 512², window change | 8.77 [4.37–12.77] | 0.08 [0.06–0.87] | 9.14 [4.87–13.08] |
| 4096×3072, new frame | 210.9 [194.8–223.6] | 0.11 [0.09–0.24] | 212.2 [195.3–224.1] |
| 4096×3072, window change | 97.1 [5.1–120.3] | 0.07 [0.05–0.09] | 97.8 [5.9–120.8] |

* **The page thread pays about 0.1 ms whatever the frame**: the canvas is the worker's, and the samples
  are shared, not sent.
* **On a software renderer the worker is the clock.** A 512² paint is half a 60 Hz frame. A 12.6 Mpx frame
  is 13 frames new and 6 on a window change, because pass 1 rewindows every sample. With a GPU the
  same shape measured 0.34 ms for a 512² paint (lab/paint-floor, [`ARCHITECTURE.md`](../../docs/ARCHITECTURE.md)
  §Paint). These milliseconds are not a phone's.
* **The check in `scripts/gate.sh`** (`--zoom1`, every 1:1 cell at DPR 1 and 2) takes 2.4 s here, browser
  start included. It runs when Python has numpy, and prints SKIPPED otherwise.
