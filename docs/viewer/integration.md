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
   paint cannot be byte-exact by construction (§Cornerstone3D, *render*). ~~It also puts the page back in the pixel
   path.~~ *Corrected 2026-11-02 (§A seam for our painter inside Cornerstone3D): on its own viewports it does; a viewport type of ours, painted by our worker,
   keeps the page out of the paint and keeps the proof.*
3. **OHIF v3.** It gives everything in (2), and a study list, a hanging protocol engine and a UI on top. It also has
   everything (2) lacks, and adds a fork to keep up with.
4. **VolView.** Its seam carries whole DICOM files. Our frames would have to be re-wrapped as files and then parsed
   again.

**What would change it:**

* **Cornerstone3D moves to first** ~~if `registerRenderBackend` lets a backend own its surface. Our painter in its worker
  would then be the backend, and the tools come with it (§Cornerstone3D, *render*).~~ *Corrected 2026-11-02
  (§A seam for our painter inside Cornerstone3D): no release is needed for our painter to carry the tools; a viewport type of ours does it at 5.14.0, at the
  costs listed there. Whether that moves it up is the owner's call.* It also moves to first if the
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
canvas transferred to its worker, so it cannot be a backend today. *Added 2026-11-02: it can be a viewport type
instead (§A seam for our painter inside Cornerstone3D).*

**The cache.** The image cache is 3 GB by default (`packages/core/src/cache/cache.ts:48`) and evicts the least recently
used image (`cache.ts:310-345`). Ours keeps every frame, or under frame-path a window around the current frame, with
OPFS behind it. Put together, our store is the source of truth. Cornerstone3D's cache is sized to our memory window,
and an evicted image is reloaded through our loader from our store, never from the wire. **Frame-path's B′ is lost**
*on the standard path (corrected 2026-11-02, §A seam for our painter inside Cornerstone3D: kept for the paint through a viewport type of ours)*:
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
| **lost** | on the standard path: the 1:1 proof (§*render*); zero-copy to the GPU; the page out of the pixel path (frame-path B′); cine off the page thread. *Corrected 2026-11-02 (§A seam for our painter inside Cornerstone3D): through a viewport type of ours the first three are kept, and the cine is ours to build* |
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

## A seam for our painter inside Cornerstone3D (2026-11-02)

**The verdict: the claim is true for the standard path only.** "Choosing B′ commits us to building our own viewer,
because Cornerstone3D and OHIF paint on the main thread" holds for every viewport Cornerstone3D ships, and for OHIF.
It does not hold for Cornerstone3D in general. Cornerstone3D accepts a viewport type from outside, and a viewport of
ours whose pixels our paint worker draws carries its tools. A spike (§4) proved this for the length, probe,
window-level, zoom, pan and stack-scroll tools in headless Chromium, with 144 lines of glue. So B′ commits us to our
own viewport, our own cine, and a seam that moves by majors. It does not commit us to our own tools. OHIF cannot
take that viewport without a fork. Read at the tags in §Sources below; the spike ran once on SwiftShader, and
nothing here is timed.

### Sources

| project | tag (commit) | tag date |
| --- | --- | --- |
| cornerstonejs/cornerstone3D | `v5.14.0` (`37d135d`), the latest; `v5.13.2` (`2adf417`); `v5.6.8` (`fe3a8e9`), OHIF's pin | 2026-10-28; 2026-10-23; 2026-07-19 |
| OHIF/Viewers | `v3.13.13` (`1fa151f`), the latest v3 release; the `v3.14.0-beta.*` tags were not read | 2026-10-16 |

Every file cited below under `packages/` is the same at 5.13.2 and 5.14.0, checked by `diff` file by file.

### 1 · Where the paint runs: confirmed

