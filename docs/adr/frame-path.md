# ADR: where a decoded frame goes — the page in or out of the pixel path, and who owns the frame store

**Status:** proposed 2026-10-11 (queue row 148, FRAMEPATH, of [`../av1/queue.md`](../av1/queue.md)); the cache's design
reviewed 2026-10-20 and **built 2026-10-27, not timed** (§Proposed: the client cache in OPFS); the owner's target
shape, a B′ without the store worker, **built 2026-10-28 as a variant beside today's path and not timed** (§3, *Built*);
both assembled on one branch 2026-10-30 (§The core, assembled). The decisions are the owner's; they are listed in §8 and under the queue's
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
CPU reference, a spy on the client — so its half that needs frames runs beside the controller (`client/view/check.js`),
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
has arrived by then (the reasoning row 229's refill already rests on; not separately tested per stream mode). The
store needs its own copy of the misses it sent, because the downloader reports nothing back. The check's on-demand
steps encoded the opposite of the target ("the newest ask alone", a cancel each step), so under `worker` they now
expect both frames kept and one `want` a step. One controller serves both views, so the want path switches on
whether the store holds a downloader: two paths in one class while the page view stays. And the fill rode `start`
so the opening run rides the session URL; to keep that, the store makes its first want before it has a client, and
it rides `start` too.

#### Experiment 2: the want ascending, and no ask across the running fill (2026-10-29)

*Rank 2 of the experiments beside the target (`claude/vw-experiments`, frame-path.md §Experiments beside the target).
Pre-registered: written, built and smoked before any data; **not run**. Its run is a row of its own, after a
methodology review of this text.* Reviewed 2026-10-30, before any data: corrections are marked *Review* where they
stand, the old text kept, and the findings are under *Review* at the end.

**Claim.** Under `worker` while filling, a reader stepping forward faster than the fill delivers ends the run with an
ask for a frame the run was about to send (WIRE §An ask during a fill), and the nearest-first want (c, c+1, c−1, …)
then never ascends, so the rest of the fill goes as alternating asks. A want ascending from the current frame
(c, c+1, …, n−1, 0, …, c−1, wrapping as the cine does) puts the frames ahead first; and a head the running run
delivers within its next k frames is waited for rather than asked. Together they should shorten the wait for the
frame a forward step lands on, by about one round trip a step that ends the fill today — **a guess**, as the table
says. *Review:* the rest goes as asks whatever the want's order, ascending too: once a second ask is owed when the
first lands, each arrival tops the asks back up to D_min and `serveWant` starts a run only with nothing owed, so no
run starts again. Under a reader at 25 slices/s, one step a visit ends the fill, and the lever acts before that ask
alone. The model's figures replace the guess (*Review*, *Predictions*).

**The setting.** `waitAhead: k` in the downloader's options (the lab's `?opts={"waitAhead":k}`; the viewer check's
`--opts`), absent by default. Absent, nothing changes: the want is nearest-first and only the run's next frame is
waited for. Set, the controller's want ascends and the downloader waits for a head among the run's next k frames
(`client/view/controller.js` `want`, `client/transport/downloader.js` `serveWant`). It acts under `worker` only; the
page view sends no want.

**Arms**, one build, one setting, nothing else different: `off`, `off′` (the A/A pair, the same build and setting run
as a second unit), and `on` at k ∈ {1, 2, 4, 8}; k = 1 is the ordering alone.

**The trace.** From frame 0's first paint, a sawtooth over the first third of the stack at 25 slices/s (MAP's
drilling trace): 0 → ⌊n/3⌋ → 0, three times, a step every 40 ms through the view's `show`. Not built: the run's row
adds it as a lab lever beside `lab/viewer/levers.js`, recording each step's time, whether its frame was held, and
when it was. The review checks the driver before round 0. *Review:* built and smoked by the review,
`lab/viewer/trace.js` behind `?trace=sawtooth` (`run.mjs --trace sawtooth`). MAP names the trace, a sawtooth over a
third of the stack at 25 slices/s; the strokes' number and ⌊n/3⌋ are this protocol's reading of it.

**Measured, per visit.** *Primary:* **the wait of a forward step**, from the step to its frame held (0 if held at the
step), averaged over the up-strokes' steps — the same steps in every arm, so no arm chooses which steps count, and
defined for a frame the reader passed before it landed. *Must not regress:* the fill's time (the controller's
`fillMs`); the backward steps' mean wait; the on-demand wait (the same trace with `fill=0`, where the setting changes
nothing by construction); exactness, every frame against its digest and the encoder input's `.sha256`. *Review:* this
departs from the table's figure (the median step → screen) and says so here: a mean to held, compared round by round.
Held is screen less one paint, the same in every arm. On demand the want is the current frame alone, and a frame the
reader left with D_min asks already owed is never asked, so its wait to held can be undefined. The on-demand figure
is the time a step's frame was missing before the next step (`missingMs`, defined for every step).

