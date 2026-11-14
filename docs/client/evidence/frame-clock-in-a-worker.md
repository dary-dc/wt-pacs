# A frame clock in the view worker

**Question:** Can a dedicated worker keep cine's frame clock?

*Moved 2026-11-14 from `docs/adr/frame-path.md` at `e5b20cba` (§A frame clock in the view worker), word for word but
for queue-row names. A bare §N or §Name is a section of that ADR: [its map](../../adr/frame-path.md) names the file
each now lives in. Choices 1–8 are [the cache's](cache-in-opfs.md#the-choices-and-what-decides-each). The design these
findings shape is [`../design.md`](../design.md).*

## A frame clock in the view worker (2026-10-28)

*Theory and a pre-registered protocol; the harness built 2026-10-30 ([`../../lab/frame-clock/`](../../../lab/frame-clock/README.md)) and smoke-run, nothing timed as a result.* The owner's next client shape: the page holds no
frame; one dedicated **view worker**, started by the page, holds the frame store, a controller and the WebGL2 paint on a
transferred `OffscreenCanvas`. How its frames reach the screen without the page is §2's last bullet; this section asks
only **which clock** the worker can run cine on. Sources are pinned as in §9, plus MDN's compat data and page, all in
[`frame-path-sources.txt`](sources.txt) (2026-10-28 block).

**The standard.** `DedicatedWorkerGlobalScope includes AnimationFrameProvider` (html 133030), callable only when
*supported*: "*provider*'s owner set contains a `Document` object", or a supported worker does (133053–133065) — a
worker the page starts qualifies. The worker event loop runs the callbacks "if … the user agent believes that it would
benefit from having its rendering updated at this time", and "a user agent can determine the rate of rendering in the
dedicated worker" (123527–123551). Nothing ties the rate to the display or to the page's vsync, and there is no
`commit()`: the bitmap is pushed to the placeholder "as part of the `OffscreenCanvas`'s relevant agent's event loop's
update the rendering steps" (76966–76973), and WebGL only requires a flush "Before the drawing buffer is presented for
compositing" (WebGL 1.0 `index.html` 359–363). A worker timer waits "until *milliseconds* milliseconds have passed with
the worker not suspended", then "Optionally, wait a further implementation-defined length of time" (html 130513–130523);
a dedicated worker's `[[CanBlock]]` is true, so `Atomics.wait` is allowed there (137968–137969).

**Per engine, by source** (chromium/src `52c75e5`, mozilla-firefox `54145f3`, WebKit `37be53d`; versions from MDN's
compat data `09b6855`):

| | Chromium | Gecko | WebKit |
| --- | --- | --- | --- |
| (a) worker `requestAnimationFrame` | since 69; "Not supported in nested Web Workers" (BCD `DedicatedWorkerGlobalScope.json` 363–366) | since 99 (BCD 369–370) | since 16.4 (BCD 376–377), `EnabledBySetting=OffscreenCanvasInWorkersEnabled` (`DedicatedWorkerGlobalScope.idl` 49), default `true` on Cocoa, GTK, WPE (`UnifiedWebPreferences.yaml` 4545–4557); WebGL2 on `OffscreenCanvas` since 17 (BCD `OffscreenCanvas.json` 415) |
| its clock | viz BeginFrames on the worker's own sink: `provider->CreateSimpleCompositorFrameSink(` (`begin_frame_provider.cc` 83), the thread raised to `base::ThreadType::kPresentation` (74); the callback time is `args.frame_time - global_scope->TimeOrigin()` (`worker_animation_frame_provider.cc` 72–75). **The display's rate, a vsync time** | vsync over PBackground straight to the worker: `bgChild->SendPVsyncConstructor(mVsyncChild)` (`WorkerScope.cpp` 1127), `RecvNotify` → `scope->OnVsync(aVsync)` (`VsyncWorkerChild.cpp` 47–58), queued at `EventQueuePriority::Vsync` (`VsyncParent.cpp` 42). *Corrected 2026-10-29 (independent review): that priority is the parent's PBackground thread queue, not the worker's; the worker side is not traced.* **The display's rate, a vsync time** | a timer: `m_animationTimer.startOneShot(scheduleDelay)` with `fullSpeedAnimationInterval` (`WorkerAnimationController.cpp` 118–121) = `{ 15_ms }`, "a little more than 60fps" (`RequestAnimationFrameCallback.h` 57–58). **≤ 66.7 Hz, not the display's rate, not on vsync** |
| in step with the page's vsync | predicted: same display, same BeginFrame kind; that the source is the page's not traced | predicted; which `VsyncDispatcher` a worker gets not traced | no |
| (b) busy page | no page thread in the tick path | ticks: none. Visibility reaches the worker from a main-thread listener (`WorkerDocumentListener.cpp` 40–65), so a busy page delays only a hide | none: the timer is the worker's |
| hidden tab | page hidden → `AnimationState::kSuspended` (`html_canvas_element.cc` 1825–1838), posted to the worker; it stops the dispatcher's frames (`canvas_resource_dispatcher.cc` 228). Whether viz stops the worker's rAF BeginFrames is not traced | `if (mFrameRequestManager.IsEmpty() \|\| !mDocumentVisible)` → `TryUnobserve()` (`WorkerScope.cpp` 1187–1193); presentation off while the browsing context is not active (`HTMLCanvasElement.cpp` 1301–1307), the last frame kept (`OffscreenCanvasDisplayHelper.cpp` 268–275) | no visibility check: "FIXME: There's a lot of missing throttling behaviour" (`WorkerAnimationController.cpp` 87); it stops only when the worker is suspended (71–75) |
| canvas off screen | no state for it in the code read | none | none |
| (c) when a WebGL2 frame is presented | in rAF: at the end of the callbacks, `canvas->PushFrameIfNeeded()` with that BeginFrame's ack (`offscreen_canvas.h` 266–278); outside rAF: `SetNeedsBeginFrame(true)` (`offscreen_canvas.cc` 771), pushed on the next BeginFrame (`canvas_resource_dispatcher.cc` 247–266). At most `kMaxPendingCompositorFrames = 2` (`…dispatcher.h` 42); a rAF with too many pending is skipped (`offscreen_canvas.h` 254–257) | on a runnable posted to the worker after the draw (`OffscreenCanvas.cpp` 318–328), into the asynchronous `ImageContainer` (§2) | on a task posted after the draw (`OffscreenCanvas.cpp` 448–457), copied to the layer from the worker (§2) |
| (e) feedback a worker reads | the rAF time (a BeginFrame's); viz's `FrameTimingDetails` reach the dispatcher and are dropped, an unnamed parameter (`canvas_resource_dispatcher.cc` 247–250) | the rAF time (the vsync's) | the rAF time is `performance.now()` at the timer (126–127) |

No engine gives a worker a presentation timestamp or callback; MDN's "will generally match the display refresh rate"
(`requestanimationframe/index.md` 13) holds for Chromium and Gecko, not WebKit.

**(d) Without rAF** (WebKit, or any engine as an arm). Every fallback below runs on the worker's thread, so the page
being busy does not touch it; none is on vsync, so its draws beat against the display.

* **`setTimeout` against a schedule:** the next delay from `performance.now()` to the next due time, so lateness does
  not accumulate; each tick is late by the timer's padding, which the standard allows.
* **A `MessageChannel` loop** posting to itself and drawing when `performance.now()` passes the due time: no timer
  padding, one core spent spinning, which a 4× throttle takes from the decoders' share.
* **`Atomics.wait` with a timeout** on a `SharedArrayBuffer` cell, in slices no longer than one interval: the worker's
  event loop is blocked while it waits, so page messages wait up to one slice.
* **The page's rAF ticks posted to the worker:** vsync-aligned, but the page is back in the path: a 200 ms task stops
  them, which is the clock-on-the-page arm.

In Chromium a draw outside rAF is pushed on the next BeginFrame, so any fallback's frame is shown at the next vsync
after its draw; Gecko and WebKit present it after the task (row (c)).

**Predictions under §7's busy page** (a 200 ms task every 500 ms; *prediction, not measured*):

| clock | Chromium | Gecko | WebKit |
| --- | --- | --- | --- |
| on the page (rAF or `setInterval`) | the frames due in each task: **6 of 15 a period at 30/s, 12 of 30 at 60/s, 40 %**; gap p99 ≈ 200 ms plus one interval | the same | the same |
| worker rAF | **≈ 0** from the page; gap p99 one interval | **≈ 0**; gap p99 one interval | at 30/s ≈ 0 (≤ 15 ms jitter inside a 33 ms interval); at 60/s **~10 %**, quiet or busy alike: 66.7 ticks a second on a 60 Hz display put two draws in ~6–7 display intervals a second, and the first is never shown. *Corrected 2026-10-29 (independent review): ~10 % holds only for ticks exactly 15 ms apart; the period is 15 ms plus the timer's wake latency, which no source gives — late frames are T/P − 1 below 16.7 ms and 1 − T/P above it, so anywhere from ~0 to 11 %* |
| worker `setTimeout` / `MessageChannel` / `Atomics.wait` | ≈ 0 at 30/s; at 60/s a few % where padding moves a draw past a vsync | the same | the same |

At 4× the worker's own per-tick work counts: a 512² paint is 0.34 ms on a GPU (§3), but a 2560×3328 16-bit frame is 17 MB a
`texImage2D`, not measured; if it passes the interval, every arm misses alike and the cell is the host's limit.

**Protocol (pre-registered, not queued; built, not run).** Frames are in the view worker's memory before the clock
starts: no network, no decode. Each frame is uploaded on its tick, as the paint worker does today.

* **Cells:** {a 512×512 16-bit series of 76 frames, 12 frames of 2560×3328 16-bit} × {30, 60 frames/s} × {quiet page,
  §7's busy page} × {1×, 4× (`lab/scripts/cpu_throttle.mjs`, every thread)} × {Chromium, Firefox} = 32. WebKit only if
  its container has one: **this container has none, and no Firefox either** (only Chromium under `/opt/pw-browsers`);
  the run row installs Firefox. *Amended before any data (2026-10-30): Playwright's own Firefox 155 is installed beside
  Chromium 153, and runs headed under `xvfb-run`; headless Firefox gives a worker no WebGL2 context.*
* **Arms, interleaved by `lab/order.mjs`:** `page-raf` (the reference: the page's rAF posts each tick to the worker),
  `page-raf′` (its A/A copy), `page-interval` (today's cine, a page `setInterval`), `worker-raf` (Chromium, Firefox,
  WebKit when present), `worker-timeout`, `worker-channel`, `worker-wait`. Seven units: `order()`'s period is 14
  rounds, so **14 rounds**, 10 s of cine each (20 busy periods); each arm's settings printed.
* **Measure, per run:** frame *i* is due at t₀ + *i*·T (*t₀ amended below*). It is **presented on its tick** if it is drawn in
  [due, due + T) and is not superseded before the display shows it. Chromium: presentation read from a CDP trace of
  the worker's frame sink. *Amended below, before any data: from the draw log in every engine.* Firefox and WebKit: the worker's draw log alone (tick time, index, draw end), a frame
  counted superseded when the next draw falls in the same display interval; **claims there are from draws, not
  presentation**, and say so. *Independent review (2026-10-29): only `worker-raf` logs a vsync time there; for the other
  arms the display interval's phase is not in the draw log, so it must be logged or the count bounded above by draws
  closer than one interval.* Reported: **frames not presented on their tick** (count and % of frames due) and the
  **gap p99** between successive presented (or drawn) frames.
* **Guards:** the long task's measured length is printed (≥ 200 ms each, or the run is void); the throttle is checked
  with `cpu_throttle.mjs --check`; the worker's draw time p99 is printed, and **a cell whose reference arm's draw p99
  exceeds T/2 is where the host saturates: it is reported and nothing is claimed in it**.
* **VOID:** a cell is VOID when `page-raf` and `page-raf′` differ by more than **2 % of frames due** (median of the
  per-round differences) or by **≥ 16.7 ms in gap p99**. A VOID cell is a design error, not one to re-run with more
  rounds (`../rig-limits.md`).

**Amended before any data (2026-10-30), while building the harness.** The smoke rounds below are not data; each
change is forced by the harness or by the review, and the original text above is kept.

* **Every arm shows the frame due at its tick,** `floor((tick − t₀) / T)`, once, `page-interval` included. Today's cine
  steps one frame a tick (`client/view/view.js`); after a 200 ms task that counts every later frame late, so the arms
  would differ in stepping, not in clock, and the 40 % above already assumes frames skipped, not delayed.
* **t₀ sits half a display interval before a vsync,** projected from a second worker's `requestAnimationFrame` that
  paints nothing (`lab/frame-clock/phase.js`). With t₀ at an arbitrary phase, a vsync-locked clock whose paint is
  longer than the rest of the interval is late on every frame: the first smoke round's A/A pair differed by tens of
  points from the phase alone. With t₀ on a vsync, a display a hair off 60 Hz moved a vsync across the due times
  within one run. Mid-interval leaves half an interval of drift.
* **Presentation is scored from the draw log against that worker's vsync log in Chromium and Firefox alike,** not from a
  CDP trace: no trace event of the worker's frame sink was named (independent review), and the second worker gives the
  vsync phase every arm needs (the review's gap above). A frame is superseded when a later paint ends before the first
  vsync after its own. **The claims are from draws, not presentation, in every engine,** and say so. In WebKit the
  worker's rAF is a timer (row (a)), so it gives no phase there; the bound by paints closer than one interval applies.
* **The guards read medians over rounds:** a cell is saturated when `page-raf`'s draw p99, median over rounds, exceeds
  T/2; the rule's gap p99 ≤ 2T is the median over rounds. The text did not say which.

**What a container can and cannot claim.** This container has 4 cores, no display and no GPU: Chromium paints on
SwiftShader with headless Chromium's own BeginFrame source, Firefox on llvmpipe under Xvfb's vsync. So:

* **every WebKit cell needs a WebKit**, and its claim is for Safari only from a Mac or an iPhone; a Linux WebKitGTK or
  WPE build would run the code (its worker rAF is on by default there, row (a)) but not Safari's display path;
* **the 2560×3328 cells need a GPU and a real display**: their per-tick cost is a 17 MB `texImage2D`, which on a
  software rasteriser measures the rasteriser, and where the host saturates nothing is claimed by the protocol's own
  guard;
* **every presented-on-time claim needs a real display** for its vsync: Xvfb's and headless Chromium's are timers, and
  neither shows a dropped frame. A container's cells can rank the arms against each other only where they do not
  saturate, and say so; the 4× cells there slow the software rasteriser with the CPU, which a GPU would not be.

**Smoke (2026-10-30), not data.** One round per arm and cell, 10 s each, to prove the harness end to end: Chromium 153
on all 16 cells, Firefox 155 (Xvfb) on the eight 512² cells and one 2560×3328 cell; every run painted with no failure,
and the 4× lever held on the page thread and a worker alike. **By the protocol's own guard this container saturates
in every cell but 512² at 30/s on a quiet page at 1×**, in both engines, and in Chromium also on a busy page at 1×. Every 60/s cell, every 4× cell and every
2560×3328 cell is past the host's limit here: nothing is claimed in them, and no other figure from the smoke is a
result.

**Rule, stated before any data.** Per engine: **the clock moves into the worker** with `worker-raf` if, in every
non-VOID busy-page cell of the 512² series at 1× and 4×, it has ≥ 20 points fewer frames late than `page-raf` in ≥ 11
of 14 rounds and a gap p99 ≤ 2 T, and in every quiet-page cell it is not worse than `page-raf` by more than the A/A
pair's difference. Where the engine has no worker rAF, or it fails, the fallback with the fewest late frames that
passes the same bar is the clock; if none passes, cine keeps the page's clock in that engine and the owner decides.
The 2560×3328 cells decide nothing outside the host's limit; inside it they must not reverse the 512² verdict. The
runs are a later row.
