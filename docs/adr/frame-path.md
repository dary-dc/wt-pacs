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

### An independent design (2026-10-28)

*Written blind, from the constraints and from `main` alone, before the owner's target design was read; the comparison
follows it as its own section, so the order is auditable. Nothing here is built or timed; every figure is one of
§2–§6's measurements, a reading of the code, or marked as a prediction. The probes under
[`../../lab/target-review/`](../../lab/target-review/README.md) are indicative only (a container, not a phone).*

**The constraints, as given.** Mobile on lossy wireless; the fill's throughput and the on-demand latency both count,
and a real viewer is a hybrid of the two by modality, study size and link; every shown frame lossless, bit-exact, checked
by XXH3 per frame; an OPFS cache of decoded samples, no frame decoded twice; priority is the client's ask order through
a FIFO server, no wire cancel, a shallow client window, stride as bandwidth conservation; no previews, no lower
resolution, no lossy delivery, no encoding change; at equal capability the simpler design wins, and removing work beats
speeding it up.

#### The shape in one line

**The disk is the only frame store; every painted frame is read from it; the decoders write it; one worker owns
everything else.** The page holds no frame and no state about frames.

```
PAGE (input, status)        CORE (one worker)                              DECODERS (N nested workers)
  show / view / cine ─────► session, records, fill, asks, viewports, WebGL2  ◄── decode: coded bytes moved ──
  ◄── shown, progress ────  reads a frame from OPFS, hashes it, uploads it  ── done: index, exact, range ───►
                                                                            decode → XXH3 → write to OPFS
```

Three kinds of thread, `N + 2` in all: the page; the **core**, a dedicated worker that holds the transport session,
every frame's record, the ask and fill policy, every viewport's canvas and display state, and the OPFS reads; and `N`
**decoders** (`min(3, hardwareConcurrency)` as today, §Resources of [`../ARCHITECTURE.md`](../ARCHITECTURE.md)), each a
codec module, a hasher and an OPFS writer. Today's four kinds (page, downloader, decoders, paint worker) become three;
§1's B′ would be five.

#### Why these threads, and not others

* **The page is out of every path but input.** Its long tasks (200–300 ms, §2) would hold a receive loop, a paint or a
  cine clock; they hold nothing here. It never touches samples: no `SharedArrayBuffer` crosses it, no frame map lives
  on it, and its per-frame cost is zero during a fill (one coalesced `progress` message at most ten times a second).
* **The paint lives in the core, not in a worker of its own**, because the core's other work is small and the paint's
  is bounded: a frame's receive and dispatch cost the downloader 0.04 ms (§The downloader variant during a fill), and a
  paint is 0.34 ms at 512² and 5.7 ms at 12.6 Mpx on a GPU (§Paint). A 17 MB mammogram's read, hash and upload hold the
  core for a predicted ~27 ms, which QUIC's receive window absorbs without a byte lost (6 MiB in Chromium; 27 ms is
  68 KB at 20 Mbit/s). A separate paint worker would buy isolation from that at the price of one thread, one port, one
  message a frame and a second owner of frame state; nothing measured says the isolation is needed.
* **The decoders write, because they hold the samples.** A decoded frame sits in the decoder's WASM heap and must be
  copied out once in any design; today that copy goes into a fresh `SharedArrayBuffer`, here it goes into the OPFS
  file through `FileSystemSyncAccessHandle.write(view of the heap)` — a copy into the page cache on Chromium and WebKit
  (§4). It is the same memcpy with a different destination, not an added one, and the store worker of §1's B′, the
  handle it is posted, and the `SharedArrayBuffer` all go. The decoder's clock gains Gecko's one quota IPC per write
  (§4) and whatever a phone's write costs over a memcpy; that is the number §Protocol measures first.
