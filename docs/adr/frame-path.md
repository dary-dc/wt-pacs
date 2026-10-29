# ADR: where a decoded frame goes — the page in or out of the pixel path, and who owns the frame store

**Status:** proposed 2026-10-11, theory only; the cache's design reviewed 2026-10-20 and **built 2026-10-27, not timed** (§Proposed: the client cache in OPFS) (queue row 148, FRAMEPATH, of
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

## Proposed: the client cache in OPFS · 2026-10-20

**Status:** a design review for the owner; the store's limit and eviction corrected 2026-10-27 for multi-GB studies
(lever 5, with its defaults). **Built 2026-10-27 with those defaults; measured 2026-10-27** (§Measurement owed): reopen
and eviction on Chromium hold, the memory window fails, eviction fails on Gecko; *fixed and measured again 2026-10-28:*
eviction holds on Gecko too, and the window still fails: the decoder workers, not the store worker, hold the frames
during a fill (§Measurement owed, *Fixes*). It builds on §1–§8 and on what is
already decided: the page stays in the pixel path (the owner, 2026-10-11, queue row 148: §8.1 settled as A unless a
measured cost says otherwise); checks stay on, the cache read's re-check included (the owner, 2026-10-11, row 151); a
frame is never decoded twice; the final image lossless and bit-exact. Sources fetched for this section are added to
[`frame-path-sources.txt`](frame-path-sources.txt) under 2026-10-20; the rest are §9's.

**Built.** The store worker is `client/viewer/store.js`, started by the viewer; both clients run under it unchanged.
`client/viewer/store.test.mjs` holds each rule below against an OPFS in memory. Where the build reads the text:

* The key is the session URL: the page knows no bundle name, and a server serves one series.
* The file is sized at the first frame checked `true`, not at open: the metadata need not carry the frame's shape.
* The per-frame present bit, min and max sit after the frames in the same file; the manifest holds the digest list,
  the shape and the last open.
* The window drops only frames already on disk, so without a cache it keeps everything, as before: question 2 is open.
* A series whole on disk still dials (question 6); a second tab on a series runs without the cache.
* Not built: the slot ring, coded storage, a second tab's `getFile()` reads, reporting.

### Background: why the page has a ceiling

The viewer keeps every decoded frame in a `Map` on the page (`client/viewer/viewer.js:33`, `take()` at :98), each a
`SharedArrayBuffer` the decoder wrote once. Nothing ever leaves it. **Measured** (queue row 273,
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Open, *The cache seam*): Chromium's `measureUserAgentSpecificMemory` puts the
page's window at the decoded size + 1 MiB, its workers at 17–144 MiB; both engines filled 8 GiB on the dev host; a
13 GiB series (512 × 3328×4096) was stopped at 339–364 frames, about 9 GiB in, by the run's cgroup (13 679 MiB), not
by the page. So the page's memory **is** the series' decoded size, and the ceiling is whatever the device allows. On a
phone that limit is not measured ([`../devices.md`](../devices.md) D5). The largest named set, `dbts_b1`, is 812.5 MiB
decoded (50 × 2560×3328, 16-bit; [`../FIXTURES.md`](../FIXTURES.md)).

### The mechanism proposed

```
                        ┌──────────── page (the consumer, as today) ────────────┐
decoder ── SAB handle ─►│ memory window: frames near the current index,         │── handle ──► paint worker
 (checked: exact)       │ within a byte budget; drops the farthest first         │
                        └───────────┬──────────────────────────▲─────────────────┘
                          handle    │ (~0.1 KB, no copy)        │ handle of a frame read back, re-checked
                                    ▼                           │
                        store worker (dedicated, started by the page)
                          one sync access handle per open series, held for the session
                                    ▼
                        OPFS  /series/<id>/frames   n × frameBytes, frame i at i × frameBytes
                              /series/<id>/manifest  present bits, per-frame min/max, the digest list it was written for
```

* **Write.** Each frame the decoder checked `true` goes to the page as today; the page puts it in the window and posts
  the same handle to the store worker, which writes it at `i × frameBytes`. The fill's clock does not see the write
  (§6). A frame leaves the window only once the store worker says it is written; until then it stays.
* **Read.** A frame outside the window is read by the store worker into a new `SharedArrayBuffer`, hashed (XXH3-64)
  against the series' frame digest, and posted back; only then can it be painted. A miss, or a failed check, is an
  ask to the downloader as today.
* **Reopen.** The page reads the metadata (its digest list), opens the series in the store worker, gets back the set
  already present, and starts the downloader with `fill` = the rest. The downloader already fills any index list as
  contiguous runs (§The downloader, *Fills are pushed*), so **neither the downloader nor either transport client
  changes**: TS and WASM clients only deliver coded bytes to it. A fully present series is decoded zero times.

### The levers, and what decides each

**1 · What is stored: decoded samples.** Not the focus; the trade-off in one table (§4 has it per entry):

| | disk a frame | reopen a frame | decided by |
| --- | --- | --- | --- |
| decoded | full size: 0.52 MB (512², 16-bit), 17.0 MB (`dbts_b1`), 27.3 MB (3328×4096) | read + re-check: **0.10 / 2.3 / 6.3 ms measured** for 0.52 / 9.85 / 27.3 MB (the exactness ADR §9, Chromium and Firefox, a container, 1×); the read itself not measured | the no-re-decoding rule: only this keeps it |
| coded | smaller by the lossless ratio (not stated in the repo for the product sets; a file-size count, not a timing, would give it) | a decode: 3.0 ms (MR 512², HTJ2K) to 69–72 ms (3328×4096, HTJ2K) and 776–804 ms (dav1d-WASM), same table | breaks the rule on every reopen |

Across the band: a series that fits the quota is stored decoded. One that does not fit is the quota's case (lever 5),
not a reason to store coded bytes for everything. Coded storage returns only if a phone reads slower than it decodes,
which §7(4)'s protocol measures.

**2 · The memory window: its budget, and what leaves first.** This is RAM, per tab; the store on disk, per origin, is
lever 5, and its limit is not this one. What leaves first is the frame farthest from the current
index (§3: a reader scrolls a stack), not the least recently used. The budget is a constant (WebKit has no
`deviceMemory`, [`../CLIENTS.md`](../CLIENTS.md) §On WebKit) until D5 measures what a phone kills a tab by. What a
budget holds, from the frame sizes above:

| budget | CT 512² 16-bit | `dbts_b1` slice | 3328×4096 mammogram |
| --- | ---: | ---: | ---: |
| 256 MiB | 512 frames | 15 | 9 |
| 1 GiB | 2 048 | 63 | 39 |

