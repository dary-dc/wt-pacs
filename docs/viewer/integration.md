# How our base plugs into each fit, and what it costs

Read 2026-10-27 at the tags of [`survey.md`](survey.md) §Sources, and vtk.js 36.4.1 from npm (Cornerstone3D's pinned
dependency). Nothing was built or run. Every behaviour here is a reading of code, and every line count is an
estimate. The requirements are requirements.md on branch `claude/viewer-requirements`, which is not merged; "R*n*"
below is its numbered required set.

**Our base, at the seam.** A frame reaches the page as `{ pixels, width, height, bits, components, signed, min, max,
exact, path }`, with `pixels` a `SharedArrayBuffer` written once by the decoder. The frame digest has already been
checked (`client/transport/consumer.js:106-131`, [`../../client/README.md`](../../client/README.md) *A frame says
whether it is exact*). The page must be cross-origin isolated (same file, *The page must be cross-origin isolated*).
The painter's contract and its 1:1 proof are [`../../client/paint/README.md`](../../client/paint/README.md). Today the
viewer keeps every frame in a `Map`. The OPFS cache and the paint worker as the frame's owner (B′) are proposed in
[`../adr/frame-path.md`](../adr/frame-path.md).

## The ranking

As decided today, pixels are bit-exact and the paint is ours (the viewer's README on the requirements branch says the
client "supplies its transport, decode, cache and paint"):

1. **Our own viewer on today's client.** It keeps everything we have, the 1:1 proof included. It is the most code to
   write: the tools and the layouts that Cornerstone3D would give us.
2. **Cornerstone3D under our page.** It is about 450 lines of glue, and gives the most for free. But its GPU
   paint cannot be byte-exact by construction (§Cornerstone3D, *render*). It also puts the page back in the pixel
   path.
3. **OHIF v3.** It gives everything in (2), and a study list, a hanging protocol engine and a UI on top. It also has
   everything (2) lacks, and adds a fork to keep up with.
4. **VolView.** Its seam carries whole DICOM files. Our frames would have to be re-wrapped as files and then parsed
   again.

**What would change it:**

* **Cornerstone3D moves to first** if `registerRenderBackend` lets a backend own its surface. Our painter in its worker
  would then be the backend, and the tools come with it (§Cornerstone3D, *render*). It also moves to first if the
  owner accepts a proved bound, such as one code, in place of equality on screen.
* **OHIF moves above Cornerstone3D** if a whole application soon matters more than the page's design (the study
  list, the hanging UI, measurement tracking). B′ is then given up, as it is under (2).
* **Nothing here moves VolView up** short of a frame-level seam in VolView.

## Cornerstone3D under our page (v5.13.2)

**The interface.** `registerImageLoader(scheme, fn)` (`packages/core/src/loaders/imageLoader.ts:719-724`). `fn(imageId)`
returns `{ promise: IImage, cancelFn?, decache? }` (`packages/core/src/types/ImageLoaderFn.ts:8-16`), and the scheme
is the imageId's prefix (`imageLoader.ts:128-137`). The metadata comes from a provider added with `addProvider`, which
now lives in `@cornerstonejs/metadata` (`packages/metadata/src/metaData.ts:42`). Core's own `metaData.ts:1-4` says it
is deprecated. A stack needs `imagePixelModule`, `generalSeriesModule` and `imagePlaneModule`, and reads
`scalingModule` and calibration if present (`packages/core/src/utilities/buildMetadata.ts:130-172`). No volume loader
is needed for 2D.

**Where pixels enter.** `IImage.getPixelData()` returns a typed array (`packages/core/src/types/IImage.ts:64`). When
an image has no `voxelManager`, one is wrapped around that array by reference (`imageLoader.ts:164-177`;
`packages/core/src/utilities/VoxelManager.ts:1601-1660`). So a `Uint16Array` over our `SharedArrayBuffer` enters the
cache uncopied. The same wrapper then runs `delete image.imageFrame.pixelData`, so the loader must supply an
`imageFrame` or its own `voxelManager`, or every load is reported failed by event (`imageLoader.ts:150-176`).
The first copy comes at display. Both stack paths give the actor a private copy (`packages/core/src/RenderingEngine/helpers/planarImageRendering.ts:92`, in the
5.x planar path), then copy each new image into it with `scalarData.set` on every image change
(`packages/core/src/utilities/updateVTKImageDataWithCornerstoneImage.ts:35`; `VtkImageMapperRenderPath.ts:396`;
`StackViewport.ts:1906-1921`). Nothing on that path needs a non-shared buffer, because a copy comes first: a reading,
which the survey left open, not a run.