* **No store worker, no frame memory.** The memory store of §3 — a window around the current index, a byte budget, an
  eviction rule, a constant a phone cannot read from `navigator.deviceMemory` — is not built. The OS page cache is the
  memory window: the frames just written are the ones read back, and the kernel evicts them under pressure, which is
  the rule §3 wanted written by hand. The core holds one read buffer per viewport, the size of one frame, reused.
  Resident frame memory is `O(viewports)`, not `O(series)`: ~1 MB for a CT stack against today's 40 MB and the
  812 MiB of the largest fixture series ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Open, row 273).

#### Who owns what

| state | owner | form |
| --- | --- | --- |
| frames on disk | the core, mirroring OPFS | a `Uint8Array(frameCount)` of stored flags per series, built at open by listing the series' directory, set by each decoder's `done` |
| frames owed by the wire | the core | today's records: `wire` (asked, or inside a fill run), `queued`, `decoding`; a record is deleted on `done`, when the flag is set |
| frames in memory | the core | one read buffer per viewport holding the samples on screen; nothing else |
| the display state | the core | per viewport: `view`, `voi`, `invert`; the page sends changes and keeps no truth but its drag's start, which `shown` carries |
| the current frame | the core | per viewport: `current`, and `pending`, the newest `show` not yet served |
| the session, the fill set, the ask window | the core | as today's downloader: `wanted`, `nextRun()`, survival, re-dial, the wire buffer ring |
| coded bytes | the core's ring, then one decoder | moved, never copied, as today |

**The entry on disk**: `<root>/<series key>@<metadata version>/<index>`, one file per frame, 32 bytes of head (width,
height, bits, components, signed, min, max), the samples little-endian as `decodeFrame` hands them, and the frame's
XXH3-64 as an 8-byte trailer. A file per frame because the sync handle's lock is per file (§4): `N` decoders write `N`
files at once with no coordination, and an entry is written, checked, evicted and listed alone. The key carries the
metadata's version, so a re-ingested series is a new directory and never a stale hit; the digest in the trailer is what
a read checks the samples against (a torn or corrupt entry), and the metadata's digest list is what says `exact`.

#### Every message, and its count per frame

| from → to | message | when | per fill frame | per on-demand miss | per step from disk |
| --- | --- | --- | ---: | ---: | ---: |
| page → core | `open` (series, metadata, digests, fill on/off), `viewport` (a transferred canvas), `cine`, `view`, `fill`, `check`, `close` | once, or per gesture; the page sends at most one `view` and one `show` per animation frame | 0 | 0 | 0 |
| page → core | `show {viewport, index}` | per step | 0 | 1 | 1 |
| core → decoder | `decode {index, bytes (moved), key, stamps}` | per frame dispatched | 1 | 1 | 0 |
| decoder → core | `done {index, exact, width, height, bits, components, signed, min, max, stamps, wire buffer (moved back)}` | after the write | 1 | 1 | 0 |
| decoder → core | `failed {index, reason}` | instead of `done` | — | — | — |
| core → page | `shown {viewport, index, exact, reason, voi, view, stamps}` | per paint | 0 | 1 | 1 |
| core → page | `progress {series, stored, failed, total}` | coalesced, ≤ 10 Hz | ~0 | 0 | 0 |
| core → page | `failed {series, index, reason}`, `opened`, `closed` | per event | — | — | — |
| **total** | | | **2** | **4** | **2** |

Today a fill frame costs 4 (compressed, pixels, `done`, `ack`) across three threads; §1's B′ costs 4 (compressed, pixels
to the paint worker, the handle to the store worker, `done`) across four.

#### Every copy of the samples

| path | copies in script | and then |
| --- | --- | --- |
| a fill frame | **1**: WASM heap → the OPFS file (the page cache) | the kernel writes it to flash on its own clock |
| an on-demand miss | **2**: heap → file; file → the viewport's read buffer | one GPU upload (`texSubImage2D` from the buffer) |
| a step to a stored frame | **1**: file → the read buffer | one GPU upload |
| a step back to the frame on screen | 0 | 0: the texture is kept |