* **Cornerstone3D (5.14.0, 5.13.2, 5.6.8).** The engine renders the viewports flagged for render in one
  `requestAnimationFrame` of the page (`packages/core/src/RenderingEngine/BaseRenderingEngine.ts:692`;
  `ContextPoolRenderingEngine.ts:353-369`). This includes a viewport with its own pipeline, whose
  `customRenderViewportToCanvas` is called there (`:376-379`). The only `OffscreenCanvas` in core is a raster cache on
  the page (`RenderingEngine/CanvasActor/index.ts:39,128`). No source file calls `transferControlToOffscreen`. Its
  workers decode (`packages/dicomImageLoader/src/init.ts:7`) or compute (`packages/tools/src/utilities/registerComputeWorker.ts:15`,
  `packages/polymorphic-segmentation/src/registerPolySegWorker.ts:22`, `packages/labelmap-interpolation/src/registerWorker.ts:13`).
  None of them paints. §Cornerstone3D, *render*, stands.
* **OHIF v3.13.13** pins Cornerstone3D 5.6.8 (`extensions/cornerstone/package.json:57,61`). Neither `extensions/`
  nor `platform/` creates or transfers an `OffscreenCanvas`. Its paint is Cornerstone3D's, on the page.

### 2 · The unexamined seam: a viewport type of our own

**How a viewport that vtk.js does not draw is built.** `registerViewportType` is exported at all three tags
(`packages/core/src/index.ts:206,377`; the registry is `RenderingEngine/helpers/viewportTypeToViewportClass.ts:166-194`). A class whose
static `useCustomRenderingPipeline` is true gets these three calls from the engine:

* it is constructed by `addCustomViewport` (`BaseRenderingEngine.ts:571-627`);
* it is resized through `resizeForRenderingEngine` (`:528-541`);
* it is rendered through `customRenderViewportToCanvas`, and the engine then fires `IMAGE_RENDERED` with what that
  returns (`ContextPoolRenderingEngine.ts:353-369`).

Cornerstone3D's own viewports of this kind take two shapes:

* The video viewport draws a `<video>` into Cornerstone3D's canvas with 2D `drawImage` (`VideoViewport.ts:1172-1197`).
* The whole-slide viewport inserts a surface of its own, dicom-microscopy-viewer's element, after Cornerstone3D's
  canvas and under the SVG layer (`WSIViewport.ts:148-159`).

Ours takes the second shape.

**One constraint, which decides the shape.** The engine draws on each viewport's canvas itself:

* the background at enable, `getContext('2d')` (`BaseRenderingEngine.ts:155-156,443`);
* its size (`:590-593`);
* a clear at disable (`:735`).

A canvas whose control has been transferred refuses `getContext` and refuses a size change. That is the HTML
standard's placeholder canvas, read from memory and not re-read for this section. So the canvas our worker paints
is a sibling, placed as the whole-slide viewport places its own, and Cornerstone3D keeps its canvas underneath.

**What the tools need from a viewport**, read at 5.14.0. Each tool tests for methods, not classes, except where noted.

| tool | reads from the viewport | here |
| --- | --- | --- |
| length, angle | `worldToCanvas`, `canvasToWorld`; the target's image data for mm (`packages/tools/src/tools/annotation/LengthTool.ts:265-266,788-802`; `AngleTool.ts:221-248`) | length **tested**; angle by reading, same calls |
| probe, pixel value | `getImageData()`, then `imageData.worldToIndex` and `voxelManager.getAtIJKPoint`, synchronously, with k set to the current index (`ProbeTool.ts:667-724`; `packages/tools/src/tools/base/BaseTool.ts:330-351`); a target id from `getViewReferenceId` | **tested**: the samples are read on the page from the frame's `SharedArrayBuffer` |
| window-level drag | `getProperties()` and `setProperties({ voiRange })` (`WindowLevelTool.ts:50,116`, `:358-386`) | **tested**: the window reaches the worker |
| zoom, pan | with no camera `position`, `getPan`/`setPan` and `getZoom`/`setZoom` in canvas units (`PanTool.ts:136-150`; `ZoomTool.ts:446-462`) | **tested**, the tools' drags |
| stack scroll | `getCurrentImageIdIndex`, `scroll`, `getImageIds` (`packages/core/src/utilities/scroll.ts:41-66`) | **tested**, the wheel |
| annotations per slice | `getViewReference`, `isReferenceViewable` (`RenderingEngine/Viewport.ts:2154-2290`) | by reading: world z is the slice index here, so an annotation belongs to its slice. Not tested |
| cine (`playClip`) | only stack, volume, video or Generic viewports; anything else throws `Unknown viewport type` (`packages/tools/src/utilities/cine/playClip.ts:580-619`). Its clock is a page timer (`:195-215`) | **ours**, and has to be: a page timer is what B′ moves into the view worker (frame-path §2). Not built |
| synchronizers | VOI dispatches by class: stack, volume or Generic (`synchronizers/callbacks/voiSyncCallback.ts:54-80`). Zoom and pan need `setViewState` (`zoomPanSyncCallback.ts:23-88`). Generic means `setDisplaySets`, `setDisplaySetPresentation`, `setViewState` (`packages/core/src/utilities/viewportCapabilities.ts:119-127`) | **not reached** by this viewport. Linked VOI, zoom and pan are either ours, or glue for the Generic interface. Neither built |

