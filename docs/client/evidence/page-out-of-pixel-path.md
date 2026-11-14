# The page in or out of the pixel path

**Question:** Should the page stay in the path a decoded frame takes to the paint, or leave it?

*Moved 2026-11-14 from `docs/adr/frame-path.md` at `e5b20cba` (§1 · Today, and the question, §2 · What the page thread
costs, and what a busy one does, §7 · Protocol, §8 · Decisions for the owner, §9 · Sources), word for word but for
queue-row names. A bare §N or §Name is a section of that ADR: [its map](../../adr/frame-path.md) names the file each
now lives in. Choices 1–8 are [the cache's](cache-in-opfs.md#the-choices-and-what-decides-each). The design these
findings shape is [`../design.md`](../design.md).*

**Status:** proposed 2026-10-11 (in the work queue, [`../av1/queue.md`](../../av1/queue.md)); the cache's design
reviewed 2026-10-20 and **built 2026-10-27, not timed** (§Proposed: the client cache in OPFS); the owner's target
shape, a B′ without the store worker, **built 2026-10-28 as a variant beside today's path and not timed** (§3, *Built*);
both assembled on one branch 2026-10-30 (§The core, assembled); **§7 run on the core 2026-10-30: `?view=page` (A)
stays the default by its rule** (§7, *Measured*). The decisions are the owner's; they are listed in §8 and under the queue's
`## Blocked`. Sources are pinned in §9; every figure not marked *measured* is a prediction or a reading of source.

## 1 · Today, and the question

```
decoder (nested worker) ── pixel port ──► page: consumer.js #deliver ──► viewer's Map ──► painter.paint() ──► paint worker
          SharedArrayBuffer, written once         ~0.1 KB message                         postMessage         texImage2D from the SAB
```

The samples are written once, into a `SharedArrayBuffer`, and never copied; every hop carries a handle
([`../ARCHITECTURE.md`](../../ARCHITECTURE.md) §The shape). The viewer keeps every frame in memory, because the cache seam
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

**Measured today** ([`../ARCHITECTURE.md`](../../ARCHITECTURE.md) §Under a throttled CPU, §Paint): the consumer's share of
the page thread is **0.07–0.15 ms a frame at 1×, 0.22–0.84 at 4×, 0.32–1.15 at 6×** (Chromium's throttle, page thread
only); `painter.paint()` adds **~0.1 ms** (`client/paint/README.md` §What it costs). Neither allocates enough to
collect. At a fill's rate this is ~1–4 % of a throttled page thread. **Removing it is not, by itself, a reason to
change the design.**

**What a busy page thread does** is the reason. A boot or the viewer's own work holds the page 200–300 ms at a time
([`../ARCHITECTURE.md`](../../ARCHITECTURE.md) §Why a downloader).

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
  when the window's event loop is busy (HTML, OffscreenCanvas). ~~**Not run:** that frames appear while the page is
  blocked is what the code shows, and the protocol in §7 checks it.~~ *Measured 2026-10-30 (§7): in Chromium they do;
  in Firefox 155 the view worker's WebGL2 draw waits for the busy page (draw p99 ≈ the 200 ms task), so its cine is as
  late as the page's. The Gecko reading above is of presentation; what holds the draw is not traced.*

**Prediction.** On a quiet page, B moves the first exact frame on screen **by under 1 ms** (the two page hops), which
no 60 Hz display shows. Under a page held by long tasks, B gains up to the task's length per waited frame and keeps
cine running; A does not. The difference is real only where long tasks are; whether the viewer has them on a phone is
not measured. *Measured 2026-10-30 (§7), corrected in place: on a quiet page B′'s first exact frame came later, not
under 1 ms sooner — by 12–276 ms, median of rounds, in 15 of 16 cells; under long tasks the gain and the running cine
held in Chromium and not in Firefox. The rule kept A.*

## 7 · Protocol (proposed 2026-10-11; run 2026-10-30 on the core, amended before data)

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

**Amended before any data (2026-10-30), for the run on the core.** The text above is kept; each change is forced by
the rig or by what the core is, and says why.

* **The arms are the core's `?view=page` (A) and `?view=worker` (B′)**, with `pageaa`, A again, as the A/A pair. The
  store worker is in neither: the core's cache is off by default (`?writer=` unset, §The core, assembled), so A is
  today's path without it. **Cell 4 is out of this run:** with no cache on by default there is nothing to time, and
  who writes it is the OPFS-arms run's to decide (§The cache I/O in the view worker).
* **Series:** row INGEST's three, through the product's ingest as HTJ2K (`lab/viewer/view_frames.py` (at `0920153d`)) — `ct_nlst` (76 ×
  512², signed), `us_liver` (70, RGB), `dbt12_ea1141` (29 × 614×1359) — and `ffdm_a`'s first view (one 2560×3328
  frame). One frame has no asks and no cine, so the mammogram is in cells 1, 3 and (2)'s first frame alone.
