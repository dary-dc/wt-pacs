# Viewer architecture: the options worth carrying, and the spike that decides

Written 2026-10-27, from [`integration.md`](integration.md), [`survey.md`](survey.md) and requirements.md (on branch
`claude/viewer-requirements`, not merged; its feature names are used below). Nothing was built or run for this file:
every number in it is quoted from those documents or is a prediction, and says which. The evaluation (§The spike) is
pre-registered, and it is not run.

## Three options, one dropped

Integration ranks four fits (integration.md §The ranking). Three are carried, because each can win under a
condition the spike can test or the owner can set:

* **A. Our own viewer on today's client.** It wins if the decided bit-exactness has to reach the screen.
* **B. Cornerstone3D under our page.** It wins if the owner accepts a proved bound in place of equality on screen,
  and its paint is fast enough.
* **C. OHIF v3 on Cornerstone3D.** It wins over B only if B passes and the owner wants a whole application more than
  control of the page.

**VolView is dropped.** Its seam carries whole DICOM files, so a frame would be decoded, re-wrapped and parsed again,
and the path after the re-wrap is unchecked. Nothing in a spike would change that (integration.md §VolView).

**Watched, not carried: B with our painter.** If Cornerstone3D's `registerRenderBackend` lets a backend own its
surface, our paint worker could be that backend, and B would keep the proof. That API is experimental and cannot do
this today (integration.md §Cornerstone3D, *Keeping our painter*). When a release can, B is re-drawn and re-spiked.

## What all three share

The same five stages run in every option up to the decoded frame. They are ours, and none of them changes:
transport, downloader, decoders, frame digest check, consumer ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The
shape). The options differ only after the frame is checked: where it is kept, who paints it, and what draws the UI.

The breast rows are ours to build under every option (survey.md §The three fits). These are: hanging protocols by
attributes, hanging protocols the user defines, view labels, Mammography CAD SR marks, the DBT toggle, and the
ingest's tags. Integration does not estimate their size. Because they are equal across options, they do not decide
between them, except where an option makes one harder (named per option below).

## A. Our own viewer on today's client

```
SERVER ══ WebTransport ══► DOWNLOADER (worker) ── coded ──► DECODERS (N workers)
                                                             decode, then verify (frame digest)
                                                                │ SAB, written once
                    ┌───────────────────────────────────────────┘
                    ▼
   PAINT WORKER (B′) or page Map (A of frame-path)    ◄── OPFS store worker (proposed)
     store: a window around the current index
     WebGL2, R16UI texture, window in the shader, one canvas per viewport
                    │ OffscreenCanvas
                    ▼
   PAGE: layout, hanging, overlays (labels, CAD marks, ruler), input; ~100 B of metadata a frame
```

**Ours:** all of it. **Theirs:** nothing beyond the decoders' libraries (OpenJPH, dav1d), which we already carry.

**Free:** nothing new. The client already has the window with LINEAR and SIGMOID, the adjustment that keeps the
function, invert, interpolated zoom, manual scrolling, and lossless pixels for mammography (requirements.md, *Of
these, the client has today*). The painter can already do 1:1 pixels, no processing; the viewer lacks the mode.

**We build:** everything else in the required set. Beyond the breast rows, this is what Cornerstone3D would have
given: layouts, linked scrolling, zoom and pan, distance and angle, the ruler, pixel value at the cursor,
annotations that can be turned off, and the cine controls. Several grey rows go into the painter's table, so the
proof grows with them: the VOI LUT Sequence, background air not windowed, PALETTE COLOR, and the GSDF (integration.md
§Our own viewer).

**Code size:** about 1 000–1 500 lines for what Cornerstone3D would give, on top of the shared breast rows. This is
integration's guess.

**Kept for native:** the painter's shader and its proof. Native §2 ports the R16UI texture with in-shader bilinear
unchanged, and M1 runs the same cells against the same reference
([`../native/README.md`](../native/README.md) §2, §6). The store's rules are the native cache's rules (§3 there). The
page's JavaScript carries only under the Tauri shape (§4 there). Under any other shape it is rewritten, so the spec
that carries is in its tests, not its code.

