# ADR: where a decoded frame goes — the page in or out of the pixel path, and who owns the frame store

**Status:** proposed 2026-10-11, **theory only: nothing built or timed** (queue row 148, FRAMEPATH, of
[`../av1/queue.md`](../av1/queue.md)). The decisions are the owner's; they are listed in §8 and under the queue's
`## Blocked`. Sources are pinned in §9; every figure not marked *measured* is a prediction or a reading of source.

## 1 · Today, and the question

```
decoder (nested worker) ── pixel port ──► page: consumer.js #deliver ──► viewer's Map ──► painter.paint() ──► paint worker
          SharedArrayBuffer, written once         ~0.1 KB message                         postMessage         texImage2D from the SAB
```

The samples are written once, into a `SharedArrayBuffer`, and never copied; every hop carries a handle
([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The shape). The viewer keeps every frame in memory, because the cache seam
is open (§The viewer). The owner decided on 2026-10-10: an OPFS client cache for both web clients, no re-decoding;
whether it holds decoded samples or coded bytes is open.

**The owner's idea, weighed here:** decoder → paint worker directly, the frame also written to OPFS, the page out of the
pixel path. Three designs are compared:

| | data path | frame store (memory) | OPFS writer and reader |
| --- | --- | --- | --- |
| **A** today, plus a cache | decoder → page → paint worker | the page | a store worker the page posts each handle to |
| **B** the owner's | decoder → paint worker | the paint worker | the paint worker |
| **B′** recommended | decoder → paint worker; paint worker → store worker (a handle) | the paint worker | a store worker, beside the paint worker |

## 2 · What the page thread costs, and what a busy one does

**Measured today** ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Under a throttled CPU, §Paint): the consumer's share of
the page thread is **0.07–0.15 ms a frame at 1×, 0.22–0.84 at 4×, 0.32–1.15 at 6×** (Chromium's throttle, page thread
only); `painter.paint()` adds **~0.1 ms** (`client/paint/README.md` §What it costs). Neither allocates enough to
collect. At a fill's rate this is ~1–4 % of a throttled page thread. **Removing it is not, by itself, a reason to
change the design.**