* **Link:** §7 named none; `r50000` (50 Mbit/s, 40 ms round trip, total-time's), behind the relay. Rig core 3,
  browser cores 0–2.
* **(2) is three visits a round:** the fill on the busy page (its first exact frame from navigation), then 10 s of
  cine; and, on demand, frame 0 then ten asks (frames 1–10) one at a time. **Arrival → screen is the decoder's
  hand-off to the frame's first draw** (`decodeEnd` to the paint's own end, both on the epoch clock): an ask's issue
  and its round trip are the page's in both arms, so only this span differs between them. A paint's end is the
  draw's, stamped in the thread that drew it, so a reply waiting on the busy page is not counted against A.
* **Cine runs on the thread that holds the frames, on the same kind of clock:** A on a page timer to a schedule, B′ on
  the view worker's (`client/view/clock.js`, `timeout`), each showing the frame due at its tick (§A frame clock,
  *amended*), frame 0 due mid display interval, at the series' rate as the viewer's cine (10/s where the metadata has
  none). Worker rAF is that section's question, not this one. **Late** is that section's score from the draw log
  against a second worker's vsync log (`lab/frame-clock/measure.js`); claims are from draws, not presentation.
* **(3) is the page's content process's main thread CPU time** over the quiet fill (`/proc`, the process that moved
  most), ÷ frames: Firefox has no trace this rig reads, so both engines are read alike. Its resolution is 10 ms a
  visit.
* **Guards.** A visit is dropped if the relay's timing is VOID, it errs, or on a busy page its shortest long task is
  under 200 ms; dropped visits are re-run as whole extra rounds, and a cell counts the first 12 rounds in which all three
arms were kept (*added after round 0, before any cell had 12 rounds: three relay-VOID asks visits made top-ups
certain, and extra rounds would otherwise loosen "9 of 12"*); a cell with fewer decides nothing. A cell is
  **VOID** when `pageaa` and `page` differ, median over paired rounds, by more than: the fill ×0.98–1.02 or the first
  frame by 16.7 ms (quiet); arrival → screen by 8 ms (asks); 2 points of late frames or 16.7 ms of gap p99 (cine).
  A cine cell is **saturated** when `page`'s draw p99, median over rounds, passes half the period.
* **The rule, read before any data** (`lab/viewer/view-summary.mjs` (at `0920153d`)): B′ is adopted if every frame is exact, and in
  every decided cell of both engines at 1× and 4×: quiet, B′'s fill ÷ A's median in ×0.98–1.02 and its first frame
  less than 16.7 ms later; asks, B′'s median arrival → screen ≥ 16.7 ms below A's in ≥ 9 of 12 rounds; cine, where
  A's median late exceeds 2 points, B′'s is at most 2 with a median gap p99 ≤ 2 periods; and each engine has an asks
  cell decided. Otherwise A stays. The mean arrival → screen is printed beside the median: §2 predicts A's *mean*
  (half the task, for the asks that land in one), which the median of ten asks need not move.

