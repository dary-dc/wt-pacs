# Architecture — the client above the transport

How a page gets frames: one **downloader** worker owns the session, every frame's record and the
queue; **decoders** turn codestreams into pixels and hand them straight to the **consumer** on the
page. Below it the transport is a seam — TypeScript, WASM or WebSocket — whose surface is
[`CLIENTS.md`](CLIENTS.md); the bytes are [`WIRE.md`](WIRE.md). What each part is for, what was
measured and chosen, and what is open.

**Status.** Built in `client/downloader/`, run by `client/harness/downloader.html`, beside the
harness's own path; removing that path waits on the browser campaign against the baseline, not yet run
on this head. Figures are a container's unless they say otherwise; none is a phone
([`rig-limits.md`](rig-limits.md) §7).

## Why a downloader

A consumer built from the raw transport surface ends up with two orchestrators — one on the page,
one in a receive worker. Measured per frame of a fill before the downloader: **four messages**, the
pixels crossing **two** threads (decoder → receive worker → page); the page **asking for each frame**
of a fill it already asked for, so a decoded frame waits for the ask; a **waiter per frame** for frames
that arrive in order anyway; the compressed bytes sent back to the page **only to be counted**; sign
extension and the range scan **on the main thread**; and, while a fast fill lands, a paint of a frame
already cached **waiting several hundred milliseconds** behind it.

A receive loop on the main thread cannot read while that thread is busy, and a viewer keeps it busy
— a boot, or its own work mid-fill, holds it 200–300 ms at a time, a stall once blamed on the
transport. **A worker removes renderer-side contention only**: the hop to the browser's network process
and the per-datagram receive cost stay ([`rig-limits.md`](rig-limits.md) §1).

## The shape

```
PAGE                                   DOWNLOADER (worker)                    DECODERS (N)
start: new Worker(downloader) ───────► config, dial, hold the session
consumer ── fill / ask / cancel ─────► per-frame state; fill pushed by session
                                        queue: asks, then fill ── compressed ─►  one decoder object each
                                                               ◄──── done ─────  sign extension, range
         ◄─────────────── pixels (shared), info, range, stamps ────────────────  written once
  asked frames: taken at once
  fill frames: taken at background priority
```

**Data takes the shortest path; control has one owner.** Pixels go from the decoder straight to the
consumer over a port the downloader hands out. Every decision — what to fetch, which decoder, what
to drop — is the downloader's; the consumer never talks to a decoder. **No proxy layer**: the worker
boundary is the API, and `stats()` is async because it cannot be truthful and synchronous across it.

* **Move, never copy; get the pixels out of the decoder's heap.** A cloned 8 MB frame costs the page
  80× a transferred one (§What a thread hop costs); a WASM heap never shrinks, so pixels kept in it
  cost 517 MB against 108 MB copied out for 87 frames ([`decode/README.md`](decode/README.md)
  §Retention, measured).
* **First-free dispatch**: round-robin idles a decoder behind a slow neighbour, which matters when
  decode times are uneven — the device case ([`decode/README.md`](decode/README.md) §Dispatch:
  first-free against round-robin).
* **Dial early, stay alive, notice death**: the session opens when the user picks a series and is used
  when the viewer mounts, minutes later; only the server can keep a browser's session open
  ([`transport/adr-idle-sessions.md`](transport/adr-idle-sessions.md)).
* **A cache seam and a paint sink** — the viewer paints from a cache filled ahead of it, through a
  renderer the client does not know. **Neither is built** (§Open).

## Messages

| to the downloader | fields |
| --- | --- |
| `start` | config — and, optionally, `fill`: the first fill's frame indices |
| `dial` | url, cert hash |
| `fill` | frame indices |
| `ask` | one frame index |
| `cancel` | — |
| `close` | — |

| to the consumer | fields |
| --- | --- |
| `frame` | index, generation, pixels, width, height, bits, components, signed, min, max, byte count, wire bytes, stamps |
| `failed` | index, generation, reason |
| `cancelled` | generation |
| `closed` | reason |

Stamps are epoch milliseconds (`timeOrigin + now`; each context has its own `timeOrigin`), converted
once by the consumer: ask, first byte, last byte, dispatched, decode start, decode end, and
`decoder`, the index of the decoder it went to. `wire bytes` is the codestream length the envelope
declared, beside the decoded byte count; a consumer reporting traffic quotes that one
(`client/downloader/README.md` §What a frame reports).

**A request's identity is its generation, not its frame index.** `cancel` bumps a counter the
downloader owns; every record, decode, decoder reply and delivery carries the generation it was made
under, and anything older is dropped where it lands. Without it a frame decoded for a cancelled
request reached the consumer under the *new* request's index — the right key, the wrong pixels — and
a late `done` deleted the new request's record. The page's drop of a stale `failed` has no clause (no
deterministic test opens that race), and is kept because one rule is easier to hold true than one
with an exception.

**The decoders are not told of a cancel**: a message to a decoder queues behind the decodes already
posted to it. A cancel wastes at most `decoders × perDecoder` frames; what matters is that the result
is not taken for the new request's. Only a flag in a `SharedArrayBuffer`, read before each frame,
would drop queued work — worth it if a phone shows a decode long against a switch.

**`start` and `dial` are two messages**, so the decoders boot and the opening fill is recorded before
the page has the URL. **It buys no round trip** — 14.51 against 14.57 to the first frame of a fill,
inside the ±0.2 arms wander ([`../lab/page-open/README.md`](../lab/page-open/README.md) §The first
byte on a fill), because the preload already warms the worker graph — and costs nothing. A device
whose worker boot is slower than its dial would decide it.

### Messages posted before anyone listens

Every message the client posts before its receiver listens is queued by the platform, not dropped,
so none needs a handshake:

| site | posted before | why it is safe |
| --- | --- | --- |
| consumer → downloader: `start`, `dial` | the worker's script has run | HTML, *run a worker*: the worker's implicit port queue is enabled only after its script runs, and `downloader.js` sets `onmessage` at top level |
| downloader → decoder: `init`, the first `decode` | the same, for each decoder | the same clause; `decoder.js` sets `onmessage` at top level |
| decoder → consumer, on the pixel port | the consumer has the port | HTML, *message ports*: a port's queue starts disabled, its messages move with it on transfer, and setting `onmessage` starts it — **`addEventListener` would not** |
| downloader / decoder → their `Worker` objects | — | the owner sets `onmessage` in the task that created the worker |
| `client/harness/ts.html` → `session-worker.js`: `connect` | the worker's script has run | as the first row |

The one pattern that does lose messages — a `BroadcastChannel` a worker constructs and the page posts
to at once — is used only by the conformance fakes, which wait for `listening`. **Measured**
([`../lab/early-messages/run.mjs`](../lab/early-messages/run.mjs), driverless Chromium 141, 5 × 1 000
opens an arm, rotated): the downloader path lost **0 of 5 000**, the harness's worker **0 of 5 000**,
the `BroadcastChannel` control **103 of 5 000**. Exposed on purpose, each site was caught: the pixel
port on `addEventListener` lost 100 of 100, either worker's `onmessage` set 50 ms late 20 of 20.

## The downloader

* **Started by the page at load**, before anything else runs. The page fetches the config — its
  shape is the deployment's — and may hand `connect` a *promise* for the URL. The downloader dials
  and holds the session; holding it open is the server's keep-alive.
* **One record per frame:** on the wire, queued for a decoder, decoding. An ask for a frame already
  in hand moves it up the decode queue instead of asking the wire again.
* **One queue, two priorities.** Asks before fill frames. Dispatch never leaves a decoder idle: up to
  `perDecoder` (2) outstanding each, to the decoder with the fewest.
