# Who owns the frame store

**Question:** Which thread holds the decoded frames in memory, and which writes and reads the cache?

*Moved 2026-11-14 from `docs/adr/frame-path.md` at `e5b20cba` (§3 · Who owns the frame store), word for word but for
queue-row names. A bare §N or §Name is a section of that ADR: [its map](../../adr/frame-path.md) names the file each
now lives in. Choices 1–8 are [the cache's](cache-in-opfs.md#the-choices-and-what-decides-each). The design these
findings shape is [`../design.md`](../design.md).*

## 3 · Who owns the frame store

**Memory.** A `SharedArrayBuffer` lives while any agent holds it. Today the page's `Map` holds every frame; in B the
paint worker holds them, and the page holds per-frame metadata only (index, `exact`, `min`/`max` for the default
window, dimensions) — a message of ~100 bytes a frame, which the page needs for its status and its window. **One owner,
the paint worker**, because it is the only consumer of samples: the page never reads one (the check reads `readPixels`
through the painter).

**Eviction** is by distance from the current index, not by recency: a reader scrolls a stack, so the frames next to the
one shown are the ones about to be wanted. The memory store keeps a window around the current index within a byte
budget; a frame evicted from memory stays in OPFS. A phone's budget cannot come from `navigator.deviceMemory`, which
WebKit declines ([`../CLIENTS.md`](../../CLIENTS.md) §On WebKit); it is a constant until a device sets it (§8).

**A frame the paint worker does not hold** (scrolled back past the window): it asks the store worker, which reads the
entry from OPFS into a new `SharedArrayBuffer`, checks it (§5), and posts the handle back. A frame in neither is asked
of the downloader as today, through the page's `requestFrame` or a port the page hands the paint worker.

**A second viewport.** One paint worker can hold several transferred canvases, one WebGL2 context each; samples are
uploaded from shared memory per context, so nothing is copied for the second. One worker for every viewport keeps one
store and one owner; two paint workers would need the decoders to post to both, or a store both ask. Recommended: **one
paint worker, every viewport**. Its cost is that two viewports' paints share one thread — 0.34 ms a 512² paint on a GPU
(measured, [`../ARCHITECTURE.md`](../../ARCHITECTURE.md) §Paint), so not a constraint at fill rates.

**The no-frame-lost rule interacts.** It makes the downloader forget a frame only once the page acknowledges it. In B the
frame's receiver is the paint worker, so the ack must come from it: the page hands it a port to the downloader at
start, or the ack is the page's, relayed from the paint worker's ~100-byte note. Either keeps the no-frame-lost rule; the first
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
  frame as it does on the page: the no-frame-lost rule holds unchanged, and the frame changes owner at the ack.
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
* **`askDepth` is 4, a constant**, inside the 2–5 that [`client-window-depth.md`](../../adr/client-window-depth.md) measured as
  `D_min` on its grid; it is not derived from the link. **Not timed:** a fill whose want stops ascending (a step during
  it) runs at that depth instead of as a run. **A head the ended run already had in flight crosses the wire twice**;
  the copy that lands second is dropped by the transport, decoded never.
* **The paint's GPU wait.** The 1-pixel `readPixels` that makes a paint return once drawn runs in the view worker only
  behind the lab's flag (`settlePaint`, set by the total-time rig's hooks in `lab/viewer/levers.js`); the paint worker
  of the page view keeps it, as before. *Corrected 2026-10-30:* neither view's product paint waits for its draw now;
  a lab names a **settle**, the fence by default, the read only to reproduce §7 (§7, *The pixel read under a busy
  page*; [`../../client/paint/README.md`](../../../client/paint/README.md) §When a paint has executed).