Page memory becomes the budget + frames written but not yet confirmed + the workers (17–144 MiB, row 273), whatever
the series' size. *Measured 2026-10-27 (M2, below): the risk holds on Chromium, and the window as built bounds
nothing; the store worker keeps every frame it is sent until a GC that does not come.* *Corrected 2026-10-28:* the
store worker holds no frame by reference (a `WeakRef` probe over `store.js`, not committed; the other agents not
probed); it is uncollected, because a `SharedArrayBuffer` does not count towards a worker's heap: the decoder workers
that allocate a frame collect it once idle, 18–19 s after the fill, and the store worker it is sent to not within 30 s
(*corrected in review:* this said both collect it when idle; the was arm below shows the store worker does not). Handing the
store a copy frees it after the fill; during the fill, the decoders hold every frame (*Fixes*, below). **Was: not measured, and a risk:** a `SharedArrayBuffer` is freed only when no agent holds it and each
has collected it (HTML, §9). Dropping it from the `Map` therefore lowers resident memory only after the collectors
run, on the page and in the store and paint workers. If that lags under a fast fill, the fix is the preallocated
store already open in [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Open (*one preallocated shared store per fill*):
a ring of budget-sized slots the decoders write into, which makes memory fixed by construction. That changes the
decoder's hand-off, so it is built only if the measurement asks for it.

**3 · The layout: one packed file per series, not a file per frame (revising §8.3).** New evidence since §8: every
frame of a series has one size. The ingest refuses files of another Rows, Columns, BitsAllocated or photometric, and
the metadata carries one `width`, `height` and `channels` ([`../FIXTURES.md`](../FIXTURES.md) §The metadata). So
frame `i` lives at `i × frameBytes` and no index is needed. What each layout costs:

| | packed per series (proposed) | file per frame (§8.3) |
| --- | --- | --- |
| handles | one, opened at series open, held | one per write and per read: `createSyncAccessHandle` is async and opens the file in the browser process (§4) |
| quota failure | once, up front: `truncate(n × frameBytes)` at open throws `QuotaExceededError` if it does not fit (fs `index.bs` 1576–1590); a full disk can still fail a write (lever 5, 6) | at any frame, mid-fill |
| eviction unit | the series: delete one file | a frame, or the series by deleting a directory |
| a second tab on the same series | the lock is exclusive (§4): the second tab runs without the cache, or reads with `getFile()`, which takes no lock (fs `index.bs` 485–500) | contends per frame, briefly |
| torn write after a crash | the re-check catches it (lever 6) | the same |

Pre-sizing costs the full series at open, not as frames land; that is what makes a quota failure a decision taken
before the fill, not a surprise during it. A series whose rung and zoom regions are served instead (deeper than
12 bits: the fit, [`resolution-fitting-for-large-frames.md`](resolution-fitting-for-large-frames.md) §2) gets one
packed file per rung, whose frames again share one size; zoom regions are not cached in this design.
*2026-10-27:* multi-GB studies leave the packed file standing. A study is several series, the largest one view
(812.5 MiB, `dbts_b1`) or one long run (13 GiB, row 273); its series differ in frame size, so packing a study would
bring back the index. A file per frame earns its cost only for keeping part of a series, which lever 5 does not.

**4 · Which worker holds the handles: a store worker started by the page.** Sync access handles exist only in
dedicated workers (§4). Three candidates:

* the decoder: puts up to ~17 ms a mammogram write on the decode clock, the fill's clock when decode-bound (§6). Rejected.
* the downloader: one dedicated worker less, but its thread runs the receive loop, and a busy receive loop is the
  stall the downloader exists to remove ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Why a downloader). Not proposed.
* **a store worker the page starts**: one thread more, and not a nested worker, so it does not depend on nested
  workers' sync handles, which §4 left unverified per engine. **Proposed.**

**5 · The store on disk: its limit, and what leaves first.** *Corrected 2026-10-27*, after the owner's reply to
124c and 124d (§Questions for the owner, 3 and 4): "we need OPFS to support multi-GB studies, so that budget won't be enough, and lru don't know if fits
then." This lever said: the store keeps a budget of its own below the origin's quota and evicts whole series by last
open, plain LRU, "so that the browser never has to"; the budget had no number. Three things were wrong or missing.
The 256 MiB the reply answers is lever 2's window, RAM per tab; it stays, and gives the disk no number. A budget of
ours does not keep the browser from clearing the origin: every engine clears on device-wide pressure, not when one
origin nears its own quota, where writes are only refused (below). And plain LRU evicted to stay under a budget,
without asking whether the series about to be written fits. What follows replaces it; the quota table below stands.

**The studies it must hold,** decoded, 16-bit, from [`../FIXTURES.md`](../FIXTURES.md) and
[`../av1/series.md`](../av1/series.md) §1c. The DBT rows are four views at one system's sizes from different exams,
not one patient's; slices grow ~1 per mm of breast (series.md §1c).

| study | built from | decoded |
| --- | --- | ---: |
| four-view DBT, slices | `dbts_a1`–`a4` / `dbts_c1`–`c4` / `dbts_b1`–`b4` | 1.0 / 1.1 / **2.75 GiB**; the largest view 812.5 MiB |
| the same with four synthesized 2D and four FFDM | + 4 × 2560×3328, + 4 × 3328×4096 | 1.15 / 1.22 / **2.9 GiB** |
| + projections, 15 a view at 4096×3328 (Hologic, series.md §1b; not read in screening) | | + 1.5 GiB |
| a screening study read with two prior combo studies | three of the row above | 3.5 / 3.7 / **8.7 GiB** |
| breast ultrasound cine, whole (`usb_cine`, `usb_cine_rgb` before cutting to 64) | 515 × 512² grey, 413 × 512² RGB | 129 / 310 MiB |
| an angiography run, 1024² 16-bit, 30 frames/s for 20 s (a size the standard allows; no fixture) | 600 frames | 1.17 GiB |
| row 273's series | 512 × 3328×4096 | 13 GiB |

**What each engine gives, from source** (2026-10-27 sources below; §4 and the table under this lever for the rest):

| engine | the real limit, per origin | what `estimate().quota` says | what clears the origin whole, best-effort |
| --- | --- | --- | --- |
| Chromium | 60 % of disk, checked at `truncate` and at every write that grows the file | **usage + 10 GiB**, whatever the disk: the static reported quota, on by default | a round that starts when all origins pass 0.7 × the pool (56 % of disk), or free disk falls under min(2 GiB, 10 %); LRU, persisted spared |
| Gecko | 10 % of disk, at most 10 GB, per site; **50 %** once persisted | that limit, as it is | the global limit (50 % of disk) reached: inactive best-effort origins, LRU; an origin with open files skipped |
| WebKit | 60 % of the volume in a browser, 15 % in an app's web view | a standard figure doubled until ≥ 2 × usage, capped at the limit: low early | total quota (80 % / 20 %), LRU, sparing open pages and persisted; ITP's deletion (§4, lever 8) |

On a 128 GB phone that is 77 GB (Chromium, Safari), 19 GB (a web view), 10 GB (Firefox, unpersisted; 64 GB
persisted): a study with priors fits in every one, and in unpersisted Firefox only one of the largest at a time.
Free disk binds before any of these on a full phone, and no API says how much there is: the quota "must not be a
function of the available storage space" (Storage §Usage and quota).

**Weighed.**

* **A fixed budget.** Below 10 GB it refuses the study with priors above; above 10 GB it never binds in unpersisted
  Firefox, and elsewhere sits under a limit the engine already enforces. Either way it does not answer "does it fit".
* **A fraction of `estimate().quota` with headroom.** Three engines, three meanings. Chromium's is usage + 10 GiB, so a
  fraction f stops the store at 10f / (1 − f) GiB, a constant in disguise (40 GiB at 0.8, 10 at 0.5); WebKit's is low
  until usage grows, so the store would evict for room it has; only Gecko's is the limit. Headroom under the limit
  buys nothing: reaching it refuses our write, harmlessly; device pressure clears us whatever our margin.
* **Trying.** The series' size is known before a byte arrives (n × frameBytes, lever 3), and `truncate` to it is the
  engine's own answer, the same on all three. **Recommended:** no budget of ours; the limit is the engine's, found by
  `truncate` at open. `estimate()` decides nothing.

**Eviction: least recently opened first, only to make room.**

* **Unit:** the series, one file (lever 3). **Order:** the series' last open. A study's series open together, so this
  is LRU by study in effect, priors included. Weighting by size or by reopening changes the order alone, not the
  layout or the rule; no reopen data favours one, so it waits for that data.
* **When:** a `truncate` refused at open. Delete the least recently opened series not open, retry, until it fits or
  nothing is left to delete. Nothing is evicted on a timer or to keep a margin.