* **Fills are pushed by the session** ([`CLIENTS.md`](CLIENTS.md) §Fills are pushed), `stream_frames`
  on the wire, one contiguous run of what is still wanted at a time. Not `request_frames`: the
  server serves a batch as one ask per index in order, so an ask behind a 200-frame batch waited for
  all 200, where a `stream_frames` fill is dropped the moment an ask is in hand. **An ask ends a
  running fill with no saved position** ([`WIRE.md`](WIRE.md) §An ask during a fill), so once an ask settles
  the downloader re-issues what is not yet delivered as a new run — the client owns that decision,
  the server stays as it is. An ask for a frame the fill still owes goes to the wire, where the
  server serves it next.
* **Cancel** ends the stream, drops queued work by generation, fails outstanding asks with an
  `AbortError`, **resets the count of asks in flight** (it gates the fill; one left over stalled the
  next fill) and answers `cancelled`.
* **Closure**: a session that dies is resumed (§Session survival); a command after a closure re-dials.
* **Memory.** The wire buffer is a ring of `decoders × perDecoder + 2`: **−19.2 MB of renderer peak on
  an 87-frame 16-bit fill, 8 of 8 rounds**, the fill's clock unmoved ([`decode/README.md`](decode/README.md)
  §The wire buffer ring). **The reader pause is proposed, not built**: past a bound of queued
  compressed bytes, stop reading and let QUIC flow control stop the server — no server cap, no new
  message. Until then the compressed queue grows with the study whenever the decoders fall behind the
  wire (read from the code). It replaces a fill window that was never built, whose reason — a waiter
  per frame — pushed fills removed.

**The wire may run ahead of the decoders; dispatch may not.** The guard is at the top of `pump()`, so
frames that land before a decoder is up wait with their bytes; gating the fill on the decoders would
delay it, and no guard loses the frame. The dial is memoised so `start` carrying a fill and a command
behind it share one handshake, and only `connect()` issues the first run (a second issue put the same
range on the wire twice). **The dial and the decoders start together**: start-to-dialled **58 →
52 ms** on the TS client and **70 → 57 ms** on the WASM one, loopback, 4 interleaved rounds — the floor;
on a real link the saving is a whole handshake.

### The first fill

**It rides with `start`**: `connect(url, hash, { fill })` puts the indices in the `start` message, so
the downloader has them before it dials. Otherwise the page posts `fill` after `started`, and a main
thread inside a long boot task cannot post it until the task ends.

Measured ([`../lab/fill-at-start/`](../lab/fill-at-start/README.md), 8 cores, 20 frames of ~51 KB,
decode off, one fresh page and session per arm, **12 rounds**, order reversed on odd rounds). Median
[min … max] from `connect()`. Over a **50 ms round trip, the main thread held 300 ms from 25 ms in**
— the worker alive and dialling, which is a viewer's ordering:

| | page posts `fill` after `started` | `fill` in `start` | better |
| --- | --- | --- | --- |
| the downloader has the fill (ms) | 327 [327 … 327] | **19 [17 … 24]** | 12/12 |
| first frame received (ms) | 486 [484 … 487] | **335 [331 … 339]** | 12/12 |
| all 20 frames received (ms) | 748 [744 … 754] | **599 [593 … 605]** | 12/12 |

**With the main thread free it is a tie** (all frames 609 → 609 ms, 5/12): nothing goes on the wire
before the handshake. **A main thread blocked in `connect()`'s own task takes the worker with it**
(905 → 906 ms, 5/12): in Chrome 148 a dedicated worker does not start while the main thread is
blocked. So it pays only where the worker was alive when the long task began.

## The decoders

* **One decoder object per worker, reused** — safe because `lab/decode-bench/parity.mjs` is
  byte-identical on every fixture. A reused decoder hands back the *previous* frame's pixels when a
  parse fails, so `decodeFrame` refuses a frame whose output is shorter than its header declares
  ([`decode/README.md`](decode/README.md) §A frame that did not decode).
* **Pixels written once, into a `SharedArrayBuffer`.** That needs cross-origin isolation, and
  `connect` refuses without it rather than falling back to a copy, which would measure the wrong
  thing.
* **Sign extension and the sample range in one pass**, or in the decoder's own pack where the build
  provides it ([`decode/README.md`](decode/README.md) §The range in the pack).
* `frame` goes to the consumer; `done` goes to the downloader, carrying the wire buffer back to the
  ring. The compressed bytes never reach the page.

**How many.** A start parameter, default 3; two rules were argued and neither is the default yet.
**Follow the queue** — start at one, add one while the decode queue stays non-empty across a dispatch,
retire one left idle — because at 20 Mbit a cine frame needs 0.34 of a desktop decoder and ~0.86 of a
phone's (arithmetic), so one decoder keeps up on every fixture; not built, and a pool that resizes
must keep both dispatch clauses (asks first, at most `perDecoder` a decoder) while it resizes. Or
**`min(3, hardwareConcurrency)`** as a resource rule (§Resources), measured at two and four cores only.
A multithreaded decoder is a separate question ([`decode/README.md`](decode/README.md) §Threads).

## The consumer

Frames that were asked for are taken at once, fill frames at background priority, so a paint never
waits behind a fill. The harness's consumer checks each frame against the fixture's `.sha256`.

`DownloaderClient.connect(url, certHash, { onFrame, onError, fill, openAsk, survival, … })` →
`requestExactFrame(index)`, `fill(indices)`, `cancel()`, `stats()`, `close()`. Every delivered frame
carries its `generation`; `cancel()` resolves once the downloader has ended the stream and dropped
that request's work. A refused **fill** frame has no waiter, so it reaches the consumer through
`onError({ frameIndex, reason, generation })`; a refused *asked* frame rejects its own promise. The
consumer keeps no timer: the downloader settles every ask. `url` and `certHash` may be promises;
`openAsk` puts the opening fill in the session URL (§Lever 1). The page forwards the triggers a
worker cannot see — `visibilitychange`, `pageshow`, `freeze`, `resume` — as one message.

### Closing a client

**`close()` ends every worker the client started.** The consumer terminates the downloader when it
answers `closed`, or after 1 s if it never does (a downloader wedged in a long task), and names any
ask still outstanding `closed by the consumer` at that point. The decoders are the downloader's
nested workers and end with it; **the downloader does not terminate them itself**. A `connect` that
fails ends its worker too.

Before, every closed client left its downloader running: **one renderer thread and 2.5 MB resident
per client** — 40 clients took the renderer from 10 to 50 threads and 106 to 206 MB, three rounds
identical ([`../lab/worker-leak/run.mjs`](../lab/worker-leak/run.mjs), Chromium 141 headless); after,
10–12 threads and 118–123 MB. **Terminating the decoders from the downloader as well strands it**:
10–12 of 40 downloader workers stayed alive, script dead, thread and memory held — a race
`client/conformance/drive_downloader.cjs` checks for by counting leftover workers after every page.

## Capabilities

Nothing on the harness's path is removed until every row passes on the downloader. **conformance** is
`client/conformance/run.mjs`, every clause against every transport; **dispatch** is `run_dispatch.sh`,
the downloader against a stalling fake decoder so contention is forced; both are in `scripts/gate.sh`.