**Licence and regulation:** MIT, ours. It adds no third-party code to the device, so nothing new to list or track.

**Risks:** time, because it is the most code. The 1:1 proof is exact only at zoom 1. At fractional zooms it is
bounded on SwiftShader, and the GPU run is still owed ([`../../client/paint/README.md`](../../client/paint/README.md)
§What is proved). The scroll rate on a GPU is not measured: on SwiftShader one 4096×3072 frame paints in 211 ms
(same file, §What it costs). Every UI convention (tooltips, keyboard, accessibility) is ours to get right.

## B. Cornerstone3D under our page

```
SERVER ══► DOWNLOADER ──► DECODERS: decode, verify ──► SAB ──► consumer (page)
                                                                  │
   our store (page Map, or frame-path A's store worker; B′ is lost)
                                                                  │ Uint16Array over the SAB, by reference
   our imageLoader 'wtp:' + metadata provider ──► Cornerstone3D cache (LRU, sized to our window)
                                                                  │ copied into vtkImageData at each image change
   vtk.js WebGL2 on the PAGE thread, 1 024-entry 8-bit VOI table, NEAREST at 1:1 ──► drawImage to each viewport
                                                                  │
   tools and annotation (SVG), synchronizers, our overlays ──► PAGE
```

**Ours:** the shared five stages, the loader, the metadata provider, the page, and the store as the source of
truth. **Theirs:** the viewports, the render path, the tools, the annotation state and the synchronizers (MIT), and
vtk.js (BSD-3-Clause).

**Free:** breast justified to the viewport edge, 1:1 pixels (but not our paint), the ruler, distance in the right
units, angle, pixel value at the cursor, linked scrolling and zoom, scroll and cine with loop and sweep, and
annotations that can be turned off. **We build:** layouts, shutters, rotate and flip only for DX and CR, orientation
labels, and the breast rows. **Harder here:** the VOI LUT Sequence is applied on the CPU fallback only, SIGMOID is
sampled into 1 024 nodes, and the cine can skip a frame, so the "no slice skipped" row needs our own scroll driver
(integration.md §The required set, per option).

**Code size:** about 450 lines of glue, on top of the shared breast rows. This is integration's estimate.

**Kept for native:** the shared five stages, as under A. The viewer layer is Cornerstone3D in a page. A native app
keeps it only as a web view (Tauri), and there the native painter cannot sit under the web view on Wayland, iOS or
Android ([`../native/README.md`](../native/README.md) §4). So a native viewer is a second viewer, not a port, and it
starts without a proof to port.

**Licence and regulation:** MIT and BSD-3, with notices carried. Cornerstone3D states no clearance (survey.md §In
depth), and clearance is our gate under every option (requirements.md §Authority). Every third-party library in the
device must be listed, and its defects tracked by us. Under B that adds Cornerstone3D and vtk.js, which move by
majors. The device-lifecycle standard that names this (IEC 62304) was not read for this row.

**Risks:**

* **Exactness.** The paint is not ours, and it cannot be byte-exact by construction (integration.md §Cornerstone3D,
  *render*).
* **The page.** The page goes back into the pixel path, so frame-path's B′ is lost, and cine runs on a page timer.
* **Copies.** Each image change copies the frame, which is 25 MB for a 4096×3072 frame.
* **Upgrades.** There were four majors in two years, and the 5.x stack viewport sits behind a migration layer.
* **Size.** The shipped bundle size is not known.

## C. OHIF v3 on Cornerstone3D

```
ingest or server ──► DICOM JSON document per study (identity, laterality, view codes; url = 'wtp:<series>/<index>')
                         │
OHIF data source ──► display sets ──► hanging protocol engine (hpMammo, reworked) ──► viewports
                         │ imageIds 'wtp:…'
   the pixel path from our consumer to the screen is B's, at Cornerstone3D 5.6.8
                         │
   React application: study list, toolbar, measurement panel, its own page and service worker
```

**Ours:** what B has, plus an extension, the app config, and the per-study document. **Theirs:** what B has, plus the
application.