* **The cache (2026-10-29), under `worker` alone.** The store resolves each frame of a want from memory, then OPFS,
  then sends the downloader the misses: a frame on disk is no miss. It reads the want's frames on disk one at a time
  in its order, each checked against its frame digest (§5) wherever it is read; a read that fails its check or throws
  drops the entry and the frame joins the misses at its own place in the want. The cache opens before the first want,
  so a reopen's `start` carries only what is not on disk, and frames on disk are read and painted while the downloader
  still dials; a miss found before the downloader is linked goes out once it is. Only a series with digests is cached,
  and only frames checked `true`. **Paint first:** a frame is written only once the paint in flight has drawn, and
  a frame read from disk is not written again. The store acks a frame once it holds it within its memory budget, or
  else once its write settles (the consumer's `heldAcks`; asked frames are acked by the consumer, as before). The
  cache says `failed {scope: cache}` once when it stops (a write refused) and once when it cannot open; a second tab on
  the same series is told *another tab holds this series' cache* and fills from the downloader alone. **The writer is
  one setting**, the lab's `?writer=` (`lab/viewer/levers.js`; the product's page always uses the default):
  * `store` (**the default**; *changed 2026-10-30:* no writer, so no cache, is the default until the owner turns the
    cache on, §The core, assembled): `client/viewer/store.js` from `claude/opfs-cache-fixes`, unchanged but for its
    pointers: one packed file a series, its lock the tab's, evicting least recently opened series. The view worker
    starts it as a nested worker and hands it a copy of each frame, transferred (a `SharedArrayBuffer` sent to it is
    never collected there); it reads back through it.
  * `decoders`: a file per frame (`client/view/frame-file.js`: the samples, then min, max and the shape), written by
    the decoder that decoded it, from the shared buffer it already holds. The decoder keeps each exact frame until the
    view worker, after the paint, posts `write` on the frame's pixel port; it answers `written`. Read back in the view
    worker with a sync handle. A Web Lock per series stands for the packed file's lock.
  * `view`: the same file per frame, written in the view worker with a sync handle after the paint. Lab only.
* **Not built:** credits, eviction by byte budget and any eviction change (the memory budget stays every frame), frame
  memory options; the cine's clock in the worker; a second viewport; a series or metadata-version
  change, the only step of the generation under a want. Under `decoders` a frame the store never asks to write (an
  ask's frame, or every frame once the cache has stopped) stays kept in its decoder: today the same shared memory the
  store holds, but it would pin a frame the store let go. Nested workers and OPFS were run in Chromium alone (§4). A downloader whose script does not load is reported on the
  page as the series' and fails `connect` at once (*corrected in review*, 2026-10-29: this read that `connect` waited on
  the check's deadline, which it did until the page raced it against that error).

**Held by** the viewer check, run by the gate under both views on both clients, filled with a cine and on demand, and
under `worker` across tabs for each writer (`client/viewer/run_check.sh`), and by `client/view/controller.test.mjs`,
`client/view/view.test.mjs`, `client/view/cache.test.mjs`, `client/viewer/store.test.mjs` and
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
| a frame on disk is painted with no downloader message, and is read once a want | the node tests; the check's reopen | the want asking frames on disk; reads not marked |
| a corrupted entry is asked again at its place in the want and painted exact | the node test; the check's reopen after a byte of frame 1's entry is flipped, under each writer | the failed read not asked again |
| the write lands after the paint, under every writer | the node test; the check's first tab, under each writer: no frame's write asked before its paint, one painted then written | the paint not awaited |
| no cache write on the view worker's thread under `store` and `decoders`; some under `view` | the check, counting `write` and `createWritable` on that thread from its start | the files written on that thread under `decoders`; under `store` |
| a reopen asks the downloader nothing for frames on disk | the check's reopen: no miss sent, no frame delivered, every frame from the cache | the want asking frames on disk |
| a miss found before the downloader is linked is sent on link | the node test | not sent |
| a frame is acked once held within the budget, or once written | the node test | acked only once written |
| a second tab without the lock is told, as the cache's | `cache.test.mjs`; the check's second tab, under each writer | the open's failure not said; the Web Lock not taken |
| the cache stops once and says so once | `cache.test.mjs`, two writes refused in flight | said per write |
| the store worker gets a copy, never the shared buffer | `cache.test.mjs` | the buffer sent |
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

**The cache's cost a frame, counted from the code.** Written: `store`, 2 more messages (the write and its reply) and
one more copy, in the view worker, out of the shared buffer; `decoders`, 2 more (`write` and `written`) on the frame's
pixel port and no copy in script beyond the write; `view`, none, and the write on the view worker's thread. Read back:
`store`, 2 messages; `decoders` and `view`, none. Nothing reaches the page either way.

**What fought the shape.** The paint worker posted to its own global, so its `start` and `paint` now return and the
entry posts; imported, its handler is replaced by the view worker's. The consumer made its own worker: it takes a
`port`, ends a port by closing it, and the page triggers it forwarded are `watchPage`, exported. The downloader posted
to its global; it now posts to whatever `link` names. The check read pixels on the page — the readbacks against the
CPU reference, a spy on the client — so its half that needs frames runs beside the controller (`lab/viewer/check-view.js`),
and the total-time harness's frame hashes are the controller's `ledger()`. A drag starts from the frame's default
window and only the frame knows it, so `shown` carries it; the canvas's CSS size is the page's, so a resize is an
intent.

*The cache (2026-10-29).* Arm D as `claude/opfs-arms-d` describes it writes in the decoder *before* it posts, which
puts every write ahead of its paint; paint first under every writer made the decoder keep the frame and write on the
view worker's word, two messages a frame more than D's four (`write`, `written`), the same as `store`'s (a write and
its reply), against none under `view`. Nothing in the view worker knew when its own paint had drawn, so the store
waits on the controller's paint in flight. The consumer acked every frame on delivery, so the ack moved to the
store behind a flag. The first want rode `start` before anything could know what was on disk, so the cache now opens
before it: on a cold cache the opening run waits for the store worker to start and open (not timed). A packed file is
locked by its handle, a file per frame only while written, so the second-tab rule needed a Web Lock for those two.