* **Never evicted:** a series open in any tab. This tab's store worker knows its own; another tab's it learns by taking
  the victim's sync access handle first, which throws `NoModificationAllowedError` while that tab holds it (§4), and
  then skips it. The spec's `removeEntry` takes no lock (fs `index.bs` 993–1035). *Corrected 2026-10-27:* this said
  it deletes while holding the handle; headless Chromium 153 refuses `removeEntry` under any open handle, its own
  included (`NoModificationAllowedError`, run once), so the store closes the handle and then removes. Gecko and WebKit
  are not run. Nothing else is
  protected: a prior study not open is as evictable as any.
* **A series bigger than the store** (still refused with nothing left to delete): kept nowhere on disk; it runs on the
  window alone, and 124b's rule applies past it. Keeping the part around the reader needs slots reused by index, an
  index, and eviction inside a series: the per-frame machinery lever 3 removed, for a case not measured as common.
* **The disk fills mid-fill.** `truncate` reserves quota, not disk: Chromium sizes the file with `ftruncate`, which
  allocates no blocks on ext4, f2fs or APFS, and Gecko's is a truncate behind the same quota check (WebKit not traced).
  So a write can still throw. The same rule, once: delete the least recently opened series not open and retry the
  write; else stop writing this series. Frames already written stay present.
* **`persist()`, asked at the first series opened** (124e: "ask"). It is what spares a multi-GB store from device
  pressure on Chromium and WebKit, and it lifts Firefox from 10 GB to 50 % of disk. Its cost is Firefox's prompt as
  the series opens (lever 8).

**Writing a multi-GB series** is lever 4's store worker and §Where it saturates: one sync handle, writes off the fill's
clock, 13 GiB at the 125 MB/s ceiling taking ≥ 110 s of arrival. A crash is lever 6's: present bits never flushed,
the re-check on every read.

**The defaults** (the build row's), and the measurement that would change each:

| setting | default | changed by |
| --- | --- | --- |
| memory window, RAM per tab (lever 2) | 256 MiB, farthest from the current index first | D5: what a phone kills a tab by |
| store limit, disk per origin | none of ours: the engine's, found by `truncate` at open; `estimate()` unused | (8) or a phone showing the origin cleared whole or the disk full mid-fill often: then a cap of ours |
| unit of eviction | the series, one packed file | scroll-back past the window inside series bigger than the store, if common |
| order | least recently opened first, only when a `truncate` is refused | a reopen log: if large series come back less, weight by size |
| never evicted | a series open in any tab | — |
| a series bigger than the store | nothing on disk; the window alone | how often a study outgrows the store, from product sizes against devices |
| a write that throws mid-fill | evict one, retry once, else stop writing this series | (9) |
| `persist()` | asked once, at the first series opened | whether Firefox's prompt then is acceptable (lever 8) |

Quotas from the sources (§4 and the 2026-10-20 sources):

| engine | per origin | private window | a cleared cache |
| --- | --- | --- | --- |
| Chromium | 60 % of disk (§4) | OPFS works **in memory**: a pool of 15–20 % of physical RAM, a third per origin, so 5–6.7 % of RAM, ~410–546 MiB on an 8 GiB phone (`quota_settings.cc` 32–46) | LRU of origins under pressure (§4) |
| WebKit, Safari 17+ | up to 60 % of disk in a browser app, 15 % in other apps; 80 % / 20 % overall (WebKit blog 14403) | by source, `getDirectory()` fails: an ephemeral session has no storage path and an empty path is refused (`NetworkStorageManager.cpp` 123–126, 624–625; `FileSystemStorageManager.cpp` 81–82). Not run | LRU of origins, sparing one with an open page or in persistent mode (blog 14403); and ITP's deletion after 30 operating days by source, 7 when flagged (§4), which a Home Screen web app counts by its own use (WebKit blog 10218) |
| Gecko | 10 % of disk, at most 10 GB (§4): ~12 `dbts_b1` series | OPFS is off: `dom.fs.privateBrowsing.enabled` defaults to `false` (`StaticPrefList.yaml` 5498–5501) | LRU of best-effort sites (§4) |

On iOS every browser is WebKit, so the WebKit row is the iPhone's (outside the EU's alternative engines; not traced).

**6 · Integrity: the frame digest, checked on every read.** Unchanged from §5 and the exactness ADR §8 *A client
cache*: store only frames checked `true`; on read, XXH3-64 against the digest, measured at 0.10–6.5 ms a frame (above).
The series has no identifier and no metadata version today ([`../FIXTURES.md`](../FIXTURES.md): no UID is copied).
So the key is the bundle's name, and the manifest keeps the digest list it was written for. At open, a list that
differs drops the series whole. That is a comparison, not a digest used as a key (exactness ADR §7). When the
metadata comes from the per-study database (the next point, M1), its series identity and version become the key. The
present bits are written after the frame and never flushed, so a crash can leave a bit set on a torn frame; the
re-check is the guard, which is why it cannot be switched off for cache reads.

**7 · Failure modes, and what the page does.**

| failure | seen as | the page does |
| --- | --- | --- |
| no OPFS: Firefox private, Safari private (by source), an engine without it | `getDirectory()` rejects | no cache: the window alone (below) |
| the series does not fit | `truncate` at open throws `QuotaExceededError` (*corrected 2026-10-27:* this also read `estimate()`, which lever 5 shows decides nothing; *measured 2026-10-27, M3:* Gecko 159 throws `NS_ERROR_FILE_NO_DEVICE_SPACE` instead, which the store does not take as a refusal; *fixed 2026-10-28:* it takes that name too) | delete the least recently opened series not open, retry until it fits (lever 5; this said "try once"); else no cache for this series |
| the disk fills mid-fill | a write throws though `truncate` passed (a sparse file, lever 5) | delete one such series, retry once; else stop writing this series |
| Chromium private window | it fits, but the "disk" is RAM in the browser process | the same rule: it caches only what fits 5–6.7 % of RAM, which then lifts nothing; not detectable as such, and not worth special code |
| storage pressure, or ITP, empties the origin between opens | the manifest is missing | a fresh fill |
| the files vanish while open | a read throws | a miss: ask the downloader |
| two tabs, one series | `NoModificationAllowedError` at open | the second tab: no cache, or reads with `getFile()` |
| a damaged frame on disk | the re-check fails | evict that frame's bit, ask the downloader; report it |

**Without a cache, the no-re-decoding rule cannot hold for a series bigger than the budget.** Something must give:
either the window drops its farthest frames and asks for them again (a second decode, a refetch), or it keeps them
all, which is today's ceiling and a risk of the tab being killed. That is a choice for the owner.

**8 · `persist()`** (§8.5, still open). It is `[Exposed=Window]`, so the page asks for it; Chromium and WebKit refuse
it to a frame of another origin. *Corrected 2026-10-22:* this said that on WebKit it spares the origin from quota
eviction but not from ITP's deletion, and that how Chromium and Gecko grant it was not traced. Traced from source
(§Sources, 2026-10-22); nothing run:

| engine | how it is granted | a persisted origin survives | it does not survive |
| --- | --- | --- | --- |
| Chromium, desktop and Android | **no prompt.** Granted at once if the site is an installed web app, or among the profile's 10 "important" sites (medium engagement, notifications allowed, a bookmark, home-screen launches); else `false`, also when cookies are blocked or session-only. A refusal is not stored, so a later ask can succeed | storage pressure: eviction takes only buckets not persisted | the user clearing site data (MDN) |
| Gecko, desktop | **a doorhanger prompt**, Allow / Block, remembered; no user gesture needed; in a private window refused without one | storage pressure; and its quota rises from 10 % to 50 % of disk, free of the 10 GB group limit (MDN) | the user clearing data (MDN) |
| Gecko, Firefox for Android | **a dialog prompt**, the default "ask", remembered | as desktop by the shared code; Android's quota not traced | as desktop |
| WebKit: Safari, and every iOS browser | **no prompt.** Granted only to a domain ITP already exempts from deletion: a Home Screen web app's own domain, an app's app-bound domains, managed domains, a list the embedding app sets. Else `false`: in a Safari tab, an ephemeral session, or with ITP off | quota eviction, by the grant (blog 14403); ITP's deletion, by the exemption the grant requires, not by the grant | the user clearing all website data, which removes the grant too |

