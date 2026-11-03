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
([`../../client/README.md`](../../client/README.md) *Its policy*), so they need CSP hashes. ~~It also registers a
service worker (`index.html:200-205`).~~ *Corrected 2026-11-03 (§A seam, §5): it loads `init-service-worker.js`, which
registers nothing in a page; the inline scripts' refusal was tested on v3.14.0-beta.68.*

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
own viewport, our own cine, and a seam that moves by majors. It does not commit us to our own tools. ~~OHIF cannot
take that viewport without a fork.~~ *Corrected 2026-11-03 (§8): by source, an OHIF extension's viewport module and a
data source of ours can host it without a fork; not built.* Read at the tags in §Sources below; the spike ran once on
SwiftShader, and nothing here is timed. *2026-11-03: §5 runs it on our real core, §6 writes the phone protocol, §7
and §8 answer the removal and OHIF questions, and §What option B costs sums it up.*

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
| length, angle | `worldToCanvas`, `canvasToWorld`; the target's image data for mm (`packages/tools/src/tools/annotation/LengthTool.ts:265-266,788-802`; `AngleTool.ts:221-248`) | length **tested**; angle by reading, same calls. *Angle tested on our core, 2026-11-03 (§5)* |
| probe, pixel value | `getImageData()`, then `imageData.worldToIndex` and `voxelManager.getAtIJKPoint`, synchronously, with k set to the current index (`ProbeTool.ts:667-724`; `packages/tools/src/tools/base/BaseTool.ts:330-351`); a target id from `getViewReferenceId` | **tested**: the samples are read on the page from the frame's `SharedArrayBuffer` |
| window-level drag | `getProperties()` and `setProperties({ voiRange })` (`WindowLevelTool.ts:50,116`, `:358-386`) | **tested**: the window reaches the worker |
| zoom, pan | with no camera `position`, `getPan`/`setPan` and `getZoom`/`setZoom` in canvas units (`PanTool.ts:136-150`; `ZoomTool.ts:446-462`) | **tested**, the tools' drags |
| stack scroll | `getCurrentImageIdIndex`, `scroll`, `getImageIds` (`packages/core/src/utilities/scroll.ts:41-66`) | **tested**, the wheel |
| annotations per slice | `getViewReference`, `isReferenceViewable` (`RenderingEngine/Viewport.ts:2154-2290`) | by reading: world z is the slice index here, so an annotation belongs to its slice. ~~Not tested~~ *Tested on our core (§5); a restored annotation needs an `isReferenceViewable` by image* |
| cine (`playClip`) | only stack, volume, video or Generic viewports; anything else throws `Unknown viewport type` (`packages/tools/src/utilities/cine/playClip.ts:580-619`). Its clock is a page timer (`:195-215`) | **ours**, and has to be: a page timer is what B′ moves into the view worker (frame-path §2). ~~Not built~~ *Built on the view worker's clock and tested (§5)* |
| synchronizers | VOI dispatches by class: stack, volume or Generic (`synchronizers/callbacks/voiSyncCallback.ts:54-80`). Zoom and pan ~~need `setViewState` (`zoomPanSyncCallback.ts:23-88`)~~ *try `setViewState` first, then fall back to `getZoom`/`setZoom` and `getPan`/`setPan` (`zoomPanSyncCallback.ts:130-147`): corrected 2026-11-03*. Generic means `setDisplaySets`, `setDisplaySetPresentation`, `setViewState` (`packages/core/src/utilities/viewportCapabilities.ts:119-127`) | ~~**not reached** by this viewport. Linked VOI, zoom and pan are either ours, or glue for the Generic interface. Neither built~~ *Tested (§5): zoom and pan reached by Cornerstone3D's own synchronizer; VOI not, and ours is one callback on its synchronizer* |

**What lags, or lives in the wrong place.**

* **The overlay and the image are drawn by two threads.** `IMAGE_RENDERED`, on which the tools draw their SVG,
  fires when `customRenderViewportToCanvas` returns (`ContextPoolRenderingEngine.ts:353-369`). The paint is only a
  message to the worker at that moment. So during a drag the SVG can lead the image by a frame or more. Firing the
  event on the painter's acknowledgement instead would make the overlay follow the image, not match it. Nothing
  here is measured. *Measured 2026-11-03 (§5): one frame apart on an idle page, the annotation leading in a pan and
  trailing in a scroll.* A busy page delays the overlay and the tools' response, not the image (frame-path §2).
