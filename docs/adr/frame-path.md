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

## Target: the view worker · 2026-10-28

**Status:** the owner's next target design for the client, 2026-10-28. It takes B′ (§1) further: the page leaves the
pixel path *and* the asking, and the frame store, the cache I/O and the paint share one worker. §8.1 was settled as A
on 2026-10-11 (queue row 148) unless a measured cost says otherwise; §7's rule is that measurement, so the design is
built as a switchable arm and adopted only if §7 passes. Theory: nothing here is measured.

```
page (UI only)  ── show(i) · setDisplay · play · pause · valueAt ──►  view worker
                ◄─ shown {i, exact} · progress · failed ───────────   ├ controller   what to want, in what order; cine clock
                                                                      ├ frame store  where a frame comes from: memory → OPFS → downloader
                                                                      └ paint module WebGL2, VOI table, display state
downloader worker ◄── want {misses, in order, generation} · ack ───── frame store
  session · records · wire ── started · failed ─────────────────────► frame store
  └ decoders (nested) ── frame {SharedArrayBuffer, exact} ──────────► frame store
```

**Responsibilities.**

* **The page** sends intents and listens to events. It never holds a frame. Pixel tools ask `valueAt(x, y)`.
* **The controller** decides: the current frame, the order of what it wants (the frame asked first, then the window
  and the look-ahead), the cine clock. It tells the store what it wants and the paint module what to paint. It never
  sees the downloader or OPFS.
* **The frame store** answers "is frame *i* here" and gets the frames it is told to want. For each, in the controller's
  order, it looks in memory, then OPFS, and sends the downloader only the misses; it never reorders them. `has` and
  `get` only read: neither reaches the network. Frames from the decoders land in it; it acks the downloader and reports
  `arrived(i)` or `failed(i)`. A frame read back from OPFS that fails its check (§5) is asked again by the store.
  Eviction follows the want: what falls outside it leaves memory first, farthest from the current frame first.
* **The paint module** is a module of the view worker, not a worker: today's paint worker code, with the display state
  (window, invert, pose) and the VOI table. A window change repaints with no frame moving.
* **The downloader** keeps the session, one record per owed frame, survival and the wire: it turns the want into
  ranges and asks ([`../WIRE.md`](../WIRE.md)), FIFO on the server ([`reject-server-ordering.md`](reject-server-ordering.md)).

**Rules.**