So on WebKit the old line holds in effect: in a Safari tab `persist()` is refused and ITP's deletion applies (30
operating days by source, 7 when flagged, §4); a Home Screen web app is exempt from that deletion whether it asks or
not, and asking adds only the quota-eviction exemption. The WebKit blog's "counts by its own use" (above, 10218) and
the source's exemption differ; the source is newer. **On phones:** Android Chrome runs the same rule, and which
installs count there (a WebAPK or a shortcut) was not traced. On iOS a Safari tab is refused, a Home Screen web app
granted, and an in-app browser (a `WKWebView`) granted only for its app's app-bound or listed domains; whether ITP
runs in a third-party browser's or an app's data store, and `SFSafariViewController`, were not traced. A
`WKWebsiteDataStore.nonPersistent()` view is an ephemeral session, so it has no OPFS by the source cited for Safari
private above; not run.

**What 124e (ask on the first series opened, or never) means per engine:**

* **Chromium:** asking shows nothing. A first-time reader gets `false`; a regular, bookmarked or installed one gets
  `true`, and the cache leaves eviction under pressure. Never: the origin stays best-effort, evicted whole, LRU.
* **Firefox, desktop and Android:** asking shows a prompt as the series opens, not after an act the reader thinks
  needs saving, which web.dev advises against; Allow lifts the quota from 10 % to 50 % of disk. Never: no prompt, the
  10 % / 10 GB cap (~12 `dbts_b1` series, above) and LRU eviction.
* **WebKit:** asking shows nothing and returns `false` in a Safari tab, so it changes nothing there; in a Home Screen
  web app it adds the quota-eviction exemption. Never: the same in a tab; in a Home Screen web app, quota eviction may
  take the cache.

**What decides it:** whether a Firefox prompt at the first series is acceptable to a reader mid-study; whether the
product is meant to be installed (a Chromium install or a Home Screen web app is where asking pays); and whether the
refetch a cleared cache costs on a wireless link is worth protecting a cache that §7 already lets be emptied.

**What 124b (past the window without a cache: drop and re-ask, or keep everything) means per engine.** It applies in
Firefox and Safari private windows and a `nonPersistent` web view (no OPFS); in a Chromium Incognito window, whose
OPFS is RAM in the browser process (5–6.7 % of RAM, above), so a cache there lifts nothing; and wherever a series
exceeds the quota (Firefox's 10 % unpersisted, a web view's 15 %).

* **Drop and re-ask:** the tab stays inside its budget on every engine; a frame scrolled back past the window is
  fetched again over the link and decoded a second time, breaking the no-re-decoding rule for that frame.
* **Keep everything:** no frame decoded twice; the page's memory grows with the series as today, and a phone that
  kills the tab loses the whole series, not one frame. What iOS and Android kill a tab at is D5's to measure, not traced.

**What decides it:** D5's kill threshold against the product's series sizes; how often a reader scrolls back past
the window; the link's cost of a refetch. No engine's source changes the trade, only where it applies.

### Where it saturates, predicted

The write rate the cache must keep up with is the decoded arrival rate: the link's coded rate × the lossless ratio.
At 100 Mbit/s and any ratio up to 10, that is at most 125 MB/s, against ≥ 1 GB/s predicted for Chromium and WebKit
writes (§4). On the target link the write does not bind, on that prediction. Gecko's write takes a synchronous quota
round trip per call (§4), so its ceiling is unknown. Reads bind sooner: cine of `dbts_b1`-sized frames at 30 frames/s
is 511 MB/s of read + check, and the check alone is ~5 ms a 17 MB frame on the container (its 3.3 GB/s, measured, exactness §9).
A phone is not measured, so nothing is claimed for it.

### Measurement owed (proposed, not queued)

§7(4) stands (write, read + check, reopen against a fresh fill). Added: **(5)** the 13 GiB series of row 273 under a
256 MiB window, Chromium and Firefox, with page memory read every second. It passes if the fill completes exact and
memory stays within budget + 160 MiB. It is mutated by a window that never drops, which must fail. In unpersisted
Firefox the series is also bigger than the store (10 GB), so it runs lever 5's last case. **(6)** each row of
lever 7's table forced through the store's own lever (a quota it is told, a manifest it is told is gone), not through
the browser, with each test mutated; added 2026-10-27: a refused `truncate` deletes least recently opened series until
it fits, and skips one a second tab holds open (mutated by an evictor that ignores open series). **(7)** the lossless
ratio of the product sets, by file size. *Added 2026-10-27, for lever 5:* **(8)** the engines' own refusal, made small:
Firefox with `dom.quotaManager.temporaryStorage.fixedLimit` set (the per-site limit is a fifth of it, `ActorsParent.cpp`
1413–1416, 8377–8386), Chromium with DevTools' `Storage.overrideQuotaForOrigin`, which the enforced quota reads
(`quota_manager_impl.cc` 250–256, 1346–1380). Open series in turn summing past the limit, a second tab holding one open: it passes
if each refusal deletes the least recently opened series not open, none open is deleted, and every frame is exact. If
the engine removes a file another tab holds, or refuses later than `truncate`, lever 5's rule is wrong there. **(9)** a
write past free disk: the profile on a small fixed-size filesystem, a series within quota but beyond free space. It
passes if the write's failure deletes one series and retries, then stops writing, every frame exact; it records whether
`truncate` there allocated blocks.

**Pre-registered 2026-10-27, before any run, for the build** (`claude/opfs-cache-build`), on the 4-vCPU agent
container: a millisecond there is container-measured ([`../rig-limits.md`](../rig-limits.md)). Series are
`lab/viewer-ceiling/make_series.py`'s, 16-bit grey, 64 distinct fields cycled; every frame is checked twice, by the
page's XXH3 against the metadata and by the rig's SHA-256 against the encoder input. Arms are ordered per round by
`lab/order.mjs`; ≥ 7 rounds; each arm's full settings printed with its rows. Rig: `lab/opfs-cache/`.