**Cells.** Sets `ct_lidc` (60 × 512²) and `dbt10_ea1141` (16 tomosynthesis frames), on fixed-rate links of 5 and 20
Mbit/s at 46 and 92 ms round trip, no loss, the relay with `--self-timing`; Chromium and Firefox; 1× CPU, the rig
pinned as TOTAL4 (`taskset -c 0-2`). Plus one on-demand cell per engine (`ct_lidc`, 20 Mbit/s, 92 ms). *Review:*
`ct_lidc` is 100 × 512² ([`../FIXTURES.md`](../FIXTURES.md) §AV1 data), 164 kB a frame as ingest codes it
([`disk-access.md`](disk-access.md) §6), and `dbt10_ea1141` is 24 × 678×1727, ~567 kB a frame (13.6 MB,
[`../native/quic-compared.md`](../native/quic-compared.md) §9.5). The traces are 198 steps (7.9 s) to frame 33 and 48 steps
(1.9 s) to frame 8. A frame takes 66–907 ms of link in every cell, longer than a 40 ms step, so the reader outruns
the fill everywhere and the live guard binds nowhere (the model: 33–100 % of `off`'s steps up not held). `run.mjs`
took one round trip per invocation (`--one-way-ms`); a link `r5000rtt92` now carries its own, so both round trips
sit in one Williams order.

**Interleaving and rounds.** The six arms in a Williams order inside each cell (`lab/order.mjs`, period 6), cells in
a Williams order each round as the total-time rig orders them; 12 rounds, two periods. `--mutate sample` before round
0 must turn every arm's exactness to 0. *Review:* it left a viewer variant exact (smoke: 30 of 30), as the flip
lived only in the total-time page. The view's ledger now takes it, and the smoke went to 0 of 30, and 0 of 11 on
demand.

**Guards.** *Saturation:* a visit whose relay prints `VOID` (p99 lateness over 1 ms) is dropped and re-run at the
round's end; a cell left under 10 visits an arm is reported as saturated and claims nothing. *Live cell:* the share
of `off`'s forward steps whose frame was not held at the step is reported beside every result; below 10 % the reader
never outran the fill, the cell is dead, and a tie there is not a null. *A/A:* a cell where `off′` − `off`'s paired
median wait is beyond ±8 ms, or its fill outside ×0.98–1.02, is too noisy to decide and says so. *Review:* a
visit that failed, or whose fill stopped short, is re-run as a `VOID` one is, not counted.

**Rule**, fixed before the data, over the live, decided cells:

* *k\** is the largest k whose wait is no later than k = 1's in ≥ 9 of 12 rounds in every such cell: waiting is no
  later than asking. None: k\* = 1.
* `on` at k\* is **adopted as the default** if its wait beats `off`'s by ≥ 16.7 ms (one 60 Hz frame) in ≥ 9 of 12
  rounds in at least one cell per engine; is later than `off` by 16.7 ms in ≥ 9 of 12 rounds in none, forward or
  backward; its fill's paired median ratio to `off` is ≤ 1.02 in every cell; the on-demand cells are within the A/A
  spread; and every frame is exact. An inexact frame in any arm rejects it whatever the timings.
* Better forward and worse backward is a trade-off for the owner, with those cells as its cost. Otherwise `off` stays
  and the setting is removed.
* *Review, amended before data:* a cell whose trace does not climb past k (k ≥ ⌊n/3⌋, `dbt10_ea1141` at k = 8)
  gives that k no vote, for k\* or for adoption: there `on` never asks within the trace, which measures no ask at
  all rather than a wait within k. *The on-demand cells within the A/A spread:* their paired median `missingMs`
  against `off` within the larger of 8 ms and that cell's A/A. `lab/viewer/wait-ahead-summary.mjs` applies the
  guards and this rule to the rows.

**Built and checked** (2026-10-29). Each check was mutated and its mutant failed:

| claim | check | mutant |
| --- | --- | --- |
| under the setting the misses go ascending from the current frame, wrapping | `controller.test.mjs` *waitAhead: the want ascends* | the setting ignored; no wrap |
| by default a head the run delivers second is asked; under k = 4 it is waited for, a head behind the run is asked, and one 5th is asked | `downloader.test.mjs` *aHeadTheRunDeliversWithinKIsWaitedFor* | k ignored; ≤ k; the default as 2; a head outside the run waited for |
| *Review:* the 5th was asked because the run had already ended, and k unbounded or k + 1 under the setting passed. Now each head is in a fresh run: by default the run's 2nd, 4th, 5th and one behind it are asked; under k = 4 the 2nd and 4th are waited for | the same test, rewritten | the two that passed; k ignored; a head outside the run; the default as 2; k − 1: 6 of 6 |

The view worker's reading of the setting has no node check: a smoke ran one round per arm of the viewer check under
`worker` with a cine (`--opts '{"waitAhead":4}'` and without), both green, and with the ascending branch made to throw
only the arm with the setting failed. It is a smoke, and gives no number.

**Review** (2026-10-30, independent, before any data).

*Sources.* This text pins no external file, so there is no sha256 to re-check. Every place it leans on was read at a
commit, and each holds as cited unless corrected above:

* WIRE.md §An ask during a fill, lines 118–137 on this base (`34ebe33`): an ask ends the run, there is no saved
  position, and the downloader re-asks the rest.
* MAP (`claude/ask-patterns-map` at `8ffe467`), `docs/ARCHITECTURE.md`. Lines 403–404 name the drilling trace, a
  sawtooth over a third of the stack at 25 slices/s; line 377 gives its rate, Diaz et al. 2015 (abstract only),
  25–30 slices/s.
* The table (`claude/vw-experiments` at `9a829a4`), frame-path.md lines 952 and 968–973.
* The independent design (`claude/review-blind` at `a429a6c`), `docs/adr/frame-path.md`. Lines 428–431 give rule 3,
  waiting for the frame next in the run; line 525 gives its depth, k = 1…8.
* The sets' sizes, from FIXTURES.md lines 353 and 359 and disk-access.md line 391; these corrected the *Cells*.

*Asks that never yield.* After a run ends, `serveWant` (`client/transport/downloader.js`) starts another only when
nothing is owed. Each landing ask tops the asks back up to D_min, so once two are owed, every miss after goes as an
ask. On the downloader alone: a run of 0–39, then two steps (to 5, then 6) before the first ask lands. The rest went as
35 asks and no run, for 34 frames. A lone ask that lands with nothing owed does let a run restart. This is the base's
behaviour (#238), and it bounds both this lever and Experiment 1's `span`: each acts only where a run starts. Changing
it is structural, and the owner's: for instance, start a run when the want's head ascends D_min unsent frames
although asks are owed. **Not built.**

*Predictions.* `lab/viewer/want-model.mjs` is a model, not a measurement. It drives the real downloader against a
simulated server and one FIFO link:

* the server recites a run and ends it at a frame boundary for any message in hand, and serves asks in order;
* it keeps at most BDP plus a queue unacknowledged (0 and 250 kB, the relay's 200 packets);
* decode and paint are taken as instant, and every frame of a set has one size.

All 80 modelled visits ran one run. Each figure below is the forward mean's change against `off`, in ms, over both
round trips; *bwd* is the backward mean's change.

| cell | queue | `off` forward | k = 1 | k = 2 | k = 4 | k = 8 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `ct_lidc` 5 Mbit/s | 0 | 2 580–2 770 | +1 | +2…+3 | +10 | +6…+23 |
| `ct_lidc` 5 Mbit/s | 250 kB | 2 129 | 0 | −171 | −165…−178 | −163, bwd −136 |
| `ct_lidc` 20 Mbit/s | 0 | 235–252 | +9…+10 | −15 | −12…−13 | −8…−9 |
| `ct_lidc` 20 Mbit/s | 250 kB | 183 | +20 | −5 | −24 | −23…−28, bwd +15…+16 |
| `dbt10_ea1141` 5 Mbit/s | 0 / 250 kB | 4 199–6 713 | 0 | 0 | 0, bwd +453…+523 | −891…−1 202, no ask |
| `dbt10_ea1141` 20 Mbit/s | 0 | 730–1 056 | 0 | +3…+7 | +207…+412, bwd +307…+391 | 0 |
| `dbt10_ea1141` 20 Mbit/s | 250 kB | 391–439 | 0 | +11 | +45, bwd +61…+64 | 0 |

Every fill is ×0.96–1.04 of `off`'s. Read under the rule, the model decides nothing:

* With the queue empty, no voting cell beats `off` by 16.7 ms, and `off` stays.
* With the queue full, k\* is 8 (k = 2 and 4 are later than k = 1 on the 20 Mbit/s DBT cell). It beats `off` on both CT cells, against
  a backward cost of 15–16 ms at 20 Mbit/s, under the 16.7 ms bar.
* Without the vote amendment, the DBT cells at 5 Mbit/s would count for k = 8 a −891…−1 202 ms win that comes from
  never asking.
* k = 1, the ordering alone, is later than `off` on CT at 20 Mbit/s by 9–20 ms.

The relay's queue occupancy, not the round trip, moves the answer. The run decides; nothing here predicts it.

*The protocol against the rules.*

* *Interleaving:* in place, as Williams orders over arms and over cells, round trips now included.
* *A/A:* `off′` as a unit, with a ±8 ms bound, half the bar. It is not measured on these links. If every cell
  exceeds it, the experiment decides nothing, and says so.
* *Saturation:* the relay's `VOID` and the 10-visit floor; the smoke saw 2 `VOID` of 6 on one round.
* *Rule fixed before data:* yes, and decidable once the four amendments above are in. They are: the vote of a k the
  trace does not climb past; the on-demand figure; failed visits re-run; and `--mutate sample` reaching the viewer.

*Experiment 1's `span` (#243, its review #248).*

* Textually, `downloader.js` merges cleanly. Against #248's head, eight files conflict: `view-worker.js`
  (`connect`), `downloader.test.mjs`, the controller's ledger and its test, `run.mjs`'s `opts`, `gate.sh`,
  `levers.js` and `viewer.js`. Most are both adding beside each other. The last two differ in kind: #248 steps on
  demand and waits for each frame, while here the steps keep time.
* Semantically, both levers act only where a run starts, so the yield above silences both. Under `span`, the run's
  next k frames include held frames it carries, which is wire distance and the k this text means.
* Exp 1's `holdEveryOther` builds its first want from `controller.want()`, which under `waitAhead` ascends. So each
  experiment runs with the other's setting absent. If either is adopted before the other's round 0, the other runs on
  the adopted default and says so.

*Built in review, each test mutated:*

| piece | where | mutants caught |
| --- | --- | --- |
| the sawtooth and each step's wait | `lab/viewer/trace.js`, `trace.test.mjs` | 9 of 10; the tenth reads a repeated frame as up, and the trace has none |
| the ledger's `fillMs` and lab flip | `client/view/controller.js`, `controller.test.mjs` | 4 of 4 |
| the trace driven from frame 0 on screen, each step on time | `client/viewer/viewer.js` | smoke only |
| a variant's `opts`, `--trace`, a link's own round trip, the trace in each row | `lab/av1/delivery/total-time/run.mjs` | smoke only |
| the guards and the rule | `lab/viewer/wait-ahead-summary.mjs`, `wait-ahead-summary.test.mjs` | 20 of 20 |

*Smoke*, Chromium, one round per arm. The set was the contract's 16-bit grey frame ×30, behind
`r5000rtt46`/`rtt92`; it shows the rig, and no result is read from it:

* the fill and on-demand cells ran all six arms, with every frame held exact;
* `--mutate sample` turned both arms it was run on, `off` and `k2`, to 0 exact, fill and on demand;
* the setting reached the view worker and the downloader with its value: each made to throw, only the arm with the
  setting failed.

*To run* (its own row). Make each set with `make_frames.py`, and give its `variants.json` the six arms `off`, `offaa`,
`k1`, `k2`, `k4` and `k8`. Each arm carries `"codec": "htj2k"`, `"openjph": "delivered"`, `"viewer"`,
`"view": "worker"`, the digests, and `"opts": {"waitAhead": k}` (absent for `off`, `offaa`). Then run:

```bash
for r in $(seq 0 11); do NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --rounds 1 --first-round $r \
  --engines chromium,firefox --throttles 1 --links r5000rtt46,r5000rtt92,r20000rtt46,r20000rtt92 --sets ct_lidc,dbt10_ea1141 \
  --trace sawtooth --out rows.jsonl; done        # and --fill 0 --sets ct_lidc --links r20000rtt92 for the on-demand cells
node lab/viewer/wait-ahead-summary.mjs rows.jsonl rows-on-demand.jsonl
```

#### Experiment 3: a transferred `ArrayBuffer` per frame (2026-10-29)

*Rank 3 of the ranked table of experiments beside the target (`claude/vw-experiments`, frame-path.md §Experiments
beside the target): FM's (a′), against the `SharedArrayBuffer` the decoders write today. On this branch the target is
§3's* Built *above, so the experiment sits here. **Pre-registered, built, not run**; the run is a row of its own,
after a methodology review. The smoke below proves the arms run, and gives no number.*

**The claim.** V8 counts a `SharedArrayBuffer` as 0 bytes towards collection, so a frame the store lets go during a
fill is not freed until something else collects (FM's M2 diagnostic: after a 2.03 GiB fill under a 256 MiB window,
2.4 GiB stayed resident until `gc()` ran in the decoder workers); a transferred `ArrayBuffer` is counted at its
length in the view worker, which then collects it. With a window, (a′)
bounds a fill's growth by the window plus the collector's slack: **predicted** 600–800 MiB on Chromium and 650–1 100
on Firefox, against 2.6–3.2 GiB shared on Chromium (FM's M5). Its costs are predicted nil: the copy count is the same
(the decoder's one), and the transfer replaces the handle.

**What this build can test.** The want's store keeps every frame: the view worker passes no budget, and a budget
under a want is not built (§3, *Not built*; a step would want again what it evicted, and `ledger()` would hash only
what is held). With every frame held, both arms hold the whole series, so the claim's cell **W** needs two things
first: the store's window under a want (its own row) and M5's rig
(`claude/opfs-cache-fixes:lab/opfs-cache/run.mjs`, cell `m2`) carried to this build. Cell **T**, the costs, runs now.

**The arms.** One build, one setting, `pixels`, a connect option the lab sets per variant (`client/README.md`): absent,
`shared` (the default); `"transfer"`, each decoder writes the frame into an `ArrayBuffer` and transfers it to the
consumer. Both under `?view=worker`, both cross-origin isolated (dropping isolation is another change), the same
decoders, store and transport. **`shared′`** is `shared` under a second name: the A/A pair.

| cell | rig | sets, links, CPU | measured | arms |
| --- | --- | --- | --- | --- |
| **T** (costs) | `lab/av1/delivery/total-time/run.mjs`, viewer variants `"view": "worker"`, `"pixels"` per arm | `ct_nlst` (512²) and `dbt12_ea1141` (614×1359, the largest frames this rig has); `r50000` clean; 1× and 4×; Chromium and Firefox | fill (issue → every frame on screen), first (issue → first exact frame on screen: the opening frame, asked cold), exactness by the decoder's XXH3 and the rig's SHA-256, each worker's CPU ms | `shared`, `shared′`, `transfer` |
| **W** (the claim) | M5's rig as M5 states it: 80 × 3328×4096 (2.03 GiB) on loopback, a 256 MiB window, the browser tree's PSS each second, growth = peak less the value before the dial | Chromium and Firefox, 1× | growth, fill, exactness | the same three, and each again with every frame held (no window): the control |

**Order and rounds.** Cells, and the arms inside each, in `lab/order.mjs`'s Williams order per round, as the rig does;
a fresh browser profile and server per visit. 12 rounds; a cell VOID at 12 gets two more, then stays VOID.

**VOID**, per cell: in T, the median per-round `shared′`/`shared` fill ratio outside 0.98–1.02 or the median
|`shared′` − `shared`| first over 16.7 ms; in W, the median |`shared′` − `shared`| growth over 64 MiB (M5's bar). A visit
the relay marks VOID is dropped, as the rig does. A VOID cell is reported and rules nothing.

**Saturation guard.** The browser has cores 0–2 and the relay core 3. A T visit whose workers' CPU ms over its fill
exceed 0.9 × 3 cores × the fill's wall time is saturated; a cell with any saturated `shared` visit is reported as
saturated and rules nothing (4× with three decoders is where this is expected). In W a visit stops at 10 GiB of growth
and counts as failed: the container stops near 12 GiB (M2).

**The rule, stated before any data.**

* **T holds** if, in every cell neither VOID nor saturated, the median per-round `transfer`/`shared` fill ratio is ≤ 1.02,
  the median `transfer` − `shared` first is < 16.7 ms, and every frame of every visit of both arms is exact by both
  checks. An inexact frame under `transfer` alone is a defect, not a cost: the experiment stops.
* **W holds** if, on each engine, in every round not VOID, `transfer` completes, every frame is exact, and its growth is
  ≤ 608 MiB (M5's bar: the floor's 537, the A/A's 64, rounded up); and in the control, the median |`transfer` −
  `shared`| growth is ≤ 64 MiB (nothing kept by a clone where a transfer was meant).
* **Adopt** `transfer` as the default only if T and W both hold; FM's (c), the slot ring, is then not built. **Reject**
  it if T fails, whatever W says, naming the regression. If T holds and W has not run, nothing changes and the setting
  stays off. If W fails, (c) stays FM's recommendation, with the numbers. WebKit is not run (no build in the
  container): an adoption says so.

**Built.** `client/decode/frame-buffer.js` allocates a frame (`htj2k.js`, `av1-frame.js`) and names its transfer list;
`decoder.js` sets it from `init` and lists the buffer on the frame's and the preview's messages; the downloader passes
`pixels` to every decoder; the consumer wraps either buffer in its `bytes`. The total-time rig takes `"pixels"` per
variant; `client/viewer/check.mjs` takes `--opts`. Each check was mutated and its mutant failed:

| claim | check | mutant |
| --- | --- | --- |
| by default a frame is a `SharedArrayBuffer` on no transfer list; under `transfer` an `ArrayBuffer` that is its message's whole transfer list, samples and range intact; a later start without the setting is shared again | `client/decode/decoder.test.mjs`: `decoder.js` and `htj2k.js` as built over a stand-in OpenJPH glue | never listed; always shared; the setting never read; the frame's post without the list; the setting never reset |
| `pixels` reaches every decoder the downloader starts | `downloader.test.mjs` *pixelsReachTheDecoders* | `pixels` left out of `init` |
| a frame's `bytes` is a `Uint8Array` over its buffer, shared or transferred | `consumer.test.mjs` *bytesOverEitherBuffer* | the old wrap, shared buffers only |
| the setting reaches a browser's decoders | the viewer check with `--opts '{"pixels":"transfer"}'` | an allocation that throws under `transfer`: 11 failing |

The module's own default (`false`) is an equivalent mutant under `decoder.js`, which sets it at every start; it is
what a codec module used alone (`av1.test.mjs`) gets.

**Smoke, 2026-10-29, one round per arm, no number reported.** The total-time rig on a three-frame set of the
contract's 16-bit grey codestream (`r50000`, 1×, Chromium), variants `shared` and `transfer`: both complete, every
frame exact by both checks. The viewer check under `--view worker --opts '{"pixels":"transfer"}'`, filled with a cine
and on demand: complete, exact and drawn, no pixel reaching the page. Not smoked: Firefox, the 4× throttle, the sets
of cell T (they need `lab/av1/fetch_data.sh` and the AV1 tools), and W, which has no rig on this build.

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

*Theory and a pre-registered protocol; the harness built 2026-10-30 ([`../../lab/frame-clock/`](../../lab/frame-clock/README.md)) and smoke-run, nothing timed as a result.* The owner's next client shape: the page holds no
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

**Protocol, M5, pre-registered 2026-10-28, before any build or data** (amended 2026-10-29, *M5 amended* below). M2's rig (`lab/opfs-cache/run.mjs`, cell `m2`)
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

**M5 amended, 2026-10-29, before any data.** Two reviews on PR #235 bear on M5: the red team's finding 3 (no
backpressure; the revised Target adopts credits, K open) and the independent design's *no frame memory* (the disk the
only frame store, one reused read buffer per viewport, the OS page cache as the window, predicted there at 530–600 MiB
like `ring`). The question stays one: which frame memory bounds a fill. The pre-registration above stands as written;
the arms, the bar and the rule below replace its own. The arms are built in `lab/opfs-cache/` only, nothing in
`client/` changes, and M5 is not run here: its runs are a separate row.

**The build.** A stand-in view worker (`arms-view.js`, page `arms.html`) runs the product's downloader with its decoder
seam pointed at `arms-decoder.js`: the product's OpenJPH build and frame check, then each exact frame written to an
OPFS file of its own **before** it is posted. Every arm so writes the same bytes from the same threads (who writes is
not this row's question), and the arms differ in one lever, what the view holds:

| arm | what the view holds | build |
| --- | --- | --- |
| `ring`, `ring′` | (c): ⌊256 MiB / frame⌋ slots of one `SharedArrayBuffer` carved once, 9 at 3328×4096 (234 MiB), with `arms-slots.js`'s table. A decoder takes a slot by `compareExchange` as it begins a frame (*corrected 2026-10-29, independent review:* once its decode ends, before the copy into the slot, as `arms-decoder.js` does); with none free it tells the view, which evicts the frame farthest from the current one, and waits for one to free | `arms-*.js` |
| `transfer` | (a′): a new `ArrayBuffer` a frame, transferred; past 256 MiB the farthest dropped | `arms-*.js` |
| `transfer-k` | `transfer` under credits: the downloader dispatches only while fewer than K frames are unacknowledged, and each ack dispatches again | `downloader.js` through the rig's stand-in `credits` |
| `disk` | nothing: no samples are posted; a frame asked or stepped to is read back into the one read buffer and checked | `arms-*.js` |
| `today` | as pre-registered: the product page, its window, the store handed copies | the product |

The lab's simplifications: a decoder waiting for a slot blocks in `Atomics.wait` (the design blocks no thread; the
decoder has nothing else to do, and the downloader's 10 s decode deadline still guards it); the view paints nothing
(the upload is the same in every arm); the current frame is 0 until the first ask, then the frame last asked.

**What disk-only costs on the asked-frame path.** Every frame shown that is not in a buffer is a read and a check: M1
measured 22.3 ms to read and re-check a 3328×4096 frame with the page cache warm (row *§7's rule, from M1*, above), the
cost the independent design's comparison concedes. M5 times it on two paths, each from the frame being at the view
to its samples checked in hand, the wire and the decode being the same in every arm: three asks during the fill
(frames 79, 69, 59, once 10, 30 and 50 frames are in, each becoming the current frame) and three steps after it (the
three frames before the last asked, inside the window around it). In `ring` and `transfer` both are a lookup; in
`disk` both are a read and an XXH3. *Corrected 2026-10-29 (independent review):* the 22.3 ms is M1's R / n, a 32-frame
reopen's time from the store worker's start divided by its frames, on Chromium only: a throughput, not one read's
latency, and 5.6 ms over the bar. That `disk` misses the time bar is predicted, not shown; Firefox's read is not measured.

**Credits, and where they matter.** The consumer acks a frame when the view takes it, and every frame is on disk
before it is posted, so "held within budget or written" holds at receipt in every arm. What credits bound is what
waits in the view's port before then: live frames no collector can free, in a queue HTML gives no bound. That matters
only where a waiting message carries samples, `transfer`: in `ring` the slots are the credits (a dry ring stops the
decoders), and in `disk` a message carries none. So credits cross `transfer` only, at two loads: the main cell, and
**`m5-busy`**, the view held 200 ms a frame, twice M2's measured delivery period (7.87 s over 80 frames), a stand-in
for a view busy reading, checking and painting (red team, 4). **K = decoders × `perDecoder` = 6** on this host: the
most frames the decoders hold at once, so credits bind only once the view falls behind, and a fill under them holds at
most the window and K frames more. K is not swept: if `transfer-k`'s median fill time at full speed falls outside
0.90–1.10 × `transfer`'s, K was too small, and `m5-busy` runs again at 12.

**Measured**, each round and arm, besides the pre-registration's: the host's page-cache growth (`Cached`, which no
PSS counts and which holds `disk`'s window); the SHA-256 check as every OPFS file read back after the fill, outside
the PSS sampling; the asked frame's times; and the view's own counts: peak bytes held, frames taken outside the ring,
the most frames waiting in its port at once (from each frame's decode-end and receipt stamps), slot waits.

**The bar and the rule, restated.**

* **Memory bar**, per engine: every round's growth ≤ the median `disk` growth on that engine + 320 MiB (the budget
  and the A/A's 64). It replaces 608 MiB, which rested on Chromium's floor of 2026-10-28 (531–537 MiB, a window
  included): Firefox's floor was never measured, and `disk`, holding no frame, measures each engine's floor in the
  same rounds. `disk` itself must hold nothing (peak bytes held 0). *The order, said plainly:* this bar was set after
  a Firefox smoke round showed the engines' floors apart; its reason does not rest on that round.
* **Time bar:** an arm's median asked-frame time ≤ `ring`'s + 16.7 ms, one display period: the bar the independent
  design set for its own read-back (its protocol, 3).
* **An arm qualifies** on an engine if, in every round not VOID, the fill is complete, every frame exact by both
  checks, the memory bar met, its own check true (`ring`: no frame outside the ring; `transfer-k`: never more than K
  waiting), and over the rounds the median fill time ≤ 1.10 × `today`'s and the time bar met. VOID as pre-registered.
* **Rule.** The simplest arm that qualifies on both engines is chosen: `disk` (no frame memory), then `transfer` (no
  table), `transfer-k`, `ring`. None: lever 2 returns to the owner with the numbers. `m5-busy` rules credits: needed for
  `transfer` if there `transfer` misses the memory bar and `transfer-k` meets it with never more than K waiting.
  `lab/opfs-cache/summary.py` applies both.

**Predicted, from the sources** (cited above and below; *floor* is an engine's growth with no frame held, which
`disk` measures):

| arm | V8 (Chromium) | SpiderMonkey (Firefox) | JavaScriptCore (WebKit, not run) |
| --- | --- | --- | --- |
| `ring` | floor + the ring: the one shared buffer counts 0 and is never garbage; 530–600 MiB as pre-registered. **Qualifies** | floor + the ring: counted once per zone that holds it (the view and three decoders), which raises each zone's trigger and frees nothing. **Qualifies** | floor + the ring: each wrapper counts it, so collections come sooner, not memory larger |
| `transfer` | floor + up to 260 MiB of window + V8's slack: a received buffer counts in the view's isolate, a sent one stops counting at detach, and 64 MiB of external memory past the last collection starts one. At the bar (floor + 324–350 against + 346): the rule decides. *Corrected 2026-10-29 (independent review, merged from §Who owns a frame's memory):* the 64 MiB is not V8's trigger; external memory starts marking past a limit that grows its low by a factor (`heap-controller.cc` 307–315, 487–490), so the slack is proportional and the + 324–350 is not sourced: the rule decides | floor + window + 1.5–3.0 × what survived the last collection: the contents count as cell memory, removed from the sender at the transfer. + 128–512 MiB over the window: **misses**. *Corrected 2026-10-29 (independent review):* the excess is (1.5–3.0 − 1) × what survived (the trigger is that × the factor; the 128–512 is already so); at 1.5 on a 234 MiB window, floor + 351 against + 346, inside the A/A's 64: the rule decides there, and misses at 3.0 | the sender's estimate falls to 0 at the transfer; the next collection proportional to the live heap: misses, as Gecko (the factor 2 under a quarter of RAM, 1.5 under a half: `runtime/OptionsList.h` 219–226, added in review) |
| `transfer-k` | as `transfer` at full speed; in `m5-busy` the window + ≤ 6 frames (156 MiB), where `transfer` holds every frame waiting, about half of them at 200 ms against 98 | the same | the same |
| `disk` | floor + one read buffer, 300–370 MiB (the floor's 531–537 less a window, plus 26; *corrected 2026-10-29, independent review:* that is 301–329, the 370 from `ring`'s predicted 600): the sync handle writes through the renderer's own file, so the samples sit in the page cache, outside PSS. Meets the memory bar; **misses the time bar**, ~22 ms in hand (M1) against ~0 | the write a stream copy into the content process's file, returning the bytes copied; floor + one read buffer; misses the time bar alike | the write and read through the handle's file; not run |
| `today` | as pre-registered, 2.6–3.2 GiB | as pre-registered, 0.6–1.2 GiB | — |

**Predicted outcome:** `disk` misses the time bar on both engines (22.3 > 16.7 ms), `transfer` misses the memory bar on
Firefox, so `ring` is chosen: (c), as recommended above. *Corrected 2026-10-29 (independent review):* neither miss follows
from the sources alone (both corrections above); `ring` is chosen only if `disk` and
both `transfer` arms each miss on an engine. On 512² frames the read is 0.7 ms (M1) and `disk` would meet
the time bar; M5 runs only the mammogram, where the two bars disagree, and says nothing of a CT series.

**Mutants**, each a stand-in written over its file by the rig, each caught in one smoke round on both engines (no
smoke number here is a result): `slots-never-freed`, the view never frees a slot, stalls the fill after nine frames
(completeness, within 120 s); `fresh-when-dry`, a decoder takes a fresh `SharedArrayBuffer` when the ring is dry
(frames outside the ring); `credits-ignored`, the ack dispatches but the gate is gone (in `m5-busy`, more than K
waiting); `disk-keeps-frames`, the decoder posts a copy in `disk` and the view keeps a window (peak bytes held).

**Amended 2026-10-29, before any data**, closing the independent review's four open items on the harness (PR #241):

* **`m5-busy` has its own A/A.** It runs `ring` and `ring′` interleaved with the two `transfer` arms, and is VOID by the
  main cell's thresholds: the median |`ring′` − `ring`| over 64 MiB, or the median `ring′`/`ring` fill time outside
  0.90–1.10. A VOID busy cell decides nothing about credits. `ring` there is reported, not ruled.
* **The time bar holds on each path.** An arm meets it if its median ask is within `ring`'s median ask + 16.7 ms, and
  its median step is within `ring`'s median step + 16.7 ms. `summary.py` used to pool the six times into one median.
  That reading let through an arm whose steps alone miss, so this changes the rule's meaning, not just its code.
* **A decoder that fails after taking a slot frees it.** The view reports the slots still marked as decoding at its
  end (`slotsDecoding`). A fixture, `throws-after-slot` (the fill's last frame fails after its decoder takes a slot),
  must end with 0. Its mutant, `throws-slot-kept`, drops the release and must end with 1.
* **`--mutant` on an M5 cell without a valid `--arm`** is refused with the arms listed (it crashed before).

**What smoke changed in the rig**, before this text was final: a stand-in routed by Playwright never reached a script
loaded by a worker's own worker, so the credits build had not bound; every stand-in is now written over its file and
put back after each browser, in both engines, M2's included. M5's series (2.03 GiB) is over the 1 300 MiB site limit
the rig set for M3, where Gecko's write comes back short without throwing (above), so M5's cells set 4 096 MiB and the
decoder counts a short write as not stored. Firefox now runs any cell (the pre-registration's "rig change, made in the
later row"). Not run: M5 itself, WebKit, and the 13 GiB follow-up, which keeps its condition on `ring` being chosen.

| claim, 2026-10-29 | source |
| --- | --- |
| Chromium: a sync handle reads and writes through a file the renderer holds | `third_party/blink/renderer/modules/file_system_access/file_system_access_regular_file_delegate.cc` 22–25, 51–61, 63–90 |
| Gecko: a read or write is a stream copy on an I/O queue into a stream deserialized in the content process; it returns the bytes copied | `dom/fs/api/FileSystemSyncAccessHandle.cpp` 523–630, 633–642 |
| WebKit: read and write through the handle's file | `Source/WebCore/Modules/filesystem/FileSystemSyncAccessHandle.cpp` 128–170 |
| Gecko: a transferred buffer's contents leave the sender's count | `js/src/vm/ArrayBufferObject.cpp` 3110–3123 |
| JSC: a transferred buffer's contents detached from the sender; a wrapper's estimate is its contents | `Source/JavaScriptCore/runtime/ArrayBuffer.cpp` 498–522; `runtime/JSArrayBuffer.cpp` 81–86; `runtime/ArrayBuffer.h` 379–383 (added in review) |
| JSC: the heap's growth factors (added in review) | `Source/JavaScriptCore/runtime/OptionsList.h` 219–226 |
| HTML: a port's message queue, with no bound given | `source` 134810–134816 |

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

### The cache I/O in the view worker: sync, async, or a store worker (2026-10-28)

**Status:** theory and a pre-registered protocol; the harness is built (`lab/opfs-arms/`) and smoke-run once per arm,
**no cell is run**: nothing below is measured unless it says *run once*, and the smoke's numbers are not results.

**The shape** (the owner, 2026-10-28): the page holds no frame and sends intents only. One **view worker**, started by
the page, owns the frame store, the cache I/O, the asking (its own port to the downloader) and the paint (WebGL2 on the
transferred canvas); the decoders post each checked frame to it, as B′ in §1–§3. §7's rule still decides adoption
against today's path. Paint first: it is the latency-critical path; the cache write comes after it.

**The question:** which arm keeps the shown frame on time while a fill writes, sustains the fill's write rate, and
reads a memory miss fastest, per engine. **A** a sync access handle in the view worker; **B** the async API in the view
worker (`createWritable` to write; `getFile()`, then `slice().arrayBuffer()` to read); **C** a store worker with a sync
handle, `client/viewer/store.js` as built. A and B each in two orders: **write on arrival**, and **paint first**, the
write drained after the paint. Frames: **S1** 512² (0.52 MB), **S2** 2560×3328 (17.0 MB), **S3** 3328×4096 (27.3 MB),
16-bit. §4 already holds the sync handle's facts (dedicated workers only, the exclusive lock,
`AllowSharedBufferSource`, the write path per engine); they are not repeated.

#### What the sources say

Sources at §9's pinned commits, fetched 2026-10-28 and listed in [`frame-path-sources.txt`](frame-path-sources.txt);
MDN's browser-compat-data at `09b6855`. Quotes are verbatim, cut with "…"; HTML's markup is stripped.

| | claim | source | quoted |
| --- | --- | --- | --- |
| (a) | an async write goes to a temporary file, swapped in at close; `keepExistingData` copies the file first | fs `index.bs` 532–538 | "This is typically implemented by writing data to a temporary file, and only replacing the [=file entry=] … when the writable filestream is closed." … "otherwise the existing file is first copied to this temporary file." |
| (a) | the chunk is `BufferSource`, not `AllowSharedBufferSource`, and is copied | fs `index.bs` 1110, 1239 | "`typedef (BufferSource or Blob or USVString or WriteParams) FileSystemWriteChunkType;`" · "let \|dataBytes\| be … a copy of … \|data\|" |
| (a) | close runs the engine's scans, then commits | fs `index.bs` 1171, 1179 | "Run [=implementation-defined=] malware scans and safe browsing checks." · "It is expected that this atomically updates the contents of the file on disk" |
| (a) Chromium | the swap is `<name>.crswap`; with `keepExistingData` the target is copied into it | `content/browser/file_system_access/file_system_access_file_handle_impl.cc` 714, 803–813, 861–867 | "`AddExtensionASCII(".crswap")`" · "Create an empty file." · "`FileSystemOperationRunner::Copy`, … `/*keep_existing_data=*/true`" |
| (a) Chromium | each `write()` is copied into a string, sent over a new data pipe, and written by the browser in 32 KiB pieces | `…/file_system_access/file_system_underlying_sink.cc` 386–389, 408–410; `mojo/public/cpp/system/string_data_source.cc` 16–17; `storage/browser/file_system/file_writer_delegate.cc` 28 | "`std::make_unique<mojo::StringDataSource>(`" · "`data_ = std::string(data.data(), data.size());`" · "`kReadBufSize = 32768;`" |
| (a) Chromium | close moves the swap over the target; OPFS skips the after-write check and quarantine; quota at each write's start and at the move; no flush by default | `…/file_system_access_safe_move_helper.cc` 222–224, 236–237, 314–316; `storage/browser/file_system/sandbox_file_stream_writer.cc` 173–175; `…/file_system_operation_impl.cc` 371–373; `storage/common/file_system/file_system_mount_option.h` 32 | "`if (dest_url().type() == storage::kFileSystemTypeTemporary)` / `return false;`" · "`&storage::FileSystemOperationRunner::Move`" · "`GetBucketSpaceRemaining(`" · "`flush_policy_(FlushPolicy::NO_FLUSH_ON_COMPLETION)`" |
| (a) Gecko | `keepExistingData` copies the main file into a new file id; the content process writes to a descriptor through 1 MiB copies, a sync quota IPC on each stream write; close swaps the file id in SQLite | `dom/fs/parent/datamodel/FileSystemDatabaseManagerVersion002.cpp` 470–474, 772–775; `…/FileSystemFileManager.cpp` 312; `dom/fs/include/fs/FileSystemConstants.h` 16; `dom/quota/RemoteQuotaObject.cpp` 55–56 | "`if (aMode == FileMode::SHARED_FROM_COPY) {`" · "`original->CopyTo(destParent, leafName)`" · "`kStreamCopyBlockSize = 1024 * 1024;`" · "`mActor->SendMaybeUpdateSize(aSize, aTruncate, &result)`" · "`DO UPDATE SET fileId = excluded.fileId`" |
| (a) Gecko | the chunk is copied once into a vector on the calling thread | `dom/fs/api/FileSystemWritableFileStream.cpp` 805 | "`CreateFromTypedArrayData<Vector<uint8_t>>(aData);`" |
| (a) WebKit | the temporary file is copied from the target with `keepExistingData`, and **copied over the target at close**; each write is an IPC carrying the bytes, with quota asked per write | `Source/WebKit/NetworkProcess/storage/FileSystemStorageHandle.cpp` 280–282, 315–316, 423; `WebCore/Modules/filesystem/WorkerFileSystemStorageConnection.cpp` 397–399 | "`FileSystem::createTemporaryFile("FileSystemWritableStream"_s);`" / "`if (keepExistingData)`" / "`FileSystem::copyFile(path, m_path);`" · "`if (!FileSystem::copyFile(m_path, activeWritableFile.path))`" · "`manager->requestSpace(*spaceRequired, …`" · "`bytes.append(dataBytes);`" |
| (a) all | a shared-memory view is refused | `…/file_system_writable_file_stream.idl` 16 (Chromium); `dom/webidl/FileSystemWritableFileStream.webidl` 19 (Gecko); `WebCore/bindings/js/JSDOMConvertBufferSource.h` 159–161 (WebKit) | "`(BufferSource or Blob or USVString or WriteParams) data`" · "`(BufferSource or Blob or UTF8String or WriteParams)`" · "`"SharedArrayBuffer is not allowed"_s`". *Run once:* `TypeError` in Chromium 153 and in Firefox 159 |
| (b) | `createWritable` and `getFile` are `[Exposed=(Window,Worker)]`, the sync handle `[Exposed=DedicatedWorker]` | fs `index.bs` 426–431 | "`[Exposed=(Window,Worker), SecureContext, Serializable]`" … "`[Exposed=DedicatedWorker]`" |
| (b) WebKit | `createWritable` behind a setting stable and on by default on Apple platforms, off in Lockdown Mode | `WebCore/Modules/filesystem/FileSystemFileHandle.idl` 41; `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml` 2395–2406 | "`[EnabledBySetting=AccessHandleEnabled&FileSystemWritableStreamEnabled]`" · "`status: stable`" … "`"PLATFORM(COCOA)" : true`" … "`disableInLockdownMode: true`" |
| (b) | versions: `createWritable` Chrome 86, Firefox 111, **Safari 26**; `getFile` and the sync handle Safari 15.2 (sync 102 / 111); worker `requestAnimationFrame` 69 / 99 / 16.4, Chrome's "Not supported in nested Web Workers" | browser-compat-data `api/FileSystemFileHandle.json` 48–64, 116–132, 186–202; `api/DedicatedWorkerGlobalScope.json` 364–379 | `"version_added": "26"` (Safari, createWritable) |
| (c) | `getFile()` takes no lock; each engine lets it run beside an open sync handle | fs `index.bs` 485–507; Gecko `dom/fs/parent/FileSystemManagerParent.cpp` 294; WebKit `NetworkStorageManager.cpp` 1200–1209; Chromium `file_system_access_file_handle_impl.cc` 180, 211–212 | "You can create a File with getFile() even if the file is locked" (Gecko). *Run once:* read beside a sync handle in Chromium 153 and Firefox 159 |
| (c) | a read lands in a new `ArrayBuffer`: Chromium fills a pipe in the browser and copies it in the renderer; **Gecko pumps a worker's read on the main thread**; WebKit copies each loaded chunk | Chromium `…/core/fileapi/file_reader_client.cc` 34–36; Gecko `dom/base/BodyConsumer.cpp` 206, 506–509; WebKit `WebCore/fileapi/FileReaderLoader.cpp` 253 | "`.copy_prefix_from(data);`" · "`MOZ_ASSERT(NS_IsMainThread());`" … "`NS_NewInputStreamPump(…, mMainThreadEventTarget);`" · "`memcpySpan(protect(m_rawData)->mutableSpan()…`" |
| (e) | a worker runs one task, then its microtasks, then, at a rendering opportunity, its animation frame callbacks | html `source` 123368–123406, 123527–123546 | "Perform \|oldestTask\|'s steps." … "Perform a microtask checkpoint." · "Run the animation frame callbacks for that `DedicatedWorkerGlobalScope`" |
| (e) | every async OPFS result comes back as a storage task; which task queue runs next is the engine's | fs `index.bs` 103–105; storage `storage.bs` 486–492; html `source` 123376–123377 | "the caller is expected to [=queue a storage task=] to [=/reject=]" · "chosen in an implementation-defined manner" |
| (f) | a worker started by a worker gets OPFS: no engine checks who started it | Chromium `…/storage_manager_file_system_access.cc` 111, `content/browser/worker_host/dedicated_worker_host.cc` 1041–1042; Gecko `dom/workers/WorkerPrivate.cpp` 3464, 3468; WebKit `WebCore/workers/WorkerMessagingProxy.cpp` 550–557 | "`context->IsWindow() \|\| context->IsWorkerGlobalScope()`" · "`loadInfo.mStorageAccess = aParent->StorageAccess();`" · "`document = Document::allDocumentsMap().get(m_loaderContextIdentifier);`". *Run once:* a sync handle in a nested worker in Chromium 153 and Firefox 159; WebKit not run |

**What this rules out.**

* **B on a packed file.** Every engine copies the whole file into the temporary file when `keepExistingData` is set,
  and a frame written without it erases the rest. One writable per frame on one series file copies n²/2 frames: 21 GB
  for `dbts_b1`'s 50 × 17 MB. One writable held for the fill shows none of its frames to a read until it closes (fs
  526–530), and a crash loses all of them. **B is weighed with a file per frame**, which reopens lever 3 for B only,
  at the costs lever 3's table gives that layout (a handle per access, a quota failure mid-fill).
* **B costs copies on the view thread, not fewer than A.** The chunk is not `AllowShared`, so the frame is copied out of
  its `SharedArrayBuffer` first; then the engine copies it again on the calling thread (Chromium's string, Gecko's
  vector, WebKit's vector). A's sync write is one copy into the page cache (§4). WebKit writes each frame twice, its
  commit being a file copy; Chromium's (a move) and Gecko's (a file-id swap) copy nothing.
* **B's read in Gecko runs through the content process's main thread**, the page's: under a page held by long tasks
  (§2), a Gecko B miss waits for the task. That is the stall the shape exists to remove; *by source, not run*.
  **Corrected 2026-10-29 (independent review):** this said Gecko alone. WebKit posts every async call a worker makes
  (`getFile`, `createWritable`, each `write`, `close`) to the page's main thread (`WorkerFileSystemStorageConnection.cpp`
  239, 353, 376, 399: "`callOnMainThread(`"), so a WebKit B write waits for a held page too; and a WebKit sync handle
  that outgrows its capacity blocks on a semaphore for the main thread (same file, 489–501), which the rig's A, its
  file truncated to the cell's size at open, does not exercise. Gecko's link from `slice().arrayBuffer()` to
  `BodyConsumer` is `dom/file/Blob.cpp` 274, 289–305, at the same commit and not in the sources list.

#### Predicted, before any run

From §4's write path (≥ 1 GB/s on Chromium and WebKit, at most ~4 GB/s, a memory copy), XXH3 at ~4 GB/s (§5), M1's
22.3 ms read + re-check of an S3 frame through the store worker, and a 16.7 ms display period. Arrivals at the fill's
ceiling, 125 MB/s decoded (§Where it saturates): 238 frames/s at S1, 7.3 at S2, 4.6 at S3.

| | blocks the view thread, a frame | the shown frame at 125 MB/s | write rate, credit-bound | a miss, intent → painted |
| --- | --- | --- | --- | --- |
| **A**, on arrival | one write: S1 0.13–0.5 ms, S2 4–17, S3 7–27 at 1×; ×4 at 4× | **late** at S2 and S3, at 1× by ~block/period of the arrivals (3–8 % of ticks; *corrected 2026-10-29 (independent review):* arrivals × block is 3–12 %), at 4× in most | ≥ 1 GB/s Chromium; Gecko lower by its quota round trips, unknown | S3: read 7–27 + check ~7 + up to a period: **the fastest** |
| **A**, paint first | ≤ 8 ms a tick, 1 MiB at a time | **on time**: paint + 8 ms + one chunk < 16.7 ms, at 4× too | ≤ 8/16.7 of the write speed: ≥ 480 MB/s at 1×; **120–480 MB/s at 4×**, under the fill's 125 at the low end | as A |
| **B**, on arrival | two copies of the frame: S3 6–12 ms at 1×, 22–44 at 4× | **late** at S2 and S3 | a file and a commit per frame; WebKit writes twice; ≥ 125 MB/s at 1× on Chromium and Gecko, not traced past that | A + an IPC round trip + one more copy: **the slowest**, by ≥ 10 % at S2 and S3 (*corrected 2026-10-29 (independent review):* does not follow at the slow end: one more copy, 2–6 ms, on A's 38–51 ms is 5–12 %, the IPC not quantified) |
| **B**, paint first | our copy budgeted; the engine's copy (S3 3–6 ms at 1×, 11–22 at 4×) in a later task, not | on time at 1×; **late at 4×** at S2 and S3, ~5–8 % of ticks | as B on arrival | as B |
| **C** | a post, ~0.1 ms; *corrected 2026-10-29:* a copy out of shared memory first, as `viewer.js` hands it, at 4–8 GB/s S2 2–4 ms, S3 3–6 at 1× (*corrected 2026-10-29, independent review:* 3.4–6.8), ×4 at 4× | **on time**; *corrected:* late at S3, 4×, by the copy (*corrected 2026-10-29, independent review:* and at S2, 4×: its 8–17 ms copy is A on arrival's S2 block at 1×, predicted late) | as A on arrival, in the store worker | A + two posts, ~0.5 ms; off the view thread |

B's copies (6–12 ms for two of S3) take a memory copy at ~4.5–9 GB/s, a rate none of the inputs above gives
(*added 2026-10-29, independent review*).

**Predicted verdict:** A-on-arrival and B-on-arrival fail the shown frame at S2–S3; B-paint-first fails it at 4×; A
paint-first and C keep it (*C corrected 2026-10-29: its copy makes it late at S3, 4×, and by the independent review at S2, 4×; the amended verdict is under
§Arm D, below*). The rule below then picks **A paint-first if it holds 125 MB/s at S3, 4×, else C**; A over B
on the miss in every engine. Where the host saturates: the paint alone uploads an S3 frame through SwiftShader on this
container, so the `none` arm may miss ticks at S3, 4×; nothing is claimed for a cell where it does.

#### Protocol, pre-registered 2026-10-28

Rig: `lab/opfs-arms/` (README there), on the 4-vCPU agent container; Chromium 153 and Firefox 159 on Xvfb; **WebKit not
run: no WebKit build in the container.** A feeder worker stands in for the decoders: it posts checked frames as
`SharedArrayBuffer`s, 4 distinct fields cycled, at 125 MB/s or on credit (*three feeders since 2026-10-29*, §Arm D). The view worker paints from memory at its own
`requestAnimationFrame`, the shown frame changing every tick at S1 and every 6th at S2–S3 (an upload from memory),
and runs one arm. Every frame recorded written is read back and hashed after the cell. Per cell: Chromium and
Firefox × S1, S2, S3 × 1× and 4× (`lab/scripts/cpu_throttle.mjs`, every thread); **12 rounds**, the arms ordered per
round by `lab/order.mjs`; a fresh profile per run; every arm's settings printed in the rows' first line.

| cell | arms | measured | settings |
| --- | --- | --- | --- |
| **L** the shown frame | `none` (no cache), A and B in both orders, C, C′ | missed ticks (a gap between callbacks of k periods misses k − 1), as a share of ticks; the paint task's delay (callback start − its frame time) p50 / p99; the backlog (frames arrived, not written) each tick; peak PSS growth | 125 MB/s for 10 s; 4 frames held for the show; paint first drains ≤ 8 ms a tick in 1 MiB pieces, after the paint (*corrected 2026-10-29 (independent review):* the rig counted the 8 ms from the tick's start, paint included) |
| **W** the write rate | A and B in both orders, C, C′ | MB/s from the first arrival to the last write, the feeder kept 8 frames ahead; every frame read back exact | 1 000 MB of frames |
| **R** a miss | A, B, C, C′ | 16 intents a run, each a frame not in memory: intent → read → re-check → painted, p50 / p99; the page cache is warm (lever 1's M1 says so too) | after a fill of 32 |

**A/A and VOID.** C′ is C again. A cell is **VOID** when, over its rounds, the median of |C′ − C| in missed share exceeds
1 % of ticks (L), or the median C′ / C lies outside 0.90–1.10 for MB/s (W) or the miss p50 (R).

**Saturation.** A cell (engine × size × throttle) in which `none` misses more than 5 % of ticks in its median round is
**saturated**: nothing is claimed there for any arm. (*Corrected 2026-10-29 (independent review):* `summary.mjs`
excluded only L there, not W and R at the same engine, size and throttle; it now excludes all three. L's 7 arms balance
their order over 14 rounds (`lab/order.mjs`), so 12 leave it slightly unbalanced.)

**The rule, stated before any data.** Per engine, over the non-VOID, unsaturated cells:

1. An arm **keeps the shown frame on time** if its missed share exceeds `none`'s by ≤ 1 % of ticks and its paint delay
   p99 by ≤ 4 ms, in ≥ 9 of 12 rounds, at every size and both throttles.
2. Its **backlog is bounded** if every write reads back exact and the largest backlog in the last third of L is no more
   than 2 frames over the first third's, in ≥ 9 of 12 rounds; and W sustains ≥ 125 MB/s in ≥ 9 of 12.
3. **The fewest threads that pass both win**: A or B (no thread more) before C (one more). If A and B both pass, B wins
   only if its median in every R cell is ≤ 0.9 × A's and its median in every W cell ≥ 0.9 × A's; else A. Within
   an arm, paint first wins unless only on-arrival passes. If no arm passes, the result goes to the owner as measured.

`lab/opfs-arms/summary.mjs` applies this rule to the rows.

**Mutants, each run before its cell is believed.** *write-before-paint*: the paint-first arm draining its whole queue
before the paint. At S3, 4×, it must miss ticks, and at least Σ ⌊block / period⌋ of its own measured blocks; a
harness that cannot see that lateness fails. *Corrected 2026-10-29 (independent review):* that check alone also passes
the arm unmutated (run once: A and B paint-first, unmutated, at S3, 4×, Chromium), so it does not tell the
mutant from the code; `summary.mjs` now counts it caught only if it also misses more than 1 % of ticks over the same
arm unmutated. Re-run once, the A mutant missed 527 ticks against 532 predicted, so the check failed it (B's passed):
⌊block / period⌋ per 1 MiB piece and the tick count's rounding do not bound each other, and the bar is marginal.
*drop-writes*: every arm recording writes it never made; W must fail its read-back. Both are `--mutant` in the rig.

**Smoke, 2026-10-28** (one round per arm, Chromium 153 and Firefox 159; not results): every arm ran its L, W and R
runs to the end in Chromium, L and R in Firefox, each writing and reading back exact, except one Firefox B-on-arrival
L run that hit the cell's deadline (4 × its 10 s) with frames unwritten, which the rule counts as an unbounded
backlog. *write-before-paint* was caught at S3, 4×, on both paint-first arms (by the check corrected
above, which the unmutated arm also passes; Chromium only: the smoke did not throttle Firefox); *drop-writes* was caught on A, B and C in both engines. The saturation check fired at S3, 4×, in Chromium's
one round: whether that cell is saturated is for the full run. The probe's facts are in the table above (*run once*).
The full runs are a separate row.

#### Arm D: the decoders write; a window drag (amended 2026-10-29, before any data)

**Why.** The Target (§Target: the view worker, on `claude/view-worker-target-rev`) rules the cache writes off the view
worker's thread (the red team's finding 4) and leaves who writes open between **C**, **D** and **A paint-first**. **D**
is the independent design's: each decoder writes its decoded frame to OPFS from its own heap before posting it, so the
paint thread never writes. Nothing here is measured; *smoke* lines are not results.

**What the sources say.** At §9's pinned commits, quoted file:line; new files and the ones not already listed are in
[`frame-path-sources.txt`](frame-path-sources.txt) under 2026-10-29.

| | claim | source | quoted |
| --- | --- | --- | --- |
| (g) | the spec's sync handle takes no options and an exclusive lock: one writer per file | fs `index.bs` 431, 605, 647–648 | "`Promise<FileSystemSyncAccessHandle> createSyncAccessHandle();`" · "takes an exclusive lock" · "with "`exclusive`" on \|entry\|" |
| (g) Chromium | ships a `mode` option; `"readwrite-unsafe"` handles share one lock type, so N of them open one file | `…/file_system_access/file_system_create_sync_access_handle_options.idl` 7–16; `file_system_file_handle.idl` 39–41; `runtime_enabled_features.json5` 3142–3143; `content/browser/file_system_access/file_system_access_file_handle_impl.cc` 322–323; `file_system_access_manager_impl.h` 769–771; `file_system_access_lock_manager.cc` 90 | "`"readwrite-unsafe",`" · "`RuntimeEnabled=FileSystemAccessLockingScheme`" · "`status: "stable",`" · "`GetSAHReadwriteUnsafeLockType();`" · "`lock_manager_->CreateSharedLockType();`" · "`return type != type_ \|\| IsExclusive();`" |
| (g) Gecko, WebKit | no options: exclusive only | Gecko `dom/webidl/FileSystemFileHandle.webidl` 17–18; WebKit `FileSystemFileHandle.idl` 40, `NetworkProcess/storage/FileSystemStorageHandle.cpp` 220 | "`Promise<FileSystemSyncAccessHandle> createSyncAccessHandle();`" · "`acquireLockForFile(m_path, FileSystemStorageManager::LockType::Exclusive)`" |
| (g) | versions of `mode`: Chrome 121, Firefox none, Safari none; experimental | browser-compat-data `api/FileSystemFileHandle.json` 75–100 | `"version_added": "121"` · `"version_added": false` |
| (h) Chromium | a write past the granted capacity asks for more synchronously; a new file has none; within it, a write sends one note and does not wait | `…/file_system_access_regular_file_delegate.cc` 77–80, 84, 91; `…/file_system_access_capacity_tracker.cc` 116 | "`if (!capacity_tracker_->RequestFileCapacityChangeSync(write_end_offset))`" · "`file_modification_host_->OnContentsModified();`" |
| (h) Gecko | the worker spins a sync loop while its IO queue copies the chunk in 1 MiB blocks; each block's write is a synchronous quota IPC, growing or not | `dom/fs/api/FileSystemSyncAccessHandle.cpp` 551, 563–564, 604, 627; `dom/fs/child/FileSystemAsyncCopy.cpp` 44–45; `dom/quota/FileStreams.cpp` 92–93; `dom/quota/RemoteQuotaObject.cpp` 56 | "`AutoSyncLoopHolder syncLoop(`" · "`kStreamCopyBlockSize,`" · "`mQuotaObject->MaybeUpdateSize(`" · "`SendMaybeUpdateSize(aSize, aTruncate, &result)`" |
| (h) WebKit | a handle starts with the file's size as capacity; growing past it, and `close()`, each **wait on the page's main thread** and the network process; `createSyncAccessHandle` goes through the main thread too | `WebCore/Modules/filesystem/FileSystemSyncAccessHandle.cpp` 162, 185–188, 125; `WorkerFileSystemStorageConnection.cpp` 284, 303–310, 491–500; `NetworkProcess/storage/FileSystemStorageHandle.cpp` 242, 540–541 | "`uint64_t initialCapacity = valueOrDefault(FileSystem::fileSize(m_path));`" · "`callOnMainThread([mainThreadConnection = m_mainThreadConnection, identifier, accessHandleIdentifier, newCapacity, &grantedCapacity, &semaphore]() {`" · "`semaphore.wait();`" |

**(1) N decoders and one packed file.** The packed file's exclusive lock (g) admits one writer, so D takes one of three
shapes:

* **A file per frame** (the independent design's layout): every engine; per frame, two async handle calls, a capacity
  request at the first write (h: a new file has none), a close, and the quota answered per frame where the packed file
  answers it at open with `truncate`. WebKit puts three waits on the page's main thread on each frame: create, capacity,
  close (h). **This is arm D.**
* **One writer the decoders post to**: C's store worker on a port to each decoder instead of the view worker. The copy
  out of the heap moves to the decoder's clock and the view thread does nothing for the cache; the packed file stays.
  Not an arm: it is C with the post moved, and **the arm to add if D fails only on the decoders' clock and C only on
  its copy** (below).
* **A shared handle** on the packed file: Chromium's `mode: "readwrite-unsafe"` alone ships it (g); Gecko and WebKit
  have no `mode`, and the spec none. It would be a second path for two engines in three. Not an arm.

**(2) Copies of the samples and messages, per fill frame.** The Target's four messages are decode, frame, `done`, ack.

| | copies in script | on the view thread | messages |
| --- | --- | --- | --- |
| **A paint first** | 2: heap → shared buffer (decoder); buffer → file (view) | the write, ≤ 1 MiB a piece after the paint | 4 |
| **C** as built | 3: heap → shared buffer; buffer → a transferable copy (view, `client/viewer/viewer.js:167`); copy → file (store worker) | the copy and a post | 6: + write, + its reply |
| **D** | 2: heap → file and heap → shared buffer, both on the decoder; 1 if the frame is not held in memory, as in the independent design | nothing but the frame's arrival | 4; the frame says it is written, so the ack is at once; the series' directory handle once per decoder |
| one writer the decoders post to | 3: heap → shared buffer; heap → a copy (decoder); copy → file | nothing | 6 |

**(3) A write on a decoder's clock.** D adds to each decoder, per frame: Chromium, the two handle calls (~1.3 ms on this
container, `lab/target-review/opfs/` at `7f335cc0` on the Target's branch, indicative; they can run while the decoder decodes), a synchronous capacity
request, the write (a copy into the page cache) and the close; Gecko, a create and a handle from the parent, and one
synchronous quota round trip per MiB (1 at S1, 17 at S2, 26 at S3) that A and C pay too, but on the view or store
thread; WebKit, three main-thread waits (h). **Whether D slows a fill** turns on whether the fill is decode-bound: three
decoders × the frame / its decode (exactness §3: 3.1 / 14.6 ms at S1, 47 / 210 at S2, 1× / 4×) against the fill's
125 MB/s. On this host that is S1 at 4× alone (108 MB/s of decode). There the probe's write and close, ~0.74 ms at 1×,
predict ~3 ms at 4×, ~20 % of the decode: **D predicted to slow a decode-bound 512² fill by ~17 % on Chromium.** S2 is
not decode-bound (243 MB/s at 4×): there the same cost is ~10 % of the decode and slows nothing. S3 has no measured
decode.

**(4) A miss under D** is read in the view worker as A reads, from the frame's own file: `getFileHandle`,
`createSyncAccessHandle`, `getSize`, one `read()` into a new shared buffer, `close`, XXH3 against the digest. It never
meets a writer's lock: the decoder closed the file before posting. Over A it costs the two handle calls and a close
(~1.0–1.4 ms on Chromium, the probe); on WebKit two main-thread waits. `getFile()` takes no lock but Gecko pumps its read
on the main thread ((c) above), so the sync handle.

**Predicted, D per cell.**

| | blocks the view thread, a frame | the shown frame (L) | write rate (W) | a miss (R) | a drag (G) |
| --- | --- | --- | --- | --- | --- |
| **D** | nothing: the frame arrives written | **on time**, as `none` | three writers: Chromium ≥ 125 MB/s at every size and throttle, nearest at S1, 4× (~190 MB/s; *corrected 2026-10-29, independent review:* that is one writer's probe ×3; the probe's three-writer table gives ~160); Gecko unknown | A + ~1–1.4 ms: within a period of A everywhere; ~5 % over A at S3 | **as `none`** |

The drag cell's other arms: **A paint first** as `none` (still frame, no upload; the drain stays inside its 8 ms);
**C** as `none` at 1× and **late at 4×**, an input landing behind a 8–16 ms copy at S2.

**Amended verdict, predicted.** Chromium: D passes L, G, W and fails the decoders' clock at S1, 4×; C is late at S3,
4× (*corrected 2026-10-29, independent review:* and S2, 4×) and in G at 4×; **A paint first is picked if it holds 125 MB/s at 4×**, which #227 predicted at 120–480 MB/s;
otherwise no arm passes, and the result goes to the owner with *one writer the decoders post to* as the arm to add.
Firefox: as Chromium except D's clock, unknown; if it passes there, D is picked. WebKit: not run, no build here; by
source D's three main-thread waits a frame stall every decoder behind the page's long tasks, which the rig's idle page
cannot show: **a WebKit cell with a busy page is owed before D is adopted on WebKit.**

**Amended protocol** (2026-10-29, before any data):

* **D** joins L, W and R. In the rig the feeders write as the decoders would, a file per frame through a sync handle
  from a non-shared heap copy, then post; each row carries the handle and write-and-close times on the feeder's clock.
* **The feeder runs as three workers**, the client's decoder count (`client/README.md`, *How many decoders*), each
  posting every third frame at a third of the rate, or on its three of the credits. Every arm, so the arms stay
  interleaved on one rig.
* **C is handed what `viewer.js` hands the store worker**, a copy out of shared memory, transferred (`bd39d089`). The
  rig had sent the shared buffer itself, so C's L would not have seen the copy.
* **G, a window drag during a mammogram fill** (the red team's cell): S2 at 125 MB/s for 10 s, the shown frame still;
  the harness holds the pointer down on the canvas and moves it every 16 ms; the page posts each move to the view worker
  as a window intent stamped with the event's time; the view worker draws the newest at its next tick. Measured: input →
  painted (the draw issued; presentation is not read) p50 / p99, and the inputs superseded before a draw. Arms `none`,
  A paint first, C, C′, D; Chromium and Firefox × 1× and 4× × 12 rounds. **VOID** when the median |C′ − C| of p99 exceeds
  4 ms; **saturated** when `none` misses more than 5 % of ticks.
* **Mutants.** *drop-writes* now drops D's writes in the feeders; W must fail its read-back. *late-input*: each window
  intent taken 34 ms late; G's input → painted p50 must be ≥ 34 ms.

**The rule, amended.** Per engine, over the non-VOID, unsaturated cells, among **A paint first, C and D** (A on arrival
and B stay in the cells, reported, not chosen):

1. **On time:** rule 1 as written, and in G an input → painted p99 no more than `none`'s + 4 ms in ≥ 9 of 12 rounds,
   at both throttles.
2. **Bounded:** rule 2 as written.
3. **D's clock**, D alone: in every W cell where the fill is decode-bound as (3) defines it, D's median write and close
   a frame, plus what its handle calls take beyond the decode, is ≤ 0.10 × the decode.
4. **D, then A paint first, then C**: D wins if it passes 1–3, unless A paint first passes too and D's miss paints a
   display period or more after A's in some R cell; then A paint first; then C. If none passes, the result goes to the
   owner as measured.

`lab/opfs-arms/summary.mjs` applies it. *Corrected 2026-10-29, independent review:* it failed rule 3 for D in any W cell
with no measured decode (S3), so D could not be picked once S3 ran; a cell rule 3 does not judge now passes it.

**Smoke, 2026-10-29** (one round per arm, Chromium 153 and Firefox 159; not results): L, W and R at S1 and G at S2 ran
every arm to the end in both engines, each write read back exact, except two Firefox L runs, C′ and B on arrival, that
hit the cell's deadline with frames unwritten, which the rule counts as an unbounded backlog. *drop-writes* was caught on
D and *late-input* on `none` and D, in both engines; one Chromium W run at S1, 4× exercised the decoders'-clock test.
The full runs are a separate row. *Independent review's smoke, 2026-10-29* (Chromium 153 only, no Firefox in its
container; XXH3 stood in by a JS hash, the decoder builds absent; not results): D's W at S1, 1× was 102, 133 and 199
MB/s in three rounds, write and close 1.6–5.7 ms on the feeder against the probe's 0.74, so W's ≥ 125 is the cell to
watch; in one G round at S2, 1×, `none` missed 9.7 % of ticks, over the 5 % saturation line.

**Amended before any data, 2026-10-29 (the independent review's open points).** *Rounds:* each cell runs one whole
Williams period of its arms (`lab/order.mjs`), so every arm follows every other equally often: **L 8 rounds** (8 arms;
8 and 16 are equally near 12, 8 taken for the host's time), **W 14** (7 arms), **R 10** and **G 10** (5 arms). The
rule's "≥ 9 of 12" reads as ≥ 75 % of a cell's rounds, as `summary.mjs` counts it: ≥ 6 of 8, 11 of 14, 8 of 10.
*Credits:* three feeders take ⌈8 / 3⌉ = 3 credits each, so W keeps 9 frames ahead in total, not 8.

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
  *Corrected 2026-10-29:* the window fills only for a reader that stops; between reads it drains, and what binds is
  the thread's time, ~64 MB/s left at 125 MB/s, while at 18–103 Mbit/s the rate holds and the pace does not
  (§The receive loop beside the paint).
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
| 2 · the receive loop sharing a thread with reads and paints | the fill's last frame and its inter-arrival p99 with a cine of S2–S3 frames read from disk at 30 frames/s on the same thread, against the target's split; a new cell beside the arms' L cell; pre-registered in §The receive loop beside the paint |
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

#### Experiment 1: span small gaps in the misses (2026-10-29)

*Row 1 of the table above, pre-registered before any data. Built behind a lab setting, default off; **not run**. The
run is a row of its own, after a methodology review.*

**What the want-path build already does, corrected against row 1.** Row 1 counts one round trip per one-frame run,
which is the fill fed from the page (`client/transport/downloader.js:290` on `main`, red 5's "today's client"; *corrected
by the review below: this read "VW's … (`downloader.js:290` there)"; at VW's head, `9c90104`, the line is :293*). On
the want-path build a scattered want is not a
chain of runs: a want that does not ascend D_min frames from its head goes out as up to D_min asks in flight, topped up
as each lands (`serveWant`, `client/transport/downloader.js`; *a want arrives in its order*,
`client/transport/downloader.test.mjs`). So on this build the table's g = 0 and *all misses as asks* are one variant,
and the idle time to remove is at most one round trip per D_min misses, not per miss: 38 misses at D_min = 4 are ~10
round trips, 0.4 s at 46 ms and 0.9 s at 92 ms on the probe's model, **a guess**. *Corrected by the review below: asks
topped up as each lands are a sliding window, not waves of four, so an idle round trip recurs only while D_min frames
take less than a round trip to send, t < RTT / (D_min − 1): 15 ms (38 kB at 20 Mbit) at 46 ms, 31 ms (77 kB) at 92.
Neither cell's series is that small, so A's idle time is the first round trip alone. The 38 misses are the probe's
76-frame series, not a cell's (35 for `us_liver`, 14 for `dbt12_ea1141`), and 10 round trips at 46 ms are 0.46 s.*
Against that, a span re-sends every
held frame it crosses: on a store holding every other frame the wire carries the whole series, twice the misses'
bytes. Where four frames in flight already fill a round trip — at 20 Mbit, row 1's 29 ms a frame is 116 ms per four,
against 46 or 92 — the asks keep the link busy and the span is predicted **slower**, towards 2×. *Corrected by the
review below: 29 ms is M1's 512² frame (7.49 s / 256, OPFSARMS), not a cell's; `us_liver` is 257 kB a frame (18.02 MB /
70, [`../../lab/av1/README.md`](../../lab/av1/README.md) §SIZE) and `dbt12_ea1141` 499 kB
([`disk-access.md`](disk-access.md)), 103 and 200 ms at 20 Mbit, 412 and 798 ms per four. The direction holds and
sharpens: S at 1.90–1.96× A in every cell.* That prediction is
the model's; the run decides.

**The change.** `span: g` in the downloader's config, from the viewer's `?opts=`, default 0 (today's behaviour): a run
from the want's head, and a fill's next run, may cross up to g frames the consumer holds — neither in the want nor
with a record in the downloader — and counts only its misses toward D_min. A crossed frame arrives with no record and
is dropped before any decoder (`runEnd`). A frame still wanted later in the order, or here and unacknowledged, ends
the run.

**Claim.** On a store holding every other frame, `span: 1` makes the misses one fill, ≥ 40 % shorter than their asks.

**Variants**, the same build and `opts` but `span`: **A** `span: 0`; **A′** `span: 0` again, the A/A pair; **S**
`span: 1`. Every gap on that store is one frame, so g = 2, 4 and 8 would send S's wire schedule exactly; the table's
sweep over g needs a held pattern with wider gaps and runs only if S passes.

**Cells.** `lab/av1/delivery/total-time/run.mjs`, the viewer under `?view=worker`, HTJ2K; `us_liver` (70 × 760×421
RGB 8-bit) and `dbt12_ea1141` (29 × 614×1359 12-bit); link `r20000` at `--one-way-ms` 23 and 46 (RTT 46 and 92),
impairments `clean` and `l1`; Chromium and Firefox; CPU 1×. Two store states:

* **half-held** — `opts.holdEveryOther` makes the view worker want the even frames first, in descending order so A and
  S ask them alike, then want the rest and time the fill from that want (`fillAround`, `client/view/view-worker.js`);
* **empty** — today's start.

**Metrics.**

* moved: the half-held fill, the controller's `fillMs` from the want of the rest to the last frame held;
* must not regress: the empty fill, which has no gap to cross, so S is A there by construction and the cell checks it;
  the first exact frame on screen; on-demand latency, `?fill=0` with ten steps across the series, step → frame held,
  which S cannot move since a want of one frame is never a run; exactness, every frame's digest against the encoder
  input's `.sha256`, each decoded once, none failed; *corrected by the review below: the rig's on-demand cell,
  `--fill 0 --asks-after 10`, shows frame 0 and steps to frames 1 … 10, not across the series; on demand a step is an
  ask (`askFor`), which never reaches `runEnd`, so this cell is a tie by construction;*
* recorded: frames on the wire (the session's `mediaReads` at the last frame) and the decoders' CPU the rig reads.
  *Corrected by the review below: `mediaReads` counts reads of the media streams, one per chunk, not frames
  (`client/contract/clauses.ts:615`), and at the last frame it includes the held frames' reads; the rig records it and
  `fillReads`, the reads from the last held frame on; the wire is the relay's `s2c` packet count.*

**Interleaving and rounds.** `lab/order.mjs`: the variants in a Williams order inside each cell, the cells in one each
round; 12 rounds. The RTT is a process argument, so even rounds run 23 then 46 and odd rounds 46 then 23. A visit the
relay marks `VOID` is dropped and its cell topped up in rounds 13 on, to n = 12.

**A/A.** Per cell, A′'s median moved metric within ×0.95–1.05 of A's; a cell outside it claims nothing.

**Saturation guard.** The host: the relay on a core of its own (`--rig-core`), the browser on the other three, 1×
only, `VOID` visits dropped. ~~The link: where A's half-held goodput, misses' bytes over its fill, is ≥ 0.9 of 20 Mbit,
the asks already fill the link; the cell is reported saturated and claims nothing for or against S.~~ *Retracted by the
review below: the link is the cell's condition, not the rig's limit. A full link is how S loses, and on the model A's
goodput is 0.97–0.99 of the link in every cell, so this guard would have voided every half-held cell and the run with
it. A cell's link-bound share is recorded, not excluded.* The decoders: where
A's decoder CPU is ≥ 0.9 of three decoders over the fill, the cell is decode-bound, treated alike.

**Rule, stated before any data.** Adopt `span: 1` as the default if, in every unsaturated half-held cell, S's fill is
≤ 0.6× A's in ≥ 9 of 12 rounds, at both RTTs and on both engines, with frames on the wire no more than the empty fill's
(the series once); and S's empty fill is within ×0.98–1.02 of A's, its first frame and its on-demand median no later
by 16.7 ms, every frame exact and decoded once. Otherwise `span` stays 0 and the setting is removed, this subsection
kept as the record. If every half-held cell is saturated, the experiment says so and claims nothing. *Corrected by the
review below: "every unsaturated cell" is true of no cell, so as written the rule adopted S if every cell saturated, and
the last sentence contradicted it; adoption needs at least one cell the host did not saturate, and every such cell to
pass. The wire bound decides nothing on this store: measured at the last frame it fails S by construction, since the
held frames' reads are in it; measured from the last held frame (`fillReads`) it passes S by construction, since S's run is
frames 1 … n − 1. It bites only on a held pattern with wider gaps.*

**What the run row adds to the rig first**, reviewed with this protocol, not built here: a variant field carrying
`span` and `holdEveryOther` into `opts`; the levers' result carrying the controller's `fillMs` and the session's
`mediaReads`; an on-demand cell for a viewer variant, if `--asks-after` does not drive one. *Built by the review below.*

**Built and checked.** *A span crosses held frames* (`client/transport/downloader.test.mjs`): span 0 asks; span 1 is
one run and only the misses reach the consumer, once each; a gap of 2 ends it; a frame wanted later, or here and
unacknowledged, is not crossed. Each mutant fails it: the span ignored, the gap bound one wider, either half of the
guard dropped, the fill's next run unspanned, D_min off by one. The smoke, one round per variant, Chromium on
localhost, a 76-frame series through `client/viewer/check.mjs --view worker --opts '{"holdEveryOther":true,"span":g}'`:
A, A′ and S each held all 76 frames exact and drawn,
and a probe, since removed, saw S send frames 1–75 as one run and A send none. No number is reported from it.

#### Experiment 1: independent review (2026-10-29)

*A methodology review before any run, by a session that wrote none of the protocol. Corrections are made in place
above, the old text kept or struck. Nothing here is a result: the smoke and the gate below ran in a shared 4-core
container.*

**Sources.** Experiment 1 and row 1 cite no file of [`frame-path-sources.txt`](frame-path-sources.txt), so there is no
pinned source to re-fetch. Every citation they do make is in-repo or `branch:path:line`, and each was read:

| claim | where | verdict |
| --- | --- | --- |
| a run is issued when the last one's final frame lands | `client/transport/downloader.js:290` on `main` | holds; VW's head has it at :293 (corrected) |
| 38 runs for 76 frames; 1.7 and 3.4 s idle | [`../../lab/target-review/README.md`](../../lab/target-review/README.md), `want-order.mjs` (b) | holds: 1702 = 37 × 46 ms, the first run not idle |
| M1's 29 ms a frame | OPFSARMS's M1, F 7.49 s for 256 × 512² over 20 Mbit | holds as 7.49 s / 256; a 512² frame, not a cell's (corrected) |
| a scattered want is up to D_min asks, topped up as each lands | `serveWant`, called from `arrived` on each frame's last byte | holds |
| *a want arrives in its order* | `client/transport/downloader.test.mjs:425` | holds |
| a run crosses ≤ g held frames, counts misses alone toward D_min; a frame wanted later or unacknowledged ends it | `runEnd`, `serveWant`, `nextRun` | holds; the PR's six mutants re-run, each fails the test (the span ignored by a throw before its check) |
| g = 2, 4, 8 send S's schedule on this store; the empty fill is A's under S | `runEnd` traced on alternating and contiguous wants | holds |
| on demand S cannot move a step | a step is `askFor`, which never calls `runEnd` | holds, by construction (corrected: the cell is a tie, not a check) |
| `us_liver` 70 × 760×421 RGB 8-bit; `dbt12_ea1141` 29 × 614×1359 12-bit | `lab/av1/fetch_data.sh` against `data.json`'s SHA-256s, re-fetched | holds |
| `mediaReads` is frames on the wire | `client/contract/clauses.ts:615`: reads of the media streams, one per chunk | wrong (corrected) |

**The model, recomputed per cell.** t is a frame's bytes over 20 Mbit; m the misses; r the frames S's run carries,
from frame 1 to the last odd frame; D_min = 4. A, D_min asks topped up on each arrival, is RTT + m · max(t, (RTT + t) /
D_min); S is RTT + r · t. Loss and decode are left out: `us_liver` decodes in 7.9 ms at 1× (SPEED), on three decoders,
against 103 ms on the wire.

| series | t | m | r | A at 46 · 92 ms | S at 46 · 92 ms | S / A | A's goodput |
| --- | ---: | ---: | ---: | --- | --- | ---: | --- |
| `us_liver`, 257 kB | 103 ms | 35 | 69 | 3.65 · 3.70 s | 7.15 · 7.20 s | 1.95–1.96 | 0.975–0.987 |
| `dbt12_ea1141`, 499 kB | 200 ms | 14 | 27 | 2.84 · 2.89 s | 5.44 · 5.48 s | 1.90–1.91 | 0.968–0.984 |

On a link-bound cell S's half-held fill is about the empty fill (r ≈ n), so under S a half-held cache saves nothing
and under A it saves half. The span is ≤ 0.6× A only where 2t ≤ 0.6 (RTT + t) / D_min, t ≤ 0.6 RTT / (2 D_min − 0.6):
3.7 ms at 46 ms and 7.5 ms at 92, frames of 9.3 and 18.6 kB at 20 Mbit. No series in [`../FIXTURES.md`](../FIXTURES.md)
is that small: `pt15_cptac`, 31 kB a frame, gives S / A 1.68 at 46 ms and 0.95 at 92. A at 1 % loss is not modelled; loss
lengthens both, and puts S's run on one stream against A's four, which is no reason to expect the sign to turn.

**The protocol against the measurement rules.**

* *Interleaving.* `holdEveryOther` is an `opts` setting, so in `run.mjs` a store state is a variant, not a cell: six
  units (A, A′, S × half-held, empty) in a Williams order per cell, a period of six rounds, 12 rounds two periods —
  balanced. The RTT alternates by process each round; it is never a compared lever, so that holds.
* *A/A and VOID.* A′/A within ×0.95–1.05 on the medians, visits the relay's `--self-timing` marks `VOID` dropped and
  topped up: as the PR wrote them.
* *Saturation.* The host and decoder guards hold. The link guard is retracted above: it would have voided every
  half-held cell on the model.
* *A rule fixed before data.* Yes, with two faults corrected above: vacuous adoption when every cell is excluded, and a
  wire bound that, on this store, passes or fails S by construction.
* *Can the rule be met?* Not on the model in any cell: it needs S at ≤ 0.6× where S is predicted at 1.90–1.96×. It
  can fail, so it is a test, but one whose outcome the model gives with a threefold margin.

**Worth running? Not as pre-registered.** 2 series × 2 RTTs × 2 impairments × 2 engines are 16 cells; six variants
over 12 rounds make 1 152 visits, each a 3–7 s fill plus a browser's start, to confirm a prediction with a threefold
margin. Its decision, `span` 0 and the setting removed, is the one the model gives already. The want path's D_min
asks took red 5's gain; what is left of it, the first round trip, is D_min's to win
([`client-window-depth.md`](client-window-depth.md) T1), not a span's. The review's recommendation: remove `span` and
`holdEveryOther`, this subsection the record. If the owner wants the model's sign checked first, the cheapest cell is
one: `us_liver`, `r20000`, 46 ms, clean, Chromium, A and S half-held, 3 rounds. S / A in 1.7–2.1 keeps the model; S / A
≤ 1.2 would retract it, and with it this recommendation. The rig below runs that cell.

**The rig, built** (`lab/av1/delivery/total-time/run.mjs`, `lab/viewer/levers.js`, `client/viewer/viewer.js`,
`client/view/controller.js`):

* a variant's `"opts"` in `variants.json` is merged last into connect's, so `{"span": 1, "holdEveryOther": true}`
  reaches the downloader and the view worker; a store state is a variant;
* the levers' result carries the controller's `fillMs`, the session's `mediaReads` at the last frame and `fillReads`
  from the last held frame on, and a row records all three;
* a viewer variant runs on demand with `--fill 0 --asks-after K`: frame 0 shown, then frames 1 … K stepped to one at a
  time, each timed from its step to its frame held (the ledger's arrival), in the row's `afterMs`. Any other
  `--fill` for a viewer is refused.

`lab/viewer/levers.test.mjs` (gated) catches 8 of 8 mutants: `fillMs` dropped, the fill's reads not from the last held
frame, the held frames taken as the odd ones, reads at the first frame, steps from 0, steps timed from the fill's
issue, steps taken in a fill, fill frames reported on demand. The controller's new ledger test catches both of its:
`fillMs` and `mediaReads` left out.

**The smoke, one round, Chromium, `r20000` at 23 ms one way, clean, 1×** — no number from it is a result. The set is a
synthetic 76 frames, the gate's `grey-16` codestream (38 kB) repeated, since no HTJ2K encoder could be built in the
container; its truth is the vendored decoder's SHA-256. The six variants each held 76 of 76 frames exact, the decoder's
check `true` on every one, with `fillMs` in each row. That the span arrived through `opts` shows on the relay: S
half-held put about half a series more packets on the wire than A, the 37 frames it crossed; with the `opts` merge
removed, S half-held sent an empty fill's packets — the mutant caught. On demand, A, A′ and S each took 10 steps, each
timed, 10 of 10 exact, none failed.

**`mediaReads` is not a wire measure.** In the smoke A's half-held fill, 38 asked frames, read about as often as an
empty fill of 76, while the relay counted half the packets: a frame on its own stream is read in more, smaller pieces
than a frame in a run. The wire is the relay's `s2c` count, already in every row; the run reports it, and `fillReads`
only beside it.

### The receive loop beside the paint (2026-10-29)

*Theory and a harness; nothing measured. The question is difference 2 above: does a WebTransport receive loop keep
the fill's rate when it shares one dedicated worker's thread with OPFS reads, XXH3 checks, uploads and paints?
Sources at the pins in [`frame-path-sources.txt`](frame-path-sources.txt) under 2026-10-29, line numbers as fetched.
The harness is [`../../lab/recv-loop/`](../../lab/recv-loop/README.md); the protocol's runs are a separate row.*

#### Where received bytes wait while the worker's thread is busy

**The standards.** A receive stream is a byte stream set up with no high-water mark, so 0 (webtransport `index.bs`
2585–2587; streams `index.bs` 6938): the user agent reads from the QUIC stream on a pull, in parallel, and
delivers what it read in a network task on the transport's event loop (2595–2628), the worker's, which waits for
the thread like any task. A buffer below it "SHOULD have a fixed upper limit, to carry the backpressure information
to the server" (2618–2619).

| engine | where the bytes wait | the receive window, and when it advertises more | what reaches the server |
| --- | --- | --- | --- |
| Chromium | a 256 KiB mojo pipe per stream (`services/network/web_transport.cc` 1445–1446); the network service reads QUIC only while the pipe has room (369–395); Blink empties the pipe in a task on the worker's thread, on a pull or the pipe's watcher (`incoming_stream.cc` 46–50, 160–170, 255–260) | 6 MiB a stream, 15 MiB the connection (`net/quic/quic_context.cc` 21–22, 95–97), WebTransport's too (`dedicated_web_transport_http3_client.cc` 853); a client never auto-tunes (QUICHE `quic_session.cc` 184, `quic_stream.cc` 149); an update once less than half the window is unread (`quic_flow_controller.cc` 190–192, 194–219), unread meaning not yet copied into the pipe (`web_transport_stream_adapter.cc` 41–52) | flow control: with the pipe full the window stops moving, and the server blocks 6 MiB + 256 KiB past what the script took |
| Gecko | a 96 KiB pipe on the socket thread (`WebTransportStreamBase.cpp` 44–49; 24 × 4 096 B, `nsIOService.cpp` 212–213), which stops reading neqo when full (`Http3WebTransportStream.cpp` 474–501); a 64 KiB IPC pipe copied into on the socket thread (`WebTransportParent.cpp` 283–301; `DataPipe.h` 149); the worker reads it in a task on its own event target, on a pull (`WebTransportReceiveStream.cpp` 57–60; `UnderlyingSourceCallbackHelpers.cpp` 253–268, 280–297) | neqo's default for the server's uni streams, 1 MiB auto-tuned to at most 10 MiB (`neqo-transport` `params.rs` 60, 83, 193; `fc.rs` 405–430): Firefox sets only the connection's 24 MiB and its own bidi streams' 12 MiB (`neqo_glue` `lib.rs` 489–494; `StaticPrefList.yaml` 16883–16892); an update once a quarter of the window is read (`fc.rs` 38, 288–310), read meaning copied into the pipe (`recv_stream.rs` 1142–1162) | flow control, as Chromium's, past W + 160 KiB, W between 1 and 10 MiB |
| WebKit | nowhere bounded: the network process re-arms `nw_connection_receive` (0 to 2³² − 1 bytes) after every delivery, whatever the worker does (`NetworkTransportStreamCocoa.mm` 242–291), sends each over IPC (`NetworkTransportSession.cpp` 77–80); the web process posts it to the worker as a task (`WorkerWebTransportSession.cpp` 116–125), which appends it to an unbounded queue (`WebTransportReceiveStreamByteSource.cpp` 116–144) | Network.framework's, not in WebKit's source; apart from it, a session stalls after 16 MB ([`../CLIENTS.md`](../CLIENTS.md), bug 319818), which recycling answers | nothing from a busy worker: the bytes queue in its memory and the spec's SHOULD is not met |

**What this corrects.** The independent design's failure case read the 6 MiB window as filling in ~0.4 s at
125 MB/s. That holds for a reader that stops; one that runs between reads drains the window at each gap. A cine
step holds the thread for T: 22 ms of read and check, the brief's figure (M1 measured 22.3 ms at 27 MB, so a 17 MB
step is likely less), plus a ~6 ms upload, so T ≈ 20–28 ms, the upper end used below. Chromium's server stalls
inside one step only when R × T passes the 3 MiB left after an update: 3.5 MB at 125 MB/s, just over; 0.36 MB at
103 Mbit/s, a ninth of it. *Corrected 2026-10-29 (independent review):* 6 MiB at 125 MB/s fills in ~0.05 s, not
0.4 s (0.4 s is 125 Mbit/s); and the bytes in flight hold the window too, so the stall is R × (RTT + T) past W, as
the formula below: 1.5 MB at 103 Mbit/s and 92 ms, still far inside. **What binds first is the thread's time.** The receive loop costs the renderer ~2.3 ms
per MB plus ~50 µs a frame ([`../rig-limits.md`](../rig-limits.md) §1: Chromium 141, a container; Gecko's and
WebKit's not measured, taken equal below). A 30 frames/s cine of 28 ms steps holds 84 % of the thread, and the
16 % left carries ~64 MB/s.

#### Predictions, per engine

Merged ≈ min(R, (1 − 30 T) ÷ c, W ÷ (RTT + T)); split ≈ min(R, the network process's ceiling, W ÷ RTT); R the link,
c ≈ 2.5 ms per MB, W the stream window. The fill is 250 KB frames as the harness's; T = 28 ms at 1× on a host with
a GPU.

| cell | split's last frame | merged ÷ split, last frame | merged's inter-arrival p99 − split's | engines |
| --- | --- | --- | --- | --- |
| 18 Mbit/s, 92 ms, cine | 6.7 s + the dial | ×1.00, one step at most | **+~28 ms**: a frame landing in a step waits it out | all three alike: a step's 63 KB fits the pipes |
| 103 Mbit/s, 46 and 92 ms, cine | 3.9 s + the dial | ×1.00–1.01 | **+~28 ms**, on a nominal 19.4 ms | Chromium, Gecko: a step's 0.36 MB spills past the pipes into the window, far inside it; WebKit: the wire untouched |
| any of those, drag | — | ×1.00 | +≤ 1 ms | a drag's tick holds the thread for a draw call, not an upload |
| 125 MB/s, 46 ms, cine (beyond the relay) | the network process's, ~100–150 MB/s on a container | **×1.3–2** (the thread, 64 MB/s at T = 28; the window, 85–95 MB/s). *Corrected 2026-10-29 (independent review):* the formula gives ×1.6–2 at T = 28, the thread binding, and ×1.05–1.3 at T = 20, the window binding | — | Chromium; Gecko once neqo's window has tuned past R × T; WebKit's wire keeps 125 MB/s and its worker's queue grows ~60 MB a second |
| 125 MB/s, 92 ms, cine | window-bound: 6 MiB ÷ 92 ms = 68 MB/s | ×1.3 (52 MB/s, the window over RTT + T) | — | Chromium; Gecko's 10 MiB: ×~1.8 (114 against 64 MB/s) |
| 4× on every thread | a step ~112 ms: the cine saturates in both arms | excluded by the guard | — | claim nothing |

*Corrected 2026-10-29 (independent review):* +~28 ms is the longest wait, not the p99's rise. Merged, arrivals
snap to the gaps between steps, so at 103 Mbit/s a gap is at most a period, 33.3 ms: a model with frames at their
nominal pace and a 28 ms step every 33.3 ms (not measured) gives merged's p99 − split's ≈ +12 ms at 103 Mbit/s,
under the rule's 16.7 ms, and ≈ +20 ms at 18 Mbit/s (+15 at T = 20), at the bar.

**So: at the target links the fill's rate is kept on every engine, and its pace is not.** Merged, a frame reaches the
script up to a step late, so the p99 rises by about a step. In the target that frame reaches the screen no sooner,
since the view worker is in the same step; what the split keeps is the decoders fed during it. The rule counts the
pace anyway, as the question names it. The 125 MB/s cells are where the independent design's failure is real, on
the thread's time more than on the window.

#### Protocol (pre-registered; not run)

* **Arms**, one lever: `split` (the receive loop in its own worker beside the view worker), `split2` (the same, the
  A/A), `merged` (one worker). Williams order (`lab/order.mjs`), 12 rounds, a fresh browser a visit on a disk-backed
  profile.
* **Cells:** cine and drag (lab README) × 103 Mbit/s at 46 and 92 ms and 18 Mbit/s at 92 ms through
  `link_impair.py`; loopback printed as the host's ceiling and outside the rule. Chromium and Firefox, on a host with
  a GPU on which the split arm's cine holds 30 frames/s; software GL does not (one-worker probe: a 46 ms draw at
  2560×3328). *Corrected 2026-10-29 (independent review):* the harness forced SwiftShader on Chromium whatever the
  host; `--angle` now picks ANGLE's backend, and the row's `renderer` shows which ran. WebKit is not runnable in the lab; its row stands on the source.
* **Checks**, each mutated (lab README): every frame exact; `merged` is one thread (no arrival inside a load task);
  `split` is two (some arrival inside one).
* **Saturation guard:** `VOID` when the host passes 90 % CPU or the relay's send p99 passes 1 ms; a round of a cell
  is dropped for all arms when `split`'s cine runs under 27 frames/s.
* **The rule.** In every shaped cell on both engines: (1) *rate*, `aa_rule.py` on the last frame, merged against split
  with split2 as the A/A, bar 2 %; (2) *pace*, merged's inter-arrival p99 within 16.7 ms of the same round's split in
  ≥ 9 of 12 rounds, the A/A meeting the same bound; (3) *paint*, the same on the cine's step lateness p99, so merged
  cannot keep the fill by starving the cine. **The downloader may merge into the view worker only if all three hold
  everywhere.** `worse` on (1), or a failure of (2) or (3) where its A/A holds, keeps the split; anything else is
  undecided and runs again with `--confirm`. `run.mjs summary` applies it. *Corrected 2026-10-29 (independent
  review):* `summary` judges one run; the `--confirm` run is `aa_rule.py --confirm` on the two `.cells.json` files.
* **Predicted outcome:** (1) and (3) hold, (2) fails on every cine cell: the split stands, on pace, not on rate.
  *Corrected 2026-10-29 (independent review):* by the model above (2) holds at 103 Mbit/s and sits at the bar at
  18 Mbit/s, so the predicted outcome is undecided, not the split.

**Smoke, 2026-10-29:** one round of loopback cine, one visit of 103 Mbit/s drag, each mutant once, Chromium 153 on
software GL. It ran and the checks caught all three mutants; no number from it is a result. No Firefox or WebKit
binary is in this container.

**Not traced:** Network.framework's receive window; Blink's high-water mark past the spec's default; the receive
cost per MB in a Gecko or WebKit worker.

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
| frame store (+ OPFS cache) | memory → cache → downloader; acks a frame once held; evicts farthest-first, only once written | the page, no cache (main's) | the view worker; the cache under a lab `writer` | UI thread / view thread / core thread; a file per frame |
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
main's behaviour; turning it on is the owner's call, not this branch's. The cache is the frame store's alone: #212's
wiring into the page's old viewer is not carried, so `lab/opfs-cache`'s M1–M4 cells, which drive `?view=page`, have no
cache to measure on this branch until they name `?view=worker&writer=store`; their rows stand as run on #212.

**Folded in,** with `git merge --no-ff`, bases first: the unified branch (for the native line); #228, #231, #232,
#235, #239, #237; #229, #238, #243 (+#248), #246, #245, #244; #225; #212's client-cache line, then #226 → #241 and
#227 → #242 with the M5 and OPFS-arms runs; #247 with #189 → #198 → #201 → #206/#209 → #216 → #218 → #236 → #240; and the follow-ups of their
sessions as they are pushed. `claude/cine-no-skip` (the simple cine's skip fix) is not folded in: it is
built on #210 and the page's viewer before #229, so it carries the viewer product's #210 with it. Each conflict and its resolution is recorded in the PR. **Superseded** once this lands
(the owner closes them): every PR above. **Out:** the viewer product (#193, #210, #214, #215), the ask-during-fill
lever (#135), ingest.