**Free:** what B gives, plus the window always shown, CT presets, orientation labels, layouts with thumbnails, and a
hanging protocol engine. **We build:** what B builds, less layouts and orientation labels. `hpMammo` matches on
Series Description, which IHE forbids, so it must be reworked. OHIF reads SR as TID 1500 only, so the CAD SR handler
for TID 4000 is ours.

**Code size:** about 350 lines of glue, plus a fork of a Yarn monorepo (integration's estimate). The fork's upkeep
is not counted in lines.

**Kept for native:** as B.

**Licence and regulation:** MIT. The application states it is not cleared (survey.md §In depth). Its inline scripts
need CSP hashes, and it registers a service worker. That is more surface for the security row to review.

**Risks:** everything B carries, and also:

* **Upgrades.** It pins Cornerstone3D behind the latest release (5.6.8 against 5.13.2), so each OHIF release is also
  a Cornerstone3D jump.
* **Control of the page.** Its policy, its preloads, and an opening fill that starts before its scripts run are no
  longer ours.
* **Prefetch.** Its own prefetcher issues loads, and our loader must answer them from the fill.

## The spike

**One pre-registered spike per option.** Each is throwaway, in `lab/viewer-spike/<option>/`, and deleted once the
decision is recorded. It builds only what the five metrics need. Its predictions and its rule are those below,
fixed before any of it is written.

**What is built.**

* **The runner, shared by all three options.** It starts a `series-server`, the relay
  (`link_impair.py --self-timing`) and headless Chromium for each visit, as total-time does
  ([`../../lab/av1/delivery/total-time/README.md`](../../lab/av1/delivery/total-time/README.md)). Each option's page
  exposes one object to the runner: the first exact image's time, the readback of a viewport, a scripted scroll, and
  memory.
* **A.** Today's viewer, with two changes: a 1:1 mode (`view()` without `fit`), and a 2×2 layout of four canvases
  held by one paint worker, as frame-path §3 proposes ([`../adr/frame-path.md`](../adr/frame-path.md)).
* **B.** A page that uses the downloader and consumer as they are. It adds a `wtp:` image loader, a metadata
  provider, one stack viewport per view, and `displayArea` SCALE 1 for 1:1. It is bundled by one bundler, with the
  lockfile kept in the spike directory.
* **C.** OHIF at `v3.13.13`, with an extension that registers B's loader unchanged. It reads two hand-written DICOM
  JSON documents, whose view attributes are copied from the source headers, because the ingest does not carry them
  (requirements.md §Open, *Identity*). `hpMammo` is switched on for the four-view study. C is built only if B passes
  the exactness gate, or once the owner has set a bound (§The rule). C's paint is B's, so it cannot pass a gate that B
  fails.

**Cells.**

* **Series** ([`../FIXTURES.md`](../FIXTURES.md) §AV1 data), made into bundles by the ingest, HTJ2K only. The codec
  does not differ between options.
  * DBT: `dbts_b1`, 50 × 2560×3328, 10-bit. It is the largest series that file names.
  * Four-view mammography: `ffdm_d`, 4 × 3328×4096, 12-bit, served as one series of four frames.
* **Links.**
  * Clean loopback.
  * The relay at 20 Mbit with 2 % iid loss: total-time's `r20000` (40 ms round trip, a 200-packet queue), plus
    `--loss 2`.
* **Order.** The options run interleaved in a Williams order each round (`lab/order.mjs`). A cell needs at least 10
  kept pairs, and a visit whose relay prints `VOID` is dropped.
* **Browser.** Headless Chromium 141 on SwiftShader, three decoders.
* **Scroll** runs on loopback only. Every frame is resident by then, so the link plays no part.

**The gate, measured first.**

* Every frame is exact.
* The readback at 1:1 is compared with `client/paint/reference.js`, at the image's first window and at identity. It
  covers frames 0, 25 and 49 of the DBT series and all four views. It records the worst |Δ| and how many samples
  differ.

**The metrics.**

| metric | how |
| --- | --- |
| time to first exact image | From navigation to the completed paint of a checked frame: A's painter acknowledgement, or B and C's `IMAGE_RENDERED`. For the four-view study, it is the last of the four. |
| scroll rate on DBT at 1:1 | Three sweeps of the 50 slices (forward, back, forward). Each step is issued once the previous frame has rendered, so no slice is skipped by design. Records frames per second, and checks that every index rendered once, in order. |
| page memory | `measureUserAgentSpecificMemory` after the fill and the scroll, minus the decoded bytes, as the viewer ceiling run measured it ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Open). |
| page-open cost | The bytes, gzipped, fetched before the first exact image, counted as `lab/page-open` counts them. Also the main thread's long-task milliseconds over the same span. |
| glue lines | The non-blank, non-comment lines in the option's spike directory. Lockfiles, vendored code and the shared runner are not counted. |

