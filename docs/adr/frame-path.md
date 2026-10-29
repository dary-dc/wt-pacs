# ADR: where a decoded frame goes — the page in or out of the pixel path, and who owns the frame store

**Status:** proposed 2026-10-11 (queue row 148, FRAMEPATH, of [`../av1/queue.md`](../av1/queue.md)); the owner's
target shape, a B′ without the store worker, **built 2026-10-28 as a variant beside today's path and not timed**
(§3, *Built*). The decisions are the owner's; they are listed in §8 and under the queue's
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

**Built** (2026-10-28), **not timed; §7 decides adoption, and its runs are a row of their own.** The owner's target
shape, beside today's path and chosen by one setting, the page's own `?view=page|worker` (default `page`):

* **One view worker** the page starts (`client/view/view-worker.js`) holds three modules: the **controller**
  (`controller.js`: the current frame, what it wants and in what order, the paint), the **frame store** (`store.js`:
  has, get and put on memory alone, a memory window by distance from the current frame, every frame by default as
  today; under `worker` it also holds the downloader's client and sends it the misses of each want), and the
  **paint module** (`paint/paint-worker.js`, imported, not a nested worker; it keeps the uploaded frame and the window
  table). Under `page` the same controller and store run on the page with the paint worker behind them, so the two
  variants differ in where they run alone.
* **The page holds no frame.** It transfers the canvas to the view worker, starts the downloader itself and links the
  two with one `MessageChannel` (the downloader's `link` message); after that it never posts to the downloader. The
  decoders' pixel ports go to the view worker, where the consumer (`consumer.js`, given the port) runs and acks each
  frame as it does on the page: row 147's rule holds unchanged, and the frame changes owner at the ack.
* **The page's API** (`client/view/view.js`): `show(i)`, `setDisplay({window, invert, pose})`, `play(fps)` and
  `pause()`, `valueAt(x, y)` → a promise of the sample under that canvas point; events `shown {i, exact, reason}`,
  `progress {have, total}` (at most every 100 ms, and at once at the last frame) and one failure event,
  `failed {scope: frame | series | cache | worker, reason}`, with `i` when the scope is a frame. `shown` also carries
  the window painted, which a drag starts from, and `progress` the exact counts the status line shows. After the view
  worker has started, its `error` or `messageerror` is fatal: the page says it as the worker's, ends the worker and
  the downloader it started, and fails every call still waiting. An intent that throws in the view worker is said as
  the worker's. The cine is still paced from the page, behind `play`.
* **The want (2026-10-29).** Under `worker` the controller decides what and the store decides from where. Each step,
  the controller tells the store its want, an ordered list: when filling, every frame nearest the current one first
  (the current frame, then +1, −1, +2, …); on demand, the current frame alone. The store drops what it holds and sends
  the downloader the misses, in that order, as one `want` message that replaces the one before, unless they are the
  misses it already sent; `has` and `get` never reach it. The first want rides `start` in place of today's fill, so an
  ascending one of `askDepth` frames or more is still the opening run on the session URL; a shorter one, as the gate's
  3-frame series, goes out as asks once the dial is up (*corrected in review*, 2026-10-29: this said any ascending
  one). The downloader keeps the want as an ordered list: the head goes out as one `stream_frames` run when it ascends `askDepth` frames or more and nothing else is owed,
  otherwise as up to `askDepth` asks, topped up as each lands. A want whose head the running run does not serve next
  ends that run with the head's ask (WIRE §An ask during a fill); the run's frames not yet here are asked again only
  once an ask lands behind it, when what it wrote has arrived. A replaced want changes the order and nothing else:
  what is owed stays owed, a frame of the series that lands after it is kept and acked, and no generation steps (one
  series and one metadata version per session, so a frame is its index). Today's `fill`, `ask` and `cancel`, and the
  page view, are unchanged; the page view asks and cancels as before.
* **`askDepth` is 4, a constant**, inside the 2–5 that [`client-window-depth.md`](client-window-depth.md) measured as
  `D_min` on its grid; it is not derived from the link. **Not timed:** a fill whose want stops ascending (a step during
  it) runs at that depth instead of as a run. **A head the ended run already had in flight crosses the wire twice**;
  the copy that lands second is dropped by the transport, decoded never.
* **The paint's GPU wait.** The 1-pixel `readPixels` that makes a paint return once drawn runs in the view worker only
  behind the lab's flag (`settlePaint`, set by the total-time rig's hooks in `lab/viewer/levers.js`); the paint worker
  of the page view keeps it, as before.
* **Not built:** credits and eviction by byte budget (with the cache arm), the OPFS store (a miss goes to the
  downloader where the store worker would be asked first; it lives on `claude/opfs-cache-fixes`), so nothing emits
  `failed` with scope `cache` yet; the cine's clock in the worker; a second viewport; a series or metadata-version
  change, the only step of the generation under a want. A downloader whose script does not load is reported on the
  page as the series' and fails `connect` at once (*corrected in review*, 2026-10-29: this read that `connect` waited on
  the check's deadline, which it did until the page raced it against that error).

**Held by** the viewer check, run by the gate under both views on both clients, filled with a cine and on demand
(`client/viewer/run_check.sh`), and by `client/view/controller.test.mjs`, `client/view/view.test.mjs` and
`client/transport/downloader.test.mjs`. Each check was mutated and its mutant failed:

| claim | check | mutant |
| --- | --- | --- |
| a want's first `askDepth` misses go out as asks in its order, topped up as each lands, and arrive in its order | `downloader.test.mjs` *aWantArrivesInItsOrder*, a want nearest-first from frame 40 of 76 | the want sorted; no depth; a run for any ascending pair |
| only an ascending head of `askDepth` or more is a run | the same | never a run; a run for any ascending pair |
| a replaced want dispatches no index to a decoder twice or in a new generation, and asks no frame its run delivered | *aReplacedWantKeepsWhatIsOwed* | the want as a cancel; the ended run forgotten at once; never released by a landing; its head not asked |
| the store sends the misses alone, in the controller's order, and the same misses once | the node test; the check's on-demand steps under `worker` | held frames sent; the same misses sent again; the want not nearest first |
| a held frame is painted with no downloader message, on demand and filling | the node test; the check's `heldStep` | a held step sending a want |
| a frame of a replaced want is kept | the node test; the check's "both kept" | the store dropping it |
| each `failed` scope reaches the page by name; a view-worker `error` or `messageerror` after start is fatal and shown | `view.test.mjs`; the node test for frame, series and worker | each scope renamed; no `messageerror`; said twice; not ended; the downloader left running; a waiting or later call left hanging |
| under `worker` no pixel, `SharedArrayBuffer` or port reaches the page, and the downloader posts it nothing | the check's count of the page's messages | the frame's pixels in `shown`; the downloader not linked |
| a step to a held frame paints it and sends the downloader nothing | the check's `heldStep` at the port; the node test | a held frame asked anyway; a held step sending `check` |
| a miss reaches the downloader from the view worker, as a want since 2026-10-29 | the on-demand steps, heard at the port; the node tests | a miss not asked; no want at all |
| every frame painted is exact | the check's exactness and readbacks | a sample altered in `htj2k.js` |
| a window change paints again with no frame moving: no upload, nothing sent | the check's `windowStep` and its readback under another window; the node test | every paint uploads; a window change paints nothing |
| a downloader whose script does not load fails `connect` at once | `view.test.mjs` | the page's error not rejecting `connect` |
| `page` behaves as before | the viewer check and every other suite, green | — |

**What each variant costs, counted from the code** (a frame decoded and acknowledged; the defaults' three decoders):

| | `page` | `worker` |
| --- | --- | --- |
| messages a frame, whole graph | 4: decode, done, frame (decoder → page), ack | 4: decode, done, frame (decoder → view worker), ack |
| … of them on the page's thread | 2: the frame in, the ack out | 0; a `progress` at most every 100 ms |
| messages a paint | 2, both the page's: `paint`, `painted` | 1: `shown`, view worker → page |
| a step | the paint's 2, plus the ask on a miss | `show` and `shown`; on a miss, or during a fill, one `want` from the view worker carrying the whole order |
| the fill's request | `fill` in `start`, 0 messages | the first `want` in `start`, 0 messages |
| threads | 6: page, downloader, 3 decoders, paint worker | 6: page, downloader, 3 decoders, view worker |

The gate's three-frame check, counted on the page's thread over its whole run (protocol, cine and readbacks
included): `page` 5 frames in, 5 acks out, 12 paints out and 12 back; `worker` 0 frames, 1 `progress`, 8 `shown`. With
the want (2026-10-29), every message the page received over the whole run, replies included: 29 filled with a cine
and 16–17 on demand, on both clients, none carrying a pixel or a port and none from the downloader.

**What fought the shape.** The paint worker posted to its own global, so its `start` and `paint` now return and the
entry posts; imported, its handler is replaced by the view worker's. The consumer made its own worker: it takes a
`port`, ends a port by closing it, and the page triggers it forwarded are `watchPage`, exported. The downloader posted
to its global; it now posts to whatever `link` names. The check read pixels on the page — the readbacks against the
CPU reference, a spy on the client — so its half that needs frames runs beside the controller (`client/view/check.js`),
and the total-time harness's frame hashes are the controller's `ledger()`. A drag starts from the frame's default
window and only the frame knows it, so `shown` carries it; the canvas's CSS size is the page's, so a resize is an
intent.

*The want (2026-10-29).* The downloader held no order: a fill is a `Set` sent lowest run first, asks went before fill
frames, and the only generation was the cancel's, which every message carries and every stale one drops. The want
is a third structure beside them (`order`), and the generation stays the cancel's. The server ends a fill at any
message with no saved position and the client cannot tell which of the run's frames are in flight, so a want that
leaves a run waits for an ask to land behind it before re-asking the rest: on the shared stream what the run wrote
has arrived by then (the reasoning row 229's refill already rests on; not separately tested per stream mode). The
store needs its own copy of the misses it sent, because the downloader reports nothing back. The check's on-demand
steps encoded the opposite of the target ("the newest ask alone", a cancel each step), so under `worker` they now
expect both frames kept and one `want` a step. One controller serves both views, so the want path switches on
whether the store holds a downloader: two paths in one class while the page view stays. And the fill rode `start`
so the opening run rides the session URL; to keep that, the store makes its first want before it has a client, and
it rides `start` too.

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

## Target: the view worker · 2026-10-28

**Status:** the owner's next target design for the client, 2026-10-28, revised 2026-10-29 with the red team's
fixes 1–4, 6 and 8 (§Review: the red team, below); the rest of both reviews is in the table at the end. It takes B′
(§1) further: the page leaves the pixel path *and* the asking, and the frame store and the paint share one worker.
§8.1 was settled as A on 2026-10-11 (queue row 148) unless a measured cost says otherwise; §7's rule is that
measurement, so the design is built as a switchable arm and adopted only if §7 passes. Theory: nothing here is measured.

```
page (UI only)  ── show(i) · setDisplay · play · pause · valueAt ──►  view worker
                ◄─ shown {i, exact, reason} · progress · failed {scope, reason} ─
                                                                      ├ controller   what to want, in what order; cine clock
                                                                      ├ frame store  where a frame comes from: memory → OPFS → downloader
                                                                      └ paint module WebGL2, VOI table, display state
downloader worker ◄── want {ordered misses} · ack ─────────────────── frame store
  session · records · wire ── started · failed ─────────────────────► frame store
  └ decoders (nested) ── frame {SharedArrayBuffer, exact} ──────────► frame store
cache writes: off the view worker's thread (a store worker, or the decoders; row OPFSARMS)
```

**Responsibilities.**

* **The page** sends intents and listens to events. It never holds a frame. Pixel tools ask `valueAt(x, y)`.
* **The controller** decides: the current frame, the order of what it wants (the frame asked first, then the window
  and the look-ahead), the cine clock. It tells the store what it wants and the paint module what to paint. It never
  sees the downloader or OPFS.
* **The frame store** answers "is frame *i* here" and gets the frames it is told to want. For each, in the controller's
  order, it looks in memory, then OPFS, and sends the downloader the misses as one ordered list, which replaces the one
  before; it never reorders them. `has` and `get` only read: neither reaches the network. Frames from the decoders land
  in it; it acks each one once it is held within the memory budget or written, and reports `arrived(i)` or `failed(i)`.
  A frame is (series, index, metadata version): a frame of the current series that arrives after its want was
  replaced is kept and acked, not dropped. A frame read back from OPFS that fails its check (§5) is asked again.
  **Eviction:** the want orders it but does not trigger it. A frame leaves memory only when the store is over its byte
  budget, only once it is written, farthest from the current frame first.
* **The cache writes** do not run on the view worker's thread: a write there delays a paint by up to a whole write
  (§Review, 4). Who writes, a store worker or the decoders, is row OPFSARMS; a sync handle in the view worker, paint
  first, stays only if that row clears it.
* **The paint module** is a module of the view worker, not a worker: today's paint worker code, with the display state
  (window, invert, pose) and the VOI table. A window change repaints with no frame moving. The 1-pixel `readPixels`
  that waits for the GPU runs only behind the lab's flag.
* **The downloader** keeps the session, one record per owed frame, survival and the wire. It keeps the want as an
  ordered list: it sends its first `D_min` misses as asks ([`client-window-depth.md`](client-window-depth.md)) and tops
  them up as frames land, and uses a `stream_frames` run only where the want is ascending ([`../WIRE.md`](../WIRE.md)).
  It dispatches to the decoders only while fewer than K frames are unacked, so a full store reaches the wire as a
  pause. Its generation steps only when the series or its metadata version changes. The server does not reorder
  ([`reject-server-ordering.md`](reject-server-ordering.md)), and any message ends a running fill with no saved
  position (WIRE §An ask during a fill) — *corrected in review*: it read "FIFO on the server", which a fill ended by
  the next ask is not.
* **Errors** reach the page as one event, `failed {scope: frame | series | cache | worker, reason}`. After start, a view
  worker `error` or `messageerror` is fatal and shown; the cache says once when it stops.

**Rules.**

* **One owner per frame at a time.** The downloader owns what is owed (asked, in flight, decoding, unacked); the store
  owns what is here. A frame changes owner at the ack (row 147's rule), so the two never hold the same frame's state.
* **Paint first.** A frame that arrives and is the one on screen is painted before its cache write; the write runs off
  the latency path and off the view worker's thread.
* **The controller decides what; the store decides from where.**

**Per frame of a fill, counted from the design:** four messages (decode, frame, done, ack), none on the page, plus one
post to a store worker if it does the writes; four context crossings (network → downloader → decoder → view worker →
GPU); the samples written once, as today.

**Open, each with what decides it.**

| question | from | decided by |
| --- | --- | --- |
| who writes the cache: a store worker (arm C), the decoders (arm D: a packed file has one writer, so D needs a file per frame or a shared handle mode), or a sync handle in the view worker, paint first (arm A) | OPFSARMS; red 4; independent 4, 6 | the arms' cells with arm D added, and a window drag during a fill, input → painted (row OPFSARMS) |
| who owns a frame's memory: fixed slots per series, or no frame memory with the disk as the store; K | FRAMEMEM; red 3; independent 3, 10 | M5 with a disk-only arm and credits on and off (row FRAMEMEM) |
| the downloader merged into the view worker | independent 1, 2, 11 | a fill's inter-arrival p99 while a cine reads 17 MB frames on the same thread (row RECVLOOP) |
| a frame clock in a dedicated worker: WebKit's is a 15 ms timer; the clock picks the frame by elapsed time and pauses on `hidden` | WORKERCLOCK; red 10 | the clock protocol, plus a WebKit cell and a hidden-tab cell |
| misses split into one-frame runs when the store holds every other frame: span gaps, or pipelined asks | red 5 | a fill from a half-held cache against an empty one at 46 and 92 ms RTT |
| several viewports: one WebGL2 context for all, wants merged by nearest distance | red 7; independent 12 | contexts lost and paint time at 1, 2, 4 and 5 viewports |
| an AV1 group as the store's unit of write and eviction; AV1 previews never stored | red 9, 11 | decodes per index on a G = 8 series with eviction forced; a mutant storing a preview |
| a read-back that throws is a miss, re-asked at its want position | red 12 | M4 with the entry deleted mid-session |
| a series without digests: stored and read back `unchecked`, or decoded again on every open | independent 13 | the owner (exactness) |
| decoder count on phones; per-frame stamps (arrived, painted, written) in `ledger()` | red 13, 14 | D5 on a device; the check reading the stamps |
| the asking patterns as wants, and what the wire lacks | ASKMAP | each pattern's deciding measurement |
| adoption | — | §7's rule, run on the arm built on `claude/view-worker` |

### Review: the red team (2026-10-28)

**What this is.** An adversarial reading of the Target section against today's client (`client/`), the decided ADRs,
and the branches that work on it: `claude/opfs-cache-fixes` (OCF), `claude/opfs-arms` (ARMS), `claude/frame-memory`
(FM), `claude/worker-clock` (WC), `claude/ask-patterns-map` (MAP) and `claude/view-worker` (VW), cited
`branch:path:line`. Engine sources are pinned in [`frame-path-sources.txt`](frame-path-sources.txt) under
*Review*. Three throwaway probes are in [`../../lab/target-review/`](../../lab/target-review/README.md). Their numbers
come from a shared container and are **indicative, not claims**. Nothing here was run on a phone, in WebKit, or in
Firefox. Every fix below is **proposed, not made**. Four helper agents did the reading and the probes.

| # | severity | where it fails | smallest change | settled by |
| --- | --- | --- | --- | --- |
| 1 | high | the controller's order never reaches the wire | the downloader keeps the want as a list and sends a bounded prefix as asks | arrival order against want order, and asked frame → screen (MAP's G1) |
| 2 | high | a replaced want re-decodes and re-downloads in-flight frames | the want carries no invalidating generation; frames are keyed by series, index and version | decodes per index = 1 over a scroll trace |
| 3 | high | no backpressure from the store to the decoders to the wire | credits: dispatch only while unacked frames < K; the store acks when held within budget or written | peak memory of a mammogram fill with slowed writes, credits on and off |
| 4 | high | one thread: a paint or tick waits behind a write, a read-back hash or a GPU wait | cache I/O off the view thread unless OPFSARMS clears arm A; no 1-px `readPixels` outside the lab | OPFSARMS, plus a window drag during a fill |
| 5 | medium | a store holding every other frame splits the fill into one-frame runs, one RTT apart | the downloader spans small gaps, or pipelines asks for scattered misses | fill from a half-held cache against an empty one, at 46 and 92 ms RTT |
| 6 | medium | errors and refusals that never reach the app | one `failed {scope, reason}` event; a view-worker error after start is fatal and said | the refusals contract run against the view worker, with mutants |
| 7 | medium | a fifth viewport loses a WebGL context; "current frame" is singular | one context drawing every viewport; per-viewport wants merged by nearest distance | contexts lost and paint time at 1, 2, 4 and 5 viewports |
| 8 | medium | eviction that follows the want thrashes cine and can drop an unwritten frame | evict only over the byte budget, and never a frame not yet written | cine over two loops on a series over budget: decodes per index = 1 |
| 9 | medium | an AV1 group with members in the cache is decoded whole again | the store keeps and evicts whole groups | decodes per index on a G = 8 series with partial eviction |
| 10 | medium | cine in a worker: WebKit's clock is a timer, rAF is absent in nested workers, and a long task delays ticks | the clock picks the frame by elapsed time; it pauses on `hidden` from the page | WORKERCLOCK plus a WebKit cell and a hidden-tab cell |
| 11 | low | an AV1 preview on the pixel port can take the frame's place in the store | the store drops `preview` messages, or the arm's decoder posts none | a mutant: the preview stored |
| 12 | low | a read-back that throws, not mismatches, has no rule, and a re-ask goes to the want's tail | any read error is a miss, re-asked at its want position | M4 with a file deleted mid-session |
| 13 | low | phones: thread count and thermal state are unmeasured | decoders counted by a device setting, not WebKit's clamped `hardwareConcurrency` | D5 on a device |
| 14 | low | observability: no per-frame timings, and a `shown` without a reason | stamps (arrived, painted, written) in `ledger()`; `shown {i, exact, reason}` | the check reading them |

**1 · The want's order is lost below the store.** The Target says the store "never reorders" the want. The
downloader does: a `fill` goes into a `Set` (`client/transport/downloader.js:181–187`), and `nextRun` sends the lowest
contiguous run (`:275–281`). Asks go before fill frames (`:108`), and groups are sorted (`:84`). On the wire, an
order that is not ascending survives only as asks, and every ask is sent at once (MAP:docs/ARCHITECTURE.md:451–460).
The probe sent a want ordered 40, 41, 39, 42, 38 … over 76 frames. The wire saw `[0, 75]`, and frame 40 arrived
41st (`want-order.mjs`). The controller's "frame asked first, then the window" therefore holds only for the one frame
it asks. **Fix:** the downloader keeps the want as an ordered list. It sends a prefix of `D_min` asks
([`client-window-depth.md`](client-window-depth.md)) and tops it up as frames land, using a `stream_frames` run only
where the want is ascending. This is MAP's G1, client-only. **Settle:** arrival order against want order, and asked
frame → screen, in the browser at the ADR's links.

**2 · A replaced want, and the generation.** The design gives the want a `generation`. Today the only generation is
cancel's, and a cancel clears every record (`downloader.js:577–591`). Every message that carries an old generation is
then dropped: frames at `:239` and `:288`, decoder failures at `:443`, acks at `:572`, and on the page at
`consumer.js:108`. The probe filled 0..9, cancelled with frames 0–3 decoding, and filled 0..9 again. Frames 0–3 were
dispatched to a decoder twice. The whole range went on the wire twice, including frames that had already arrived and
were waiting for a decoder (`want-replaced.mjs`). A viewer whose every wheel step replaces the want would break "no
frame is decoded twice" at each step. With no cancel on the server (decided), the superseded frames still arrive, and
nothing counts them (MAP:490–496). **Fix:** a want replaces the order and nothing else. Frame identity is (series,
index, metadata version). The store keeps any frame of the current series that it does not already hold, and acks
it. A generation steps only when the series or its metadata version changes. **Settle:** decode dispatches per index
over a recorded scroll trace (must be 1), and wire bytes per frame shown.

**3 · Backpressure has no path.** A decoder's slot frees at `done` (`downloader.js:380–384`), whatever the store has
done with the frame. The pixel port's queue is unbounded by spec (HTML §port message queue), and a queued
`SharedArrayBuffer` message keeps its whole buffer alive. The wire ring allocates when it is empty
(`client/transport/ts/frame-session.ts:82–84`), and the compressed queue grows with the series while decoders lag,
because the reader pause is not built ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The downloader). So when the store
is full, or its writes fall behind, frames pile up in the view worker's port, outside any budget. ARMS saw this once
in its smoke: a Firefox write-on-arrival run ended with an unbounded backlog (ARMS:docs/adr/frame-path.md:810–816).
On V8 a `SharedArrayBuffer` counts 0 bytes towards the heap that triggers collection (FM:fp:639–645), and M2's
memory window failed its bar on Chromium, its re-run VOID (OCF:fp:304–306, 581, 611). **Fix:** credits. The downloader dispatches only while its unacked frames
number fewer than K. The store acks a frame only once it is held within budget or written. The reader pause then
carries this to QUIC flow control. FM's slots (c) are the same idea built in memory. **Settle:** peak resident memory
of a four-view mammogram fill with the store's writes slowed through a test lever, credits on and off, interleaved
(M5's bar).

**4 · One thread paints, stores, hashes and decides.** A worker runs one task at a time, and its rAF callbacks run
only between tasks (HTML §event loop processing model). Chromium drops a BeginFrame whose deadline has passed. ARMS
predicts arm A (a sync handle in the view worker, writing on arrival) blocks 4–17 ms a frame at 17 MB, and four
times that at 4× (ARMS:fp:758–769). M1 measured 22.3 ms to read and re-check one 3328×4096 frame (OCF:fp:577–580).
The probe (`busy-worker.cjs`, headless Chromium) posted `show` every 16 ms:

* idle: p95 0.2–0.3 ms;
* a 17 MB write every 100 ms in the same worker: p95 45–53 ms, max 91–294;
* the same writes in a second worker: p95 0.2–0.3 ms, the idle figure;
* writes plus a 17 MB read-back and a JS sum standing in for XXH3: median ≈ 50 ms, and that worker is saturated.

A cost the Target does not name: the paint ends with a 1-pixel `readPixels` that waits for the GPU
(`client/paint/paint-worker.js:224–225`). In today's paint worker that wait blocks nothing else. In the view worker
it blocks the store and the controller. **Fix:** take cache I/O off the view thread (arm C, a store worker) unless
OPFSARMS shows arm A paint-first holds; and keep the 1-pixel read only behind the lab's flag. **Settle:** OPFSARMS as
pre-registered, plus one cell it lacks: a window-level drag during a mammogram fill, input → painted.

**5 · Filtering fragments the wire.** The store sends only misses. If the cache holds every other frame, which a
budget's eviction or an earlier partial look can leave, the misses become one-frame runs. The downloader issues each
run only when the last one's final frame lands (`downloader.js:290`), and a new message ends the fill (WIRE §An ask
during a fill). The probe counted 38 runs for 76 frames. On a model of one idle RTT per run, that is 1.7 s at 46 ms
and 3.4 s at 92 ms, against none for one run. The model is the probe's, not a measurement. **Fix:** span gaps of up
to g held frames in one run, and drop the duplicates before decode (wire bytes, not decodes). Or send scattered misses
as pipelined asks, which the planner already holds 8 of (WIRE §FoD messages). **Settle:** a fill from a half-held
cache against an empty one at 46 and 92 ms RTT, sweeping g.

**6 · Errors that never reach the app.** In the build:

* intents are fire-and-forget (VW:client/view/view-worker.js:80), so a rejection in `controller.show` goes nowhere;
* the view worker's `onerror` reports any later error as "did not start" (VW:client/view/view.js:70), and nothing
  restarts the worker;
* a downloader whose script fails leaves `connect` hanging until the check's deadline (VW:fp:109–110);
* the downloader's series-level failure arrives as "frame -1".

On OCF, a refused write or a stopped series is swallowed, visible only as a count (OCF:client/viewer/store.js:105,
OCF:client/viewer/viewer.js:125). A second tab's lock is swallowed the same way: that tab silently runs without a
cache (OCF:viewer.js:155–163). **Fix:** one event, `failed {scope: frame | series | cache | worker, reason}`. After
start, a view-worker `error` or `messageerror` is fatal and shown. The cache says once when it stops. **Settle:** the
refusals contract (`client/contract/refusals.html`) run against the view worker, every refusal visible by name, plus
one mutant per scope.

**7 · A second viewport.** Chromium and WebKit allow **4 active WebGL contexts per worker thread** (16 on the main
thread). A fifth loses the oldest (sources, *Review*). A four-view mammogram in one view worker sits at that limit,
and any fifth canvas loses one of them. A single current frame also leaves undefined the store's "farthest from the
current frame" and the controller's want. **Fix:** one WebGL2 context drawing every viewport (a scissored region each
on one canvas, or one context presenting to each canvas). Each viewport has its own want; the wants are merged by
nearest distance and evicted by the minimum distance over viewports. **Settle:** contexts lost and paint time at 1, 2,
4 and 5 viewports, Chromium and WebKit.

**8 · Eviction that follows the want.** Read literally, every want change pushes what falls outside it out of memory.
A cine loop over a series that fits in memory (40–68 MB, §4) would then read every frame back from OPFS on every loop,
which today's path never does. FM lets an ask evict the farthest frame "on disk or not" (FM:fp:689). The build's
`put` can evict the frame it has just stored and still report it as arrived (VW:client/view/store.js:29–31). Either
one re-decodes a frame. OCF's built window drops only frames already on disk (OCF:viewer.js:111–118), and that is the
rule to keep. **Fix:** the want orders eviction but does not trigger it. A frame leaves memory only when over the byte
budget, and only once written. **Settle:** cine for two loops on a series over budget, then a series under it: decodes
per index, and OPFS reads per loop (0 under budget).

**9 · AV1 groups.** A miss inside a group asks for the whole group (`downloader.js:76–85`), because its frames depend
on the keyframe. If the cache holds part of a group, that part is decoded again, and "no frame is decoded twice"
cannot hold under per-frame eviction. It bites only at `groupLength` > 1, which the downloader supports
([`../av1/adr-unit.md`](../av1/adr-unit.md) §3) and the viewer does not set today. **Fix:** a group is the store's
unit of write and eviction. **Settle:** decodes per index on a G = 8 series with eviction forced through the store's
levers.

**10 · Cine with the clock in the worker.** Engine support:

* Chromium has no worker rAF in a nested worker, so the view worker must be the page's own child. The build is
  (VW:view.js:69).
* WebGL2 on `OffscreenCanvas` needs Safari 17.
* WebKit's worker rAF is a ~16.7 ms one-shot timer, not vsync, with no hidden-tab throttling ("FIXME").
* Gecko stops on `hidden`.
* Chromium's hidden-tab behaviour is not traced (WC:fp:200–205; sources).

Any task from #4 delays a tick. The build still paces cine from the page (VW:view.js:41–46). **Fix:** the clock picks
the frame from elapsed time since `play`, so a late tick skips to the right frame instead of drifting. The page
forwards `hidden` as a pause, as it already forwards its other triggers. **Settle:** WORKERCLOCK as pre-registered,
plus a WebKit cell and a hidden-tab cell counting ticks and battery-relevant wakeups.

**11 · An AV1 preview in the store.** The decoder posts a scalable payload's lower layer as `kind: "frame"` with
`preview: true`, on the same port, before the exact frame (`client/decode/decoder.js:62`). Today the consumer splits
it off (`consumer.js:118`). A store that keeps the first frame for an index, as `take` does (`client/viewer/viewer.js:99`), would
keep the preview and drop the exact frame. Previews are out of scope, so: **Fix:** the arm's decoders post none, or
the store drops them. **Settle:** a mutant that stores a preview must fail the check.

**12 · OPFS read-back.** The Target names a failed check and nothing else. A read can also throw: a cleared origin
(`NotFoundError`), a closed handle (`InvalidStateError`). What an open handle sees after a clear is in no spec or
source found. A re-ask placed at the want's tail reorders it, and a re-asked frame on OCF counts towards the fill's
end, which stamps it early (OCF:fp:598–599). **Fix:** any read error is a miss, re-asked at its own want position.
**Settle:** M4 with the entry deleted mid-session.

**13 · Phones.** WebKit reports `hardwareConcurrency` as 4 below 8 cores (sources), so a phone with two performance
cores runs three decoders, a downloader, the view worker and the page, plus a store worker in arm C. Memory is
#3's question. Thermal behaviour is not measured anywhere. **Fix:** the decoder count is a device setting where the
engine clamps it. **Settle:** D5 on a device.

**14 · Observability.** Today a lab reads the page's `Map` with arrival stamps (`client/viewer/viewer.js:100`). The build moves the
check's readbacks into the worker and adds `ledger()`, but nothing is timed (VW:fp:87). `shown {i, exact}` drops the
reason the page shows today (`client/viewer/viewer.js:84`). **Fix:** per-frame stamps (arrived, painted, written) in `ledger()`,
and `shown` carries `reason`.

**What holds up.**

* Taking the page out of the pixel path: presentation needs no page thread in any engine (§2, by source).
* The controller and store split, and "one owner per frame, changed at the ack": the build keeps the rule and its
  survival paths (VW:fp:96–99).
* The read-back check: M4 caught 4/4 flipped frames.
* The cache's value: M1 reopened 256×512² in 174 ms against a 7.49 s fetch.
* `valueAt`, built with a test.
* The session, survival and refusals staying in the downloader.

**No capability of today's path is lost by design.** The losses are in the build: error reporting (#6), timing (#14),
and the per-frame promise of `requestExactFrame`, now an event. The design's real exposure is #1–#4. The wire cannot
carry an order without asks; a want with today's generation re-decodes; nothing pushes back; and one thread carries
I/O. Each has a small fix and a measurement that settles it.

### An independent design (2026-10-28)

*Written blind, from the constraints and from `main` alone, before the owner's target design was read; the comparison
follows it as its own section, so the order is auditable. Nothing here is built or timed; every figure is one of
§2–§6's measurements, a reading of the code, or marked as a prediction. The probes under
[`../../lab/target-review/`](../../lab/target-review/README.md) are indicative only (a container, not a phone).*

**The constraints, as given.** Mobile on lossy wireless; the fill's throughput and the on-demand latency both count,
and a real viewer is a hybrid of the two by modality, study size and link; every shown frame lossless, bit-exact, checked
by XXH3 per frame; an OPFS cache of decoded samples, no frame decoded twice; priority is the client's ask order through
a server that does not reorder (*corrected in review*: the brief read "FIFO"; any message ends a running fill), no wire cancel, a shallow client window, stride as bandwidth conservation; no previews, no lower
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

Priority on the wire stays the ask order: asks, then the fill, no reordering at the server (*corrected in review*: it read "FIFO at the server"; any message ends a running fill), as the ADRs decided. The
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

### The independent design against the target (2026-10-28)

*Written after the section above was committed and pushed, then §Target: the view worker (PR #228,
`claude/view-worker-target`) and its branches were read: `claude/view-worker` (the view worker built as a variant, no
OPFS), `claude/opfs-arms` (the packed-file store built, M1–M4 measured, three cache-I/O arms pre-registered),
`claude/frame-memory` (who owns a frame's memory: a slot ring recommended, M5 pre-registered), `claude/worker-clock`
(the frame clock per engine, by source) and `claude/ask-patterns-map` (the asking patterns as wants). Figures marked
measured are those branches' or §2–§6's; the rest is read from their text and code.*

#### Where the two agree

Both take the page out of every path but input and status; both put the controller, the frame store and the paint on
one dedicated worker with WebGL2 on a transferred canvas; both run cine on that worker's own clock; both keep the ask
order as the only priority, a server that does not reorder (*corrected in review*: it read "a FIFO server"), no wire cancel, a shallow window; both store decoded samples checked
`true`, re-checked by XXH3 on every read, keyed by the series and its digests; both evict by series, least recently
opened; both ask `persist()` once and rely on nothing from it. The disagreement is in where the frame lives between
the decoder and the screen, and in how many owners that takes.

#### The differences, one by one

| | the target | the independent design | simpler for the same capability |
| --- | --- | --- | --- |
| **1 · threads** | page, downloader, N decoders nested in it, view worker: `N + 3`; a store worker (arm C) would be `N + 4` | page, core, N decoders nested in it: `N + 2` | the independent one, by one thread and one port; see 2 for what the thread buys |
| **2 · owners of frame state** | two by rule: the downloader owns what is owed, the store what is here, the frame changing owner at the ack; a want port between them carrying misses, order and a generation | one: the core holds the records and the stored flags; nothing changes owner, nothing is acked | the independent one: the want protocol, the ack, G1–G3 of the patterns map and the generation across the port do not exist. The target's reason for the split, "a busy receive loop is the stall the downloader exists to remove", is weighed under *What decides* |
| **3 · frames in memory** | a window around the current index within a budget (256 MiB), farthest first; M2 measured the window bounding nothing on V8, which counts a shared buffer as 0 bytes, so a slot ring with a `compareExchange` take count and backpressure is recommended (M5) | none: one read buffer per viewport; the kernel's page cache is the window | the independent one, by the whole of lever 2, the ring, the slot table and M2's finding: no shared buffer exists to be miscounted |
| **4 · how a fill frame reaches disk** | decoder → a `SharedArrayBuffer` (or a slot) → the view worker, which writes it paint-first in ≤ 8 ms pieces a tick (arm A) or posts it to a store worker (arm C); two copies of the samples (heap → buffer, buffer → file) and the write competes with the paint for one thread, which the L cell exists to measure | decoder → the file: one copy, on the decoder's thread; the paint thread never writes | the independent one: the L cell's question, "is the shown frame on time while a fill writes", has no object. Its cost is the write on the decoder's clock, measured by the W cell |
| **5 · how an asked frame reaches the screen** | from the buffer it arrived in: paint first, the write after | read back from the file after `done`: + 0.68–0.73 ms at 512², **+ 22.3 ms at 3328×4096** (M1, warm page cache, measured) | **the target**, on large frames: 22 ms is more than a display period. Conceded below |
| **6 · the layout** | one packed file per series, one handle held for the session, frame `i` at `i × frameBytes`, present bits and min/max after the frames, the manifest beside; `truncate` at open answers the quota before a byte arrives; M3 and M4 measured on Chromium and Firefox | a file per frame with a 32-byte head and an 8-byte digest trailer; two handle calls per write and per read; the quota answered per frame | **the target**, on the quota and on handles; the independent one needs a file per frame only because its decoders write in parallel under the exclusive lock. Conceded below |
| **7 · without OPFS, or a series past the quota** | the window alone, as today: the series stays viewable up to the device's memory | refused by name at open; a series past the quota fails its frames mid-fill once eviction finds nothing to delete | **the target**: it degrades, the independent one stops. Conceded below |
| **8 · asking** | a want: the ordered list of misses, replacing the one before, sent over the port; the downloader windows it (G1); the seven patterns map onto it | four rules in the core: stored → read; in hand → promote; next in the running fill → wait; else ask within `D`, the newest pending; the fill's next run starts after the frame shown | equal on today's wire; the want is the general form and the map a better survey of the space (patterns 1–3, 6 ride a want and not the four rules). Conceded in part |
| **9 · the clock** | worker `requestAnimationFrame`, traced per engine: on vsync in Chromium and Gecko, a 15 ms timer in WebKit (66.7 Hz, not the display's), with four fallbacks and a protocol | worker `requestAnimationFrame`, asserted from the standard alone | **the target**: its WebKit finding changes the design there (a `setTimeout` against a schedule or the page's ticks at 60 frames/s). Conceded |
| **10 · the hand-off's memory model** | `SharedArrayBuffer`, so cross-origin isolation stays a page requirement and V8's accounting applies; (a′), a transferred `ArrayBuffer`, is the condition that would turn the ring over | nothing shared: coded bytes moved, samples to disk, one private buffer per viewport; no isolation headers needed | the independent one |
| **11 · what changes in proven code** | the downloader, the consumer, both clients and the dispatch rig's 80 clauses stay; the consumer takes a port; the view worker is new | the downloader is rewritten into the core: its 606 lines, survival, re-dial, recycling, the ring and the rig's clauses move with it | **the target**: it is the smaller change to the most-tested module. Conceded below |
| **12 · a second viewport** | not weighed | one core, a map of series, a canvas and a read buffer per viewport; fills in focus order | the independent one, by having an answer |
| **13 · a series without digests** | not written: `exact !== true` is never stored, so it decodes again on every open | written with its trailer, read back `unchecked` | the independent one, by 8 bytes |

#### Failure scenarios, each way

**The target.**

* *Inputs:* a fill of 80 × 3328×4096 (2.03 GiB) on Chromium; *state:* the window at 256 MiB, frames as shared buffers.
  *Wrong result:* resident memory 2.5–3.0 GiB whatever the window does (M2, measured, VOID in its A/A but every round
  over the bar), because V8 charges a shared buffer to no isolate and the decoders keep every frame they allocated until
  idle. The fix is the slot ring, not yet built; until it is, the window is a number that bounds nothing.
* *Inputs:* a cine at 30 frames/s of 17 MB frames while the fill lands at 125 MB/s; *state:* arm A on arrival.
  *Wrong result:* the shown frame late by the write's block, 4–17 ms a frame at 1× and four times that at 4×
  (predicted in the arms section; the L cell decides). Arm A paint-first bounds it at 8 ms a tick and then sustains
  120–480 MB/s at 4×, under the fill at the low end: the backlog grows.
* *Inputs:* a series in a window with no window budget below its size, no OPFS (a private window on Firefox);
  *state:* question 2 open, "keep everything". *Wrong result:* today's ceiling, the tab killed by the device, not
  measured on a phone.
* *Inputs:* a want replaced while `D` asks are on the wire; *state:* G3 undecided. *Wrong result:* up to `D` plus the
  in-flight frames decoded for nothing, or dropped and asked again later (29–37 % more packets in SCROLLPOLICY's
  re-aimed fill, read as consistent with that).
* *Inputs:* two tabs on one series; *state:* the packed file's exclusive lock. *Wrong result:* the second tab runs
  without the cache, and a reopen within 1.6–9.2 s of a navigation does too (seen in M3 and M4, the lock outliving
  the page).

**The independent design.**

* *Inputs:* a step to a 3328×4096 frame just decoded, or a four-view mammogram flipped between views; *state:* no
  frame in memory. *Wrong result:* each step pays 22.3 ms of read and check (M1) before a ~6 ms upload: 28 ms, two
  display periods, where the target pays 6. At 4× on every thread, about 90 ms. The protocol's item 2 would add a
  painted-frames ring; item 3 the samples riding on `done`; both are the second path the design declined.
* *Inputs:* a reader cines 17 MB frames from disk at 30 frames/s during a fill; *state:* reads of 22 ms on the
  core's thread, 30 of them a second. *Wrong result:* the receive loop gets a third of its thread; QUIC's receive
  window (6 MiB) fills in ~0.4 s at 125 MB/s and the server stalls: the fill slows by the reads' share. The target's
  downloader keeps receiving; its view worker blocks the same way but only the paint waits. Not measured either way.
* *Inputs:* a series larger than the origin's quota, or a private window whose OPFS is in memory (Chromium: a third
  of 15–20 % of RAM per origin, ~410–546 MiB on an 8 GiB phone, from the quota sources); *state:* nothing left to
  evict. *Wrong result:* frames past the quota fail by name mid-fill, and the series cannot be viewed past them. The
  target views it on the window alone.
* *Inputs:* a phone whose `createSyncAccessHandle` costs milliseconds; *state:* a file per frame. *Wrong result:*
  two of those on every write and every read, a floor on the step and on the fill's write rate that the packed file
  pays once per session. The probe gives this container's number; a phone's is not known.
* *Inputs:* a decoder on Gecko writing 17 MB frames; *state:* one synchronous quota IPC per write (§4). *Wrong
  result:* the decoder's clock, the fill's when decode-bound, gains that round trip per frame; unknown size.
* *Inputs:* a 1 000-frame series on an engine where a directory of 1 000 files lists or evicts slowly; *state:*
  `removeEntry(recursive)` and `keys()`. *Wrong result:* a slow open or eviction; not measured.

#### What each counts per frame

| | target, a fill frame | independent, a fill frame | target, an on-demand miss | independent, an on-demand miss |
| --- | ---: | ---: | ---: | ---: |
| threads touched | 3 (downloader, decoder, view worker) | 2 (core, decoder) | 4 (page, downloader, decoder, view worker) | 3 (page, core, decoder) |
| messages | 4 (decode, frame, `done`, ack) | 2 (decode, `done`) | 4 + `show` and `shown` = 6 | 4 (`show`, decode, `done`, `shown`) |
| copies of the samples in script | 2 (heap → buffer or slot; buffer → file, arm A) or 1 + a post (arm C) | 1 (heap → file) | the same 2 or 1 | 2 (heap → file; file → the read buffer) |
| GPU uploads | 0 | 0 | 1, from the arrival buffer | 1, from the read buffer |
| on the paint thread, besides the paint | the write (A) or a post (C) | nothing | the write (A) or a post (C) | the read and the check |

#### What decides each difference

| difference | the measurement, and where it already is |
| --- | --- |
| 2 · the receive loop sharing a thread with reads and paints | the fill's last frame and its inter-arrival p99 with a cine of S2–S3 frames read from disk at 30 frames/s on the same thread, against the target's split; a new cell beside the arms' L cell |
| 3 · no memory window | M5's arms gain one: `disk-only`, the core reading every painted frame; measured as M5 measures (growth, fill time), predicted 530–600 MiB like `ring` with no ring |
| 4 · the decoder writes | the arms' W cell with a fourth arm, the write in the decoder (the §Protocol item 1 above): MB/s sustained and the fill's time against `none` |
| 5 · the read-back on the ask path | the §Protocol item 3 above; M1 already gives the floor: 0.7 ms at 512², 22.3 ms at 3328×4096 |
| 6 · a file per frame | the opfs probe: the two handle calls per access, the listing of 1 000 entries, three writers at once; a phone's figures are owed |
| 7 · past the quota | a rule, not a measurement: which behaviour the owner wants; M3's rig can run the case on both |
| 8 · wants against four rules | G1's measurement (asks held at `D_min` against one run) decides whether the want needs anything the four rules lack; the survey's sawtooth trace decides patterns 1–2 against the `current + 1` rule |
| 9 · the clock | the worker-clock protocol, as pre-registered there |
| 11 · the rewrite | not a measurement: the dispatch rig's 80 clauses re-run against the core would prove it, at the cost of the port they would need |

#### Where the target is better, conceded

1. **An asked frame painted from its arrival buffer.** 22.3 ms of read and check on a 3328×4096 frame (M1) is a display
   period and more, on the one path the constraints single out. "One path" was worth 0.7 ms at 512² and not 22 at the
   mammogram: the samples of an asked frame should ride `done` as a transferred `ArrayBuffer`, the §Protocol's item 3
   adopted without its measurement. The fill frame nobody looks at still goes straight to disk.
2. **The packed file and `truncate` at open.** One handle held, the quota's answer before the first frame, eviction and
   the manifest by series, M3 and M4 measured on two engines. A file per frame was chosen only so that `N` decoders
   could write; the two handle calls it costs per access are the probe's number and not yet a phone's.
3. **Degrading without OPFS or past the quota.** A viewer that stops at the quota is worse than one that views on
   memory alone; the independent design needs the target's window as its fallback for that case, which brings lever 2
   back for that case only.
4. **The smaller change to proven code.** Keeping the downloader, both clients, the consumer on a port and the dispatch
   rig is a cost the target does not pay; merging the downloader into the core is a rewrite of the module with the most
   clauses, and "removing work" was meant for the running system, not for the proof. The port and the ack are the price
   of that proof staying as it is.
5. **The clock, by source.** WebKit's worker `requestAnimationFrame` is a 15 ms timer, and the fallbacks and the protocol
   are already written; the independent design asserted what the standard allows and not what the engines do.
6. **The asking patterns as wants.** The survey and the map are the better statement of the space; the four rules are
   one point in it.

#### Where the independent design stands

* **No shared buffer anywhere**, so V8's zero accounting (M2) has nothing to miscount, no slot ring, no take count, no
  backpressure, no cross-origin isolation for the page. The target's own turn-over condition for the ring, (a′), is this
  design's default.
* **No memory window**: the kernel's page cache holds the frames just written, and a phone's eviction of it is the
  kernel's, not a constant we cannot read. Resident frame memory is `O(viewports)`.
* **The decoders write**, so the paint thread never writes and the L cell's question dissolves; one copy a fill frame
  against two.
* **One owner**, two messages a fill frame against four, no want protocol, no ack.
* **A second viewport and a second series** have an answer.

**What would settle it:** the W cell with the decoder writing (4), M5 with a `disk-only` arm (3), and the receive-loop
cell (2). If the decoder's write holds 125 MB/s on every engine and the fill under a disk cine stays within ×1.02, the
shape to build is the target's view worker with its downloader merged, its window dropped and its decoders writing;
if either fails, the target's split stands and the independent design's items 3 and 4 are what it takes from here.

#### The probes, indicative only

Run in this container's headless Chromium 153 on software GL, 4 cores, [`../../lab/target-review/`](../../lab/target-review/README.md);
no Firefox binary here, no WebKit. A number below is this host's, not a phone's, and nothing is claimed past it.

* **A file per frame costs ~1.7 ms of handle calls a write** (`getFileHandle` 0.8, `createSyncAccessHandle` 0.5,
  `close` 0.35, size-independent) and **~1.0 ms a read**; the write itself is a copy into the page cache (0.41 / 0.64 /
  4.2 ms at 0.52 / 1.67 / 17 MB, with 60–100 ms writeback stalls in every variant's tail at 17 MB), the warm read 0.08 /
  0.23 / 2.3 ms in the opfs probe and 1.4 / 2.1 / 11.3 ms in the one-worker probe (different pages, not reconciled).
  Pre-opening the next frame's handle takes ~1.2 ms off the decoder's critical path. Difference 6's price on this host:
  ~2 ms per access, which the packed file pays once per session.
* **Sync access handles work in a worker started by a worker** at the same cost (Chromium 153; the ADR's unverified
  item, for one engine); **three workers writing three files at once raise no error**, medians 20–60 % higher on four
  cores; a directory of 1 000 files lists in 20 ms and is created at 0.63 ms a file; `navigator.storage.estimate()`
  answers in the worker.
* **One dedicated worker holds WebGL2 on a transferred canvas, a sync access handle, `requestAnimationFrame` and the
  `WebTransport` constructor at once** (Chromium 153). Its rAF loop, painting a 512² frame a tick, **ran 60 ticks in the
  second the page's main thread spun and 60 in the second before it**, `setInterval(16)` 62 against 63: §2's prediction
  that the page's long tasks do not reach a worker's clock, as draws, for one engine; presentation is not read.
* The step from disk at 512² is ~2.2 ms of OPFS; the draw on SwiftShader (3.5 ms at 512², 46 ms at 2560×3328) is the
  host's and says nothing about a GPU.

#### Sources for the independent design (2026-10-28)

Fetched after the comparison was committed; they change no design text. Each file's URL and sha256 is in
[`frame-path-sources.txt`](frame-path-sources.txt) under 2026-10-28; commits as §9's, plus w3c/webtransport `eb3430a`
and WebKit `48880e3` (nested workers, 2022-09-17, "Blink and Gecko already support this"). Line numbers are of the
files as fetched.

| claim | source |
| --- | --- |
| a dedicated worker may start a worker | html `source` 136866–136867 `[Exposed=(Window,DedicatedWorker,SharedWorker)] interface Worker`; WebKit `workers/Worker.idl` 29–31, `Exposed=Window` at `9085c84` → `(Window,DedicatedWorker)` at `48880e3`; Gecko `dom/webidl/Worker.webidl` 14–15; Chromium `core/workers/worker.idl` 32–34 |
| WebGL2 on an `OffscreenCanvas` in a worker | html `source` 76936–76939; WebKit `html/OffscreenCanvas.idl` 62–73, `html/canvas/WebGL2RenderingContext.idl` 68–70; Gecko `OffscreenCanvas.webidl` 16–29, `WebGL2RenderingContext.webidl` 28–29 |
| `WebTransport` in a worker | w3c/webtransport `index.bs` 833–834 `[Exposed=(Window,Worker), SecureContext]`; Chromium `modules/webtransport/web_transport.idl` 8–10; Gecko `WebTransport.webidl` 75–76; WebKit `Modules/webtransport/WebTransport.idl` 28–31 |
| worker `requestAnimationFrame` | html `source` 133025–133030, 123527–123546; WebKit `DedicatedWorkerGlobalScope.idl` 49 (`EnabledBySetting=OffscreenCanvasInWorkersEnabled`); Gecko `DedicatedWorkerGlobalScope.webidl` 38; Chromium `dedicated_worker_global_scope.idl` 44–47 |
| a transferred `ArrayBuffer` is moved and detached, with no cross-origin-isolation check; a `SharedArrayBuffer` cannot be transferred, is cloned only when the settings object is cross-origin isolated, and is deleted from every global of a non-isolated cluster | html `source` 11291–11293, 11330, 11354–11365; 10533–10545; 117928–117939 |
| `estimate()` and `getDirectory()` in workers; `persist()` Window-only | storage `storage.bs` 604–624; fs `index.bs` 1692–1704 |
| file and directory handles are `[Serializable]` | fs `index.bs` 329–330, 361, 426–427, 471–472, 677–678, 726–727 |
| the sync handle's lock: taken exclusive, released on `close()`; released when the worker dies in Chromium (the host's mojo pipe severed → `OnDisconnect` → the lock handle destroyed), not a spec step | fs `index.bs` 132–172, 605–609, 1656–1664; Chromium `file_system_sync_access_handle.{h,cc}` 66–68, 39–50; `platform/mojo/heap_mojo_remote.h` 24–25, 112–115; `content/browser/file_system_access/file_system_access_access_handle_host_impl.{h,cc}` 67–69, 110–114, 58–60, 81–93; `file_system_access_lock_manager.cc` 574–579; `file_system_access_file_handle_impl.cc` 315–330 |
| a write or `truncate` past quota throws `QuotaExceededError` in Chromium, capacity asked before the write | `file_system_access_regular_file_delegate.cc` 76–82, 117–118; `file_system_access_capacity_tracker.cc` 73–105; `file_system_sync_access_handle.cc` 123–127, 204–217 |

**Not traced:** WebKit's and Gecko's release of the lock when a worker dies; WebKit's nested workers' sync handles at
run time (the IDL exposes them; the probe ran Chromium only).

### Experiments beside the target (2026-10-29)

*Which changes to the Target are worth an experiment each, ranked by expected gain over cost. Gathered from the
Target's open table, both reviews, [`../ARCHITECTURE.md`](../ARCHITECTURE.md), the branches cited as in §Review (FM,
ARMS, WC, MAP, VW) and a reading of `client/transport`, `client/decode`, `client/paint` and `VW:client/view/view-worker.js`.
**Nothing here is built or run**; a figure is a measurement cited where it is, or marked a guess. Each experiment
changes one lever against the Target as built on VW, interleaved (`lab/order.mjs`), ≥ 12 rounds, Chromium and
Firefox, every frame checked against the encoder input's `.sha256`, and states its rule before any data.*