*The want (2026-10-29).* The downloader held no order: a fill is a `Set` sent lowest run first, asks went before fill
frames, and the only generation was the cancel's, which every message carries and every stale one drops. The want
is a third structure beside them (`order`), and the generation stays the cancel's. The server ends a fill at any
message with no saved position and the client cannot tell which of the run's frames are in flight, so a want that
leaves a run waits for an ask to land behind it before re-asking the rest: on the shared stream what the run wrote
has arrived by then (the reasoning the head re-issue already rests on; not separately tested per stream mode). The
store needs its own copy of the misses it sent, because the downloader reports nothing back. The check's on-demand
steps encoded the opposite of the target ("the newest ask alone", a cancel each step), so under `worker` they now
expect both frames kept and one `want` a step. One controller serves both views, so the want path switches on
whether the store holds a downloader: two paths in one class while the page view stays. And the fill rode `start`
so the opening run rides the session URL; to keep that, the store makes its first want before it has a client, and
it rides `start` too.

**Proposed (2026-10-30): the page dials, beside the view worker's boot** (§7, *The view worker's start, timed*, found
why B′'s first frame is later). It changes "the first want rides `start`", so it is proposed here first and built
behind lab settings in `?opts=` whose defaults are today's; each is refused under `?view=page`, where it would be
ignored (`lab/viewer/levers.js`).

* **`pageDials`.** At connect the page, which already creates the downloader and links it to the view worker, also
  posts it `start` and `dial`, as the page view does, so the session opens while the view worker boots. The view worker
  joins that downloader (`DownloaderClient.connect` with `dialled`: it waits for `started` and posts neither) and links
  its store with what rode the start; a want of its own that differs goes over the port as `want`, as any later want
  does. **What rides the start:** with no cache and no half-held store, the controller's want from frame 0
  (`wantFrom`, the one definition both threads use) — the same frames in the same order the view worker would have
  sent, so the opening run still rides the session URL. **With the cache on** (`?writer=`) the want depends on what is
  on disk, which only the view worker learns once the cache opens: the page sends no want, the dial carries no run, and
  the view worker's misses go once it is linked. That stays correct — a frame on disk is never asked — but the opening
  run no longer rides the URL (not timed). `writer=decoders` is refused with it: the decoders learn at spawn whether to
  keep frames for the cache, which only the open cache can say. Costs: two messages more on the page, once; nothing a
  frame.
* **`viewWorkerFirst`.** The view worker is created before the metadata is awaited (`ViewWorker.boot`), so its module
  graph loads beside the metadata's fetch; the canvas and `start` still wait for the metadata. A script that fails
  before then is said as the worker not starting, as now.
* **`glAfterDial`.** The WebGL2 context is made a task after the view worker has posted the dial, not in `start`; a
  paint waits for it. Under `pageDials` the dial is the page's, so this buys nothing there.
* **`shortRuns`.** Before the session opens, a want the run covers whole — it ascends, and every unsent frame of it is
  in the one run, `span` crossing held frames as it would for a long one — rides the dial however short, as the page
  view's `fill` always does. Once the session is up nothing changes: a short want is asks, so on-demand steps stay
  asks, and `waitAhead`, which acts only while a run is in flight, is untouched.
* **`cache.js` imported lazily** is decided by §7's step timing: built only if its import is a visible share of the
  view worker's boot. *Decided 2026-10-30: not built* — 6–8 ms of the boot, probed (§7, *The view worker's start, timed*).

**Pre-registered for the re-run, before its data:** A (`page`), its A/A (`pageaa`), B′ (`worker`) and B′ with the fix
(`workerfix`: `pageDials`, `viewWorkerFirst`, `shortRuns`), §7's start timing's cells, rounds, guards and corrected
bars, read by `lab/viewer/start-summary.mjs`; **B′ with the fix ties A** when its verdict there is "ties A".
