# The seam spike: Cornerstone3D's tools on a viewport our paint worker draws

Throwaway. It answers one question for [`docs/viewer/integration.md`](../../../docs/viewer/integration.md)
§A seam for our painter inside Cornerstone3D: can a Cornerstone3D viewport whose pixels come from our paint worker's
`OffscreenCanvas` carry Cornerstone3D's tools? The result and its reading are there, not here. No timing is claimed.

```bash
(cd lab/viewer-spike/seam && npm ci)              # @cornerstonejs/core and tools 5.14.0, esbuild; the lockfile pins them
NODE_PATH=$(npm root -g) node lab/viewer-spike/seam/run.mjs
```

| file | is |
| --- | --- |
| `worker-viewport.js` | the glue: a viewport type registered with `registerViewportType`, painted by `client/paint/painter.js` on a canvas beside Cornerstone3D's own |
| `page.js`, `index.html` | three synthetic 64×48 16-bit slices (a ramp, 0.5 mm pixels) in one viewport, with the length, probe, window-level, zoom, pan and stack-scroll tools |
| `run.mjs` | bundles the page, serves the repository cross-origin isolated, runs every check in headless Chromium, then each mutant against the check that must catch it |

Each check states its claim in `run.mjs`. A check that compares the painted image reads back the last paint the
viewport sent to the worker and compares the code under a canvas point with what `client/paint/voi.js` makes of the
sample the probe reads there, under the window the tools last set; at the fit (4 CSS px per image pixel) the bilinear
pass mixes neighbours, so it allows one code.

The run of 2026-11-02 is kept at commit `7f07555` of this branch, in `rows/run-2026-11-02.txt` (the tag
`rows/viewer-seam` points at it locally; the session could not push tags).
