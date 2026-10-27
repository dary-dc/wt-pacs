# Existing viewers: which could carry a diagnostic 2D reader

Read 2026-10-27 from each project's source at the tag in §Sources and from its own docs. Nothing was built or run, so every
statement about behaviour is a reading of code, and none is measured. What we have is
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) and [`../CLIENTS.md`](../CLIENTS.md). The painter's proof is
[`../../client/paint/README.md`](../../client/paint/README.md). The requirements are not written here.

## The three fits

No open viewer meets the breast feature bar (§The feature bar). The work for mammography hanging, DBT and CAD SR marks
is ours whichever viewer we choose. The licence rules out two of the five in-depth candidates: dwv is GPL-3.0, and
Stone is AGPLv3+ with an LGPLv3+ library. Of the three that remain:

1. **Cornerstone3D as a library, under our own page** (MIT). It brings viewports, tools, annotation and touch, and
   needs nothing else from us. Our downloader, decoders and frame digest check stay, behind a `registerImageLoader`
   scheme that hands it our decoded frames. **We lose the painter's 1:1 proof.** Its stack path copies each frame into
   a vtk.js image on every image change. It samples 16 bits as normalized floats, interpolates linearly by default,
   and windows through an 8-bit colour texture. Its experimental `registerRenderBackend` might let us keep our own
   painter, but its docs say it is "not fully functional yet".
2. **OHIF v3, the application on Cornerstone3D** (MIT). It adds what (1) leaves to us: a study list, a hanging
   protocol engine, SR, measurements and a UI, plus a mammography protocol, `@ohif/hpMammo`. That protocol matches
   views partly on `SeriesDescription` text, which IHE forbids. It is off by default. OHIF does not read Mammography
   CAD SR. It loses what (1) loses. On top of that it is a whole application to keep up with, and it runs behind
   Cornerstone3D's releases (it pins 5.6.8 against the latest 5.13.2).
3. **VolView** (Apache-2.0), a distant third. It has a transport seam, a `Fetcher` on a data source, but that seam
   must deliver whole DICOM files, so our frame transport would carry the wrong unit. It copies the decoded result
   into its volume. It has no breast features and, in its own WASM, no HTJ2K decoder. One person committed to it in
   the last six months.

Under (1) and (2) our transport, decoders and frame digest check are kept as they are. What is lost is the exact
paint: the step from the SAB frame to the screen, and the proof that holds it. Keeping that, or proving their paint
path to the same bar, is the question an adoption decision turns on (§What each would cost).

## Sources

| project | tag (commit) | tag date |
| --- | --- | --- |
| OHIF/Viewers | `v3.13.13` (`1fa151f5`) | 2026-10-16 |
| cornerstonejs/cornerstone3D | `v5.13.2` (`2adf417c`); `v5.6.8` (`fe3a8e99`), the one OHIF pins | 2026-10-23; 2026-07-19 |
| cornerstonejs/codecs | no release tag; `main` (`d9eee386`) | 2026-10-14 |
| ivmartel/dwv | `v0.36.4` (`8846eaf9`) | 2026-08-05 |
| Kitware/VolView | `v4.5.3` (`8b027431`) | 2026-10-26 |
| orthanc-stone (Mercurial) | branch `StoneWebViewer-3.0` (`2fde13a7`); Stone releases as branches | 2025-12-03 |

Activity counts commits on the default branch from 2026-04-27 to 2026-10-27. Authors are counted by distinct
e-mail, without bots. An npm unpacked size is not a shipped size, since a package carries maps and several builds.
No project here was built, so no shipped size is known.

## In depth