**Measured 2026-10-30, on the core** (`claude/core-s7`; rows at `claude/core-s7@3d12a46f`, not in this tree, in [`lab/viewer/rows/`](https://github.com/dary-dc/wt-pacs/tree/3d12a46f44167d9d5cf901a0db94323102c40ae2/lab/viewer/rows),
read there by `node lab/viewer/view-summary.mjs lab/viewer/rows/view-{quiet,cine,busy,asks}.jsonl`). Headless Chromium 153
(SwiftShader) and Playwright's Firefox 155 headed under Xvfb (llvmpipe), 4 cores, no GPU, no display; rounds 0–11,
then whole extra rounds of a kind (to 26 for the asks) until every cell had 12 rounds with all three arms kept. 2 880
visits, 302 dropped (the relay's timing guard: a quarter of the short asks visits, 5 % of the rest; no long task
under 200 ms, no error). **92 124 of 92 124 frames exact**; `--mutate sample` turned every frame of every arm in both
engines inexact. Medians over the 12 rounds; *Δ* is B′ − A paired by round.

| cell | Chromium 1× | Chromium 4× | Firefox 1× | Firefox 4× |
| --- | --- | --- | --- | --- |
| (1) quiet, first exact frame Δ, ms: CT / US / tomo / mammo | +16 / −1 / +12 / **+84** | **+38** / **+22** / *+90* / *+80* | *+61* / **+32** / *+77* / *+106* | *+83* / *+94* / **+175** / *+276* |
| (1) quiet, fill B′ ÷ A: CT / US / tomo / mammo | 1.008 / 1.006 / 1.009 / **1.086** | 1.014 / 1.011 / *1.026* / *1.072* | *1.015* / 1.013 / *1.019* / *1.134* | *1.022* / *1.029* / **1.058** / *1.228* |
| (2) asks, arrival → screen median A / B′, ms: CT / US / tomo | 11.6/10.9 · 16.5/15.6 · 89/17 | 21.8/17.7 · *83/33* · *82/34* | 12.7/11.4 · 15.8/13.3 · 82/71 | 24.4/23.2 · 98/63 · 74/74 |
| (2) asks, mean A / B′, ms: CT / US / tomo | 63/12 · 59/16 · 107/18 | 75/19 · *110/32* · *89/34* | 59/58 · 63/53 · 106/101 | 68/63 · 114/103 · 87/84 |
| (2) asks, rounds B′ ≥ 16.7 ms sooner of 12: CT / US / tomo | 0 / 0 / 7 | 0 / *9* / *12* | 0 / 0 / 6 | 0 / 7 / 4 |
| (2) cine late A / B′, %: CT / US / tomo | 20 / 0 · 20 / 0 · 20 / 0 | 20 / 0 · *24 / 0*ˢ · *24 / 0*ˢ | *20 / 26* · 23 / 20ˢ · *22 / 27*ˢ | *33 / 40*ˢ · 30 / 34ˢ · *35 / 40*ˢ |
| (2) cine gap p99 A / B′, ms (period 100) | 283 / 117 · 317 / 133 · 275 / 117 | 283 / 117 · *383 / 150* · *392 / 150* | *288 / 297* · 339 / 323 · *322 / 323* | *356 / 356* · 407 / 424 · *373 / 390* |
| (2) busy, first exact frame Δ (A/A), ms: CT / US / tomo / mammo | +53 (7) / −8 (−8) / +7 (5) / +85 (15) | +61 (−44) / −169 (−1) / −80 (−2) / +19 (12) | −11 (−13) / −41 (45) / −54 (15) / −10 (−54) | 0 (−7) / +222 (101) / +262 (236) / +86 (−2) |
| (3) page thread CPU, ms a frame, A / B′: CT / US / tomo | 1.45/1.05 · 1.57/1.36 · 2.76/3.10 | 1.64/1.05 · 1.57/1.00 · 2.41/2.24 | 1.97/1.18 · 2.14/1.14 · 3.10/2.76 | 2.11/1.18 · 2.29/1.29 · 3.45/2.76 |

*Italic*: the cell is VOID (its A/A pair apart by more than the bar); ˢ: saturated by the guard (A's draw p99 over half
the period); **bold**: a decided cell that fails the rule. (2)'s busy first frame is from the cine visits and decides
nothing, its A/A pair as wide as its Δ (whether a task stands in the way is a coin toss); the mammogram's is from its
own busy visit. (3)'s mammogram is one frame at 10 ms resolution, 40–70 ms
both arms, and is left out.

**The rule's verdict: A stays** — `?view=page` remains the core's default. It fails on two counts, each alone enough:

* **(1), the quiet page:** B′'s first exact frame is later by ≥ 16.7 ms in five decided cells (Chromium CT and US at
  4×, the mammogram at 1×; Firefox US at 1×, tomosynthesis at 4×, there with the fill ×1.058). It is later in 15 of
  16 cells, VOID or not. Why is not measured; the view worker's start (its module graph, its WebGL context, its
  consumer) lies on B′'s path to the first frame and not on A's.