* **One owner per frame at a time.** The downloader owns what is owed (asked, in flight, decoding); the store owns what
  is here. A frame changes owner at the ack (row 147's rule), so the two never hold the same frame's state.
* **Paint first.** A frame that arrives and is the one on screen is painted before its cache write; the write runs off
  the latency path. How it is scheduled is the cache arms' question (below).
* **The controller decides what; the store decides from where.**

**Per frame of a fill, counted from the design:** four messages (decode, frame, done, ack), none on the page; four
context crossings (network → downloader → decoder → view worker → GPU); the samples written once, as today.

**Open, each with what decides it.**

| question | decided by |
| --- | --- |
| the cache I/O: a sync handle in the view worker, async OPFS in it, or a store worker | shown frame on time while a fill writes, write rate, miss read (row OPFSARMS) |
| a frame clock in a dedicated worker, per engine | sources, then cine frames late under a busy page (row WORKERCLOCK) |
| who owns a frame's memory: the decoders hold each one during a fill (§Proposed M2 on `claude/opfs-cache-fixes`) | peak memory of a fill under the window (row FRAMEMEM) |
| the asking patterns as wants, and what the wire lacks | each pattern's deciding measurement (row ASKMAP) |
| several viewports: one view worker for all, or one each | not weighed |
| adoption | §7's rule, run on the arm built on `claude/view-worker` |

## The core, assembled (2026-10-30)

**Decided by the owner, 2026-10-30:** *"We won't build visualizers for now. We build the new architecture (core)
while investigating, testing and improving the diff options. And ideally land in a single PR, that even if big it
will be easier to localize. Native client can have similar module architecture, threads might be different. In any
case, we build the architecture now, but modules like the view worker's for a complex viewer will be too much and
isn't even designed, so we stick with the simple cine for now."*

So the core is the Target above, built once on one branch (`claude/core`), with only the simple cine on top: no
viewport layout, hanging protocols or tools, and no ingest change. **Every design option still under investigation
is a setting inside the core whose default is today's behaviour**, until its pre-registered rule decides it.

**Modules, and the thread each runs on.**

| module | does | browser, `?view=page` (default) | browser, `?view=worker` (the Target) | native, `--paint-thread` `ui` (default) / `view` / `core` |
| --- | --- | --- | --- | --- |
| downloader | session, a record per owed frame, survival, the wire; sends the want's misses as asks or runs | its worker | its worker | the UI's runtime / its own thread / the core thread |
| controller + want | the current frame, what is wanted in what order, the cine clock | the page | the view worker | UI thread / view thread / core thread |
| frame store (+ OPFS cache) | memory → cache → downloader; acks a frame once held; evicts farthest-first, only once written | the page's `Map`, store worker behind it | the view worker, the cache's writer per `writer` | UI thread / view thread / core thread; a file per frame |
| decoders | decode, XXH3 against the ingest's digest, hand on the samples | nested workers of the downloader | the same | `N` decoder threads |
| paint | WebGL2 / wgpu, the VOI table, display state | the paint worker | a module of the view worker | UI thread / view thread / core thread |

The page holds intents and events only under `worker`; under `page` it is today's viewer. Native has the same modules;
only the threads differ ([`../native/README.md`](../native/README.md) §Built, #247).

**Settings.** Each is printed with the arm it ran in; a default changes only when its rule says so.

| setting | default (today's) | other values | decided by | status 2026-10-30 |
| --- | --- | --- | --- | --- |
| `?view=` | `page` | `worker` | §7's rule (B′), #229 | built, not run |
| `opts.span`, held frames a run may cross | `0` | `g` | §Experiment 1, #243 (review #248) | built and its rig, not run |
| `opts.waitAhead`, the want ascending and no ask within `k` of the running fill | off | `k` | §Experiment 2, #246 | built, not run |
| `opts.pixels`, a decoded frame's memory | `shared` (`SharedArrayBuffer`) | `transfer` | §Experiment 3, #245; M5, #226/#241 | built, not run |
| frame memory: slots, disk-only; credits `K` | none, no credits | ring of slots, disk-only, `K` | M5, #226/#241 | arms in `lab/opfs-cache` only; run in progress |
| `?writer=`, who writes the OPFS cache | `none`: no cache, as main | `store`, `decoders`, `view` | OPFS arms, #227/#242; #244 | arms in `lab/opfs-arms`, core built; run in progress |
| frame clock | the page's timer | worker rAF, timer to a schedule, `MessageChannel`, `Atomics.wait` | #225 | loaded only on a lab's play intent |
| receive loop, the downloader in the view worker | its own worker | merged | #237 | rig in `lab/recv-loop` only |
| native `--paint-thread`; `--credits`, `--budget` | `ui` | `view`, `core`; `K` 4, 64 MiB | NATIVERUN, #247 | built, not run |

*The cache's default.* The owner decided an OPFS client cache on 2026-10-10 (§1), but main has none, so `none` keeps
main's behaviour; turning it on is the owner's call, not this branch's.

**Folded in,** with `git merge --no-ff`, bases first: the unified branch (for the native line); #228, #231, #232,
#235, #239, #237; #229, #238, #243 (+#248), #246, #245, #244; #225; #212's client-cache line, then #226 → #241 and
#227 → #242; #247 with #189 → #198 → #201 → #206/#209 → #216 → #218 → #236 → #240; and the follow-ups of their
sessions as they are pushed. Each conflict and its resolution is recorded in the PR. **Superseded** once this lands
(the owner closes them): every PR above. **Out:** the viewer product (#193, #210, #214, #215), the ask-during-fill
lever (#135), ingest.