**Screened out**, against what is decided or what is already measured:

* *Hashing the decoder's output before the copy into shared memory* (the hasher copies the frame into its own memory
  in 16 KB chunks, `client/decode/xxh3.js:21–25`): the copy would then be painted unchecked. Exactness first.
* *The range folded into the copy*: measured slower, 1.06–1.17× ([`../decode/README.md`](../decode/README.md) §The
  range pass). *Reading frames whole by default (`readMin`)*, which skips a copy on receive: frame 0 ties
  ([`../cloud-queue.md`](../cloud-queue.md), RMD4).
* *Merging `done` and the ack, or batching frames per message*: 0.1 ms a message at 1×, 0.4 at 4×
  ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The hand-off), spent in workers nobody waits on.
* *Reusing the paint's textures and its VOI table across frames* (`client/paint/paint-worker.js:104–120`): the whole
  paint is 0.34 ms at 512², and at 12.6 Mpx the upload is 5.70 of 5.74 ms (§Paint). Nothing anyone sees is left to
  remove.
* *Already pre-registered elsewhere, run as written against the view worker*: the values of `D_min`
  ([`client-window-depth.md`](client-window-depth.md) T1), the clock (WC), a disk-only store and the slot ring (FM's
  M5), who writes the cache (OPFSARMS), the 1-pixel `readPixels` (the Target keeps it behind the lab's flag).

| rank | experiment | metric it moves, and by how much | code | risk to exactness | decided by |
| ---: | --- | --- | --- | --- | --- |
| 1 | span small gaps in the misses (red 5) | a fill from a half-held cache: 1.7 s at 46 ms RTT, 3.4 s at 92 ms of idle round trips removed (the probe's model), against ~1.1 s of transfer for 38 CT frames at 20 Mbit (M1's 29 ms a frame) | `nextRun` takes a gap ≤ g; duplicates dropped before decode: ~20 lines | none: held frames are not decoded again | half-held against empty cache, 46 and 92 ms, 0 and 1 % loss, g ∈ {0, 1, 2, 4, 8} and all-misses-as-asks |
| 2 | the want ascending from `current + 1`, and no ask for a frame the running run delivers within k | forward steps during a fill: about one RTT (46–92 ms) per step that ends the fill today; **a guess** from WIRE §An ask during a fill | the controller's order and one test in the downloader: ~15 lines | none | MAP's sawtooth trace at 25 slices/s, step → screen; k = 1…8 |
| 3 | a transferred `ArrayBuffer` per frame, (a′), not a `SharedArrayBuffer` | peak memory of an 80 × 3328×4096 fill: 600–800 MiB against 2.6–3.2 GiB on Chromium (FM's M5 prediction); no slot table | the decoders' allocation and a transfer list: ~10 lines, against (c)'s ring | a detached buffer reaches no one; a store worker (arm C) needs it transferred back or copied | M5's `transfer` arm, read as the default and (c) as the alternative |
| 4 | the credit count K | the same peak memory against the fill's time; below `decoders × perDecoder` = 6 the decoders starve (**a guess**) | a constant | none | M5 with writes slowed, K ∈ {3, 6, 9, 12} |
| 5 | decoders on a phone, with the view worker's thread added (red 13) | fill time: 3 decoders on 2 cores at 4× were 7 % slower than 2 (5 329 against 4 999 ms, §Resources); one more thread moves the crossover, **a guess** | a setting | none | `resources.mjs` with the view worker, 2 and 4 cores, 1× and 4×, then D5 on a device |
| 6 | one WebGL2 context for every viewport (red 7) | a fifth canvas no longer loses a context; paint time unknown | a scissored canvas or a presentation per canvas: a few hundred lines | a viewport bleeding into its neighbour | contexts lost and paint p95 at 1, 2, 4, 5 viewports, Chromium and WebKit |
| 7 | the decoders write and post only frames near the want (arm D with independent concession 1) | one 17 MB copy a fill frame off the decoder's clock, ~4 ms (the probe's write) of a 47–72 ms decode: ≤ 8 % of a decode-bound fill, **a guess** | the decoder learns the window; the store learns "on disk, not held" | none new: every read is checked (§5) | OPFSARMS's W cell with arm D, posting all against posting the window |
| 8 | the AV1 group as the store's unit, previews never posted (red 9, 11) | nothing today: the viewer sets `groupLength` 1 and decodes no scalable payload | the store's eviction by group | a preview stored in a frame's place | deferred until either ships; then decodes per index at G = 8 |

**1 · Span small gaps.** The store sends only misses, and the downloader issues each run after the last one's final
frame lands (`client/transport/downloader.js:290`), so a cache holding every other frame costs a round trip a frame:
the probe counted 38 runs for 76 frames. Asking for g held frames to keep a run whole spends wire bytes, not decodes.
The third arm sends every scattered miss as pipelined asks, which the Target's `D_min` prefix already does for the
want's head. **Rule:** adopt the smallest g whose fill from the half-held cache is ≤ 0.6× of g = 0's in ≥ 9 of 12
rounds at both RTTs, with wire bytes ≤ the empty cache's fill; else keep g = 0. Lossy wireless makes an idle round
trip longer, so the 1 % cells matter most.

**2 · Do not ask across the running fill.** An ask ends the fill the server is reciting, and the fill is re-issued at
the asked frame's head ([`../WIRE.md`](../WIRE.md) §An ask during a fill): a reader stepping forward into what the
fill delivers next pays a round trip for a frame that was coming anyway. A want that starts at `current + 1` is
ascending, so it rides one run (MAP's G1), and the independent design's rule 3 is its downloader half. **Rule:** k is
the largest step ahead at which waiting is no later than asking in ≥ 9 of 12 rounds; adopt the ordering if the
sawtooth's median step → screen improves by ≥ 16.7 ms with the fill within ×0.98–1.02.

**3 · (a′) by default.** V8 counts a shared buffer as 0 bytes (FM:fp:639–645), so M2's window bounded nothing; a
transferred buffer is charged to its holder and collected. FM recommends the slot ring (c) and names (a′) the
turn-over (FM:fp:730); the ring costs a slot table, a `compareExchange` per frame and its own backpressure. If
`transfer` meets M5's 608 MiB bar the ring is not built, and the page no longer needs cross-origin isolation for its
frames. This ranks above K because it decides what K is protecting.

**4 · K.** The Target dispatches only while fewer than K frames are unacked; ARMS's W cell keeps its feeder 8 ahead
(ARMS:fp:784). Too small starves three decoders of two frames each; too large is M2 again. **Rule:** the smallest K
whose fill is within ×1.02 of K = 12, then check its growth against M5's bar.

**5 · Decoders on a phone.** The count is `min(3, hardwareConcurrency)`, and WebKit reports 4 below 8 cores, so a
phone with two fast cores runs three decoders beside the downloader, the view worker and the page. **Rule:** per core
count, the decoder count with the shortest fill whose cold ask is no later by 16.7 ms; a device setting where the
engine clamps.

**6 · One context.** A four-view mammogram already sits at the 4 contexts a worker gets in Chromium and WebKit. This
is a correctness fix with a cost to measure, not a speed-up. **Rule:** adopt if 5 viewports lose none and the paint
p95 at 4 is within 1 ms of four contexts; the check reads every viewport.

**7 · Decoders write, post the window.** A fill frame nobody looks at then never leaves the decoder but to disk, as in
the independent design, while asked frames ride a transferred buffer (its concession 1). Worth it only where the fill
is decode-bound and frames are large. **Rule:** adopt if the fill improves by ≥ 2 % on the mammogram in ≥ 9 of 12
rounds on both engines and no set is slower.

**8 · Groups and previews.** Both bite only with a payload the viewer does not use today; the experiment waits for
one.