| capability | the harness's path | the downloader |
| --- | --- | --- |
| connect, single ask, fill; shared and per-frame stream modes | conformance `workerSafe`, `cancellable`, `bothStreamModes`; server `stream_frames_range_arrives_in_order`, `a_batch_arrives_whole_and_in_ask_order` | the same clauses plus `pushedFill`; `downloader.html` against the real server, byte-identical |
| a fill cancelled mid-way, the session still serving | `cancellable`; server `end_stream_stops_a_fill_on_the_wire` | `cancellable`; dispatch `lateFramesOfACancelledRequestAreDropped`, `aLateDoneDoesNotDropTheNewRequestsFrame`, `cancelCompletesAndUnblocksTheNextFill` |
| a closed session noticed at once, waiters failed; a live one's frame owed its full wait | `noticesClose` | the same — an in-flight ask is woken at once; an ask after the closure re-dials and is served |
| refusals delivered, none lost | `refusals.html` headless against a real server (`run_wire.sh`), both clients | a refused ask arrives with the server's reason; a refused fill through `onError` — dispatch `aRefusedFillReachesTheConsumer` |
| worker-safe clocks; transferable results | `workerSafe`, `transferable`; `client/scripts/check_worker_safe.sh` | the same: stamps across two worker boundaries non-zero and ordered, a delivered buffer movable. **Move-not-copy across the boundary is not page-observable** — a dropped transfer list arrives as a clone that still detaches, found by a mutant that passed |
| an ask during a fill, served before the fill's queue | `ask-during-fill.html` against a real server: the ask is served, the fill ends — 28 of 120 arrive, then nothing | the same page: the ask is served and the fill completes without being asked again, no frame twice; dispatch `askBeatsQueuedFill`, `promoteBeatsQueuedFill`, `asksTheWireForAnOwedFrame`, `reissuesAfterAsk` |
| `stats`; one dial serves later asks; re-dial after closure | `reportsStats`, `oneDialServesLaterAsks`, `redialsAfterClosure` | the same; `stats` answered on the page |
| 8-bit multi-component, 16-bit unsigned, 16-bit signed | `parity.mjs`, signed against ground truth an independent decoder confirmed ([`decode/README.md`](decode/README.md) §Signed) | 8-bit 3-component byte-identical in `downloader.html`; the others rest on the package, which sign-extends itself. **Not yet run behind the downloader on a signed study** |
| every decoded frame byte-identical to `.sha256` | `parity.mjs`, `lab/decode-bench/` | `downloader.html`, mutation-checked both ways: one perturbed sample turns every line to `MISMATCH`, every fifth frame dropped reports 9/12 |
| TS, WASM and WebSocket transports behind the same downloader | every clause against every transport; the gate requires the WASM package | `lab/scripts/downloader_both_clients.sh`: single ask byte-exact on TS and WASM, fill a tie (120 / 125 ms); WebSocket and the race in §What was built |

Every clause was broken on purpose and seen to fail by name. A mutant that passes is a finding about
the rig before the test: one WASM mutant "passed" against a package whose `cargo build` had failed
behind a `tail`.

## Results

### S4

The container campaign ([`../lab/downloader-campaign/`](../lab/downloader-campaign/README.md)). 4
cores, loopback, 87 real HTJ2K frames of 512×512×3 (~430 KB each). Three arms, one fresh session
each, order rotated every round, **8 rounds**, 120 runs, no errors: **H**, the harness path — the TS
session on the page, a waiter per frame; **Dw**, the downloader with decode off, the like-for-like
comparison; **Dd**, the downloader decoding with three decoders, the product path. Median
[min … max], and Dw's rounds better out of 8. Reported, not decided on.

**Settled, ranges that do not overlap**: over an 80-frame fill the page's main thread does **95 ms
[85 … 128] on H against 14 ms [11 … 18] on Dw**, 8/8, and the page's JS heap peaks at **59 MB [55 …
70] against 31 MB [27 … 33]**, 8/8. *Corrected in place:* this said the renderer collects 139 times on
H against 0 on Dw; 139 counted `V8.GC*` trace events, most of them phases — H makes **one**
collection per fill and Dw none (§Under a throttled CPU). **Ties**: the fill, **233 ms [203 … 255]
against 230 [193 … 278]**, 5/8; a cold ask, **4.98 ms against 5.87**, 2/8, ranges overlapping — the
hop costs one ask under a millisecond, below what this rig resolves.

**An ask during a fill** (frames 0–79, the ask for frame 86):

| | H | Dw | Dw better | Dd |
| --- | --- | --- | --- | --- |
| ask → delivered at 10 % (ms) | 40.6 [25.7 … 45.9] | 36.7 [28.7 … 45.0] | 4/8 | 77.5 [64.5 … 92.8] |
| ask → delivered at 50 % (ms) | 36.1 [32.6 … 40.3] | 40.1 [33.8 … 49.9] | 1/8 | 41.1 [32.6 … 78.8] |
| ask → delivered at 90 % (ms) | 36.2 [30.7 … 41.3] | **24.0 [22.8 … 27.8]** | **8/8** | 32.9 [29.9 … 38.2] |
| fill frames delivered, ask at 10 % / 50 % | **23 / 53** of 80 | 80 / 80 | | 80 / 80 |
| fill issue → last frame, ask at 10 % (ms) | 63 (dead) | 230 [200 … 241] | | 478 |

The ask waits behind the frames already in flight, some fifteen here. At 90 % Dw wins every round;
that H's ask competes with the fill's parsing on one thread is a mechanism offered, not established.
**What differs is the fill**: on H the server ends it and nothing re-issues it, so 23 or 53 frames
arrive and the page holds waiters that would sit out 15 s; on Dw the fill completes in a plain fill's
time. On Dd an ask at 10 % waits behind the two frames each decoder holds — the dispatch bound's price.
The decode arm alone: 80 frames in **472 ms [435 … 481]**, decode-bound on four cores and not
transferable; main thread 33 ms, page JS heap peak 1.7 MB (the pixels are `SharedArrayBuffer`s the
page never copies); a cold ask 39.6 ms, one decode.

**Per frame, counted from the code**: Dd posts 3 messages (compressed to a decoder, pixels to the page,
`done` back), crosses 2 threads (a move, then shared memory) and copies the bytes 3 times (out of the
stream chunk, into the WASM heap, out to the `SharedArrayBuffer`); Dw posts 1 and copies once; H posts
none but holds a promise and a 15 s timer per frame on the page. Loopback in a container throughout:
the window the ask waits behind is this host's, and a long fat link holds more of it.

### Under a throttled CPU

The same 80-frame fill on H, Dw and Dd at 1×, 4× and 6× Chromium CPU throttle, arms and throttles
rotated inside each of 5 rounds ([`../lab/downloader-campaign/throttle.mjs`](../lab/downloader-campaign/throttle.mjs)),
collections and task time per thread from each fill's trace, allocations sampled on the page:

| arm | fill, 1× / 4× / 6× | page collections (pause) | worker threads' time | page allocation, KiB |
| --- | --: | --: | --: | --: |
| H | 279 / 478 / 692 ms | 1 (3.0 / 13.4 / 15.0 ms) | 0 | 812 / 474 / 465 |
| Dw | 273 / 283 / 300 | **0** | 37–41 ms | 192–224, `consumer.js` 42–53 |
| Dd | 674 / 759 / 762 | **0** | 2 006–2 286 | 265–288, `consumer.js` 50–58 |

* **No collection happens on the downloader's page, or in its workers, at any throttle.** `consumer.js`
  allocates ~0.4–0.5 KiB a frame for the message it receives and ~130 B for what it hands on — far
  below a young generation, so the seconds of collection once predicted for a phone do not occur.
* **The throttle slows the page's thread only** — Chromium refuses it on a worker target — so the
  downloader's fill stays flat while H's slows 279 → 692 ms. `lab/scripts/cpu_throttle.mjs` slows
  every thread ([`decode/README.md`](decode/README.md) §The decode tail on a slow CPU).
* *Corrected in place:* the decoded path's page cost was read as 0.28 / 2.5 / 3.7 ms a frame at 1× /
  4× / 6×. That counted the handler twice — its call sits inside the dispatch event — and included the
  lab page's own handler. The product's share is **0.15 / 0.84 / 1.15 ms (Dd), 0.07 / 0.22 / 0.32
  (Dw)**.