* **(2), the asks:** no decided cell has B′'s median arrival → screen 16.7 ms sooner in 9 of 12 rounds. On the CT and
  US series most asks land outside a long task, so A's median is the quiet path (11–25 ms) in both engines.

**What §2 predicted, against this.**

* *Chromium, the prediction holds.* A's *mean* arrival → screen is 59–110 ms against B′'s 12–34 ms (§2: half the task
  for the asks that land in one); B′'s cine stays on time through the long tasks (0 % late, gap p99 117–150 ms) where
  A's misses 20–24 % (gap p99 ≈ 283 ms, the task plus an interval). The worker's frames reach the screen while the
  page is blocked, as §2's last bullet read from source.
* *Firefox, it does not.* B′'s cine is as late as A's or later (20–40 %), and the view worker's draw p99 is
  **≈ 200 ms at 1× and 220 ms at 4×, the long task's length**, against Chromium's 23 and 44 ms: in Firefox 155 a
  worker's WebGL2 draw, ending in the one-pixel `readPixels` the lab's paint waits on, waits for the busy page. A's
  paint worker shows the same in some rounds (draw p99 57–300 ms). Whether presentation without that read also waits
  is not measured, and nor is the Gecko path that makes it wait. The saturation guard marks these cells, but it is
  reading the engine, not the host: the draw p99 is the task's length at 1× as at 4×.
  *Corrected 2026-10-31* (§*The pixel read under a busy page*): **the wait was our code's, the one-pixel read.** In
  Firefox 155 a worker's `readPixels` waits for the page's main thread (the probe: 12 of 12 rounds, each read in a task
  lasting what is left of it), and nothing else in the draw does. With the paint settled by a fence instead, the view
  worker's draw p99 is 22–37 ms and **B′'s cine is 0 % late in Firefox too** (gap p99 119–136 ms) where A's misses
  20–21 %, in both decided 1× cells, as §2 predicted. The saturation these cells carried was the read's, not the host's.
  The verdict above stands: (1)'s first frame is stamped by the same settle but is later under B′ in Chromium too, and
  Chromium's decided asks cells fail (2) by themselves. Firefox's asks were settled by the read as well, so their
  arrival → screen may carry the same wait (B′'s mean 53–103 ms there against 12–34 in Chromium); they are not
  re-measured here.
* *The page thread* (3): B′ takes 1.0–1.4 ms a frame of the page's main thread against A's 1.45–2.3 on CT and US, the
  rest of the page's own work (its status line, the downloader's port, the lab's polls) staying. Neither is a reason
  to change the design by itself (§2's first paragraph).

**Where the host saturates:** the 4× Chromium cine cells on US and tomosynthesis, and every Firefox cine cell by the
guard (above). Nothing is claimed from them. Everything is from software rasterisers and the containers' synthetic
vsyncs, as §A frame clock's *What a container can and cannot claim* says; a GPU, a display and a phone are not
measured. **Cell 4 (OPFS)** was not run: the core's cache is off by default, and who writes it is the OPFS-arms run's
question (§The cache I/O in the view worker).

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
[`frame-path-sources.txt`](sources.txt); nothing fetched is committed. Commits: whatwg/fs `7df1158`
(2026-10-08), whatwg/storage `23f38d8` (2026-10-06), whatwg/html `877d614` (2026-10-09), KhronosGroup/WebGL `714857a`
(2026-09-14), chromium/src `52c75e5`, WebKit/WebKit `37be53d`, mozilla-firefox/firefox `54145f3` (each 2026-10-11).

| claim | source |
| --- | --- |
| sync handles in dedicated workers; exclusive lock; `AllowSharedBufferSource`; `flush()` | fs `index.bs` 425–432, 605–609, 647–652, 1421–1430, 1632–1640 |
| buckets cleared whole; best-effort first; `persist()` Window-only | storage `storage.bs` 362–367, 561–563, 573–579, 618–624 |
| SAB within an agent cluster; ports transferable; worker `requestAnimationFrame`; OffscreenCanvas placeholder | html `source` 10532–10547, 117612–117620, 134770–134771, 123527–123546, 76966–76973, 77549–77562. *Corrected 2026-10-28:* 134770–134771 is the `MessagePort` IDL (ports transferable); the worker's `requestAnimationFrame` is 133029–133030 and 123527–123546 |
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