| cell | arms | measured | predicted | rule |
| --- | --- | --- | --- | --- |
| **M1** reopen against a fetch, (4) | **F**: a fresh profile fills over `link_impair.py`, 20 ms one way, 20 Mbit each way, 500-packet queue, 0 % or 2 % iid each way; **R**: the series reopened from OPFS by the product's store worker in the same origin, every frame read and re-checked. Sets: 256 × 512², both links; 32 × 3328×4096, clean only (2 % would take tens of minutes a round) | the series whole and exact in hand: F the page's own `fill` (dial → last frame), R the worker's start → its last read checked. The page cache is warm for R: a cold read is not measured | R ≤ 0.1 × F every round; R ≤ 0.2 s on 512², ≤ 2 s on 3328×4096 | **holds** if R ≤ 0.5 × F in every non-VOID round of every cell; else the store's reopen is no faster than the link and lever 1 returns to the owner. And §7's rule: per frame, R / n against the decode of the same size (3.0 ms at 512², 69–72 ms at 3328×4096, the exactness ADR §9): store decoded if lower on both |
| **M2** page memory during a fill, (5) | **on**: the store as built; **off**: the store worker answering every call with an error (the page's no-OPFS path), routed by the rig. 80 × 3328×4096 (2.03 GiB) on loopback; 512 × 3328×4096 (13 GiB) on alone | the browser tree's PSS, sampled each second, its peak less its value before the dial | on: growth ≤ 256 + 160 MiB; off: growth ≥ 0.95 × the decoded size; 13 GiB on: ≤ 416 MiB, the fill complete. The off arm at 13 GiB is not run: row 273 saturated this class of host at ~9 GiB | **holds** if every on round is within 416 MiB and complete and exact; a mutant window that never drops must fail it |
| **M3** a multi-GB study against the store's limit, (8) | the quota overridden to 1 300 MiB (Chromium, DevTools' `Storage.overrideQuotaForOrigin`); four series A–D of 20 × 3328×4096 (520 MiB each) opened in turn in one origin, B held open in a second tab from its open; then the second tab closed and A opened again | the series on disk after each open, read from OPFS; every frame | after A: {A}; B: {A, B}; C: {B, C}, A evicted; D: {B, D}, B skipped as held, C evicted; A again: {A, D}, B evicted. Refusal at `truncate`, never later | **holds** if every step's set is the predicted one and every frame exact, in every round. Mutants: eviction most recent first; no probe of a held series (on Chromium it is predicted to survive: the engine refuses the removal itself) |
| **M4** a tab killed mid-write, lever 6 | 64 × 3328×4096 filled on loopback in a kept profile; the browser killed (`SIGKILL`, the process group) once the page shows ≥ 32 on disk, then reopened; in half the rounds one present frame's bytes in the profile's OPFS file are flipped before reopening, as a torn write would leave them (a kill alone does not tear: the kernel keeps what was written) | the frames present on reopen; what the fill asks; every frame at the end | present ≥ the count shown at the kill; the fill asks exactly the rest; the flipped frame fails its re-check, is reported and asked again; 64 / 64 exact | **holds** if no round shows a frame not exact, and the flipped frame is caught every time. Mutant: the read without its re-check, which must fail |

**A/A first, and VOID.** M1 runs F and R twice a round (F, F′, R, R′) and M2 runs on twice (on, on′). A cell is
**VOID** when the median of its A/A ratios over the rounds (F′/F, R′/R) lies outside 0.90–1.10, or, for M2, when the
median |on′ − on| exceeds 64 MiB; a round in which the relay's own timing guard (`--self-timing`) reads `VOID` is
dropped and counted. M3 and M4 are rules on states, not timings: no A/A. Firefox and WebKit are run only where the
container can; a cell not run on an engine says so.