Three decoders keep three of four cores busy through the Dd fill: the host saturates there. The
throttle is Chromium's, not a phone; allocations are sampled at 8 KiB.

### The hand-off

**Nothing is changed: the cost was counted twice (above), and on a slow CPU coalescing has almost
nothing to batch.** At 4×, a frame's 0.84 ms is ~0.22 deserialising the message, ~0.10 `#deliver` and
~0.24 the dispatch around it — ~4 % of a 4×-throttled main thread at a frame every 20 ms. What costs is
the message, not what it carries: [`port.mjs`](../lab/downloader-campaign/port.mjs) posts the decoder's
message from a worker at a fill's pace, 80 frames, 7 rounds, and neither dropping the
`SharedArrayBuffer` nor the stamps separates from the product message, while **two frames a message
does** (0.101 → 0.068 ms at 1×, 0.385 → 0.212 at 4×, 7/7 each; 0.401 → 0.351 at 6×, 4/7).

**Why coalescing is not built.** Slowed as a phone would be — every thread — frames from the *same*
decoder never share an animation frame at 4–6×, and frames from any decoder do 15–33 % of the time.
Each decoder posts to the page itself, so per-decoder batching batches nothing and holding k frames
delays each by k − 1 decodes (80–120 ms). Batching across decoders needs a point they all pass — a hop
through the downloader or a shared ring the page reads — a change to §The decoders' shape for about
10 ms of a fill's main thread, less on the target link. Open for the owner (§Open).

### Resources

What the product path holds and burns, and whether the decoder count should follow the cores.
[`../lab/scripts/proc_sampler.mjs`](../lab/scripts/proc_sampler.mjs) reads each process's PSS and each
thread's on-CPU time every 100 ms; [`resources.mjs`](../lab/downloader-campaign/resources.mjs) runs the
Dd fill and a cold ask with 1, 2 and 3 decoders, the browser pinned to 2 or 4 cores, at 1× and 4×
(every thread slowed) — a fresh browser a visit, everything rotated, 7 rounds, 252 visits. Medians:

| fill | cores | time, decoders 1 / 2 / 3 | page main thread | renderer PSS | JS heaps, all workers |
| --- | --: | --: | --: | --: | --: |
| 1× | 2 | 1 598 / **1 027** / 1 067 ms | 38 / 35 / 48 ms | 220 / 224 / 228 MB | 53 / 105 / 156 MB |
| 1× | 4 | 1 508 / 899 / **723** | 31 / 38 / 33 | 219 / 225 / 229 | 53 / 105 / 156 |
| 4× | 2 | 7 021 / **4 999** / 5 329 | 198 / 337 / 271 | 216 / 221 / 228 | 53 / 105 / 156 |
| 4× | 4 | 6 624 / 3 642 / **2 616** | 58 / 62 / 118 | 218 / 223 / 224 | 53 / 105 / 156 |

A second decoder shortens the fill in 7 of 7 rounds everywhere, a third in 7 of 7 on four cores and in
2 and 1 of 7 on two; no decoder count moves a cold ask (53–65 ms at 1×).

* **A decoder costs one thread and ~51 MB of JavaScript heap, but only ~4–5 MB resident**: the package
  reserves a 50 MB heap floor a 512² frame barely touches. Which one a phone kills a tab by is not
  measured. The GPU process (~35 MB), the browser (~99 MB) and the workers' total CPU (~1.5–1.9 s a
  fill) do not follow the decoder count.
* **The count should be `min(3, hardwareConcurrency)`.** On two cores the third decoder is no faster at
  1× and slower at 4× (1/7), and starves the page's main thread; on four, three win every round. "More
  decoders" is not a lever. A phone reports its little cores too, so the rule bites only on two-core
  devices; whether a phone's scheduler behaves like this emulation is for a device.
* **The heap floor is a link-time choice**: on the decoder built from source with a 4 MB floor the Dd
  arm holds **16.3 MB against 161.4**, fill and cold ask identical to the tenth, byte-identical on all
  six fixture sets. Whether that build ships is a supply question ([`decode/README.md`](decode/README.md)
  §A build of our own).

## What a thread hop costs

Priced before the shape was chosen ([`../lab/thread-hops/`](../lab/thread-hops/README.md): workers
standing in for decode and receive, no transport, no decoder; headless Chromium 141, 4 vCPU,
cross-origin isolated so `performance.now()` is 5 µs and a one-tick difference is quantisation).

* **Relaying through the receive worker costs ~0.1–0.2 ms while it is quiet** against a direct port,
  flat in frame size; **under a busy receive worker it becomes unbounded** — 0.15–36.6 ms at 512 KB
  with the worker 9–12 % busy and the host at 70 % (queueing, not saturation), while direct stays
  within 0.05–0.27 ms. That load is far above the product's; it is the one that shows the failure.
* **A copy costs far more than any hop**: at 8 MB a frame posted without its transfer list costs the
  page's main thread **1.34 s per 237-frame burst against 17 ms transferred**, ~80×, 5/5 rounds at
  every size from 512 KB. A `SharedArrayBuffer` tracks the transferred frame and edges it at 2–8 MB.
* **Pulling each frame adds a `postMessage` per frame to the main thread.**

Both arms were mutated and moved as they should: `shared` given a transfer list delivers nothing, and
`direct` routed through the receive worker takes relay's numbers.

### The downloader arm during a fill, against direct

Another stack running this downloader and decoder pair read a per-frame interval during a fill of
10.4 ms colour / 13.8 ms 16-bit through the pair, against ~9.2 / 9.1 for a client on the page. The
same comparison on this lab's transport: [`../lab/decode-tail/`](../lab/decode-tail/run.mjs) `page.js`
is the product path, `direct.js` the same TS transport on the page feeding the same `decoder.js`
workers by the same rule, so the downloader worker is the only difference. Driverless Chromium,
loopback, the 87-frame colour and 16-bit sets, 7 rounds interleaved, medians:

| decoders | set | interval, downloader | interval, direct | direct finished sooner |
| --- | --- | ---: | ---: | --- |
| 1 | colour | 16.84 ms | 16.98 ms | 4/7 — a tie |
| 1 | 16-bit | 6.92 | **6.63** | 6/7 |
| 3 | colour | **5.55** | 6.26 | 2/7 |
| 3 | 16-bit | 2.95 | 2.92 | 2/7 — a tie |

**The gap does not reproduce, and nothing on this path is worth removing.** With one decoder the
interval *is* the decode; with three the downloader is level or ahead — its loop hands a frame to a
decoder in **0.04 ms** where the page's main thread takes **1.04**, and the pixel port delivers in
0.17–0.36 ms either way. The one cost, **+0.29 ms a 16-bit frame at one decoder (6/7)**, sits inside
the decode stamp: contention on this four-core host, which the colour fill saturates.

## Paint

Not built into the product: the client hands decoded frames to a renderer it does not know. Measured
([`../lab/paint-floor/`](../lab/paint-floor/README.md)) so the paint path is chosen on a number. **2d**:
every sample through a lookup table into a new RGBA `ImageData` at source size, onto an
`OffscreenCanvas`, scaled, handed to the main thread as a bitmap. **gl**: the samples uploaded to an
integer texture, window and level as uniforms, one draw at display size. The downloader's pixels are a
`SharedArrayBuffer`, which can back `texImage2D` but never an `ImageData`, so the 2D route's copy is
structural.

Headless Chrome 148 on an integrated laptop GPU (`--use-angle=gl`; default headless is software, and a
run that does not print its renderer is not a GPU measurement). Three passes of twelve paints a route a
cell, interleaved and rotated. **The box saturates at one 60 Hz frame**; nothing is claimed for a faster
display. DPR 1, identity window, main-thread ms a paint:

| set | 2d | gl | 2d / gl | 2d allocates |
| --- | --- | --- | --- | --- |
| 512² signed 12-bit | **7.55** [1.8 … 13.5] | **0.34** [0.1 … 0.5] | 22× | 1 028 kB |
| 512² RGB 8-bit | **11.14** [2.2 … 31.0] | **0.43** [0.1 … 1.2] | 26× | 1 025 kB |
| 4096×3072 16-bit, shown at 768×576 | **105.36** [88.3 … 181.0] | **5.73** [5.0 … 18.9] | 18× | 48 MiB |

* **The floor for a 512² frame is a third of a millisecond, and the 2D route is 22–26× above it**; at
  12.58 Mpx it overruns by six frames. The gl route allocates nothing and lands inside one frame at
  every size. **Device pixel ratio moves neither route**: cost follows the source, not the display.
* **A new window costs the gl route under 0.1 ms at every size**; the 2D route remaps every sample.
  For a new frame the gl route's time is almost all the texture upload (5.70 of 5.74 ms at 12.58 Mpx):
  if it is ever too slow, the upload is the thing to attack.
* **Without a GPU the gl route frees the main thread and delivers later**: on SwiftShader at 512² it
  reaches the screen 2–3 vsyncs after the 2D route (24 paints a cell: a direction). A blocked GPU is a
  real device state.
* **The two routes are the same image**: integer windowing on both, bit-equal at 1:1 and every integer
  magnification (119.5 M samples); under minification they differ only on exact texel edges, where
  canvas 2D's own rule is not self-consistent. Six of seven mutations caught, the seventh equivalent.
  A differential check proves agreement, not correctness; `frames.py` anchors the samples to the
  generator's `.sha256`.

**Not answered**: neither route filters when it minifies — 96.5 % of a 12.58 Mpx frame is discarded at
768×576 either way, which a resolution rung answers
([`adr-resolution-fitting-for-large-frames.md`](adr-resolution-fitting-for-large-frames.md)); nothing
here is a viewer or the target — the shape transfers, not the milliseconds. On a 60 Hz display a change
to one ask moves the median only when it crosses a 16.7 ms line.

## The session open

**A cold open is three round trips to first byte**: the QUIC handshake, the CONNECT, and the frame.
The ask costs nothing of its own — a client-initiated stream opens locally, so it rides out with the
stream. Measured natively through `lab/scripts/link_impair.py` at 40, 80 and 160 ms, the phase fitted
against the round trip so the relay's floor and the crypto fall into the intercept
([`rig-limits.md`](rig-limits.md) §3): before lever 2, session ready **3.00** round trips (+13.7 ms)
and first byte **4.01** (+17.7 ms); with it, **2.10 and 3.14**. In a browser the dial was 3.0 round
trips and is 2.1–2.5 with lever 2; everything a page spends before it is
[`../lab/page-open/README.md`](../lab/page-open/README.md). A prerendered page hides the page's half
of a cold open, not the dial: the session and the worker complete only at activation
([`rig-limits.md`](rig-limits.md) §8; Chromium only).

### What production adds

The counts above use this tree's dev dial: a self-signed 450 B leaf pinned by hash. **Before it has
validated the client's address a QUIC server may send three times what it received**; a quinn Initial
is 1 200 B, so the first flight is capped at **3 600 B** and the rest waits a round trip. Chains from a
throwaway CA, padded as a public CA issues them, flights read by `lab/scripts/first_flight.py`, slopes
over 40 / 80 / 160 ms, five arms interleaved, n = 7 a delay:

| arm | server's first flight | first byte | session ready |
| --- | --- | --- | --- |
| dev dial | 1 338 B / 2 datagrams | 4.03 rt | 3.03 rt |
| ECDSA P-256 chain | 2 810 B / 4 | 4.04 rt — a tie | 3.05 rt |
| RSA-2048 chain | **3 600 B / 3, then 240 B a round trip later** | **5.05 rt**, 7/7 at every delay | **4.03 rt** |
| RSA-2048, compressed | 2 870 B / 4 | 4.08 rt | 3.07 rt |

**An RSA chain costs a round trip on every cold open and reconnect (+60–80 ms at the target's round
trip); an ECDSA chain costs nothing — issue the server an ECDSA certificate.** Certificate compression
(`exact-server`'s `cert-compression` feature, no code) buys the round trip back, −32.3 % on the
Certificate message; Chrome 148 offers it over QUIC, brotli only. **It stays off by default**: five
crates and +1.29 MiB on the binary, for what ECDSA gets with none. **A leaf-only PEM** makes the
browser fetch the intermediate over AIA on every cold open until cached; `deploy/check_equivalence.sh`
warns on one ([`../deploy/README.md`](../deploy/README.md)). The fetch's cost is not measured.

### Lever 1

**The ask in the session URL**, `?ask=frame:42` or `?ask=fill:0-486`. `SessionRequest::path()` is
readable before `accept()`, so the server opens the media stream behind its own accept while the client
is still opening its control stream; no crate patch. The control stream is unchanged and owns every
later ask; a session with no URL ask behaves as before. The URL is untrusted: the study resolves against
the configured root, and a bad ask is refused with `FrameError` on the control stream, not by dropping
the session. *Corrected in place:* the prototype had no control stream to refuse on, so every refusal in
such a session was dropped; `refuse` now waits for the stream (`an_opening_ask_is_served_behind_the_accept`).

**Worth −1.13 round trips to the first frame of a fill in a browser** — 13.44 against 14.57, seven
rounds an arm at 40, 80 and 160 ms, interleaved, against a ±0.2 spread on milestones it does not touch:
41 ms at 40, 178 at 160. **Off by default** (`--open-ask`, `openAsk`): the URL carries one contiguous
run, and no host but this box's relay has served it. Two clauses hold it (honoured and optional; a
malformed ask leaves the session serving). A re-dial puts the fill's remainder in the new URL too.

### Lever 2

**The server's SETTINGS at 0.5 RTT.** Chromium holds its CONNECT until the server's SETTINGS arrive,
and `wtransport` 0.7.2 opened the server's control stream only after the handshake completed.
[`../patches/wtransport-0.7.2-settings-early.patch`](../patches/wtransport-0.7.2-settings-early.patch)
(19 lines in `endpoint.rs`) takes the server's `Connecting` to 0.5-RTT with `into_0rtt` and starts the
driver on it, so SETTINGS ride the handshake flight (RFC 9114 §6.2.1 allows it). It still waits for the
handshake before reading the client's SETTINGS and CONNECT, so a `SessionRequest` exists only after a
completed handshake, and early data stays off. **On by default.** *Corrected in place:* this was first
said to halve the round trip and to need a fork; it removes the whole of it — Chrome sends its CONNECT
with its Finished once it holds the SETTINGS — and is carried as a build-time patch:
[`../scripts/patch_crate.sh`](../scripts/patch_crate.sh) applies it with `--fuzz=0` to the
checksum-verified crates.io tarball, behind a `[patch.crates-io]` shim in `patched/wtransport/`;
dropping it is deleting that line. `settings_ride_the_handshake_flight` holds it (mutant caught).

**Worth one round trip off the dial**, in a browser ([`../lab/page-open/run.mjs`](../lab/page-open/run.mjs)
with `SERVERS=`, both builds behind their own relays, interleaved, 8 rounds at 0, 40 and 80 ms):

| arm | profile | dial, unpatched | dial, patched | rounds won at 40 / 80 ms |
| --- | --- | ---: | ---: | --- |
| ts | cold | 3.15 rt | **2.14 rt** | 8/8 · 8/8 |
| wasm | cold | 3.41 rt | **2.49 rt** | 8/8 · 8/8 |
| downloader | cold | 3.40 rt | **2.41 rt** | 8/8 · 8/8 |
| downloader | warm | 3.51 rt | **2.18 rt** | 8/8 · 8/8 |