**What a busy page thread does** is the reason. A boot or the viewer's own work holds the page 200–300 ms at a time
([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Why a downloader).

* **A:** a frame that lands during a long task waits on the pixel port until it ends, and so does its paint. The fill
  itself is not slowed: the decoders keep decoding and the port queues handles. A frame the user is waiting on — the
  first, or an ask — reaches the screen late by the rest of the task: **a mean of half the task**, up to all of it.
  Cine is a page `setInterval`, so it stalls for the whole task.
* **B and B′:** the paint worker takes the frame and paints it if it is the current one, without the page. The
  current index, the window and the view are whatever the page last posted. Input is still the page's: a key or a
  wheel during a long task is handled after it, in every design. Cine driven by the paint worker's own clock
  (`requestAnimationFrame` in a dedicated worker, HTML, §9) keeps running through the task.
* **Presenting needs no page thread** in any engine, by source: Chromium submits the worker's frames to viz over the
  worker's own `CompositorFrameSink`; Gecko pushes them into an asynchronous `ImageContainer`; WebKit copies them to
  the layer from the worker and tells the main thread only to update the element. The spec encourages exactly this
  when the window's event loop is busy (HTML, OffscreenCanvas). **Not run:** that frames appear while the page is
  blocked is what the code shows, and the protocol in §7 checks it.

**Prediction.** On a quiet page, B moves the first exact frame on screen **by under 1 ms** (the two page hops), which
no 60 Hz display shows. Under a page held by long tasks, B gains up to the task's length per waited frame and keeps
cine running; A does not. The difference is real only where long tasks are; whether the viewer has them on a phone is
not measured.

## 3 · Who owns the frame store

**Memory.** A `SharedArrayBuffer` lives while any agent holds it. Today the page's `Map` holds every frame; in B the
paint worker holds them, and the page holds per-frame metadata only (index, `exact`, `min`/`max` for the default
window, dimensions) — a message of ~100 bytes a frame, which the page needs for its status and its window. **One owner,
the paint worker**, because it is the only consumer of samples: the page never reads one (the check reads `readPixels`
through the painter).

**Eviction** is by distance from the current index, not by recency: a reader scrolls a stack, so the frames next to the
one shown are the ones about to be wanted. The memory store keeps a window around the current index within a byte
budget; a frame evicted from memory stays in OPFS. A phone's budget cannot come from `navigator.deviceMemory`, which
WebKit declines ([`../CLIENTS.md`](../CLIENTS.md) §On WebKit); it is a constant until a device sets it (§8).

**A frame the paint worker does not hold** (scrolled back past the window): it asks the store worker, which reads the
entry from OPFS into a new `SharedArrayBuffer`, checks it (§5), and posts the handle back. A frame in neither is asked
of the downloader as today, through the page's `requestExactFrame` or a port the page hands the paint worker.

**A second viewport.** One paint worker can hold several transferred canvases, one WebGL2 context each; samples are
uploaded from shared memory per context, so nothing is copied for the second. One worker for every viewport keeps one
store and one owner; two paint workers would need the decoders to post to both, or a store both ask. Recommended: **one
paint worker, every viewport**. Its cost is that two viewports' paints share one thread — 0.34 ms a 512² paint on a GPU
(measured, [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Paint), so not a constraint at fill rates.

**Row 147 (FRAMELOSS) interacts.** It makes the downloader forget a frame only once the page acknowledges it. In B the
frame's receiver is the paint worker, so the ack must come from it: the page hands it a port to the downloader at
start, or the ack is the page's, relayed from the paint worker's ~100-byte note. Either keeps row 147's rule; the first
keeps the page out of it.

## 4 · OPFS, from the specs and the engines' sources

* **Sync access handles exist only in dedicated workers** (`[Exposed=DedicatedWorker]`, fs §FileSystemSyncAccessHandle),
  which includes a worker started by a worker; nested workers' support per engine was not checked. The page cannot use
  them; the async `createWritable` path it could use is a stream, slower by design and not weighed here.
* **One writer per file.** A sync handle takes an **exclusive lock** on its file; a second handle or a `createWritable`
  fails with `NoModificationAllowedError` until it closes (fs, take a lock). A packed file per series therefore has one
  writer; a file per frame lets several writers work at once. Chromium ships a non-standard `mode`
  (`"readwrite-unsafe"`, `"read-only"`); nothing here relies on it.
* **Read and write take a view of shared memory** (`AllowSharedBufferSource` in the spec and in all three engines' IDL):
  a frame is written to OPFS from its `SharedArrayBuffer` and read back into a new one, with no copy in script. WebGL2's
  `texImage2D` takes `[AllowShared]` views too, which is how the paint worker uploads today.
* **Write cost, by source, not measured.** Chromium and WebKit write in the worker straight to a file the browser
  process opened and handed over; an IPC is sent only when the file outgrows the capacity already granted (Chromium:
  1 MiB at least, doubling to 128 MiB) plus, in Chromium, a fire-and-forget note per write. Gecko writes to a file
  descriptor in the content process through an IO task queue while the worker spins a sync loop, with a **synchronous
  quota IPC on every stream write**. So a write is a copy into the page cache on Chromium and WebKit, and that plus a
  round trip per write call on Gecko. **Predicted:** ≥ 1 GB/s on Chromium and WebKit on a desktop, so ≤ 0.5 ms for a
  512² 16-bit frame and ≤ 17 ms for a 17 MB mammogram; Gecko slower by the number of quota round trips, unknown. No
  write needs `flush()` for a cache: a torn entry is caught on read (§5), and `flush()` is `fdatasync` on Chromium.
* **Quota and eviction.** All three clear **whole origins or buckets, least recently used first, best-effort only**, never
  single files (Storage §Clearing). Per origin: Chromium **60 %** of disk (80 % pool × 75 %); WebKit **60 %** in a browser,
  **15 %** in a web view; Gecko a fifth of its global limit (50 % of disk) per site, at most 10 GB — **10 %** of disk below
  that cap. `persist()` is `[Exposed=Window]` only: the page asks, not a worker.
* **WebKit's deletion of script-written storage includes OPFS** (`WebsiteDataType::FileSystem` is among the monitored
  types). *Qualified in place in [`../CLIENTS.md`](../CLIENTS.md) and [`../native/README.md`](../native/README.md):*
  WebKit's 2020 post says 7 days, but the source's default window is **30 operating days**, 7 applying to a domain
  flagged by link decoration; whether shipping Safari changes the default was not traced. Either way the cache must
  survive being emptied: it is a cache, not a store.

**Decoded samples against coded bytes.** The owner's rule is no re-decoding, which coded bytes break on every reopen.
Per entry:

| | disk | reopen, per frame | check on read |
| --- | --- | --- | --- |
| decoded samples | the full size: CT 512² 16-bit 0.52 MB, DBT 614×1359 1.67 MB, mammogram 17.0 MB | read + XXH3 + upload | one XXH3 of the samples (≈ 4 GB/s at 1×, measured) |
| coded bytes | the lossless ratio smaller | read + **a decode** + XXH3 + upload | the decode's own check |

On the viewer's series, decoded is **40 MB** (`ct_nlst`, 76 frames), **48 MB** (`dbt12_ea1141`, 29), **67 MB**
(`us_liver`, 70) and **68 MB** a four-view mammogram (`ffdm_a`) — inside any quota above. A decode of the mammogram is
47 ms at 1× and 210 at 4× (measured, the exactness ADR §3); reading 17 MB and hashing it is predicted at ~10 ms on a
desktop. **Decoded samples are recommended**: they keep the owner's rule and are faster on reopen wherever a read beats
a decode, which a phone's flash should (not measured).

## 5 · The exactness digest

Today the decoder hashes every frame with XXH3-64 against the ingest's digest **before it is handed on**
([`exactness-in-production.md`](exactness-in-production.md) §2). That does not move: in B the decoder checks, then posts
to the paint worker. Its §8 *A client cache* rules hold: **store only frames checked `true`**; store with each entry the
sample digest and the metadata's version; key by series, index and version, never by digest.

**A frame read back from OPFS must be checked again**, against the digest stored with it, whose version must match the
series' current metadata. Disk, a torn write after a crash, or a cleared-and-rewritten file can each return wrong
samples, and nothing else in the path would see it. It costs one XXH3 (0.12 ms for 0.52 MB, 4.7 ms for 17 MB at 1×,
measured); the store worker does it before it posts the handle. A mismatch evicts the entry and asks the frame again —
here asking again helps, as the ADR says.

## 6 · Memory on phones, and where the write goes

Decoded frames held in shared memory are the cache's working set, and the page's tab is what a phone kills. Today the
viewer holds a whole series: 40–68 MB on the sets above, more on a longer DBT. With OPFS behind it, the memory store
becomes a window (§3) and the series' size moves to disk. Which limit a phone kills a tab by — resident memory or the
JavaScript heaps — is not measured ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Resources). B moves no memory: the
same buffers, held by a worker instead of the page.

**Where the write goes.** Not on the fill's critical path in B′: the paint worker takes the frame and posts the handle
on (~0.1 ms), and the store worker writes while the paint worker paints. Writing in the decoder would put up to ~17 ms
a mammogram on the decoder's clock, which is the fill's when decode-bound; writing in the paint worker would put it in
front of the next paint (B's flaw). B′ costs one more thread; on a host whose cores the decoders already saturate (3 on
4, [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Resources), the writes compete for the fourth core with the page. Measured by §7's protocol, not assumed.

## 7 · Protocol (proposed, not queued)

Arms differ in the lever alone: **A** (today's path, plus the store worker) and **B′**, same decoders, painter code,
store worker and transport, each arm's settings printed. Chromium and Firefox; the viewer's three series and a
mammogram; 1× and 4× (`lab/scripts/cpu_throttle.mjs`, every thread); `lab/order.mjs` interleaving; ≥ 12 rounds; every
frame checked against the encoder input's `.sha256`.

1. **Quiet page:** the first exact frame on screen from navigation, and the fill.
2. **Busy page:** a 200 ms long task posted every 500 ms on the page from navigation; the first exact frame on screen,
   ten asks' arrival → screen, and cine at the series' rate counting the frames not presented on time.
3. **Page thread:** its task time per frame from the trace, during the fill.
4. **OPFS:** write and read+check, ms per MB, per engine, per set; reopen of a series from OPFS against a fresh fill
   of it.

**Rule, stated before any data.** Adopt B′ if in (2) it cuts the median arrival → screen of asked frames by ≥ 16.7 ms
in ≥ 9 of 12 rounds in both browsers and keeps cine on time where A misses, while (1)'s fill is within ×0.98–1.02 and
its first frame no later by 16.7 ms or more. Otherwise keep A with the store worker. Store decoded samples if, in (4),
reopen is faster than a decode of the same frame on every set; otherwise the owner reopens the coded-bytes question.

### A frame clock in the view worker (2026-10-28)

*Theory and a pre-registered protocol; nothing built or timed.* The owner's next client shape: the page holds no
frame; one dedicated **view worker**, started by the page, holds the frame store, a controller and the WebGL2 paint on a
transferred `OffscreenCanvas`. How its frames reach the screen without the page is §2's last bullet; this section asks
only **which clock** the worker can run cine on. Sources are pinned as in §9, plus MDN's compat data and page, all in
[`frame-path-sources.txt`](frame-path-sources.txt) (2026-10-28 block).

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

**Protocol (pre-registered, not queued; nothing built).** Frames are in the view worker's memory before the clock
starts: no network, no decode. Each frame is uploaded on its tick, as the paint worker does today.

* **Cells:** {a 512×512 16-bit series of 76 frames, 12 frames of 2560×3328 16-bit} × {30, 60 frames/s} × {quiet page,
  §7's busy page} × {1×, 4× (`lab/scripts/cpu_throttle.mjs`, every thread)} × {Chromium, Firefox} = 32. WebKit only if
  its container has one: **this container has none, and no Firefox either** (only Chromium under `/opt/pw-browsers`);
  the run row installs Firefox.
* **Arms, interleaved by `lab/order.mjs`:** `page-raf` (the reference: the page's rAF posts each tick to the worker),
  `page-raf′` (its A/A copy), `page-interval` (today's cine, a page `setInterval`), `worker-raf` (Chromium, Firefox,
  WebKit when present), `worker-timeout`, `worker-channel`, `worker-wait`. Seven units: `order()`'s period is 14
  rounds, so **14 rounds**, 10 s of cine each (20 busy periods); each arm's settings printed.
* **Measure, per run:** frame *i* is due at t₀ + *i*·T. It is **presented on its tick** if it is drawn in
  [due, due + T) and is not superseded before the display shows it. Chromium: presentation read from a CDP trace of
  the worker's frame sink. Firefox and WebKit: the worker's draw log alone (tick time, index, draw end), a frame
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

**Rule, stated before any data.** Per engine: **the clock moves into the worker** with `worker-raf` if, in every
non-VOID busy-page cell of the 512² series at 1× and 4×, it has ≥ 20 points fewer frames late than `page-raf` in ≥ 11
of 14 rounds and a gap p99 ≤ 2 T, and in every quiet-page cell it is not worse than `page-raf` by more than the A/A
pair's difference. Where the engine has no worker rAF, or it fails, the fallback with the fewest late frames that
passes the same bar is the clock; if none passes, cine keeps the page's clock in that engine and the owner decides.
The 2560×3328 cells decide nothing outside the host's limit; inside it they must not reverse the 512² verdict. The
runs are a later row.

## 8 · Decisions for the owner

1. **The page out of the pixel path (B′) or not (A).** Recommended: B′, decided by §7's rule.
2. **Decoded samples in OPFS.** Recommended, from the no-re-decoding rule; costs the lossless ratio in disk.
3. **A packed file per series or a file per frame.** A file per frame lets each entry be written, checked and evicted
   alone under the exclusive lock; a packed file needs one writer and an index. Recommended: a file per frame, unweighed
   against file-count costs per engine.
4. **The memory window's budget on a phone,** without `deviceMemory` on WebKit.
5. **`persist()` asked or not.** Unasked, every engine may clear the cache whole under pressure, and WebKit after its
   interaction window.

A change to the store's format or the wire is not proposed: all of this is client-side.

**What the reference implementation's client could take** — it keeps decoded frames in a memory cache painted from the
page: the memory cache moved into the paint worker, the page left with per-frame metadata; a store worker behind it
writing only checked frames to OPFS, keyed by series, index and metadata version; a check on every read; eviction by
distance from the current frame. The design note is local to that client; nothing here was run on it.

## 9 · Sources

Every file was fetched on 2026-10-11 and is listed with its URL and sha256 in
[`frame-path-sources.txt`](frame-path-sources.txt); nothing fetched is committed. Commits: whatwg/fs `7df1158`
(2026-10-08), whatwg/storage `23f38d8` (2026-10-06), whatwg/html `877d614` (2026-10-09), KhronosGroup/WebGL `714857a`
(2026-09-14), chromium/src `52c75e5`, WebKit/WebKit `37be53d`, mozilla-firefox/firefox `54145f3` (each 2026-10-11).

| claim | source |
| --- | --- |
| sync handles in dedicated workers; exclusive lock; `AllowSharedBufferSource`; `flush()` | fs `index.bs` 425–432, 605–609, 647–652, 1421–1430, 1632–1640 |
| buckets cleared whole; best-effort first; `persist()` Window-only | storage `storage.bs` 362–367, 561–563, 573–579, 618–624 |
| SAB within an agent cluster; ports transferable; worker `requestAnimationFrame`; OffscreenCanvas placeholder | html `source` 10532–10547, 117612–117620, 134770–134771, 123527–123546, 76966–76973, 77549–77562 |
| `[AllowShared]` texture upload | WebGL `specs/latest/2.0/webgl2.idl` 516–524 |
| Chromium quota and LRU eviction | `storage/browser/quota/quota_settings.cc` 31, 127–141; `quota_features.cc` 26–27; `quota_database.cc` 640–679 |
| Chromium write path | `…/file_system_access/file_system_access_regular_file_delegate.cc` 25, 76–91, 127–130; `file_system_access_capacity_tracker.cc` 21–24, 89–116; `base/files/file_posix.cc` 679–697 |
| Chromium presentation | `…/graphics/canvas_resource_dispatcher.cc` 60–67, 90–92; `…/offscreencanvas/offscreen_canvas.cc` 716–726, 815–820 |
| WebKit quota, eviction, ITP | `UIProcess/WebsiteData/Cocoa/WebsiteDataStoreCocoa.mm` 80–83; `NetworkProcess/storage/NetworkStorageManager.cpp` 275–284, 600–610; `NetworkProcess/Classifier/WebResourceLoadStatisticsStore.cpp` 66–81; `ResourceLoadStatisticsStore.cpp` 73–74, 2834–2842; WebKit blog 14403 (2023-08-10) and 10218 (2020-03-24) |
| WebKit write path and presentation | `WebCore/Modules/filesystem/FileSystemSyncAccessHandle.cpp` 162–192; `NetworkProcess/storage/FileSystemStorageHandle.cpp` 220–243; `WebCore/html/canvas/PlaceholderRenderingContext.cpp` 51–56, 97–120 |
| Gecko quota and eviction | `dom/quota/ActorsParent.cpp` 1413–1440, 2137–2172, 8377–8386 |
| Gecko write path and presentation | `dom/fs/api/FileSystemSyncAccessHandle.cpp` 551–627; `dom/quota/FileStreams.cpp` 84–97; `dom/quota/PRemoteQuotaObject.ipdl` 10–18; `dom/canvas/OffscreenCanvasDisplayHelper.cpp` 146–148, 387–404 |

**Not verified:** nested-worker sync handles per engine; Gecko's `flush()` at the OS; how Chromium's `mode` values lock;
shipping Safari's ITP window; any frame on screen while the page is blocked.