**What lags, or lives in the wrong place.**

* **The overlay and the image are drawn by two threads.** `IMAGE_RENDERED`, on which the tools draw their SVG,
  fires when `customRenderViewportToCanvas` returns (`ContextPoolRenderingEngine.ts:353-369`). The paint is only a
  message to the worker at that moment. So during a drag the SVG can lead the image by a frame or more. Firing the
  event on the painter's acknowledgement instead would make the overlay follow the image, not match it. Nothing
  here is measured. A busy page delays the overlay and the tools' response, not the image (frame-path §2).
* **The probe reads samples on the page.** The spike drives the paint worker with the page posting each frame's
  handle, which is today's `?view=page` shape. Under the view worker the page holds no frame (frame-path §3,
  *Built*). The probe would then need one of two things:
  * the current frame's handle, sent with `shown`;
  * or the view worker's asynchronous `valueAt`, whose answer arrives after the tool has drawn.

  Neither was tried.
* **The window.** The tools set `{ lower, upper }`. Ours is a centre, a width and a function. The glue maps the
  range to LINEAR_EXACT. LINEAR, SIGMOID and the VOI LUT Sequence need it to carry the function: the tool reads
  `VOILUTFunction` from `getProperties` (`WindowLevelTool.ts:116`). The table stays ours, so the painter's proof
  holds for whatever window the tools set.

**Supported, or internals?** The registration is a documented extension point. The 5.x guide registers a new type
"only for a genuinely new data shape or render path" (`packages/docs/docs/migration-guides/5x/2-generic-viewport.md:66-87`,
how at `:130-187`). The methods the tools read from our class are another matter: `getProperties`, `getCamera`,
`scroll`, and the `Viewport` base class. The same guide calls this legacy surface "a temporary migration layer",
expected to be removed in a later breaking release (`:54-58`, `:384-389`). The tools already route new code by
`isGenericViewport` (`playClip.ts:610-617`; `voiSyncCallback.ts:61-80`). So a lasting form of this glue implements
the Generic viewport's interface instead. That was not attempted, and the glue should be expected to change at each
major (§Cornerstone3D, *upgrade risk*).

**The `registerRenderBackend` roadmap.** At 5.14.0, a backend still draws to an existing `'vtk'` or `'cpu'` surface
(`packages/docs/docs/concepts/cornerstone-core/generic-viewport/render-backends.md:45-54,99-101`). The project's own
tracker, as of 2026-11-02:

* Issue #2894 (open, 2026-09-02) lists "backend-owned surfaces — a backend declares and creates its own canvas". It
  is a prerequisite landing on the timeline of PR #2796.
* PR #2796 (open) is an experimental WebGPU backend that "blit[s] into the `cpu` surface canvas". Its frames are
  blitted on the page.
* PR #2904 (open) is #2796 repackaged.
* PR #2795 (merged 2026-07-09) reshaped the API.

No release and no milestone names a backend-owned surface. Nothing in these items says that such a surface could
belong to a worker. Read from GitHub's search results (each item's title and body) only; their threads were not
read.

### 3 · Other viewers

Each viewer at the tag in [`survey.md`](survey.md) §Sources: whether it renders off the page's main thread, or could
host a canvas a worker paints.