At 0 ms the arms tie, as a round-trip lever must. Chrome's net log
([`../lab/scripts/netlog_dial.py`](../lab/scripts/netlog_dial.py), 18 of 18 sessions an arm at 80 ms)
shows the SETTINGS in the first flight and the CONNECT leaving before `HANDSHAKE_DONE`. From a TLS
page host the lever takes its round trip off the page's first frame in every cell
([`../lab/page-open/README.md`](../lab/page-open/README.md) §The first frame on a real host).

#### What lever 2 costs

**No bytes**: the SETTINGS take the padding of the server's 1 200 B Initial datagram, so the
amplification budget is untouched. **Under 1 % loss, no regression**: native session 2.04–2.13 round
trips against 3.07–3.14, 10/10; Chrome ready 169 against 251 ms, 34/40. **Under a blink** — a 150 ms
blackout at an offset into a cold dial at 80 ms ([`../lab/page-open/dial-blink.mjs`](../lab/page-open/dial-blink.mjs),
n = 5 an offset) — it wins by 80–340 ms everywhere but where the blink eats the server's first flight,
where it was **one round trip behind** (1 414 against 1 334 ms): the lost SETTINGS were recovered only
after the handshake. The native client has a second losing phase Chrome lacks — a blink over its
Finished and CONNECT, +220 ms, as RFC 9002 §6.2.1 predicts (not traced).

#### The losing phase, removed

Traced with `swallow`, which drops exactly the server's first flight
([`../lab/scripts/swallow_cells.sh`](../lab/scripts/swallow_cells.sh)): Chrome repeats its Initial from
+300 ms and quinn answers none; quinn's own probe fires at +1.001 s carrying **only the ServerHello**,
the Handshake flight follows a round trip later, and the SETTINGS are declared lost a round trip after
that. [`../patches/quinn-proto-0.11.18-probe-every-space.patch`](../patches/quinn-proto-0.11.18-probe-every-space.patch)
(8 lines): a server's handshake probe probes every space with data in flight, so the Handshake flight
rides it and a 1-RTT PING's ACK declares the SETTINGS lost a round trip sooner (RFC 9002 §6.2.4 bars
none of it). On by default. Session ready with the first flight swallowed, medians, seven rounds:

| client | round trip | unpatched | lever 2 | **lever 2 + this** |
| --- | --- | ---: | ---: | ---: |
| native | 80 ms | 1 328.5 | 1 411.7, 0/7 | **1 247.3**, 7/7 |
| Chrome | 80 ms | 1 332 | 1 414, 0/7 | **1 249**, 7/7 |

Clean dials tie with lever 2 alone, every other blink offset is within 2 ms, and at 1 % loss the worst
dial goes 1 416 → 1 250. `a_lost_first_flight_is_repeated_whole` holds it. *Corrected in place:* as
first written that test raced its client's own Initial repeat under load (1 run in 4); the client now
waits 3 s. **Untraced**: a client whose repeat reaches the server just before its probe may not get
the round trip back. Tried and not built: probing only the 1-RTT space (no more than lever 2 alone);
re-queueing the SETTINGS as data (the session stalled, cause not found). `--initial-rtt-ms 100` is a
larger, different lever here (−700 ms on every server) whose default waits on the target's round trip.

#### Other clients

Every other client this container could run ([`../lab/other-clients/`](../lab/other-clients/README.md)),
against both builds, at 40 ms, 5 rounds rotated. Session ready (quic-go: SETTINGS received) with the
lever against without: native 2.12 / 3.18 round trips, webtransport-go v0.9.0 2.17 / 3.21, aioquic
1.3.0 2.45 / 3.48, quic-go v0.53.0 1.13 / 2.20; h3 0.0.8 reaches only the handshake, 1.07 either way.
**Every client connects and takes the lever.** Through
[`../lab/scripts/half_rtt_deaf.py`](../lab/scripts/half_rtt_deaf.py), which makes any client one that
ignores 0.5-RTT data, it still works and **pays a round trip over no lever** (4.22–4.54 against
3.20–3.47; inferred, not traced); none of these clients does that on its own. Not the lever: the
server's HTTP/3 surface ends a non-CONNECT request with no response (`wtransport`'s behaviour), and
webtransport-go from v0.13.0 refuses the server for want of reset-stream-at. Upstream issue and pull
request are drafted, not posted ([`transport/upstream-wtransport-settings.md`](transport/upstream-wtransport-settings.md)).

### Lever 3

Optional hints in the same URL — `&rtt=62&down=18000&cores=4&mem=4` — each one the server may
ignore. **Not built**; proposed only so the format has room. Nothing should be decided by them until
something measures whether they help, and WebKit declines both `navigator.connection` and
`navigator.deviceMemory` ([`CLIENTS.md`](CLIENTS.md) §On WebKit).

### The probe after the open

Chrome re-sends one small packet as a `PTO_RETRANSMISSION` shortly after a session opens: **spurious,
quinn's, one packet.** From Chrome's net log ([`../lab/scripts/netlog_pto.py`](../lab/scripts/netlog_pto.py)):
the ask goes in the packet after the control stream's header; the server's first data packet
acknowledges the header but not the ask, then fills its window, and the ACK of the ask waits a round
trip for the client's ACKs — ~163 ms at 80 ms, where Chrome's probe fires at ~146. quinn-proto 0.11.18
skips the whole Data space while the congestion window is full, an owed ACK with it, though RFC 9000
§13.2.1 wants it within `max_ack_delay` and an ACK-only packet is outside the window. Moving the
window proves it: at 80 ms **7 / 8** sessions with the default window, **0 / 8** with
`--initial-window-bytes 1000000`. It costs a 65-byte packet — no congestion reaction, no delay to the
first frame. Derived, not measured: an ask sent while a fill holds the window full can draw the same
probe. Fixed in quinn's own harness and drafted for upstream
([`transport/upstream-quinn-ack.md`](transport/upstream-quinn-ack.md)).

## Session survival

A session that dies is noticed by the downloader and resumed on the records it already keeps.
**Built in the lab's client** (`downloader.js`, and the page triggers in `consumer.js`); no wire
message, no server change. The screen-lock pair is not built.

### What this means for the stack choice

**QUIC connection migration is not available to a browser page.** A session is named by a connection
ID, not its 4-tuple, so migration was expected to carry a viewer across a Wi-Fi ↔ cellular handover —
one reason this transport was chosen. In Chromium's public source (`net/quic/` at `refs/heads/main`,
not pinned to a commit) `DedicatedWebTransportHttp3Client` observes no network change and creates its
socket once, never re-binding it; the migration code (`MigrateNetworkImmediately`,
`OnNetworkMadeDefault`, …) is in `QuicChromiumClientSession`, driven by `QuicSessionPool` over pooled
HTTP/3 sessions, which WebTransport is not. Absence of a code path, not a device result: **no phone has
been tried**, and WebKit's QUIC is not readable from source.

**The server half.** Per-core endpoints drop a rebound session in silence — **12 of 16 rebinds killed
it at four endpoints, 0 of 6 at one**, the `(W−1)/W` the hash predicts, with **no stateless reset**
reaching the client, which timed out at 30 001 ms. They are parked on a branch. This tree's single
endpoint migrates a port-only rebind: at 40 ms the session survived **16 of 16**, the next ask in 70 ms,
at 10 s and 30 s idle timeouts alike. Not modelled: a new IP address.

* **An application-layer reconnect is required whatever the server's shape**, and **it is a cold
  session**: Chrome offers no TLS ticket and pools nothing (§Resumption and 0-RTT), so §The session
  open's round trips are paid again on every handover.