**Decoders.** Under our scheme, `@cornerstonejs/dicom-image-loader` is never initialised. Its worker pool is created
only by its `init` (`packages/dicomImageLoader/src/init.ts:7-23`), and core starts no worker for a stack. Our
downloader, decoders and digest check run unchanged before the loader. Its HTJ2K and other codecs could sit beside
ours for a second scheme, such as DICOMweb priors. A frame on that path would not be checked against a digest.

**Render, against the painter's proof.** It renders WebGL2 through vtk.js on the page thread, into an offscreen
canvas made with `document.createElement`. The result is copied to each viewport's 2D canvas with `drawImage`
(`packages/core/src/RenderingEngine/WebGLContextPool.ts:28-39`; `ContextPoolRenderingEngine.ts:588-608`). The grey
path differs from ours in four ways:

* **The window is a 1 024-entry table, not one entry per stored code.** vtk.js samples the transfer function into
  `colorTextureWidth` entries, 1 024 by default (vtk.js `Rendering/Core/AbstractImageMapper.js:31`), of 8 bits each
  through a `Uint8ClampedArray` (`Rendering/OpenGL/ImageMapper.js:571-592`). The shader looks the sample up by
  `intensity * cscale0 + cshift0` in float (`ImageMapper.js:265-266`). Cornerstone3D does not set the width. Ours is
  65 536 entries for codes above 8 bits, in float64, rounded half up (`client/paint/voi.js`). So once a window is
  wider than 1 024 codes, adjacent codes share an entry, and the output moves by a code where they should not.
  `Uint8ClampedArray` also rounds half to even, where ours rounds half up. How many samples differ is not computed.
* **SIGMOID is 1 024 nodes of a piecewise-linear function** (`packages/core/src/utilities/createSigmoidRGBTransferFunction.ts:28`,
  `enums/VOILUTFunctionType.ts:6`), not the formula per code.
* **The VOI LUT Sequence is applied on the CPU fallback only** (`RenderingEngine/helpers/cpuFallback/rendering/getVOILut.ts`).
  The GPU path builds only a linear or a sigmoid function (`planarImageRendering.ts:195-213`; `StackViewport.ts:1636-1662`).
* **It filters, then windows** (`ImageMapper.js:265-266`). Ours windows, then filters. Our mutant "the window after
  the filter" moved fractional cells by up to 8 codes ([`../../client/paint/README.md`](../../client/paint/README.md)
  §What is proved).

It can show one image pixel per canvas pixel. `displayArea` of type `'SCALE'` sets `NEAREST` and aligns the focal
point to a pixel centre (`packages/core/src/types/displayArea.ts:14-15,25-40`; `RenderingEngine/Viewport.ts:972-1010`).
The context-pool engine sizes the canvas by `devicePixelRatio` (`RenderingEngine/helpers/getOrCreateCanvas.ts:94-109`).
`NEAREST` also makes the colour table nearest (`ImageMapper.js:575-580`). So at 1:1 each sample takes one of 1 024 table
values, which is a point transform, but not ours. `imageCanvasPoint` can justify the image to an edge (R1). The CPU
fallback builds one 8-bit entry per stored value (`cpuFallback/rendering/generateLut.ts:25-34`). It is the one route
that could be held to our reference, apart from rounding. Our own 2d route, of the same shape, measured
18–26× the gl route's cost on a GPU ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Paint).

**Keeping our painter.** `registerRenderBackend` is experimental. A backend draws to an existing `'vtk'` or `'cpu'`
surface and "cannot yet register" its own
(`packages/docs/docs/concepts/cornerstone-core/generic-viewport/render-backends.md:45-54,99-101`). Our painter owns a
canvas transferred to its worker, so it cannot be a backend today.