**Mutants, each to be caught by name before any timing.**

* One sample altered in the decoder: not every frame exact.
* The paint offset by one row in each option: worst |Δ| above 0.
* One scroll step that does not wait for the render: an index skipped.

**Where the host saturates.**

* The container has no GPU. Scroll rate and paint cost on SwiftShader only show a direction: the GPU host reruns
  them, as native §6 asks of its own rows.
* `requestAnimationFrame` caps scrolling at 60 frames per second, so nothing above that is claimed.
* The relay's limits are in [`../rig-limits.md`](../rig-limits.md).

**Predictions, fixed now.**

* **P1, exactness.**
  * A: worst |Δ| = 0 in every readback.
  * B and C: worst |Δ| ≥ 1 on `ffdm_d` at both windows. Both windows span more than 1 024 codes, so adjacent codes
    share a table entry.
  * On `dbts_b1` at identity (1 024 codes), B and C differ by at most 1, from rounding only.
* **P2, time to first exact image.**
  * On loopback: B ≥ A + 100 ms, and C ≥ B + 300 ms.
  * At 20 Mbit with 2 % loss: A and B within ±10 % of each other, because the wire binds.
* **P3, scroll rate.**
  * On SwiftShader: A below 10 frames per second on `dbts_b1`, extrapolated from 211 ms for a 4096×3072 paint.
  * B ≤ 0.8 × A, because B copies 17 MB on the page thread at each step.
* **P4, page memory above decoded.**
  * A: ≤ 2 MiB in the window, plus workers in the measured 17–144 MiB.
  * B and C: at least one frame copy per viewport more. That is +17 MB on DBT and +109 MB on the four-view study.
* **P5, page-open cost.**
  * A: today's 264 845 B, plus under 10 kB.
  * B: at least 300 kB more.
  * C: at least 2 MB more.
  * Both figures for B and C are guesses, since no bundle has been built.
* **P6, glue lines.**
  * A: ≤ 200.
  * B: ≤ 450.
  * C: ≤ 350, not counting the fork.

**The rule.**

1. **The gate.** An option is out under the requirement as decided if any of these fail: every frame exact,
   worst |Δ| = 0 at 1:1, and every DBT index rendered in order.
2. **If only A passes,** A is carried forward. B's worst |Δ| and its count of differing samples go to the owner as the
   price of a bound. If the owner sets a bound, B is judged again on the same data, with the bound in place of
   |Δ| = 0. Nothing is re-run.
3. **B beats A** only if it holds all of the following in every cell. Otherwise A wins.
   * Time to first exact image ≤ 1.2 × A's.
   * Scroll rate ≥ 0.8 × A's.
   * Memory above decoded ≤ A's, plus one frame per viewport, plus 64 MiB.
   * Page open ≤ A's + 1 MB gzipped.
   * Its glue ≤ 900 lines: twice integration's estimate, past which its code advantage over A's 1 000–1 500 lines is
     gone.

   A wins ties, because only A keeps B′ and the native painter.
4. **C beats B** only if it holds rule 3 against A, and the owner wants the application shell (the study list and the
   hanging protocol UI). The spike cannot price that, so it records C's numbers and hands the choice to the owner.

## For the owner

* **Whether bit-exactness reaches the screen, or stops at the decoded frame.** This decides more than the spike does.
  If it reaches the screen, rule 2 is likely to end the evaluation at A, and P1 tests exactly that.
* **Whether to run the spike, or take A on integration's reading.** The spike's cost is three small pages and one
  runner. What it buys is P1 measured rather than read, and B's price in numbers if the owner wants a bound.
* **The thresholds in rule 3,** which are this file's proposal.