Today a fill frame is copied once into shared memory and uploaded from it (§1); here the fill frame nobody is looking
at is written once and never enters a JavaScript heap. The on-demand frame pays one read more than today — predicted
0.6 ms for a 512² CT frame (0.5 MB at ≥ 1 GB/s, plus 0.12 ms of XXH3) and ~22 ms for a 17 MB mammogram at §4's
desktop rates, against a decode of 3 and 47 ms and a wire time of tens of milliseconds to seconds. That read is the
price of one path. **The alternative, the asked frame's samples riding on `done` as a transferred `ArrayBuffer` so the
paint skips the read, is a second path through the paint and is not built** until a measurement says a step to a
just-decoded frame crosses 16.7 ms on the target device (§Protocol, 3).

**No `SharedArrayBuffer`, so no cross-origin isolation.** Nothing is shared between threads: coded bytes are moved to a
decoder and the buffer moved back, samples go to disk, and the one buffer the paint reads is the core's own. The
COOP/COEP headers today's page needs for its pixel path become a decoder-build question (a threaded dav1d would still
need them); the page serves without them otherwise.

#### The cache I/O: where, and with which API

* **Writes, in each decoder.** On `init`, the decoder receives the series' `FileSystemDirectoryHandle` (handles are
  serializable, §Sources) and keeps it. On `decode`, before decoding, it starts `dir.getFileHandle(name, {create: true})
  .then(h => h.createSyncAccessHandle())` so the two IPCs overlap the decode; after the decode and the XXH3 of the heap
  view, it writes head, samples and trailer in one `write()` and closes. Only a frame that passed the check, or an
  unchecked one of a series without digests, is written; a mismatch takes the second decode of
  [`exactness-in-production.md`](exactness-in-production.md) §2, then fails by name and is never stored. The decoder
  answers `done` after the write, so the core's flag is set only for a whole file; a torn write (a crash mid-write)
  fails the trailer on read. No `flush()`: a cache needs no durability it can check for.
* **Reads, in the core.** A `show` of a stored frame: `getFileHandle`, `createSyncAccessHandle`, `getSize`, one `read()`
  into the viewport's buffer (grown when a series' frames are larger, never shrunk), `close`, XXH3 of the samples
  against the trailer and the metadata's digest, then `texSubImage2D` from the buffer and the draw. A read is
  synchronous once the handle exists; the two handle calls are asynchronous and are the step's floor, measured by the
  probe. Chromium's non-standard `mode: "read-only"` is not relied on: open, read, close, one lock at a time per file.
* **Quota and eviction, in the core, by series.** `navigator.storage.estimate()` at each `open` (exposed in workers,
  §Sources); when `usage + frameCount × frameBytes` passes 80 % of `quota`, whole series directories go, least recently
  opened first, from a `recent.json` at the root the core rewrites at each open. A `QuotaExceededError` on a write
  reaches the core as `failed`, which evicts one series and asks the frame again, once. `persist()` is the page's one
  line at start and is not relied on: an engine clearing the origin (§4) costs a fill, never a wrong frame.
* **Groups** (AV1 with `groupLength` above 1, built and not adopted): an entry per frame as above; a step inside a
  group whose frames are not all stored asks the group from its keyframe as today's `wholeGroups` does, since the coded
  keyframe is gone with its decode. Not changed here.

#### How the paint gets its frame

One path: the core reads the entry, checks it, uploads it, draws. The painter's two passes and its contract
([`../../client/paint/README.md`](../../client/paint/README.md)) move into the core unchanged, one WebGL2 context per
transferred canvas; `painter.js`'s page half goes, since the canvas is transferred in `viewport`. A `done` whose index
is some viewport's `current` or `pending` paints at once by the same read; a `done` for any other frame sets a flag and
nothing else. Presenting needs no page thread in any engine (§2, by source), so a frame lands on screen while the page
is inside a long task; what still waits for the page is the next key press, in every design.

#### How asking is decided, and reaches the wire

The page sends intent, never frames: `show(i)` for a step or a jump, `cine(fps)`, `fill(on)`. The core derives every
ask from four rules:

1. **Stored → read.** No wire, no decoder, no second decode.
2. **In hand → promote.** A frame `queued` or `decoding` moves to the front of the decode queue (today's `promote`);
   its paint follows its `done`.
3. **Owed by the running fill and next in line → wait.** If `i` is the frame the current run will deliver next (`i ==
   lastDelivered + 1`), asking it would end the fill the server is reciting and re-issue it a round trip later
   ([`../WIRE.md`](../WIRE.md) §An ask during a fill) to get the same frame no sooner. The depth of this rule — how
   many frames in flight an ask cannot overtake — is measured (§Protocol, 4) and is 1 until then.
4. **Otherwise → ask**, if fewer than `D` asks are outstanding; else `i` becomes `pending`, replacing whatever was
   pending. When an ask settles, `pending` is asked if still wanted. `D = 2` until the window ADR's estimator is
   measured ([`client-window-depth.md`](client-window-depth.md) §Which depth ships); on the target links and CT-sized
   frames its formula gives 1–3.

Rule 4 with the page's one `show` per animation frame is stride: frames scrolled past under a fast wheel are never
asked, the frame the reader settles on always is, and a miss waits behind at most `D − 1` stale asks — the bound
[`reject-server-ordering.md`](reject-server-ordering.md) accepts. No `cancel` message exists on the page's API: an ask
on the wire is owed and will be stored, which with a cache is the right outcome, not waste. The fill is today's: a
`stream_frames` run of what is wanted and not stored, re-issued on the asked frame's envelope head (`refill: "head"`),
the opening run in the session URL. One change makes it the hybrid the constraints ask for: **the next run starts
after the frame shown**, `nextRun()` taking the run that contains `current + 1` before the lowest wanted index, so a
reader stepping forward during a fill hits what the fill delivers next instead of asking across it. On a series
already on disk the fill asks nothing; on a reopen it asks the holes.

Priority on the wire stays the ask order: asks, then the fill, FIFO at the server, exactly as the ADRs decided. The
decode queue keeps its two priorities (asks first, `perDecoder` outstanding each). Survival, re-dial, recycling before
WebKit's 16 MB stall and the dial deadline are today's, unchanged, inside the core.

#### The main thread's API

```js
const core = await ViewerCore.open({ key, url, certHash, transportFile, metadata, fill: true });   // one per series
const vp = core.viewport(canvas, key);        // transfers the canvas; a second call is a second viewport
vp.show(i);  vp.cine(fps | null);  vp.view({ zoom, panX, panY, rotate, flipH, flipV, invert, voi });
core.fill(key, false);                        // stop filling (a data cap), end_stream on the wire
core.onShown = ({ viewport, index, exact, reason, voi }) => …;   // per paint: the status line, the drag's start
core.onProgress = ({ key, stored, failed, total }) => …;         // coalesced
core.onFailed = ({ key, index, reason }) => …;
await core.stats();                           // asynchronous, because truthful across the boundary
core.close();                                 // ends the core; the decoders end with it, the locks with them
```

Keys, the wheel and pointer drags stay the page's and become `show` and `view`; the page coalesces them to one of
each per animation frame. `ViewerCore.open` refuses by name before any worker starts when the browser has no
`FileSystemSyncAccessHandle` in workers, no WebGL2 in an `OffscreenCanvas`, or no `WebTransport`: a memory-only viewer
is a second mode and is not built.

#### Cine

A `requestAnimationFrame` loop in the core (available in dedicated workers, §Sources), stepping `current` when the
frame's period has elapsed: stored → read and paint; not stored → rule 2, 3 or 4 above, and the clock holds on that
frame until its `done`, then goes on. Cine never skips a frame and never involves the page, so it runs through the
page's long tasks (§2's prediction, and the probe counts the ticks). A cine on a series not yet filled runs at the
fill's pace, which is the honest rate; the fill follows it by the `current + 1` rule.

#### A second viewport