**The cache.** The image cache is 3 GB by default (`packages/core/src/cache/cache.ts:48`) and evicts the least recently
used image (`cache.ts:310-345`). Ours keeps every frame, or under frame-path a window around the current frame, with
OPFS behind it. Put together, our store is the source of truth. Cornerstone3D's cache is sized to our memory window,
and an evicted image is reloaded through our loader from our store, never from the wire. **Frame-path's B′ is lost**:
the paint runs on the page thread, so the page cannot leave the pixel path. Cine is a page timer
(`packages/tools/src/utilities/cine/playClip.ts:201-214`). Of frame-path's designs, only A, with its store worker,
remains.

**Workers and isolation.** It needs neither SAB nor COOP/COEP since 2.x
(`packages/docs/docs/migration-guides/2x/1-general.md:36-41`). Our page sends both
(`deploy/nginx/wt-pacs.conf.template:23-25`). Bundled same-origin, nothing it loads is cross-origin. The CSP already
allows `'unsafe-eval'` (`:28`). Whether vtk.js needs it was not checked.

**Page open.** The downloader page's files are 264 845 bytes gzipped in all, WASM client and OpenJPH included
([`../../lab/page-open/README.md`](../../lab/page-open/README.md) §Compression and cache headers). The CT series' first exact frame is on screen
576–847 ms from navigation at 1× on SwiftShader ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The viewer).
Cornerstone3D adds core, tools and vtk.js, published as ESM with bare imports, so a bundler and a lockfile join the
client build. Its shipped size is unknown (npm unpacked: core 2.2 MB, tools 3.4, vtk.js 14.9; survey.md). Its first
image adds the actor copy, the upload and the render, all on the page thread. A 4096×3072 16-bit frame is 25 MB to
copy at each image change. None of it is measured.

| | |
| --- | --- |
| **kept** | the transport, the downloader, the decoders, the digest check, the consumer; the page check's readback, pointed at its canvas |
| **replaced** | the painter and `voi.js` on screen; the viewer page |
| **lost** | the 1:1 proof (§*render*); zero-copy to the GPU; the page out of the pixel path (frame-path B′); cine off the page thread |
| **glue, estimated** | a loader building `IImage` from our frame and waiting on the fill or asking, ~100 lines; a metadata provider from the series metadata, ~80; the page (engine, viewport, tool group, display area, exactness mark, status), ~200; the page check pointed at its canvas, ~50; a bundling step, ~30, and a lockfile. **~450 lines**, in a new directory beside `client/viewer/`; nothing in `client/transport/`, `client/decode/` or `client/paint/` changes |
| **upgrade risk** | majors on 2024-10-29, 2025-02-27, 2025-08-28 and 2026-06-09. In 5.x the stack viewport is behind "a temporary migration layer" whose helpers "should be expected to be removed" (`packages/docs/docs/migration-guides/5x/2-generic-viewport.md:57-58`), and metadata moved package. The loader signature has held since 2.x. Glue written against the planar viewport is the stabler target |
| **licence** | MIT; vtk.js BSD-3-Clause. No codec ships under our scheme |

## OHIF v3 (v3.13.13, on Cornerstone3D 5.6.8)

**The interface.** A data source supplies imageIds and metadata, never pixels
(`platform/core/src/DataSources/IWebApiDataSource.js:15-78`). Its existing DICOM JSON source turns each instance's
`url` into the imageId unchanged (`extensions/default/src/DicomWebDataSource/utils/getImageId.js:32-38`, called from
`extensions/default/src/DicomJSONDataSource/index.js:97,290`). So a document whose instances carry
`url: "<our scheme>:<series>/<index>"`, one instance entry per frame (`index.js:274-292`), routes every pixel to
our loader without a new data source. The loader is
registered in an extension's `preRegistration` (`platform/core/src/extensions/ExtensionManager.ts:44`). OHIF's own
provider answers metadata from the instances it stored (`platform/core/src/classes/MetadataProvider.ts`). Our series
metadata carries none of the identifiers or view attributes that the document needs (requirements.md, *Identity*).

**Pixels, render, cache.** These are Cornerstone3D's, the same as above, but at 5.6.8: the copy on image change is
the same there (survey.md). OHIF always initialises the DICOM image loader, and with it a worker pool of
`hardwareConcurrency − 1` (`extensions/cornerstone/src/initWADOImageLoader.js:23-27`), idle under our scheme. Its
study prefetcher issues loads of its own (`extensions/cornerstone/src/init.tsx:267`). The loader must answer them
from our fill, or they become asks.

