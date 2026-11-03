# The seam on our core: Cornerstone3D's tools on a viewport our view worker paints

Throwaway. It answers what [`../seam/`](../seam/README.md) left open, for [`docs/viewer/integration.md`](../../../docs/viewer/integration.md)
§A seam for our painter inside Cornerstone3D, §5 and §6. The viewport is fed end to end by the core of
`claude/core-fold-2026-11-02` at `0920153`: transport, downloader, decoders, digest check, frame store and view worker
(`?view=worker`'s shape), under the product's isolation headers and Content-Security-Policy. The page holds no frame.
The results and their reading are in integration.md, not here.

```bash
git worktree add ../core origin/claude/core-fold-2026-11-02          # then, in ../core:
#   cargo build --release -p series-server -p pack-series
#   bash client/decode/wasm/fetch_openjph.sh && bash client/decode/wasm/fetch_xxh3.sh
#   git checkout origin/claude/decoders-committed -- client/decode/wasm/built client/transport/ts/dist/session.js
#   OpenJPH 0.31.0's ojph_compress: lab/scripts/gen_htj2k_fixtures.sh builds it (BUILD=...)
(cd lab/viewer-spike/seam-core && npm ci)                             # @cornerstonejs/core and tools 5.14.0, esbuild
node series.mjs --core ../core --ojph BUILD/install --out S           # 24 slices of 128×96, 16-bit, HTJ2K, digests
export NODE_PATH=$(npm root -g)
node run.mjs --core ../core --series S/series.sbnd                    # every check, then every mutant
node lag.mjs --core ../core --series S/series.sbnd --rounds 3         # the overlay against the image, in frames
node controller-freeze.test.mjs --core ../core [--fixed]              # the core's defect, and the fix proposed
node ohif-policy.mjs --dist D/package/dist                            # D: npm pack @ohif/app@3.14.0-beta.68, untarred
node proxy.mjs --core ../core --series S/series.sbnd                  # the phone protocol's desktop proxy, 4× and 6×
```

| file | is |
| --- | --- |
| `core-viewport.js` | the glue: a viewport type whose frames, paint and cine are the core's `ViewWorker`; the probe asks `valueAt` |
| `page.js`, `index.html` | two such viewports on one served series, the tools, the links, and the runner's handle |
| `standard.js`, `standard.html` | option A for the proxy: Cornerstone3D's stack viewport, its images from our core on the page |
| `checks.mjs`, `run.mjs`, `host.mjs` | each check's claim and its mutant; the bundle and the hosts (series-server, and a static host sending the product's headers) |
| `lag.mjs` | the annotation against the image during a pan and a scroll, read off the screencast |
| `proxy.mjs`, `measure.js` | the phone protocol's runner; on a desktop, Chromium throttled; on a phone, `--remote --lan --http-port` |
| `controller-freeze.test.mjs` | a defect in the core's `Controller.repaint`, found here, and the one-line fix proposed |
| `ohif-policy.mjs` | OHIF's built app, unchanged, under our headers |
| `series.mjs`, `shape.mjs`, `png.mjs`, `instrument.js` | the series; a screenshot's samples; what the page counts from its first line |

A check that compares the image reads the code **on screen** (a one-pixel screenshot, the worker's canvas composited)
at a canvas point, and compares it with what `client/paint/voi.js` makes of the sample the probe reads there under
the window the tools last set. It allows one code. The rows of the run of 2026-11-03 are in `rows/`.