* **The idle timeout is a detection bound, and the wrong instrument.** The effective one is the lower
  of the two ends ([`transport/adr-idle-sessions.md`](transport/adr-idle-sessions.md) §Picking the
  pair), so a 60 s server timeout leaves an idle session's detection at Chromium's 30 s. *Corrected in
  place:* this once said the 20 s / 60 s pair doubles a 30 s freeze; it cannot push detection past the
  client's bound. And **a fill does not freeze for 30 s**: with data owed Chromium ends the session in
  **6.55 s** (n = 7), `session closed: Connection lost.` The 30 s holds only for an idle session.

**What would change it**: migration symbols appearing in `dedicated_web_transport_http3_client.cc`
(re-read it before re-deciding), connection-ID steering on the server, a device reading.

### Detection by the bytes

**No byte for `stallMs` (3 s) while frames are owed means the path is dead**, and each re-dial that
silence causes doubles the wait for the next. Both transports stamp `stats().lastByteAt` on every chunk
any stream delivers, so a frame slower than the wait is not a death while its bytes keep coming. Every
trigger — `online` / `offline` and `navigator.connection` `change` in the worker; `visibilitychange`,
`pageshow`, `freeze`, `resume` from the page — re-reads the silence and decides nothing else; on one
host the stall is the only one a path change raises.

*Retracted in place: the probe.* The first build answered a trigger with a probe ask for a frame
already delivered, with a deadline. **On a slow link it livelocks**: the stall fires between two slow
frames, the probe asks for a 428 KB frame that cannot arrive in time at 700 kbit and whose ask ends the
running fill, so the session is re-dialled and the fill re-issued, for ever.
[`../lab/session-survival/cells.sh`](../lab/session-survival/cells.sh) — headless Chromium, the
downloader against the real server through `link_impair.py`, 428 KB frames, both detections
interleaved on an idle box, 3–7 rounds a cell:

| cell | the link | probe (retracted) | bytes |
| --- | --- | --- | --- |
| cut | 20 Mbit, the path cut after 12 frames | noticed **5 006** ms [5 003–5 012] | noticed **3 016** ms [3 012–3 028] |
| radio | 80 ms, ordered ±10 ms jitter, Gilbert–Elliott loss | a false re-dial in 2 fills of 7, **1 never completed** in 600 s | a false re-dial in 3 of 7, all completed |
| blinks | 80 ms, a 1 s blackout every 5 s | none; 19.1 s a fill | none; 19.1 s a fill |
| slow | 700 kbit, 80 ms, 0.9 s queue | **0 of 7 completed** in 120 s | 7 of 7, **41.4 s**, no re-dial |
| deep | 700 kbit behind a 4.1 s standing queue | **0 of 7 completed** | 7 of 7, 52.9 s, one re-dial each |

**Two defects checked for.** *A replaced session left open*: not here — of 205 replaced sessions none
ended by idle timeout. *A frame's deadline counted from its ask*: **here, in three places** (both
transports' 15 s waiter, the consumer's timer) — six frames asked at once on the slow link failed 4 at
15.0 s while their bytes still arrived. Waiters now time from the **last byte**, the consumer keeps no
timer, and the burst delivers **6 of 6 in 31.2 s**; a server that accepts every dial and never sends
keeps an ask waiting through doubling re-dials. Relay rates only — latency and completion, no
throughput; only the radio cell's re-dials are read, its fill time varying 20–54 s with the loss draw.

### Re-dial and re-issue

A dial that fails is retried `tries` times `redialMs` apart while anything is owed; then every owed
frame is failed, once. On the new session the downloader issues exactly what the records still owe —
the fill's remainder as a run, any outstanding ask again. Frames delivered, decoding or queued for a
decoder are untouched: **nothing that arrived is re-fetched or re-decoded**, which is why resumption
sits behind the records rather than behind a session-level retry. **The request's generation does not
change** — a resume is the same request, and bumping it would drop frames inside a decoder; a session
**epoch** private to the worker fences the dead session's callbacks, and the page learns only when each
resume happened, as `stats().resumedAt`.

Deadlines `{ stallMs: 3000, redialMs: 1000, tries: 5, dialMs: 5000 }`; `survival: false` turns it off,
an object overrides them; nothing runs when nothing dies. **`tries` bounds the dials in one resumption,
not the resumptions**: a dial onto a path that still carries nothing leaves the fill quiet and the cycle
restarts after the doubled wait; a network that is genuinely down refuses the dial, which `tries` ends.
Six dispatch clauses hold it, each mutated and seen to fail.

### The measurement this owes