**Workers and isolation.** It needs no SAB. Its page has inline scripts
(`platform/app/public/html-templates/index.html:53-56,209-216`) that our policy refuses
([`../../client/README.md`](../../client/README.md) *Its policy*), so they need CSP hashes. It also registers a
service worker (`index.html:200-205`).

**Page open.** A React application: the HTML, `app-config.js`, a mode, the data source's JSON, and then a hanging
protocol pass before the first image. The shipped size is unknown (npm `dist` 213 MB unpacked; survey.md). Not
measured.

| | |
| --- | --- |
| **kept** | as Cornerstone3D |
| **replaced** | as Cornerstone3D, and the page itself |
| **lost** | as Cornerstone3D, and control of the page: its policy, its preloads, and the opening fill that starts before the page's script has run |
| **glue, estimated** | the same loader, ~100 lines; an extension, ~50; an app config, ~60; a DICOM JSON document per study from the series metadata, ~120, in the ingest or the server; CSP hashes, ~5. **~350 lines**, plus a fork of a Yarn monorepo built with Rspack |
| **upgrade risk** | the highest. An application above a library it pins behind (5.6.8 against 5.13.2), so each OHIF release is also a Cornerstone3D jump. Our extension sits on two moving APIs |
| **licence** | MIT |

## VolView (v4.5.3)

**The interface.** A `UriSource` may carry a `Fetcher` (`src/io/import/dataSource.ts:8-14`), which is `connect`,
`getStream`, `blob`, `close`, `cachedChunks` and `size` (`src/core/streaming/types.ts:41-51`). Each chunk's blob
becomes a `.dcm` file that `@itk-wasm/image-io` reads in its worker
(`src/core/streaming/dicomChunkImage.ts:533-541,86`). The handler list is fixed
(`src/io/import/importDataSources.ts:166-190`), so registering ours means a fork.

**Pixels and decoders.** It decodes the file itself, with GDCM, which has no HTJ2K and no AV1 (survey.md). So we would
decode with ours, re-wrap the samples as an uncompressed Part 10 file, and let GDCM parse it back. The result is copied
into the volume (`dicomChunkImage.ts:581`). Our digest check covers the frame before the re-wrap and nothing after it.
Several files that each hold several frames are refused (`dicomChunkImage.ts:489-495`). One file per frame is what we
would send anyway.

**Render.** vtk.js, linear by default (survey.md). Only LINEAR and LINEAR_EXACT windows are read
(`src/utils/dicomWindowRange.ts:12-27`). There is no SIGMOID.

**Cache.** The fetcher keeps the chunks (`src/core/streaming/cachedStreamFetcher.ts:72`), and the volume keeps the
samples: two copies of the series in memory.

| | |
| --- | --- |
| **kept** | the transport and the decoders, behind a file writer |
| **replaced** | the painter, the page, the frame as the unit of the cache |
| **lost** | everything Cornerstone3D loses, and a checked frame: after the re-wrap the path is unchecked |
| **glue, estimated** | a `Fetcher` over our client, ~120 lines; a Part 10 writer, ~150; the fork's handler, ~20; a manifest, ~30. **~320 lines**, plus the fork |
| **upgrade risk** | one maintainer (survey.md), and a fork of its import pipeline |
| **licence** | Apache-2.0; it ships no NOTICE file |

## Our own viewer on today's client

**The interface** is the one we have: `DownloaderClient` and `Painter`. **Pixels** go from the decoder to the
`SharedArrayBuffer` and up to the GPU, copied nowhere. **Render**: the proof holds as it stands. It is exact at 1:1,
and bounded on SwiftShader at fractional zooms, with a GPU run still owed ([`../../client/paint/README.md`](../../client/paint/README.md)).
**Cache**: frame-path's A or B′, as that ADR decides. **Isolation**: as today. **Page open**: as today, plus the code
added.

Several grey requirements fall into the painter's table, which has one entry per stored code: the VOI LUT Sequence
(R3), Pixel Padding Value held black through any window (R3), PALETTE COLOR (R9), and a presentation LUT for the GSDF
(R3). Each is a change to `voi.js` and `reference.js`, with cells in `check.mjs`, so the proof grows with it.
Justification (R1) is a placement change, so it needs new cells. Several viewports would share one paint
worker, as frame-path §3 proposes.