| viewer | off the main thread? |
| --- | --- |
| OHIF v3 | no: Cornerstone3D 5.6.8 (§1). Hosting our viewport needs a fork, because its viewport types are a closed list that throws on any other (`extensions/cornerstone/src/utils/getCornerstoneViewportType.ts:85-87`) |
| Cornerstone3D | its own viewports, no (§1); a viewport of ours, yes (§2, §4) |
| VolView 4.5.3 | no: vtk.js on the page. Its only `OffscreenCanvas` decodes JPEG cine frames in a worker (`src/core/cine/jpegDecode.worker.ts:22-26`), or probes the GPU (`src/utils/gpuInfo.ts:3`) |
| dwv 0.36.4 | no: Canvas 2D on the page (`src/gui/viewLayer.js:916,1151`), Konva for drawing (`src/gui/drawLayer.js:543`); and GPL-3.0 |
| Stone Web Viewer | not read for this section (Mercurial, not cloned); the survey reads WebGL from WASM on the page. AGPLv3+ |
| NiiVue 0.69.0 | no: `attachToCanvas(HTMLCanvasElement)` (`packages/niivue/src/niivue/index.ts:898`), WebGL2 on it (`niivue/core/gl.ts:18-19`); no `OffscreenCanvas` in its source |
| BlueLight 1.1.0 | no: Canvas 2D on the page (`bluelight/scripts/viewport.js:137`) |
| dicom.ts 1.3.0 | a renderer, not a viewer. Typed for an `HTMLCanvasElement`, which it creates with `document` if not given one (`src/renderer/Renderer.ts:29-31`). It might run on an `OffscreenCanvas` in a worker, but that was not tried |
| dcmjs-imaging 0.2.6 | a CPU renderer to RGBA, with no `document` or `window` in `src/`, so it could run in a worker. It has no viewer to host |
| Papaya 0.8 | no: Canvas 2D on the page (`src/js/viewer/screenslice.js:25`); dormant since 2015 |
| cornerstone (legacy) 2.6.1 | no: Canvas 2D on the page (`src/rendering/renderGrayscaleImage.js:89`); superseded |
| any the survey missed | **not searched**. This section looked only at the survey's list |

No open web viewer read here paints off the main thread. Only Cornerstone3D has a seam through which ours can.

### 4 · The spike

[`../../lab/viewer-spike/seam/`](../../lab/viewer-spike/seam/README.md) holds the spike, which is throwaway. It
registers a viewport type whose paint is our `client/paint/painter.js`, unchanged. The page half transfers a canvas,
placed beside Cornerstone3D's own, to the paint worker. The worker paints an R16UI texture with the window in the
shader. The data is three synthetic 64×48 16-bit slices: a ramp, with 0.5 mm pixels. The browser is headless
Chromium 153 on SwiftShader, DPR 1, at Cornerstone3D 5.14.0.

Each check that compares the painted image works the same way:

1. It reads back the last paint that the viewport sent to the worker.
2. It takes the code under a canvas point.
3. It compares that code with what `client/paint/voi.js` makes of the probe's sample at the same point, under the
   window the tools last set.

The check allows one code, because the bilinear pass mixes neighbours at 4 CSS px per image pixel.

| check | result, 3 of 3 runs | its mutant, caught |
| --- | --- | --- |
| length, centres of pixels (10, 10) to (40, 30) | 18.028 mm, the 18.028 expected | `canvasToWorld` scaled 1.1 in x: 16.910 |
| probe at pixel (20, 15), slice 0 | 3175, the sample | the next sample read: 3215 |
| the painted code under the probe, at the fit | 76 against 75 | the painter panned 8 px: 70 |
| the same after the zoom tool's drag (zoom 3.68) and the pan tool's | 112 against 112 | the painter's zoom 5 % off: 106 |
| window-level drag | the window moves (2000–6000 → 2000–6160); 72 against 72 | the window never reaches the painter: 76 |
| one wheel step | slice 1 shown and probed (5130); 200 against 200 | scroll paints slice 0: 9 |