`core.viewport(canvas2, key)` adds a canvas, a WebGL2 context, a read buffer and a `current`; the session, the records
and the stored flags are the series', shared. Two viewports on one series cost two reads of a frame both show, not
two decodes. A second series is a second `open`: its own session, records and directory, in the same core, which holds
a map of series. Fills across series run one at a time, the series of the viewport that last received a `show` first,
so the link serves what the reader looks at; asks are served as they come, whichever series. Two contexts on one
thread share its time: 0.34 ms a 512² paint (§Paint) makes that no constraint at any fill rate.

#### Errors

| what fails | who sees it | what happens |
| --- | --- | --- |
| a refused ask or run (`frame_error`) | the core | `failed` to the page by name; the viewport keeps its last frame |
| a decoder crashes, hangs (`decodeMs`) or cannot be read | the core | replaced; its unacknowledged frames asked again, twice at most, then failed by name — today's rule, with `done` as the ack |
| the digest does not match | the decoder | the second decode of the exactness ADR; still wrong → `failed`, nothing written, nothing painted; the page shows the failure, never the pixels |
| an entry fails its trailer or its digest on read | the core | the file is removed, the flag cleared, the frame asked again: the one case where asking again helps |
| the write throws `QuotaExceededError` | the decoder → the core | one series evicted, the frame asked again once, then failed by name |
| the origin's storage is cleared, or the series' version changed | the core at open | the listing finds nothing: a fill, as on a first visit |
| the session dies | the core | today's survival on the records; nothing stored is asked again |
| a WebGL2 context is lost | the core → the page | `failed` by name for that viewport; no fallback renderer, as today |
| the core's script throws | the page's `worker.onerror` | `closed` by name; the cache survives, a reopen fills the holes |
| no sync handles, WebGL2 or WebTransport in a worker | `open` | refused by name before any worker starts |

#### The counts

| per frame | threads touched | messages | copies of the samples | GPU uploads |
| --- | ---: | ---: | ---: | ---: |
| a fill frame nobody looks at | 2 (core, one decoder) | 2 | 1 | 0 |
| an on-demand miss | 3 (page, core, one decoder) | 4 | 2 | 1 |
| a step to a stored frame | 2 (page, core) | 2 | 1 | 1 |
| today's fill frame (§The container campaign) | 3 | 4 | 1, into shared memory | 1 when shown |

#### What is predicted, and what decides it (a protocol, written before any data)

Arms differ in one lever each; `lab/order.mjs` interleaving, ≥ 12 rounds, Chromium and Firefox, the viewer's three
series and a mammogram, 1× and 4× on every thread, every frame checked against the encoder input's `.sha256`.

1. **The decoder writes** against today's copy into shared memory: the fill's last frame and the decoders' CPU. Adopt
   the write if the fill is within ×0.98–1.02 in ≥ 9 of 12 rounds on every set; a mammogram fill outside it makes the
   write a store worker's again (§1's B′) and nothing else changes.
2. **A step from disk** (open, read, check, upload, draw) per set and engine, against a step from memory (upload,
   draw). Keep the disk as the only store if the step is under 16.7 ms on every set but the mammogram's, and under
   two display frames there; otherwise add a ring of the last `R` painted frames in the core, `R` from the measurement,
   and nothing else changes.
3. **An on-demand miss**: ask → on screen, here against today, the same series and links. The read-back is adopted if the
   median is within 16.7 ms of today's on every set; else the asked frame's samples ride on `done`.
4. **Rule 3's depth**: a step to `lastDelivered + k` during a fill for `k` = 1…8, asked against waited, on the
   link-conditions cells; the depth is the largest `k` at which waiting is no later than asking.
5. **A busy page**: §7's long-task cell, cine on time and asks' arrival → screen, here against today.

**Not verified** until then: a phone's OPFS write and read rates and its two handle IPCs per file; nested workers'
sync handles in WebKit; the kernel's page cache as a frame window on iOS; the file count's cost per engine (a
1 000-frame series is 1 000 files); whether Gecko's quota IPC per write shows at a fill's rate.
