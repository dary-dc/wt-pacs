# The viewer product

A complete 2D DICOM viewer for diagnostic reading. Breast imaging comes first: FFDM and synthesized 2D, DBT slices,
breast ultrasound stills and cine, and ABUS. Other 2D follows: CR/DX, CT and MR read slice by slice, US, and XA/RF
runs. It targets desktop and mobile on lossy wireless. Pixels are lossless and bit-exact, and there is no
low-resolution preview; both are decided. This line of work is kept apart from the current client
([`../ARCHITECTURE.md`](../ARCHITECTURE.md), [`../../client/README.md`](../../client/README.md)), which supplies its
transport, decode, cache and paint.

| file | |
| --- | --- |
| [`requirements.md`](requirements.md) | what the viewer must do and what is nice to have, on what authority, and what the client has today |
| [`survey.md`](survey.md) | the open viewers, read at pinned tags |
| [`integration.md`](integration.md) | how our base plugs into each, and the seam for our painter inside Cornerstone3D |
| [`architecture.md`](architecture.md) | the options carried, and the spike that decides between them |

## What is verified

Every claim these files make about Cornerstone3D, OHIF and the seam, as of 2026-11-03. *Test*: a check in
`lab/viewer-spike/` that passed and whose mutant was seen to fail. *Source*: read at the pinned release, file:line in
the section named. *Open*: neither. A bare §*n* is [`integration.md`](integration.md) §A seam for our painter inside Cornerstone3D, §*n*.

| claim | where | status |
| --- | --- | --- |
| Cornerstone3D paints every viewport it ships in one `requestAnimationFrame` of the page; nothing in it transfers a canvas to a worker | integration §A seam, §1 | source, 5.14.0 / 5.13.2 / 5.6.8 |
| OHIF's paint is Cornerstone3D's, on the page | integration §A seam, §1 | source, v3.13.13 |
| Its standard path cannot be byte-exact: a 1 024-entry 8-bit table, filter before window, SIGMOID sampled, the VOI LUT Sequence on the CPU only | integration §Cornerstone3D, *render* | source, 5.13.2 and vtk.js 36.4.1; **how far** from ours: open |
| Its stack viewport copies each image into its actor on every image change | integration §Cornerstone3D, *Where pixels enter* | source |
| `registerRenderBackend` cannot give a backend its own surface | integration §A seam, §2 | source, 5.14.0; the roadmap from GitHub titles and bodies only |
| A viewport type of ours, painted by our worker, carries length, probe, window, zoom, pan and scroll | integration §A seam, §4 (synthetic frame), §5 (our core) | test |
| … and angle, per-slice annotations (drawn and restored), and our cine on the view worker's clock | §5 | test |
| … end to end on our transport, decoders, digest check, frame store and view worker, with no frame on the page | §5 | test |
| The probe reads its sample from the view worker after one round trip | §5 | test |
| Cornerstone3D's own zoom-pan synchronizer reaches our viewport; its VOI synchronizer does not; ours is one callback | §5 | test; the fallback by source (`zoomPanSyncCallback.ts:130-147`) |
| `playClip` refuses our viewport, and its clock is a page timer | §2 | source |
| Cornerstone3D asks its loader for nothing and caches nothing under our viewport | §5 | test |
| `stackPrefetch`, if enabled on our viewport, queues every other slice: a second download order | §5 | test |
| The tools tried need nothing from a metadata provider; the viewport needs width, height and pixel spacing | §5 | test |
| The ingest carries no pixel spacing, frame of reference or instance UIDs | §5, §8 | source, core-fold `dicom_series.py` |
| Cornerstone3D under our headers and policy stays cross-origin isolated, with nothing refused | §5 | test |
| Cornerstone3D opens nine WebGL2 contexts on the page under option B | §5 | test (counted); what they cost on a phone: open |
| The annotation and the image are one frame apart: ahead in a pan, behind in a scroll | §5 | test, indicative (SwiftShader, idle page); a busy page: open |
| A display change before the first frame stops the core's controller from painting again | §5 | test (`controller-freeze.test.mjs`); the fix proposed, not applied |
| The methods the glue relies on that Cornerstone3D will remove: `getProperties`/`setProperties`, `getCamera`/`setCamera`, `resetCamera` | §7 | source, 5.14.0; **when**: open, no release named |
| An OHIF extension's viewport module and a data source of ours can host our viewport, with no fork | §8 | source, v3.14.0-beta.68 and v3.13.13; built: open |
| OHIF's own viewport types are a closed list | §3, §8 | source |
| OHIF unchanged boots cross-origin isolated under our headers; our policy refuses its two inline scripts | §5 | test, v3.14.0-beta.68 |
| OHIF's service worker does not register in a page | §5 | source |
| Option A against option B on a phone | §6 | open: protocol written, not run; the desktop proxy is a test, indicative |
| The glue: 212 lines for our viewport on the core (144 on a synthetic frame); about 450 for the standard path | §5, §4; §Cornerstone3D | counted; 450 is an estimate, open |
| Bundle size and page-open cost of either | §Cornerstone3D, *Page open* | open |
| Firefox, a GPU, DPR 2, any VOI function but LINEAR_EXACT, the Generic viewport's interface | §5, §Open | open |
| *Later, not essential:* a long-task profile of OHIF unchanged in typical use, split into rendering and UI work, to replace the core's synthetic busy page | — | open |