**The cut** (`link_impair.py`'s `cut`) blackholes the client port the session is on for good and
rebinds its own upstream port: the old path gone, a new one working, **and nothing telling the
client**. A blackout is not this — the same path comes back and QUIC recovers by itself. Method:
[`../lab/session-survival/README.md`](../lab/session-survival/README.md). 428 KB frames at 20 Mbit, a
fill of 80 cut after 12, **7 rounds**, arms interleaved; `today` is `survival: false` plus a page that
re-asks for everything missing the instant the fill is reported gone — a generous baseline. Median
[min … max] ms from the cut:

| arm | noticed | first frame after the cut | fill completed | frames failed |
| --- | --- | --- | --- | --- |
| `today` | 6 552 [6 539 … 6 558] | 6 745 [6 740 … 6 758] | 7/7 | **476** (68 a round) |
| built, probe design | 5 010 [4 996 … 5 023] | 5 191 [5 172 … 5 216] | 7/7 | 0 |

*Superseded in place:* the built row is the retracted probe; by the bytes the cut is noticed at
**3 016 ms**. What stands: **the resume costs ~180 ms**, a dial and a frame; detection is the deadlines
and nothing else; today the fill **fails** with every owed frame named, built it **completes by
itself**. A shorter `stallMs` is not a default — it must outlast the longest legitimate gap between
frames (428 KB at 1 Mbit is 3.4 s); a wait derived from the fill's own pace is not built. The platform
triggers are covered by clauses, not by this campaign.

### A dial that never settles

WebKit bug 319879 (Safari 26 on macOS): the server answers the CONNECT with 200 and `ready` never
settles. **Not WebKit's alone**: `exact-server --hold-sessions`, a lab flag, takes each CONNECT and never
answers, and a bare `new WebTransport`, the TS and WASM clients and the downloader all stayed pending
past 180 s in Chromium 141 ([`../lab/dial-deadline/`](../lab/dial-deadline/README.md)) — neither
Chromium nor QUIC's idle timeout ends it. An overloaded server that stalls a CONNECT does the same.

**The deadline.** The TS and WebSocket clients take `dialMs`: a dial whose `ready` has not settled is
closed and rejected as a `DialTimeoutError`. The downloader passes 5 s — two lost handshake flights,
derived, not measured — and retries `tries` times, the first dial included; a dial refused outright is
reported at once. **Chrome's `close()` on a connecting dial rejects `ready` at once**, so the deadline
must reject before it closes; the fake transport rejects the same way. Against the held server the
downloader fails at **29.1 s**, five dials 1 s apart, naming the deadline. Not built: `dialMs` in the
WASM client.

### Resumption and 0-RTT

**The server resumes already** — rustls's defaults, two TLS 1.3 tickets a handshake, no 0-RTT; the
native client was resumed 21 of 21 times ([`../lab/scripts/client_hello.py`](../lab/scripts/client_hello.py)
decrypts each Initial) — **and resumption buys no round trip**: the flights are the same, only the
certificate drops (native, 7 rounds: 85.2 against 85.0 ms ready at 40 ms, 165.8 against 165.3 at 80).
**Chrome never offers a PSK on a WebTransport dial**: none of 216 dials in Chromium 141
([`../lab/session-resume/run.mjs`](../lab/session-resume/run.mjs)) — same page, new page, pinned hash or
CA-signed certificate, against a server accepting early data — carried `pre_shared_key` (inferred: no
session cache in its WebTransport client). **So nothing changes in the server.** 0-RTT would need the
server's early data, a `wtransport` that accepts a session before its handshake, and a browser that
sends it, for one round trip off a re-dial (derived). Every client message is a read, so it would be
safe until the URL carries a credential. Revisit when Chrome resumes WebTransport sessions.

**Careful Resume — a remembered congestion window for the reconnect — is not recommended.** It is
reachable (an `accept_with` in the settings-early patch, keyed on a server-issued token in the URL, not
on an address a carrier NAT shares), but **the push at open recovers the same slow start with no saved
state**: a first ask of 250 KB at 80 ms, 7 rounds, takes 461.6 ms fresh, 104.6 warmed, **130.1 with the
push**, 134.0 jumping to half the warmed window, 112.7 with both; behind a 10 Mbit, 20-packet queue the
push reaches the ceiling alone (313.7 against 302.8) and the jump is 38 % slower than it. "Jump"
approximates Careful Resume with no pacing, validation or retreat. What would reopen it: reconnects
with nothing to push, a bottleneck the push cannot fill in one burst on the target link, and a real
Careful Resume arm in that cell.

### A fill outlasts the screen lock

A 61 MB fill at 20 Mbit is 24 s; a phone locks well inside that, and a frozen page runs nothing. **Not
built, not measurable here**: a screen wake lock held only while a fill runs, and a deliberate close on
`freeze` with a re-dial on `resume` / `pageshow`, so the session dies on the client's terms with its
records intact — without the wake lock, which the platform may refuse. Chromium keeps no page with an
open WebTransport session in the back/forward cache (read, not measured).

## The TCP fallback

WebTransport needs UDP. Some networks impair it — Chrome's field data puts it near 5 % — and some
browsers have no WebTransport. **A WebSocket carrying the same envelopes is built, off by default**, as
completion of the implementation, not a performance claim.

**How fast a client knows** (`lab/scripts/udp_reject_time.mjs`, headless Chromium, 6 rounds
interleaved): a port answering ICMP unreachable rejects the dial in **2 ms**; a socket that swallows the
datagram in **4 004 ms**, Chromium's handshake timeout, not configurable from the page. A network that
impairs UDP drops rather than answers, so the realistic cost is **four seconds of blank viewer**.

**iOS.** WebKit bug 319818 (open): a WebTransport connection stalls after 16 MB because flow control
never refills, so a 61 MB fill would freeze **on every iPhone, on a good network** — read from the bug,
not reproduced. Recycling the session before 16 MB and re-issuing, which §Re-dial and re-issue makes
ordinary, would keep QUIC there; **nobody has measured what recycling costs**, and it is the cheaper
experiment.

**What TCP gives up**: independent streams, so a slow frame blocks every frame behind it
([`adr-stream-shape.md`](adr-stream-shape.md)); loss recovery per stream; the idle behaviour measured
for QUIC; `stream_frames` as the same protocol. A degraded viewer beats none, but the conformance
clauses about independent delivery are marked not applicable on it rather than green.

### Race it

**Open both and use whichever is ready first**, then drop the other: one extra connection attempt per
open against the four seconds, paid otherwise by exactly the users the fallback is for. The rejection
time above records the cost of not racing; no client should depend on it.

### What was built

The frame path, the store and the planner are untouched; the wire mapping is [`WIRE.md`](WIRE.md).

* **Server** (`server/src/transport/websocket.rs`, `--websocket`): TCP on the QUIC port's number, the
  same certificate, `TCP_NODELAY`; `FrameOut::WebSocket` beside `Shared` and `PerFrame`, refusals
  through the same writer; one process serves both. Without the QUIC knobs, the `session path` line,
  telemetry rows, or the URL's opening ask (the fill is the socket's first message, a round trip later).
* **Client**: `client/transport-ts/frame-session.ts` is everything a session does whatever carries its
  bytes; `session.ts` and `ws-session.ts` are carriers over it, and the downloader takes either as
  `transport`. `race-session.ts` (opt-in) dials both, keeps the first ready, closes the other when its
  dial settles, and sends an opening fill to the winner alone.
* **Conformance**: every clause runs against the WebSocket client, with the per-frame halves of two
  clauses and *a frame slow on its own stream holds no other* listed as not applicable; four race
  clauses (QUIC first, TCP first, QUIC refused, the opening fill); `run_wire.sh` runs refusals and an
  ask during a fill over the WebSocket, raw and through the downloader.
* **The loopback smoke** ([`../lab/tcp-fallback/`](../lab/tcp-fallback/README.md)): every frame
  bit-exact over WebTransport, WebSocket and the race, 3 rounds interleaved. No performance claim
  ([`rig-limits.md`](rig-limits.md) §3). **On loopback the WebSocket wins the race**, 57–58 of 60 dials:
  with the round trip near zero the handshakes' work decides. On a link TCP + TLS + upgrade is three
  round trips against QUIC's 2.1, so QUIC should win by one — not measured.

**Before it is enabled anywhere**: a device check of the iOS stall and of recycling. **What the shaped
A/B on the workstation should measure**, arms interleaved: (1) a fill's wall time and per-frame
inter-arrival p99, WebTransport against WebSocket, at 40 and 80 ms, clean and at 1 % / 3 % loss — the
p99 is where head-of-line blocking shows; (2) an ask during a fill, which waits behind QUIC's send
window or TCP's socket buffer, not the same size; (3) each dial's time to ready and which one the race
keeps at each round trip — if TCP wins short links, QUIC wants a head start; (4) on a network that
drops UDP, the race's time to ready against the four seconds.

## Open

* **Adoption.** The browser campaign against the baseline on this head; removing the harness's path
  follows it.
* **The decoder count**: `min(3, hardwareConcurrency)` or a pool that follows the queue, neither the
  default (§The decoders); a phone's scheduler (efficiency cores) and decode speed.
* **The reader pause** that bounds the compressed queue (§The downloader) — not built.
* **Coalescing decoded frames across decoders** — a merge point for ~10 ms of a throttled fill's main
  thread: design it or drop it, the owner's call (§The hand-off).
* **An out-of-band cancel** that drops work already queued to a decoder — only if a phone shows a
  decode long against a switch.
* **One preallocated shared store per fill** in place of a `SharedArrayBuffer` per frame — estimated
  ~0.2–0.3 ms a frame, not run.
* **The cache seam** (an interface, in-memory and OPFS behind it; whether it holds compressed or
  decoded frames is to be evaluated — and "all frames decoded" cannot mean all resident on a phone) and
  **the paint sink** — neither built. An OPFS cache must be evictable on WebKit ([`CLIENTS.md`](CLIENTS.md)
  §On WebKit).
* **Survival on a device**: the Wi-Fi → cellular freeze and what the page sees; the triggers where a
  radio change and `freeze` are real; the screen-lock pair; whether 5 s suits a dial on a phone.
  Detection of a dead *idle* session with a server idle timeout below 30 s is not measured.
* **Lever 1 as a default** (a non-contiguous first fill; a host other than this box's relay), and **the
  TCP fallback** (the device check before enabling, the recycling cost, the shaped A/B).

## Looked at and dropped

Read, not measured, unless it says so: a `SharedWorker` holding the session (no shared memory);
transferable streams (add a hop, chunks cross a port); posting one compiled module to the workers (the
engine already shares a compile per process); cheaper `postMessage` shapes and `scheduler.postTask`
for ingest (the crossing is not what binds, §Under a throttled CPU, and WebKit has no `postTask`);
`sendOrder`, `getStats`, `congestionControl` (absent in Chrome); textures as the frame cache (0.34 ms a
paint for GPU memory lost on backgrounding); WebGPU for paint (nothing WebGL2 lacks here).