The rows are kept at commit `7f07555` on this branch, `lab/viewer-spike/seam/rows/run-2026-11-02.txt`.

**What worked:** each row above, in each of 3 runs.

**What was built only to make it work:** the canvas beside Cornerstone3D's own (the constraint in §2). Two stubs for
Node builtins that `xmlbuilder2` imports under `@cornerstonejs/tools` (`run.mjs`). A 450 ms wait after each press,
because the tools hold a press for 400 ms to tell a double click (`packages/tools/src/eventListeners/mouse/mouseDownListener.ts:27`).

**The glue is 144 lines** (`worker-viewport.js`, non-blank and non-comment), at spike quality. The page, 64 lines,
and the runner, 182, are not glue.

**Not done:**

* the angle tool, the per-slice annotation filter, cine, synchronizers;
* the view worker in place of the paint worker (the probe's question above);
* any VOI function but LINEAR_EXACT;
* DPR 2;
* a GPU;
* Firefox, where frame-path §7 found the worker's draw waiting for a busy page;
* any timing, of the paint or of the overlay against it.

### What it changes

* **B with our painter is an option today.** It no longer waits on a release. It keeps the painter and its proof,
  zero copies to the GPU, and B′'s paint off the page. It takes Cornerstone3D's tools, annotation state and
  measurement code. Its costs:
  * our viewport, about 144 lines at spike quality;
  * our cine;
  * linked views that are ours, or more glue;
  * an overlay drawn one thread away from its image;
  * a seam on the legacy method set, which Cornerstone3D says it will remove.

  Whether to carry it beside A is the owner's call, below.
* **OHIF stays as integration.md has it.** It cannot take this viewport without a fork, so under OHIF the paint is
  still Cornerstone3D's.

| Retracted | What is true |
| --- | --- |
| "Cornerstone3D … puts the page back in the pixel path" (§The ranking, 2) | only on its standard viewports; a viewport of ours painted by our worker keeps the page out of the paint (§2, §4) |
| "Cornerstone3D moves to first if `registerRenderBackend` lets a backend own its surface" (§The ranking) | another seam, a viewport type, does today what that release was awaited for (§2) |
| "Frame-path's B′ is lost: the paint runs on the page thread" (§Cornerstone3D, *The cache*) | lost on the standard path; kept for the paint through a viewport of ours. Cine through `playClip` stays a page timer, so the cine is ours (§2) |
| "lost: the 1:1 proof; zero-copy to the GPU; the page out of the pixel path; cine off the page thread" (§Cornerstone3D, table) | on the standard path. Through a viewport of ours, the first three are kept and the cine is ours to build (§4) |
| "a backend that owns its surface would have to own a worker's `OffscreenCanvas`, and Cornerstone3D's tools draw in page coordinates" (§Open) | the tools' page coordinates did not block a worker's canvas: the overlay is one thread apart, not wrong (§2, §4) |

## Open

* **Whether the bit-exactness that is decided reaches the screen.** If it does, the ranking stands. If it stops at the
  decoded frame, Cornerstone3D's paint needs a bound, such as one code, and a check that holds it to that bound.
  Neither the bound nor the check exists.
* **How far Cornerstone3D's paint is from ours.** It can be measured with the page check's readback against
  `client/paint/reference.js`, which needs a run.
* **`registerRenderBackend` with a surface of its own.** It is not on any release yet *(still so at 5.14.0; planned in
  issue #2894 with no release named, §A seam for our painter inside Cornerstone3D)*. ~~A backend that owns its surface would have to own a worker's
  `OffscreenCanvas`, and Cornerstone3D's tools draw in page coordinates.~~ *Corrected 2026-11-02: the tools' page
  coordinates did not block a worker's canvas behind a viewport type of ours; the overlay is drawn one thread apart.*
* **A viewport type of ours, beyond the spike** (§A seam for our painter inside Cornerstone3D): the probe under the view worker, the cine, synchronizers or the
  Generic viewport's interface, the overlay against the image in time, Firefox, a GPU. None done.
* **The glue line counts are estimates**, as are the 1 000–1 500 lines of the own option. No shipped bundle size or
  first image was measured for any option.