* **The probe reads samples on the page.** The spike drives the paint worker with the page posting each frame's
  handle, which is today's `?view=page` shape. Under the view worker the page holds no frame (frame-path §3,
  *Built*). The probe would then need one of two things:
  * the current frame's handle, sent with `shown`;
  * or the view worker's asynchronous `valueAt`, whose answer arrives after the tool has drawn.

  ~~Neither was tried.~~ *The second was tried on our core (§5): the probe answers after one round trip, with no frame
  on the page.*
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
| OHIF v3 | no: Cornerstone3D 5.6.8 (§1). ~~Hosting our viewport needs a fork, because its viewport types are a closed list that throws on any other (`extensions/cornerstone/src/utils/getCornerstoneViewportType.ts:85-87`)~~ *That list closes only OHIF's own viewport; an extension's viewport module can host ours (§8, by source)* |
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

* ~~the angle tool, the per-slice annotation filter, cine, synchronizers;~~ *done on our core (§5)*
* ~~the view worker in place of the paint worker (the probe's question above);~~ *done (§5)*
* any VOI function but LINEAR_EXACT;
* DPR 2;
* a GPU;
* Firefox, where frame-path §7 found the worker's draw waiting for a busy page;
* ~~any timing, of the paint or of the overlay against it.~~ *the overlay against the image, in frames (§5); the paint
  only in §6's proxy*

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
* **OHIF stays as integration.md has it.** ~~It cannot take this viewport without a fork, so under OHIF the paint is
  still Cornerstone3D's.~~ *By source it can, as an extension's viewport module beside a data source of ours (§8);
  not built.*

| Retracted | What is true |
| --- | --- |
| "Cornerstone3D … puts the page back in the pixel path" (§The ranking, 2) | only on its standard viewports; a viewport of ours painted by our worker keeps the page out of the paint (§2, §4) |
| "Cornerstone3D moves to first if `registerRenderBackend` lets a backend own its surface" (§The ranking) | another seam, a viewport type, does today what that release was awaited for (§2) |
| "Frame-path's B′ is lost: the paint runs on the page thread" (§Cornerstone3D, *The cache*) | lost on the standard path; kept for the paint through a viewport of ours. Cine through `playClip` stays a page timer, so the cine is ours (§2) |
| "lost: the 1:1 proof; zero-copy to the GPU; the page out of the pixel path; cine off the page thread" (§Cornerstone3D, table) | on the standard path. Through a viewport of ours, the first three are kept and the cine is ours to build (§4) |
| "a backend that owns its surface would have to own a worker's `OffscreenCanvas`, and Cornerstone3D's tools draw in page coordinates" (§Open) | the tools' page coordinates did not block a worker's canvas: the overlay is one thread apart, not wrong (§2, §4) |

### 5 · On our core, end to end (2026-11-03)

[`../../lab/viewer-spike/seam-core/`](../../lab/viewer-spike/seam-core/README.md) replaces §4's synthetic frame with
the core of `claude/core-fold-2026-11-02` at `0920153` (frame-path §*The core, assembled*). That is our transport,
downloader, decoders, digest check, frame store and view worker. Two viewports of ours each drive one `ViewWorker`
(`?view=worker`'s shape) over a real WebTransport session to `series-server`. The page holds no frame. Every
response carries the product's three isolation headers and its policy (`deploy/README.md` §*What must be preserved
exactly*), with `connect-src` naming the series server. The series is 24 synthetic 16-bit slices of 128×96 with
0.5 mm pixels: a ramp with one bright column, encoded HTJ2K by OpenJPH 0.31.0, with XXH3 digests (`series.mjs`). The
browser is headless Chromium 153 on SwiftShader, DPR 1, Cornerstone3D 5.14.0. A check that compares the image reads
the code **on screen**: a one-pixel screenshot, with the worker's canvas composited. §4 read back the paint instead.

| check | result, 3 of 3 runs | its mutant, caught |
| --- | --- | --- |
| every frame exact, both viewports, through our digest check | 24/24 exact | no digests passed: 0/24 exact |
| the product's headers and policy | cross-origin isolated, nothing refused | a fetch outside `connect-src`: 1 refused |
| through every tool, Cornerstone3D's image loader asked for nothing, nothing in its cache | 0 loads, 0 B | the page enables `stackPrefetch`: 23 loads |
| `stackPrefetch`, if enabled on our viewport, asks Cornerstone3D's loader for every other slice | 23 of 23 | no `hasImageURI`: 0 loads |
| no metadata provider answers, yet length and probe give mm and samples | 18.028 mm, 2550; the tools asked for `imageRetrieveConfiguration` and `scalingModule` | the image data's spacing 1: 36.056 mm |
| length, centres of pixels (10, 10) to (40, 30) | 18.028 mm | `canvasToWorld` × 1.1 in x: 16.910 |
| angle, three clicks at (10, 10), (40, 10), (70, 40) | 135.00° | `canvasToWorld` × 1.1 in y: 137.73° |
| probe at (20, 15), its sample asked of the view worker | 2550 | the sample + 1: 2551 |
| the code on screen under the probe, at the fit | 5 against 5 | the pan 8 px off: the probe's reply no longer matches its pixel, so it never settles |
| the same after the zoom tool's drag (3.676) and the pan tool's | 15 against 15 | the zoom 5 % off: as above |
| window-level drag | 25 → 43 on screen, 43 expected | the window never sent: 25 |
| one wheel step | slice 1 probed (3060) and on screen (10 against 10) | the step never sent |
| an annotation drawn on slice 0, and one restored onto slice 2 | drawn on slices 0, 1, 2, 0: 1, 0, 1, 1 | world z constant: 1, 1, 2, 1; an image reference viewable anywhere: 2, 1, 1, 2 |
| Cornerstone3D's own synchronizers | VOI not reached; zoom and pan reached (3.676 and −18, −11 on both views), the image on screen under both | no `getPan`: pan not linked |
| our VOI callback on Cornerstone3D's synchronizer | the other view painted with the new window, 43 against 43 | the callback does not render: 25 |
| our cine, the view worker's clock, 20/s for 1.5 s | 30 frames, none started > 50 ms late; the tools follow it; the slice's annotation shows on its slice only | the page does not follow: index 0, worker at 5 |

The rows are at `claude/viewer-seam2@710b23f`, `lab/viewer-spike/seam-core/rows/`. The painter's 1:1
proof through this series and the view worker is the core's own viewer check: readbacks 0:0 12:0 23:0 23:0 on this
series (`client/viewer/check.mjs --view worker`, run here once, not kept as rows).

**What the data side needs, and the three risks, answered.**

* **Cornerstone3D's image cache and stack prefetch against our download order: verified, by test, and conditional.**
  Our viewport never touches Cornerstone3D's loader or cache: the frames' order is the view worker's want, as the
  core's own viewer has it. Cornerstone3D's `stackPrefetch` decides by methods, not class
  (`packages/tools/src/utilities/stackPrefetch/stackPrefetchUtils.ts:45-76`, through `viewportSupportsImageSlices`,
  `packages/core/src/utilities/viewportCapabilities.ts:49-58`). So if it is enabled on our viewport, it queues every
  other slice on its own loader (`stackPrefetch.ts:195-215`). That is a second download order. The risk holds only if
  something enables it, or if a loader answers our image ids. Our page must not, and an OHIF host would (below).
* **The metadata the tools expect: verified, by test, for these tools.** Length, angle, probe, window, zoom, pan,
  scroll, links and cine took their geometry from the viewport (`getImageData`, `canvasToWorld`), with no metadata
  provider answering. They asked only `imageRetrieveConfiguration` and `scalingModule`, and needed neither. What the
  viewport itself needs is the frame's width, height and pixel spacing. Our series metadata carries width and height
  (core-fold `ingest/from-dicom/dicom_series.py:142-145`) but **no pixel spacing, frame of reference, or image plane**.
  The spike adds `pixelSpacing` to its own metadata. The ingest would have to carry it (requirements.md §Open,
  *Identity*). Not checked: the US probe's calibrated regions and the SUV path (`ProbeTool.ts:699-722`), which read
  metadata modules.
* **OHIF's inline scripts and service worker against COOP/COEP and our policy: verified, by test, for OHIF unchanged
  at `v3.14.0-beta.68`** (npm `@ohif/app`, tarball SHA-256 `7b98195…ef7cb4`; `ohif-policy.mjs`). Under our headers it
  is cross-origin isolated and boots to its first screen. Our policy refuses its two inline scripts
  (`platform/app/public/html-templates/index.html:53-56,209-216`), so `window.PUBLIC_URL` and
  `browserImportFunction`, which loads extensions at run time, are missing. OHIF runs today, but one of those scripts
  must move to a file (or be hashed into the policy) before an extension loads at run time. With `'unsafe-inline'`,
  nothing is refused: the check's mutant. Its default data source is refused by `connect-src`, a configuration
  matter. Its service worker does not register in a page: `init-service-worker.js:1-5` unregisters every worker, and
  `:13` registers only where `importScripts` exists, which a window lacks (verified by source; the test page at
  127.0.0.1 is also excluded by `:20`). OHIF ships no COOP/COEP of its own (`netlify.toml` at both tags), and its
  suggested policy, report-only, allows inline scripts and `blob:` workers (`netlify.toml:37`).
* **SharedArrayBuffer: verified, by test.** Cornerstone3D under the product's headers keeps the page cross-origin
  isolated, so the core's `SharedArrayBuffer` frames hold. Under option B no frame reaches the page.
* **Events: verified, by test.** The glue fires `STACK_NEW_IMAGE` on a step, `VOI_MODIFIED` on a window, and
  `CAMERA_MODIFIED` on zoom and pan. The engine fires `IMAGE_RENDERED`. Cornerstone3D's zoom-pan synchronizer and our
  VOI one run on the last two.
* **Memory: measured once, not judged.** Cornerstone3D opens **nine WebGL2 contexts on the page** at start, and two 2D
  ones, though nothing it draws reaches the screen under option B (`instrument.js`, the policy row's output). Each
  costs a GPU context on a phone. Whether a setting avoids them was not looked for. The page's JS heap is in §6's
  proxy rows; every thread's memory is not available in this headless build.

**What else the run found.**

* **A defect in the core: a repaint before the frame arrives stops all painting** (`controller-freeze.test.mjs`).
  `Controller.repaint()` (core-fold `0920153`, `client/view/controller.js`) with the current frame not yet held runs its async
  loop to its end synchronously, sets `#painting = null`, and only then stores the settled promise. Every later
  repaint returns that promise, and nothing is painted again. The core's own viewer reaches it with a display key, a
  ctrl-wheel zoom or a resize once connected and before frame 0 is painted (core-fold `client/viewer/viewer.js:147,
  189-207,232`). Its drags wait for `shown` (`:214`). On a slow link that is the whole wait for the first frame. The test fails on the core as it is, and passes with
  `await null` at the loop's head (`--fixed`). Not fixed on the core branch, which this run does not own. The glue
  sends no display before the view worker's first `shown`.
* **The probe under the view worker: answered.** It asks `valueAt` at the pixel's centre, answers `null` until the
  reply, and the tool recomputes a `null` value on the next render (`ProbeTool.ts:531-546`). One round trip, no frame
  on the page. The reply's pixel is checked against the asked one, which is how the pan and zoom mutants were caught.
* **Restored annotations need one more override.** `hydrate` throws "Unsupported viewport type" on a class it does not
  know unless given `referencedImageId` (`packages/tools/src/tools/base/AnnotationTool.ts:915-958`). It stores no
  plane, and only `StackViewport` filters by image (`filterAnnotationsForDisplay.ts:62-77`), so a restored annotation
  showed on every slice. The glue answers `isReferenceViewable` by image when there is no plane.
* **Our cine needs the page to follow until the pause is answered.** A frame painted while the pause was in flight left
  the page's index one behind the screen, once in 3 runs. The glue now follows `shown` until the view worker answers.
* **The glue is 212 lines** (`core-viewport.js`, non-blank, non-comment) at spike quality, against §4's 144.

**The overlay against the image (c), in frames: measured, indicative.** `lag.mjs` films the screencast (every
composited frame, both layers together) while the page pans 2 px each frame for 60 frames, then steps one slice every
3 frames through 23 steps with an annotation on the even slices.

| gesture, 3 rounds | distinct composited frames | the annotation against the image |
| --- | --- | --- |
| pan, 2 px a frame | 62 per round | the annotation **one frame ahead** of the image in 59; level in 2, at rest before and after; one where the first step jumps 58 px, which reads as 29 |
| scroll, a slice every 3 frames | 44–45 per round | at 21–22 of 23 steps, one composited frame with the annotation on the wrong slice, lasting a median 14.4–15.0 ms, **after** the image changed |

The rows are `lab/viewer-spike/seam-core/rows/lag.txt`.

The two drawings are one frame apart in both gestures, but in opposite directions. In the scroll, the annotations
change one frame after the image: Cornerstone3D draws the SVG in its own next animation frame after `IMAGE_RENDERED`
(`packages/tools/src/stateManagement/annotation/AnnotationRenderingEngine.ts:154`), while the view worker paints a
frame it already holds as soon as the intent arrives. In the pan, the annotation leads the image by one frame. Why the
two differ was not traced. Neither drawing is ever more than one frame from the other in these rows, on an idle page.
A busy page delays the SVG, not the image, and was not measured.

### 6 · The phone protocol: option A against option B (written 2026-11-03, before any data)

**The options, as the owner named them for this run.** Option A is Cornerstone3D's standard path: its stack
viewport paints on the page, its images handed over by an image loader fed by our core on the page. It is
[`architecture.md`](architecture.md)'s B. Option B is our viewport inside Cornerstone3D: the view worker holds the
frames and paints them, and the page sends intents (§4, §5). Both run the same transport, downloader, decoders and
digest check. Product target: mobile browsers first.

**Rig.** Chrome for Android, driven from a computer over remote debugging (`adb forward tcp:9222
localabstract:chrome_devtools_remote`, then Playwright's `connectOverCDP`). The page is served on the phone's own
`localhost` through `adb reverse`, so it is a secure context and can be cross-origin isolated. The series server is
dialled over the LAN, because WebTransport is UDP and `adb reverse` carries TCP only. Both arms share one Wi-Fi link,
interleaved. The runner is [`../../lab/viewer-spike/seam-core/proxy.mjs`](../../lab/viewer-spike/seam-core/README.md):
`--remote http://localhost:9222 --lan <computer's IP> --http-port <P> --rates 1`, after `adb reverse tcp:P tcp:P`.
Record before the first round: the phone's model, Android and Chrome versions, the display's refresh rate, the
battery level, and that the phone is on charge, not hot, and has no other tab open.

**Series.** The spike's: 24 slices of 128×96, 16-bit, HTJ2K, with digests (`series.mjs`). It is small on purpose:
it measures the paint path and the page, not the wire. A DBT series is the next cell, once this one is read.

**Order.** 10 rounds. Each round runs both arms on a fresh page, A then B in odd rounds and B then A in even ones.

**The metrics, one visit each.**

| metric | how |
| --- | --- |
| first exact image | navigation → the first paint of frame 0, which is checked exact before either option may paint it: A's `IMAGE_RENDERED`, B's `shown` heard on the page |
| scroll on time | 71 steps (1 → 23, 23 → 0, 0 → 23), one every 50 ms, once the fill is complete. A step is on time if its frame's paint (as above) lands within 33.3 ms (two 60 Hz periods) of the step. Reported as the fraction on time |
| cine on time | 30 frames/s for 3 s: A's `playClip`, B's view-worker clock. Frame k is due k periods after the first paint, and on time if painted within one period of that. A skipped frame is not on time. Reported as on-time paints ÷ the 90 due. A's paint time is `IMAGE_RENDERED`; B's is the paint's end on the view worker's own clock, because B's claim is that its paint does not wait on the page |
| page long tasks | the page thread's `longtask` entries, summed in ms, over the open, the scroll and the cine |
| memory | `measureUserAgentSpecificMemory` after the cine, every thread, where Chrome gives it. Otherwise the page thread's JS heap (`Performance.getMetrics`), which leaves out the workers and so favours B; said as such |

**The rule, fixed now.** Each metric's median over the 10 rounds, B against A.

* *B no worse* on a metric when: first exact ≤ 1.1 × A + 16.7 ms; scroll on time ≥ A − 5 points; cine on time ≥ A − 5
  points; page long tasks ≤ 1.1 × A + 50 ms; memory ≤ A + 32 MiB.
* *B better* on a metric when it beats A by the same margins the other way: first exact ≤ A / 1.1 − 16.7 ms, on time
  ≥ A + 5 points, long tasks ≤ A / 1.1 − 50 ms, memory ≤ A − 32 MiB.
* **Verdict.** "B pays for its costs on this phone" if B is no worse on all five and better on at least one of scroll,
  cine or page long tasks. "A" if B is worse on any. Otherwise "a tie, and A by default", since A carries none of
  §*What option B costs*.
* **Void.** A visit with any frame not exact, or a page error, is dropped with its round's other arm. Fewer than 8 of
  10 rounds kept: not judged.
* **Where it saturates.** The phone's refresh rate caps what on time can mean, and a 90 or 120 Hz display is judged
  against 60 Hz periods as written. Its thermal state is not controlled beyond the checks above. Nothing is claimed
  for another phone, a busy page, or a larger series.

**The desktop proxy, run here (indicative).** The same runner in headless Chromium on SwiftShader, its CPU throttled
4× and 6× (`Emulation.setCPUThrottlingRate`), 5 rounds per rate, the rule applied as written. A throttled desktop is
not a phone: its GPU is software, its memory and thermals are a server's, and `measureUserAgentSpecificMemory` is not
available in this headless build, so memory is the page heap alone.

**The proxy's run (2026-11-03), indicative.** Rows at `lab/viewer-spike/seam-core/rows/proxy.txt`. Chromium 153 on
SwiftShader, 5 rounds per rate, all kept. Medians:

| | first exact, ms | scroll on time | cine on time | page long tasks, ms | page JS heap, MiB |
| --- | --- | --- | --- | --- | --- |
| 4×: A | 1 854 | 95.8 % | 100 % | 1 444 | 16.4 |
| 4×: B | 1 819 | 97.2 % | 98.9 % | 1 325 | 12.6 |
| 6×: A | 2 483 | 91.5 % | 100 % | 2 037 | 16.5 |
| 6×: B | 2 266 | 97.2 % | 98.9 % | 1 759 | 12.6 |

**By the rule as written: at 4×, a tie, and A by default.** B is no worse on all five and better on none. Its long
tasks, 1 325 ms, miss the "better" bar of 1 263. **At 6×: "B pays for its costs".** B is no worse on all five, and
better on scroll on time (97.2 against 91.5 %, bar 96.5) and on page long tasks (1 759 against 2 037 ms, bar 1 802).
What this does not say:

* Every long task fell in the open (Cornerstone3D's start, the dial and the first image). None fell in the scroll or
  the cine on either option, so the page was never busy where B's paint would show its advantage.
* A's cine was on time; B's dropped one frame in 90 most rounds, on the view worker's timer.
* B's scroll time is `shown` heard on the page, one thread hop after its paint. A's is `IMAGE_RENDERED`, when the
  page has issued its draw. They are not the same instant.
* Exactness was checked for frame 0 on both, and for A's whole fill, not per frame on B in these visits (§5's checks
  saw 24/24 every run). Page errors were not collected.
* Memory is the page heap only, which leaves out B's view worker, so it favours B.

None of this is a phone, which decides.

### 7 · The methods Cornerstone3D says it will remove (d)

Read in `packages/docs/docs/migration-guides/5x/2-generic-viewport.md` at 5.14.0. The guide names a method set the
"legacy compatibility adapters" keep, and says each "should be expected to be removed in a later breaking release".
Our viewport implements several of them, because the tools read them from any viewport that is not Generic.

| our viewport implements | read by (5.14.0) | the guide says | what replaces it |
| --- | --- | --- | --- |
| `getProperties`, `setProperties` | the window-level tool (`WindowLevelTool.ts:50,116,358-386`) | temporary, for migration only (`:379-382`) | `setDisplaySetPresentation(displaySetId, { voiRange, … })` (`:362-376`) |
| `getCamera`, `setCamera` | pan and zoom take their canvas-unit path when the camera has no `position` (`PanTool.ts:136-150`, `ZoomTool.ts:446-462`); the base `getViewReference` (`Viewport.ts:2154-2167`) | temporary, to be removed (`:386-389`) | `ViewState`: `setViewState`, `updateViewState`; presentation through `viewportProjection` (`:389-424`) |
| `resetCamera` | the reset of a view (the glue's own use) | a temporary migration name (`:514-519`) | `resetViewState` (`:510-514`) |
| the `Viewport` base class it extends | everything above, through `super` | not named for removal; the guide moves code from concrete classes to capability guards (`:7-15`) | the Generic interface: `setDisplaySets`, `setDisplaySetPresentation`, `setViewState` (`packages/core/src/utilities/viewportCapabilities.ts:119-127`) |

Not named by the guide, and tested by method rather than class: `scroll`, `getImageData`, `getCurrentImageIdIndex`,
`getImageIds`, `hasImageURI`, `canvasToWorld`, `worldToCanvas`, `getZoom`/`setZoom`, `getPan`/`setPan`
(`viewportCapabilities.ts:49-58`, `zoomPanSyncCallback.ts:130-147`). `registerViewportType` is the documented
extension point (`:66-87`).

**When.** No release is named. The guide says "a later breaking release". GitHub's search found no issue or pull
request titled for a 6.0 (2026-11-03, titles only). The tools already route a Generic viewport first
(`voiSyncCallback.ts:63`, `playClip.ts:610-617`). So the lasting form of this glue implements the Generic interface,
which would also let Cornerstone3D's own VOI synchronizer reach it. That was not attempted, and it is an upgrade risk
each major.

### 8 · OHIF without a fork (e)

Read at `v3.14.0-beta.68` (`51e301d`, 2026-10-29), the latest v3 tag; every line below is the same at `v3.13.13`
(`1fa151f`), the latest release, unless noted. OHIF pins Cornerstone3D 5.12.0 at beta.68 and 5.6.8 at 3.13.13
(`extensions/cornerstone/package.json:54` and `:57`). 5.12.0's build exports `registerViewportType` and calls
`customRenderViewportToCanvas` (`dist/esm/RenderingEngine/ContextPoolRenderingEngine.js:210,233`, from npm). Read, not
run.

**By source: yes, as an extension and a mode, with no fork.**

* **A viewport module of ours.** An extension may return any React component from `getViewportModule`
  (`platform/core/src/extensions/ExtensionManager.ts:47`), as `dicom-pdf` does with a viewport that is not
  Cornerstone3D's (`extensions/dicom-pdf/src/index.tsx:31-37`). A mode routes display sets to that viewport by
  namespace (`modes/basic/src/index.tsx:284-285`). OHIF's closed list of viewport types
  (`getCornerstoneViewportType.ts:56,85`) applies only to its own Cornerstone viewport, which ours would not use.
  §3's "needs a fork" read that list as the only door. **Corrected below.**
* **A data source of ours.** `dataSourcesModule` is an extension module type (`MODULE_TYPES.js:5`,
  `ExtensionManager.ts:314`). Ours would answer the study and series queries from our metadata, and a SOP class
  handler of ours (`:50`) would make the display sets our viewport takes.
* **OHIF's tools on our viewport.** Its tool groups take any viewport id and rendering engine
  (`ToolGroupService.ts:171-193`), so the toolbar's length, angle, probe and window reach our viewport as in §5.

**What it does not give without more glue.**

* OHIF's commands that act on "the viewport" (presets, reset, flip, its cine) find it through
  `getCornerstoneViewport`, which answers only viewports OHIF created (`CornerstoneViewportService.ts:631-636`;
  3.13.13 `:599-604`). Ours is not among them.
* Its measurement panel maps each annotation to a DICOM instance through `metaData.get('instance', imageId)`
  (`utils/measurementServiceMappings/utils/getSOPInstanceAttributes.js:58-64`). Our data source would have to give
  every frame Study, Series and SOP Instance UIDs, which the ingest does not carry (`dicom_series.py:133-160`: no
  identifiers).
* OHIF registers image loaders and a prefetcher for its own schemes. Our image ids must stay on a scheme no loader
  answers, or §5's second download order returns.
* The two inline scripts (§5) must leave the HTML before an extension loads at run time under our policy.

None of this was built. Whether OHIF's layout, hanging protocols and viewport grid accept a viewport module that
holds a worker's canvas (resize, re-mount, unmount) is **open**.

### What option B costs (updated 2026-11-03)

Option B is our viewport inside Cornerstone3D (§2, §5). Each cost is marked as this run leaves it.

**The four costs.**

1. **Cine and linked views are ours to build; Cornerstone3D's run on the page.** *Verified, by test and source, and
   smaller than drawn.* `playClip` refuses our class (`playClip.ts:580-619`). Our cine on the view worker's clock is
   about 20 lines of the glue (§5). Linked zoom and pan come free: Cornerstone3D's own synchronizer falls back to
   `getZoom` and `getPan` (`zoomPanSyncCallback.ts:130-147`). Linked window is one callback of ours on its
   synchronizer (§5).
2. **Annotations can lag the image by a frame.** *Verified, by test, indicative* (SwiftShader, idle page): one frame
   apart, the annotation leading in a pan and trailing in a scroll (§5). A busy page is not measured.
3. **Methods Cornerstone3D says it will remove, an upgrade risk each major.** *Verified, by source* (§7):
   `getProperties`/`setProperties`, `getCamera`/`setCamera` and `resetCamera`, "in a later breaking release". No
   release is named. The Generic interface replaces them, and was not attempted.
4. **~~OHIF cannot take the viewport without a fork.~~** *Retracted, by source* (§8): an extension's viewport module, a
   data source and a mode of ours can host it, and OHIF's tool groups reach it. **Open, by test:** none of it was
   built, and OHIF's commands, measurement panel and grid need more glue.

**The three data-side risks.**

5. **Cornerstone3D's image cache and stack prefetch against our download order.** *Verified, by test:* no load and
   nothing cached through every tool. But `stackPrefetch`, if enabled on our viewport, queues every other slice (23 of
   23) on Cornerstone3D's loader: a second order. Our page must not enable it, and under OHIF our image ids must stay
   on a scheme no loader answers.
6. **The metadata its tools expect.** *Verified, by test, for the tools tried:* nothing from a metadata provider. The
   viewport needs each frame's width, height and pixel spacing, and the ingest carries no spacing or frame of
   reference. OHIF's measurement panel would also need instance UIDs, which the ingest does not carry. *Open:* the US
   probe's regions and the SUV path.
7. **With OHIF, its inline scripts and service worker against COOP/COEP and our policy.** *Verified, by test, OHIF
   unchanged at v3.14.0-beta.68:* it boots cross-origin isolated under our headers. Its two inline scripts are
   refused, which breaks run-time extension loading until they move to a file. Its service worker never registers in
   a page (by source).

**Found on the way, and not in the owner's list:** a defect in the core's controller that stops all painting after a
display change before the first frame (§5, fix proposed). Also, Cornerstone3D opens nine WebGL2 contexts on the page
under option B, though none of them paints.

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
* **A viewport type of ours, beyond the spike** (§A seam for our painter inside Cornerstone3D): ~~the probe under the view worker, the cine, synchronizers or the
  Generic viewport's interface, the overlay against the image in time,~~ Firefox, a GPU, DPR 2, any VOI function but
  LINEAR_EXACT, the Generic viewport's interface, the phone run (§6). *The struck items were done on our core,
  2026-11-03 (§5).*
* **The glue line counts are estimates**, as are the 1 000–1 500 lines of the own option. No shipped bundle size or
  first image was measured for any option.
