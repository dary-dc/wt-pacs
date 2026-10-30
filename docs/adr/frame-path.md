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