| | |
| --- | --- |
| **kept** | all of it, the proof included |
| **replaced** | nothing |
| **lost** | nothing; time |
| **glue** | none. **What Cornerstone3D would have given instead**: viewports and layouts, zoom, pan, pinch and scroll, linked scroll, zoom and pan, the length, angle, Cobb angle and probe tools, a ruler, annotation state and its overlay, and cine controls. By guess **~1 000–1 500 lines**, in a new directory beside `client/viewer/`; for scale, today's `viewer.js`, one viewport with window, zoom, pan, scroll and cine, is 246 non-blank lines |
| **upgrade risk** | ours only |
| **licence** | ours; our decoders' licences are already carried |

## The required set, per option

Free means it is in the option, by reading. Build means it is ours to write. The breast rows are ours under every
option (survey.md §The three fits).

| requirement | Cornerstone3D | OHIF | VolView | own |
| --- | --- | --- | --- | --- |
| R1 hanging by laterality and view, user-configured; current and prior | build | engine free; `hpMammo` matches on `SeriesDescription`, rework (survey.md) | build | build |
| R1 justified to the edge | free (`imageCanvasPoint`) | free | build | build (painter placement) |
| R2 1:1, same size, true size; ruler; distance in MG units | 1:1 free, but not our paint; ERMF spacing (`packages/core/src/utilities/getPixelSpacingInformation.ts:4-8`), ruler (`ScaleOverlayTool`), length free | as Cornerstone3D | build | 1:1 painted and proved, the viewer lacks the mode; the rest to build |
| R3 VOI LUT Sequence; LINEAR and SIGMOID; padding black; GSDF | GPU: no LUT Sequence; SIGMOID sampled; padding and GSDF build | as Cornerstone3D | LINEAR only; the rest build | LINEAR and SIGMOID done; the rest in the table |
| R4 view labels, identity, chest wall clear, synthesized, not recent | build | an overlay to customise; the labels build | build | build |
| R5 CAD SR marks | build | build: SR is TID 1500 only (survey.md) | build | build |
| R6 DBT: scroll, cine speed, loop and sweep, no slice skipped, spatial order | scroll and cine free, with `bounce`; but cine skips a frame not rendered within `waitForRendered` ticks (`packages/tools/src/types/CINETypes.ts:12-17`; `playClip.ts:406-415`); the order is the ingest's | as Cornerstone3D | build | manual and cine done; speed, sweep, no-skip and the end stop build |
| R7 GSPS | build | build | build | build |
| R8 layouts, thumbnails, linked scroll, zoom and pan | sync free (`packages/tools/src/synchronizers/synchronizers/`); layouts build | free | partly | build |
| R9 window shown; CT presets; shutters; invert | shutters build; the rest small | window shown and presets free (`extensions/cornerstone/src/components/WindowLevelActionMenu/defaultWindowLevelPresets.ts:5`); shutters build | build | invert done; the rest build |
| R10–R14 orientation, rotate for DX/CR only, distance, angle, value at cursor, lossy label, annotations off | tools free; the gating and the labels build | orientation markers free (`extensions/cornerstone/src/Viewport/Overlays/ViewportOrientationMarkers.tsx`); the gating build | build | build |
| R15 lossless, checked | kept (our loader) | kept | kept up to the re-wrap | kept |
| R16 mobile label, R17 security | build | build | build | build |

Under every option the ingest must also carry the tags these rows read (laterality, view codes, identity, Lossy Image
Compression, Image Position for DBT order). The requirements file lists them under *What the client contradicts
today*.

## Open

* **Whether the bit-exactness that is decided reaches the screen.** If it does, the ranking stands. If it stops at the
  decoded frame, Cornerstone3D's paint needs a bound, such as one code, and a check that holds it to that bound.
  Neither the bound nor the check exists.
* **How far Cornerstone3D's paint is from ours.** It can be measured with the page check's readback against
  `client/paint/reference.js`, which needs a run.
* **`registerRenderBackend` with a surface of its own.** It is not on any release yet. A backend that owns its surface
  would have to own a worker's `OffscreenCanvas`, and Cornerstone3D's tools draw in page coordinates.
* **The glue line counts are estimates**, as are the 1 000–1 500 lines of the own option. No shipped bundle size or
  first image was measured for any option.