**Measured 2026-10-27** (by `lab/opfs-cache/`'s `summary.py`; *corrected 2026-10-28:* this read "the rows:
`lab/opfs-cache/`", but they are in its untracked `work/`, not committed). Chromium 153.0.8010.12, Playwright's headless
shell, every cell; Firefox 159.0 on an Xvfb display, M3 only; **WebKit not run** (no build in the container). Every
frame of every arm was exact by both checks, except where a mutant made it not.

| cell | measured | verdict |
| --- | --- | --- |
| M1 · 256 × 512², clean | F 7.49 s [7.49–7.50], R 174 ms [157–208]; R / F ≤ 0.028; A/A F′/F 1.000, R′/R 0.997; 6 rounds, 1 dropped on the relay's guard | **holds**; "R ≤ 0.2 s" missed in 1 round (208 ms) |
| M1 · 256 × 512², 2 % | F 70.5 s [70.0–71.0], R 187 ms [165–206]; R / F ≤ 0.003; A/A 0.985, 1.073; 6 rounds, 1 dropped | **holds**; "R ≤ 0.2 s" missed in 1 (206 ms) |
| M1 · 32 × 3328×4096, clean | F 31.11 s [31.09–31.12], R 712 ms [665–773]; R / F ≤ 0.025; A/A 1.000, **1.093**, near the 1.10 bar; 7 rounds | **holds** |
| §7's rule, from M1 | read + re-check a frame, R / n: 0.68–0.73 ms at 512², 22.3 ms at 3328×4096, against a decode of 3.0 and 69–72 ms | **decoded samples stay**: lower on both sets. The page cache was warm; a cold read is not measured |
| M2 · 80 × 3328×4096, 2.03 GiB | growth on 2 521 MiB [2 394–2 543], on′ 2 524 [2 398–2 532], off 2 287 [2 184–2 359]; A/A median \|on′ − on\| 11 MiB; 7 rounds, all complete | **fails**: on is over 416 MiB in 7 of 7, and above off. The never-drops mutant reads 2 529 MiB, the same: the window bounds nothing |
| M2 · 512 × 3328×4096, 13 GiB, on | the host's guard (under 1 536 MiB available) stopped 7 of 7 at 12.0–12.7 GiB of growth, ~460 of 512 frames, all exact so far | **fails**. **The container saturates there**: nothing past ~12 GiB of growth is claimed |
| M3 · Chromium | 7 of 7 rounds, every step's set as predicted, every frame exact; refusal at `truncate` (`QuotaExceededError`). Mutants: most recent first caught; no probe survived, as predicted (Chromium refuses `removeEntry` under any handle) | **holds** |
| M3 · Firefox, `fixedLimit` 1 300 MiB per site | 0 of 6 rounds (a 7th hung in the rig's BiDi driver, killed at 26 min: VOID). At C, Gecko's `truncate` throws `NS_ERROR_FILE_NO_DEVICE_SPACE`, not a `QuotaExceededError`; the store stops the series and evicts nothing, so C and D run on the window alone, exact | **fails on Gecko: lever 5's rule is wrong there**, by one error name. With the store also taking that name (a stand-in): 2 of 2 rounds hold, B skipped while held |
| M4 | 7 of 7: shown at the kill 32–34, present on reopen 32–36 (never fewer); the fill asked exactly the rest; the flipped frame caught 4 of 4, reported and asked again; 64 / 64 exact at the end. Mutant without the re-check: caught by SHA-256, while the page marked the frame exact | **holds** |

**Why M2 fails** (a diagnostic after the cells, not pre-registered, 3 rounds each of the 2 GiB on arm, `--expose-gc`).
Growth stays at 2 376–2 379 MiB 30 s after the fill, and after `gc()` on the page. `gc()` in the store worker
brings it to 530–532 MiB; the paint, downloader and decoder workers then change nothing. So the store worker holds
every frame it was sent (*corrected 2026-10-28:* by no reference, only uncollected, and the decoders hold them too until
they idle; *Fixes*, below): each write's `SharedArrayBuffer` stays until that worker's isolate collects, which it does
not on its own. Lever 2's risk holds (below). Even fully collected, growth is 530 MiB, over the 416 predicted.
`measureUserAgentSpecificMemory` is not exposed in the headless shell, so the page/worker split row 273 used is not
read here.

**Seen along the way, not pre-registered.** A viewer's lock on its series outlived its page by 1.6–1.9 s after a
navigation (M3) and 7.7–9.2 s after a fill (M4): a reopen in that time runs without the cache. The status line's
`on disk` lags the writes, since it is redrawn only at the next frame. A frame asked again after a failed re-check
counts towards the fill's end, so the page's `fill` time was stamped one frame early in 2 of M4's 4 flipped rounds.
Gecko also refuses `removeEntry` under an open handle, and a write past its limit returns 0 bytes instead of throwing
(one run each, same worker); (9) is not run. CPU: M1's fetches 10–20 % busy (link-bound), M2's off arm 80 % (three
decoders on four cores).

**Fixes, measured 2026-10-28** (`claude/opfs-cache-fixes`, same container, Chromium 153, Firefox 159.0; the rows
are not committed: `lab/opfs-cache/`'s `work/` is untracked, so the numbers below cannot be re-derived from the repo). The store takes `NS_ERROR_FILE_NO_DEVICE_SPACE` as a refused size, and the page hands the store
worker a copy of each frame it owns (a transferred `ArrayBuffer`) in place of the frame's `SharedArrayBuffer`. M2 ran
as registered with a fourth arm interleaved, **was**: the build before the copy, by a stand-in.

| cell | 2026-10-27 | 2026-10-28 | verdict |
| --- | --- | --- | --- |
| M2 · 2 GiB | on 2 521 MiB, A/A 11 MiB | on 2 970 [2 615–3 149], on′ 2 924 [2 613–3 265], off 2 345 [2 226–2 380], was 2 584 [2 457–2 654]; A/A median \|on′ − on\| **266 MiB**; 7 rounds, all complete and exact. Fill: on 7.87 s, was 7.11 s, off 5.90 s. Never-drops mutant 2 757–3 060 MiB | **VOID** by its A/A, and every on round over 416 MiB: the copy does not bound the fill's peak. *Corrected in review:* this also said the copy raises the peak ~390 MiB over was and slows the fill ~10 %; in a VOID cell no arm is compared, and on − was (386 MiB) is under 1.5 × the A/A's 266, with their ranges overlapping; the fill time has no A/A reported: neither cost is measured |
| M2 · 13 GiB, on | stopped at 12.0–12.7 GiB, 7 of 7 | the host's guard stopped 7 of 7 at 12.0–12.7 GiB of growth, 396–449 of 512 frames, all exact so far | **fails**; the container saturates there, as before |
| M3 · Chromium | 7 of 7 | 7 of 7, every step's set as predicted, every frame exact | **holds** |
| M3 · Firefox 159 | 0 of 6, 1 VOID | 7 of 7: C evicts A at `truncate`, D skips B as held and evicts C, A again evicts B; every frame exact | **holds** |

*Why M2 still fails* (the diagnostic, not pre-registered, `--expose-gc`, 3 rounds of on and of was alternated): after
the fill, on returns to 531–536 MiB by itself 18–19 s later; was stays at 2 377–2 381 MiB for 30 s, and after `gc()`
on the page, until `gc()` in the store worker. At the fill's end (2 rounds of on), `gc()` on the page and in the paint
worker frees nothing, in the store worker 150–290 MiB (its copies), in the decoder workers the rest, down to 533–537 MiB. So
the store worker no longer keeps what it is sent, and the decoder workers keep every frame they allocated until they idle.
Node 22 shows the mechanism on its own: 80 unreachable 27 MiB `SharedArrayBuffer`s allocated without a `gc()` leave
2 200 MiB resident, `ArrayBuffer`s 149 MiB; sent to a worker that drops them, 2 218 MiB against 167 for
transferred copies. A frame's memory is bounded during a fill only by buffers reused, not collected: lever 2's slot
ring.

**Left open:** the fix for M2 (lever 2's ring of slots), the owner's (weighed for the view worker below, §Who owns a frame's memory), and whether the store's copy stays without it
(it frees the fill's frames after it; its cost to the fill's peak and time is not measured, M2 being VOID); WebKit; (5) on Firefox; (9); questions 2 and 6.

### Who owns a frame's memory (2026-10-28)

**Status:** theory and a reading of the engines' sources; nothing built, nothing run. The shape it assumes is the
owner's of 2026-10-28, written nowhere else yet: one dedicated **view worker** holds the frame store (the memory window,
OPFS behind it), the controller and the paint; the decoders, nested in the downloader worker, post each checked frame
straight to it. The question: who owns a decoded frame's memory, so that the window bounds peak memory during a fill on
every engine. The finding it answers is M2's (*Fixes*, above); lever 2 names the ring.

**What each engine's collector sees** (pinned sources below):

| engine | a `SharedArrayBuffer`'s backing store | a transferred `ArrayBuffer` | what starts a collection |
| --- | --- | --- | --- |
| V8 | **counted as 0 bytes** in every isolate that holds it, "to avoid GC thrashing" (a TODO) | counted at its length in the isolate that holds it; the sender's count is cleared on detach | external memory past limits set from the last GC (the soft one 64 MiB over its low since then) starts marking or a collection. *Corrected 2026-10-29 (independent review):* the soft limit is defined there and called nowhere in the files read; an allocation past its low since the last GC + 128 KiB starts marking only once the global limit is reached, which grows that low by a factor (`heap-controller.cc` 307–315, 487–490): proportional, not 64 MiB |
| SpiderMonkey | counted at its length, once per zone (each worker is its own), whatever the holders | counted at its length | a zone's malloc bytes past max(retained, 38 MiB) × 1.5–3.0 |
| JavaScriptCore | counted at its length by every wrapper ("probably overcounts") | the same | the heap, extra memory included, past a proportional multiple of the last live size |

So M2's failure is V8's alone by source: a dropped frame weighs nothing there, and only a collection the JS heap
itself asks for frees it. Gecko and JSC should collect a dropped frame on pressure, with slack in proportion to what is
held. No web API forces a collection; V8's `ExternalMemoryAccounter` is the embedder's, not a page's. *Not measured:*
M2 never ran on Firefox, and WebKit not at all.

**The candidates.** Copies are of the decoded samples, in script, from the decoder's output to the store, per frame;
the paint's upload (GL) and the OPFS write (the kernel) are the same in all. Today, counted from the code
(`htj2k.js` `decodeWith`, `av1-frame.js` `begin`, `av1-webcodecs.js` `read`, `viewer.js` `write`): HTJ2K **2** (the heap
into a new `SharedArrayBuffer`, then the page's copy for the store, *Fixes*), dav1d **2** (its pack is the first),
WebCodecs **3** (`copyTo`, the pack, the page's). The decode-side count of
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The container campaign, *Per frame, counted from the code* (3 for HTJ2K, the coded bytes' two included) rises to 4
with the store's copy.

| | **(a)** a `SharedArrayBuffer` a frame, collected sooner | **(a′)** a transferred `ArrayBuffer` a frame | **(b)** a ring of largest-frame slots | **(c)** slots carved once per series |
| --- | --- | --- | --- | --- |
| memory during a fill | V8: unbounded, as M2; Gecko and JSC: window + collector slack | window + collector slack on every engine: V8 64 MiB and its marking's length (*corrected 2026-10-29:* V8's is proportional too, above), Gecko up to 0.5–2 × the window, JSC proportional | **fixed**: the ring | **fixed**: the ring |
| copies, HTJ2K / dav1d / WebCodecs | 1 / 1 / 2 | 1 / 1 / 2 | 1 / 1 / 2 | 1 / 1 / 2 |
| what the window holds at 256 MiB | the budget | the budget | the study's largest frame sets every slot: with a mammogram in it, 9 slots, so a CT series keeps 9 frames, not 512 | the series' own: 512 at 512², 9 at 3328×4096 |
| new machinery | none, and nothing to build it with on V8 | the decoder's output type and a transfer list | a slot table, backpressure, the races below | the same as (b) |
| races | none (single-threaded reads, frames never reused) | none: a transfer detaches the sender | below | below |

The copy falls by one under every candidate, and the fall is the **shape's**, not the owner's choice: in one thread the
store writes OPFS from what it holds, so the page's copy for the store goes. Against each other the four copy the same.
Writing into a slot is the copy the decoder already makes: `set(out)` into the slot's view in place of a new buffer;
dav1d's pack writes its output view over the slot. WebCodecs' `copyTo` takes a shared view (`AllowSharedBufferSource`),
so it could write the slot directly, but a grey 4:2:0 frame brings its chroma (a slot half as large again at 8 bits)
and the split and offset still want a pass: not counted. (b) wastes the window whenever a study mixes frame sizes;
(c) does not, because one series has one frame size (lever 3). A tab shows one series today (a server serves one), so
(c) carves one `SharedArrayBuffer` of the budget once; several series on screen would share it, re-carved only with
every slot free, which is not designed here. A second buffer is never allocated: on V8 the first would never be freed.

**How (c) works.** A slot table of one `Int32` a slot, in a small `SharedArrayBuffer` sent once with the ring: free,
or the decoder writing it, or held by the store, with a take count. A decoder takes a slot by `compareExchange` when it
**begins** a frame (not when one is queued, so at most one slot a decoder, three of nine on a mammogram), decodes,
hashes the slot (the exactness check, unchanged, while the decoder still owns it), and posts `{ index, slot, take }`.
The store frees a slot on eviction. A decoder that finds none free says so on its port and the store answers when one
frees; the store checks on receipt, so no wake-up is lost, and no thread blocks. A read back from OPFS takes a free
slot the same way, reads into it (sync access handles take shared views, §4) and re-checks it there.

* **Every slot held.** With OPFS a slot frees one synchronous write after its frame lands, so a fill dries the ring
  only when nothing can be dropped: no OPFS, or a write refused. Then the decoders stop, their two frames each stay
  queued, and dispatch stops. That reaches the wire only through the reader pause, proposed and not built
  ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The downloader, *Memory*); until it is, coded bytes queue, at most the
  series' coded size. Under (c) question 2's *keep everything* cannot be had: past the budget the fill stops or drops
  the farthest. An ask outranks the window: the store evicts the farthest frame for it, on disk or not.
* **Races.** The paint's `texSubImage2D` and the OPFS `write` both read the slot synchronously in the view worker, so
  neither can see it reused mid-read; nothing else in that thread yields between them. A decoder writes only a slot it
  took, and a frame decoded again after a mismatch reuses its own. Three cases need a rule: an AV1 preview layer stays
  its own transferred buffer outside the ring (a slot would be overwritten by the exact frame while the preview is shown); a
  cancelled frame's decoder frees its slot itself; a dead decoder's slots are freed by the store only once the
  downloader has terminated it. A double free would paint another frame silently, after the check: the store compares
  the slot's take count before and after each read (two `Atomics.load`), and drops and re-asks on a change.

**Recommendation: (c).** It is the only candidate that bounds a fill by construction on V8, where M2 failed, and
on the other engines by a number we choose instead of a growth factor. Its cost is the slot table and the rules
above, on the decoders' output and in the store. **What would turn it over:** (a′) meeting the same rule on
Chromium and Firefox in the protocol below: then the collector's slack is small enough in practice, and (a′) needs no
table, no backpressure and no new failure mode. Also: the ring losing fill time beyond its A/A (decoders waiting on
slots); a hanging protocol putting series of different frame sizes on screen at once, which wants a byte allocator,
not slots; a budget under four of a series' frames (three decoders and the frame shown), which (c) cannot serve.

**Protocol, M5, pre-registered 2026-10-28, before any build or data.** M2's rig (`lab/opfs-cache/run.mjs`, cell `m2`)
and its rules carry over: the 4-vCPU container, the 80 × 3328×4096 series (2.03 GiB) on loopback, a 256 MiB window,
a fresh profile an arm, the browser tree's PSS each second, peak less the value before the dial; every frame checked
by the decoder's XXH3 and the rig's SHA-256; arms ordered per round by `lab/order.mjs`; ≥ 7 rounds; each arm's
settings printed with its rows; CPU busy recorded. Chromium as M2; Firefox on Xvfb, which needs the rig's Firefox
driver taken from M3 to `m2` (a rig change, made in the later row). WebKit is not run (no build in the container). *Corrected 2026-10-29:* `browser` already sends `m2` to the
Firefox driver under `--engine firefox`; what `m2` lacks is the engine in its settings and rows. The arms are three
client trees, and the rig serves one (`today`'s `was` was a stand-in): serving them side by side is a rig change too.

| arm | build |
| --- | --- |
| `ring`, `ring′` | the view worker with (c); `ring′` the same, run again: the A/A |
| `today` | `claude/opfs-cache-fixes` as measured 2026-10-28 (the page's window, the store handed copies) |
| `transfer` | the view worker with (a′): the same shape, the decoder posting a transferred `ArrayBuffer` |

* **Measured:** growth, the fill's time (dial → last frame checked), exactness, and on `ring` the decoders' slot waits
  (count and total ms).
* **Predicted:** `ring` 530–600 MiB on both engines: the floor once everything is collected, 531–537 MiB (*Fixes*), holds
  the window and the workers already, and the ring adds nothing to it. `today` on Chromium as on 2026-10-28,
  2.6–3.2 GiB; on Firefox bounded by collection, 0.6–1.2 GiB. `transfer` 600–800 MiB on Chromium, 650–1 100 on
  Firefox. (*Corrected 2026-10-29:* Chromium's 600–800 rested on the 64 MiB slack, which the sources do not give: a
  guess, not a derivation.) Fill: `ring` ≤ `today` (one copy and one hop fewer); slot waits near zero with OPFS.
* **VOID**, per engine: the median |`ring′` − `ring`| over 64 MiB, or the median `ring′`/`ring` fill time outside
  0.90–1.10.
* **Rule.** On each engine, (c) **holds** if in every round not VOID the fill is complete, every frame exact by both
  checks, `ring`'s growth ≤ 608 MiB (the budget + 352: the floor's 537 and the A/A bar's 64, rounded up), and the median
  `ring`/`today` fill time ≤ 1.10. It **fails** otherwise, and lever 2 returns to the owner with the numbers.
  **Turned over to (a′)** if `transfer` also meets the 608 MiB bar and the time bar in every round not VOID, on both
  engines. (*Corrected 2026-10-29:* VOID is the engine's cell, not a round: read "in every round of a cell not VOID";
  a VOID cell decides nothing on that engine.) `today` is reported, not ruled: on Firefox it may already be bounded, which tests the source reading above.
* **Mutants**, each a stand-in as M2's: the store never frees a slot, which must stall the fill (predicted after nine
  frames, the ring's count) and fail completeness within 120 s, 15 × today's fill; and a ring that allocates a fresh buffer when dry,
  which must fail the 608 MiB bar. *Corrected 2026-10-29 (independent review):* with OPFS the ring is predicted
  near never dry (slot waits near zero, above), so that mutant may allocate nothing and pass: it runs with the store
  off (the `off` stand-in), where the ring dries after nine frames. The 120 s is a rig change too: `fill` waits 1 800 s.
* **After it, if (c) holds:** the 13 GiB series on `ring`, Chromium only: growth as at 2 GiB and the fill complete,
  where every earlier arm stopped at ~12 GiB, the container's limit (M2).

**Sources, 2026-10-28**, fetched for this section and added to [`frame-path-sources.txt`](frame-path-sources.txt).
V8 at `f428bb0` (Chromium `52c75e5`'s `DEPS`); Gecko and WebKit at §9's pinned commits; WebCodecs at `2b849bb`.

| claim | source |
| --- | --- |
| V8: a shared backing store counts 0 bytes per isolate | `src/objects/backing-store.h` 203–209; `src/objects/js-array-buffer.h` 291–298 |
| V8: an array buffer's count added on attach, removed on detach; 0 skipped | `src/heap/array-buffer-sweeper.cc` 358–372, 388–402, 426–438 |
| V8: what external memory starts; the 64 MiB | `src/heap/heap.cc` 1389–1401, 6976–7022; `include/v8-internal.h` 1233 |
| V8: the start is the global limit, external memory's low × a factor (*added 2026-10-29*) | `src/heap/heap-controller.cc` 307–315, 482–490; `src/heap/heap-controller.h` 219; `src/heap/heap.cc` 5607–5611, 5646 |
| V8: the accounting API is the embedder's | `include/v8-external-memory-accounter.h` 15–49 |
| Gecko: a shared buffer counted once per zone, at its length; the trigger checked | `js/src/vm/SharedArrayObject.cpp` 777–800; `js/src/gc/Zone.cpp` 89–113 |
| Gecko: an array buffer's contents counted and released as cell memory | `js/src/vm/ArrayBufferObject.cpp` 1885–1910 |
| Gecko: the malloc trigger, base and growth | `js/src/gc/GC.cpp` 2158–2188; `js/src/gc/Scheduling.h` 409–431; `js/src/gc/Scheduling.cpp` 466–497, 580–597 |
| JSC: each wrapper counts the whole buffer, shared or not | `runtime/JSArrayBuffer.cpp` 45–50; `runtime/ArrayBuffer.h` 379–383; `heap/Heap.cpp` 646–653 |
| JSC: the next collection, proportional | `heap/Heap.cpp` 171–203, 1905–1911 |
| WebCodecs: `copyTo` takes a shared view | `index.src.html` 3446–3448 |

**Not traced:** Blink's own accounting of a shared buffer outside V8; whether Gecko's high-frequency mode holds during a
fill (it picks 1.5 or 3.0); JSC's growth factor on a phone; `Atomics.waitAsync` per engine, which the design avoids.

### Options, and what each costs

| option | changes | costs | switch later |
| --- | --- | --- | --- |
| **packed file per series** (lever 3) | one handle, quota failure up front, no index | eviction by series only; one tab per series writes | a format change inside OPFS: drop the cache, refill |
| file per frame (§8.3) | per-frame eviction, several writers | a handle opened per access; quota failure mid-fill | the same |
| window by distance, `Map` (lever 2) | memory bounded by a constant | depends on collection; one constant for every device | the constant is configuration |
| slot ring (lever 2) | memory fixed by construction | the decoders' hand-off changes | structural |
| the engine's limit, LRU to fit, by series (lever 5; *corrected 2026-10-27*, was "own LRU budget by series: the browser never evicts us") | multi-GB studies held up to each engine's quota; fit tested by `truncate` | the browser may still clear the origin unless persisted | configuration |
| a budget of our own (fixed, or a fraction of `estimate()`) | a margin we choose | refuses multi-GB studies or never binds; `estimate()` means three things | configuration |
| without OPFS: drop and re-ask | the tab survives | a second decode of a dropped frame | configuration |
| without OPFS: keep all | no frame decoded twice | today's ceiling, the tab at risk | configuration |

### Questions for the owner

1. **The packed file per series, revising §8.3?** It rests on one size per series, which the ingest enforces.
2. **Without OPFS** (Firefox and Safari private windows, a quota too small): past the window's budget, drop the farthest
   frame and ask for it again, or keep everything as today? Per engine: lever 8.
3. **The window's starting budget:** 256 MiB until D5 says what a phone kills a tab by, or D5 first? *2026-10-27:* the
   owner's reply on budgets concerns the store on disk (lever 5); the window, RAM per tab, stays at 256 MiB.
4. **Eviction across series:** plain LRU inside a budget of ours (proposed), or the size- or link-weighted variant now?
   *Answered 2026-10-27 (lever 5):* no budget of ours; least recently opened first, only when a `truncate` is refused;
   a series open in any tab never.
5. **`persist()`** (§8.5): ask for it on the first series opened, or never? Per engine: lever 8. *2026-10-27:* lever 5
   recommends asking, for multi-GB studies; still the owner's.
6. **A series already whole in OPFS:** dial the session anyway (ready for asks, one handshake), or only on a miss?

### Sources, 2026-10-22

Fetched 2026-10-22 for lever 8 and added to [`frame-path-sources.txt`](frame-path-sources.txt); source files at §9's
pinned commits, MDN at mdn/content `468fcd1`.

| claim | source |
| --- | --- |
| a grant is a permission; persistent buckets cleared only with the user | storage `storage.bs` 498–508, 573–579, 686–690 |
| Chromium: top level only; cookies; installed; 10 important sites; a refusal not stored | `chrome/browser/storage/persistent_storage_permission_context.cc` 68–79, 88–105, 116–128, 130–156 |
| Chromium: what makes a site important | `chrome/browser/engagement/important_sites_util.cc` 190–194, 341–352 |
| Chromium: eviction skips the persisted default bucket | `storage/browser/quota/quota_database.cc` 642, 663–668 |
| Gecko: private windows refused; the prompt; no gesture | `dom/quota/StorageManager.cpp` 318–329, 651–667; `browser/modules/PermissionUI.sys.mjs` 267–269, 1853–1925 |
| Firefox for Android: the dialog, default ask | `…/feature/sitepermissions/SitePermissionsFeature.kt` 936–945; `mobile/android/fenix/…/utils/Settings.kt` 1873–1876, 1929 |
| WebKit: the grant is ITP's exempt set | `NetworkProcess/storage/NetworkStorageManager.cpp` 914–944; `NetworkProcess/NetworkProcess.cpp` 837–846; `Classifier/ResourceLoadStatisticsStore.cpp` 791–800, 2895–2897; `Classifier/WebResourceLoadStatisticsStore.cpp` 775–781, 1590–1597; `UIProcess/WebsiteData/WebsiteDataStore.cpp` 2091–2101 |
| WebKit: quota eviction spares persisted; clearing all data removes the grant | `NetworkStorageManager.cpp` 566–567, 607, 1474–1476; WebKit blog 14403 |
| user clearing; Firefox's persisted quota; engines' prompting | MDN *Storage quotas and eviction criteria* (`index.md` 44, 50–52, 91, 164); web.dev *Persistent storage* (2020-05-12) |

**Not traced:** Gecko's rule for a third-party frame; Firefox for Android's quota; which installs count on Android
Chrome; ITP in third-party iOS browsers and in-app web views; `SFSafariViewController`.

### Sources, 2026-10-27

Fetched 2026-10-27 for lever 5 at §9's pinned commits and added to [`frame-path-sources.txt`](frame-path-sources.txt).

| claim | source |
| --- | --- |
| the quota must not follow free space | storage `storage.bs` 543–552 |
| `removeEntry` takes no lock | fs `index.bs` 993–1035 |
| Chromium: `estimate()` reports usage + 10 GiB, static by default | `storage/browser/quota/quota_manager_impl.cc` 136–155, 1170–1200; `quota_features.cc` 38; `content/browser/quota/quota_manager_host.cc` 26–31; `content/browser/storage_partition_impl.cc` 1414–1426 |
| Chromium: the enforced limit, its override, and the eviction round's trigger | `quota_manager_impl.cc` 250–256, 1346–1380, 1670–1683; `quota_settings.cc` 127–141; `quota_features.cc` 18–35; `quota_temporary_storage_evictor.cc` 25, 188–211 |
| Chromium: `truncate` and growing writes ask for quota; the file sized by `ftruncate` | `…/file_system_access_regular_file_delegate.cc` 76–81, 112–123; `base/files/file_posix.cc` 450–456 |
| Gecko: the limits, `estimate()`, eviction skipping persisted and open origins | `dom/quota/ActorsParent.cpp` 1413–1440, 2137–2172, 8377–8390, 8410–8455 |
| Gecko: `truncate` checks quota | `dom/fs/api/FileSystemSyncAccessHandle.cpp` 322–356; `dom/quota/FileStreams.cpp` 27–42, 84–97 |
| WebKit: the reported quota, doubled with usage, capped | `NetworkProcess/storage/OriginQuotaManager.cpp` 34, 175–185; `NetworkStorageManager.cpp` 750–785 |

**Not traced:** each engine's `removeEntry` on a file another tab holds; WebKit's `truncate` at the OS; WebKit's
standard volume capacity; how often a phone's free disk binds before its quota.