| | OHIF v3 | Cornerstone3D | dwv | VolView | Stone Web Viewer |
| --- | --- | --- | --- | --- | --- |
| licence, quoted | "MIT License" (`LICENSE:1`) | "MIT License" (`LICENSE:1`) | "Released under GNU GPL-3.0" (`readme.md:12`) | "Apache License Version 2.0" (`LICENSE:2`) | "licensed under the AGPLv3+ … ./OrthancStone/Sources/ … LGPLv3+" (`README:125-129`) |
| inside an MIT product | yes | yes. Its codecs wrap OpenJPH and OpenJPEG (BSD-2), CharLS (BSD-3), libjpeg-turbo (IJG/BSD-3/zlib) and libjxl (BSD-3). Three of their npm tarballs ship no upstream notice, so we would carry those notices ourselves | **no** | yes, with Apache's NOTICE. The licences of GDCM and its codecs inside its WASM were not checked | **no** |
| stack | React 18, Rspack, Tailwind, Radix (`platform/app/package.json:78,29`) | TypeScript, vtk.js 36 over WebGL2 (`packages/core/package.json:89`) | plain ES modules, Konva (`package.json:17,32-36`) | Vue 3, Vuetify, Pinia, vtk.js, itk-wasm | C++ → WASM (Emscripten), Vue 2.6.14, Bootstrap 3 (`WebAssembly/JavaScriptLibraries.cmake:23-50`) |
| activity | 281 commits (136 a bot), 20 authors | 260 (112 a bot), 26 authors | 821 (253 bots), 4 authors, 561 by one person | 199, 1 author | 117, 1 author; 112 on an open `refactoring` branch |
| maintainers | Open Health Imaging Foundation; NCI grant to MGH (`README.md:348-352`) | the same foundation (`README.md:7`) | Yves Martelli (`package.json:11`) | Kitware | Sébastien Jodogne, UCLouvain (`AUTHORS`) |
| FDA / CE, as stated | "NOT F.D.A. cleared or CE Marked" (`platform/docs/docs/faq/general.md:40-44`) | no statement | "not certified for diagnostic use" (`readme.md:11`) | "not FDA approved for any purpose" (`docs/index.md:21`) | "Not for diagnostic usage" (`WebApplication/index.html:186-187`) |
| where our loader plugs in | a data source (`platform/core/src/DataSources/IWebApiDataSource.js:15-78`) supplies image ids and metadata, never pixels. Pixels come through Cornerstone3D's loader for that id's scheme | `registerImageLoader(scheme, fn)` (`packages/core/src/loaders/imageLoader.ts:719-724`, dispatched at `:128-137`); `addProvider` for metadata; `registerRenderBackend`, experimental (`packages/docs/docs/concepts/cornerstone-core/generic-viewport/render-backends.md:43-84`) | none public: the loader list is a module constant (`src/io/loaderList.js:8-15`). `Image(geometry, buffer)` keeps the buffer it is given (`src/image/image.js:328-331`) | `UriSource.fetcher` (`src/io/import/dataSource.ts:13`; `src/core/streaming/types.ts:41-51`), delivering whole DICOM files; the handler list is fixed (`src/io/import/importDataSources.ts:166-190`) | the C++ `IOracle` (`OrthancStone/Sources/Oracle/IOracle.h:33-47`), so a WASM rebuild |
| our SAB pixels | as Cornerstone3D | no SAB code in core (removed in 2.x, `migration-guides/2x/1-general.md:36-41`); the cache wraps the loader's array (`utilities/VoxelManager.ts:1601-1660`); **the stack viewport copies on each image change** (`RenderingEngine/StackViewport.ts:1906-1921`, `utilities/updateVTKImageDataWithCornerstoneImage.ts:35`, the same at 5.6.8) | kept by reference; progressive loading copies (`image.js:1111-1134`) | copied into the volume (`src/core/streaming/dicomChunkImage.ts:581`) | copied into the WASM heap |
| decoders | as Cornerstone3D | `decodeImageFrameWorker.js:388-511`: RLE, JPEG family, JPEG-LS, J2K, **HTJ2K `.201–.203` by OpenJPH** with sub-resolution decode (`shared/decoders/decodeHTJ2K.ts:85-86`), JPEG XL. **No AV1**; video only through `<video>` (`RenderingEngine/VideoViewport.ts:66,141`) | JPEG baseline and lossless, J2K (pdf.js, 2015), RLE (`src/dicom/dicomParser.js:392-404`); no HTJ2K, no JPEG-LS | GDCM in its `dicom.wasm`: JPEG, JPEG-LS, J2K, RLE; no HTJ2K (by `strings`; the npm `@itk-wasm/image-io` build was not read) | DCMTK JPEG and JPEG-LS (Orthanc's `OrthancFrameworkParameters.cmake:95-96`); no J2K, no HTJ2K |
| rendering | as Cornerstone3D | WebGL2 by vtk.js, a CPU fallback, no WebGPU. 16 bits as **norm16** textures sampled as float, falling back to half-float (`types/Cornerstone3DConfig.ts:11-27`). VOI through a `Uint8ClampedArray` texture built from a Float32 table (`vtkStreamingOpenGLImageResliceMapper.js:327-345`). Interpolation **linear by default** (`StackViewport.ts:921,2004`). No 1:1 claim | Canvas 2D; window on the CPU into an 8-bit table (`src/image/windowLut.js:103-107`); nearest by default (`src/gui/viewLayer.js:206`) | WebGL2 by vtk.js; float window in the shader; linear by default (vtk.js `ImageProperty.js:90`) | WebGL; 16 bits rescaled by min/max into two bytes of an RGB24 texture (`Scene2D/Internals/OpenGLFloatTextureProgram.cpp:66-131`); linear by default (`StoneWebViewer.cpp:4714`) |
| mammography hanging | `@ohif/hpMammo`: CC/MLO 2×2 and current-against-prior CC (`extensions/default/src/hangingprotocols/hpMammo.ts:31-202`). It matches on `ViewCode`, `PatientOrientation` and `SeriesDescription` (`utils/mammoDisplaySetSelector.ts:27-165`), never on Image Laterality. Not on by default (`modes/basic/src/index.tsx:364`) | — | none | none | none |
| DBT | a generic multi-frame stack (`extensions/default/src/getSopClassHandlerModule.js:270-273`) | — | generic enhanced multi-frame | none | none |
| CAD SR (TID 4000) | **no**: the SR extension takes TID 1500 only (`extensions/cornerstone-dicom-sr/src/getSopClassHandlerModule.ts:34-38`) | — | Chest CAD (TID 4100) and TID 1500 only (`src/image/annotationGroupFactory.js:238-258`) | none | a text report only (`OrthancStone/Sources/StoneEnumerations.cpp:88-90`) |
| mobile | 2-finger zoom, 3-finger scroll (`modes/basic/src/initToolGroups.ts:32,36`); no phone layout stated | touch events (`packages/tools/src/enums/Events.ts:360-366`); `isMobile` (`packages/core/src/init.ts:136-137`) | pinch zoom (`src/tools/zoomPan.js:126,181`); "laptop, tablet, phone" (`readme.md:3`) | "from the one on your phone" (`docs/index.md:17`) | pinch and pan since 3.0 (`NEWS:9`) |
| npm unpacked | `@ohif/app` `dist`, 213 MB | core 2.2 MB, tools 3.4, loader 0.3, codecs 0.4–3.8 each, vtk.js 14.9 | 7.1 MB | 101 MB | not on npm |
| accessibility | a Radix-based UI described as "offering … accessibility" (`platform/docs/docs/migration-guide/3p9-to-3p10/3-UI/1-Introduction.md:12`); no WCAG claim | none stated | none stated | none stated | none; no `aria-` in `index.html` |

## One line each

| project | licence, quoted | last tag | activity | for our target |
| --- | --- | --- | --- | --- |
| BlueLight | "MIT License" (`bluelight@v1.1.0 LICENSE:1`) | v1.1.0, 2026-01-25 | 34, 1 author | a mammography 4-up keyed on MLO (`bluelight/scripts/plugin/AutoOperation.js:90,104`); its CAD SR branch is empty (`scripts/viewer.js:790`); CPU, 8-bit (`scripts/viewport.js:483`) |
| dicom.ts | "MIT License" (`dicom.ts@v1.3.0 LICENSE.md:2`) | v1.3.0, 2025-03-04 | 0 | WebGL1, 16 bits as byte pairs recombined in the shader (`src/decoder/Decoder.ts:53`); greyscale single-frame only (`README.md:5`) |
| dcmjs-imaging | "The MIT License (MIT)" (`dcmjs-imaging@v0.2.6 LICENSE.txt:1`) | v0.2.6, 2026-10-20 | 2, 1 author | a CPU renderer to RGBA8 (`README.md:28-29`), no viewer |
| NiiVue | "BSD 2-Clause License" (`@niivue/niivue-v0.69.0 LICENSE:1`) | 2026-05-20 | 30, 7 authors | R16I/R16UI textures (`packages/niivue/src/niivue/data/VolumeTexture.ts:182,195`); DICOM only by conversion to NIfTI (`packages/dicom-loader/README.md:3`); neuro volumes |
| Papaya | "THIS PRODUCT IS NOT FOR CLINICAL USE" (`papaya@v0.8 LICENSE:1-4`) | v0.8, 2015-07-27 | 0 | dormant |
| cornerstone (legacy) | "The MIT License (MIT)" (`cornerstone@v2.6.1 LICENSE:1`) | v2.6.1, 2021-11-19 | 0 | superseded by Cornerstone3D |
| newer, npm only | — | — | — | `@opdicom/core` and `@omniradiology/omnirad` wrap Cornerstone3D. `@lunit/insight-viewer` sits on legacy cornerstone, and its repository is not public. GitHub was not searched |
| Weasis (desktop) | "Eclipse Public License 2.0 … or the Apache License, Version 2.0" (`Weasis@v4.7.3 LICENSE:1-3`) | v4.7.3, 2026-08-25 | 304, 10 authors | Java desktop; "not a certified medical device (CE or FDA)" (`weasis-launcher/src/main/java/org/weasis/launcher/messages.properties:6`); no hanging protocol engine; DBT and Mammography CAD SR storage commented out (`weasis-distributions/resources/store-tcs.properties:159,312`) |
| Horos (desktop) | LGPL v3 (`horos@2a13050 LICENSE:6-7`) | Horos_2.0.2, 2016 | 0 | macOS only; the README builds a fork (`README.md:11`) |
| AlizaMS (desktop) | "GNU GENERAL PUBLIC LICENSE Version 3" (`AlizaMS@v1.10.3 LICENSE:1-2`) | v1.10.3, 2026-08-19 | 184, 2 authors | GPL; HTJ2K, SR (`README.md:58-59`); no mammography hanging found |
| 3D Slicer (desktop) | "a BSD style license, with extensions" (`Slicer@v5.12.4 License.txt:6`) | v5.12.4, 2026-09-08 | 711, 58 authors | "research purposes only … not … approved by the Food and Drug Administration" (`License.txt:147-150`); a volume workstation |

## The feature bar

The firmest public bar is IHE RAD TF-2 Rev 23.0 (2025-08-08): §4.16.4.2.2.1.1 for mammography display and
§4.16.4.2.2.1.3 for DBT. The sections are cited here, not restated. Commercial documents match that bar where they
can be read. MedDream's mammography page lists hanging of current and prior CC/MLO, quadrant zoom, left/right align
and lock, CAD SR marks with show/hide, DBT scrolling and a MIP from DBT. Unifi lists magnify, invert, sizing modes,
cine and linked datasets (510(k) K190694). Visage's press material lists multiple magnifiers, slab thickness while
scrolling, and placeholders for missing views. CAD vendors leave the display to the viewer: Transpara K241831 sends
"a standardized mammography CAD DICOM format", and its user interface "is to be provided by third parties".

**Regulatory facts that bear on a browser reader**, from FDA 510(k) summaries read on accessdata.fda.gov:

* Web viewers have been cleared with a mammography and DBT indication: Prima K140960 (hosted web), NilRead K150415
  (zero-footprint), MedDream K222320 (HTML5) and GE's ZFP K131977 (HTML5).
* Every one of them excludes lossy-compressed mammograms from primary reading.
* Each requires an FDA-cleared mammography monitor (Hologic, NilRead) or one that meets local regulations (GE).
* None allows diagnosis on mobile. NilRead: "On mobile platforms, this device is not intended for diagnostic use".
  MedDream: "mobile device display of mammographic images are not intended for diagnostic purposes". Visage Ease
  Pro K142196 excludes mammography and DBT outright.
* No open project in this survey states a clearance (§In depth, FDA / CE).

## What each would cost

**What stays ours under any adoption:** the transport, the downloader, the decoders and the frame digest check. Under
Cornerstone3D and OHIF the loader seam sits after decode, so a frame reaches it already checked; VolView decodes
itself. Cornerstone3D's own HTJ2K path
(OpenJPH) is the one place it could replace our decoder. That would bypass the check, and it does not cover AV1.

| | Cornerstone3D under our page | OHIF v3 | VolView |
| --- | --- | --- | --- |
| replaces of ours | the painter; tools, annotation, viewport state we have not built | the painter, the viewer page; study list, hanging, SR, measurement we have not built | the painter, the page |
| we lose | the 1:1 proof; zero-copy to the GPU (one copy per image change); integer-texture sampling | the same, and control of the page | the same, and frame-by-frame transport: it wants whole DICOM files |
| to adopt (unmeasured) | a loader for our scheme and a metadata provider; NEAREST and a proof of its paint path against `client/paint/reference.js`, or a render backend once that API settles; mammography hanging, DBT, CAD SR ourselves | the same loader, plus a data source that emits our scheme's ids; rework of `hpMammo` to IHE's attributes; a CAD SR (TID 4000) handler; DBT | a `Fetcher` over our transport that rebuilds DICOM files; every breast feature; an HTJ2K decoder |
| to keep | a library whose majors move (OHIF still pins 5.6.8 against 5.13.2); 26 authors, about four of them core | an application on that library, which follows it late | one maintainer |

**Open.** Whether a SAB-backed frame survives Cornerstone3D end to end. How far `registerRenderBackend` works beyond
its docs. Whether Cornerstone3D with NEAREST and norm16 can be proved byte-exact against our reference. Shipped bundle
sizes. Each of these needs a run, and none was made.
