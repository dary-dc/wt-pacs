# Proposal: one downloader worker

**2026-09-16 · Status: approved for investigation, not accepted.** Supersedes
[`proposal-decode-in-the-harness.md`](proposal-decode-in-the-harness.md), which put the decode pool on
the main thread — one of the layers this removes. Built by cloud agents in stages (§Stages); adopted
only if §Capabilities holds on the new path and a browser campaign on the workstation does not lose on
any figure.

## Why

A browser consumer built from today's surface ends up with two orchestrators — one on the page, one
in a receive worker — and a frame that crosses more layers than its job needs. Measured on the
workstation, per frame of a fill:

* **four messages**, and the pixels cross **two** threads: decoder → receive worker → page;
* the page **asks for each frame** of a fill it already asked for, so a decoded frame waits in the
  worker until the ask arrives;
* a **waiter per frame** in the session and a promise per frame above it, for frames that arrive in
  order on one stream anyway;
* the compressed bytes **go back to the page only to be counted**;
* per-sample work — sign extension, and a full scan for the sample range — **on the main thread**;
* while a fast fill lands, the page's main thread is busy taking it in, and **painting a frame
  already in the cache waits several hundred milliseconds**.

Each layer was added so the one above it would not change. The fix is to stop doing that.

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
consumer over a port the downloader hands out. Every decision — what to fetch, which decoder, what to
drop — is the downloader's. The consumer never talks to a decoder.

Measured (L13, [`thread-hops.md`](thread-hops.md), container): relaying through the receive worker
costs ~0.1–0.2 ms while it is quiet and becomes unbounded — up to tens of milliseconds — while it
reads; the direct port stays under 0.3 ms throughout, better in 5/5 rounds at every size from
512 KB. A frame posted without listing its buffer is the expensive case at any route: an 8 MB
series costs the page's main thread 1.34 s cloned against 17 ms transferred.

## Messages

| to the downloader | fields |
| --- | --- |
| `start` | url, cert hash, config — and, optionally, `fill`: the first fill's frame indices |
| `fill` | frame indices |
| `ask` | one frame index |
| `cancel` | — |
| `close` | — |

| to the consumer | fields |
| --- | --- |
| `frame` | index, generation, pixels, width, height, bits, components, signed, min, max, byte count, stamps |
| `failed` | index, generation, reason |
| `cancelled` | generation |
| `closed` | reason |

Stamps are epoch milliseconds (`timeOrigin + now`), converted once by the consumer: ask, first byte,
last byte, dispatched, decode start, decode end.

**A request's identity is its generation, not its frame index.** *Amended 2026-09-20 (P1).* `cancel`
bumps a counter the downloader owns, and every record, decode, decoder reply and delivery to the page
carries the generation it was made under; anything older is dropped where it lands. Without it a
frame decoded for a cancelled request was handed to the consumer under an index the *new* request was
using — the right key with the wrong pixels, which is the bit-exact guarantee — and a late `done`
deleted the new request's record, so its own frame arrived with nothing to put it in and was dropped.

**The decoders are not told, because telling them would do nothing.** A `cancel` posted to a decoder
queues behind the decodes already posted to it, so it cannot stop them; what a cancel wastes is at
most `decoders × perDecoder` frames, which is what the dispatch bound already holds. What matters is
that the result is not taken for the new request's, and the generation on the reply is that.
An out-of-band signal a decoder could read before each frame — a flag in a `SharedArrayBuffer` — is
the only shape that would drop queued work; it is worth its complexity only if a decode is long
against a switch, which the phone measurement would say.

**`want()`'s bare index is not one of these places**, though the sweep read it as one: `cancel`
clears `records`, so an index `want()` skips is always one the *current* request already has on the
wire or in hand.

## The downloader

* **Started by the page at load**, before anything else runs, with the URL of its config. It fetches
  the config, dials, and holds the session. Holding an idle session open is the server's keep-alive
  (`docs/transport/adr-idle-sessions.md`).
* **One record per frame:** not asked, on the wire, waiting for a decoder, decoding, delivered. An
  ask for a frame already in flight moves it up the queue instead of asking the wire again.
* **One queue, two priorities.** Asks before fill frames. Dispatch never leaves a decoder idle: up to
  two outstanding per decoder (`docs/decode/README.md` §Dispatch). `N` is a start parameter; the
  comparison campaigns use 3.
* **Fill frames are pushed by the session** (Stage 3), on the wire as `stream_frames`, one
  contiguous run of what is still wanted at a time. Asks keep their waiter. On the wire an ask
  ends a fill with no saved position (L16), so once an ask settles the downloader re-issues the
  frames not yet delivered as a new fill — the client owns that decision, the server stays as it
  is. An ask for a frame the fill still owes goes to the wire, where the server serves it next;
  one already in hand only moves up the decode queue.
* **The reader pauses, and that is the whole memory bound.** *Amended 2026-09-19 (P1, from
  [S15](improvements/2026-09-18.md)).* Today the compressed-frame queue is bounded only by the
  study — 61 MB for the usual one, gigabytes for a large series, all of it resident before a
  decoder has taken it. Instead: once queued compressed bytes pass a bound, the downloader stops
  reading its stream. QUIC flow control then stops the server, **with no server-side cap and no
  new message** — the back pressure is the transport's, which is what it is for.
  **This deletes M3's fill-window protocol** rather than implementing it: that window existed to
  stop a waiter being allocated per frame, and D3 already removed the per-frame waiter when fills
  became pushed. What must not be lost is cancellation, which M3 also carried and which is
  independent — it stays, as the `AbortError` row below.
* **Closure:** outstanding frames fail with the session's reason, as today; the next command re-dials.
* **Cancel:** end the stream, drop queued work by generation, fail outstanding asks with an
  `AbortError` distinct from the timeout. The reason's name is pending confirmation before adoption.
  *Amended 2026-09-20 (P1).* It also **resets the count of asks in flight** — that count is what
  gates the fill, so one left over from the cancelled request stalls the next fill to the consumer's
  15 s timeout — and answers `cancelled`, which `DownloaderClient.cancel()` returns as a promise. The
  page rejects its own waiters when it posts the cancel, which is what the `failed`-per-record the
  worker used to post was for, and is one message per cancel instead of one per outstanding frame.

**The first fill rides with `start`.** *Amended 2026-09-19.* `DownloaderClient.connect(url, hash,
{ fill })` puts the indices in the `start` message, so the downloader records them before it
dials and the page is out of the fill's path. Without it the page must wait for the `started`
message and then post `fill` — and a message cannot be delivered into a running task, so a main
thread inside a third-party viewer's ~280 ms boot does not post that fill until the boot ends.
Leaving `fill` out is exactly today's behaviour.

**Why the wire may run ahead of the decoders, and dispatch may not.** Issuing a fill needs a
session and nothing else; handing a frame to a decoder needs a decoder that holds its instance.
Those were one condition (`decodersUp` on `issueFill`) and are now two: the guard moved to the top
of `pump()`, so frames that land before a decoder exists sit in the queue with their bytes and go
out the moment `decodersUp` flips. Left as one condition the fill waits for the decoders; removed
altogether a frame reaches a decoder that does not exist yet and is lost. The dial is memoised for
the same reason — `start` carrying a fill and a command behind it must share one handshake — and
`connect()` alone issues the first run, since a second `issueFill()` after the dial put the same
`stream_frames` range on the wire twice.

**The dial no longer queues behind the decoders.** *Amended 2026-09-19 (D2d, from
[S6](improvements/2026-09-18.md)).* `start()` awaited every decoder's instance before it dialled,
so the handshake was paid after decoder start-up rather than beside it. They now start together
and **dispatch** is what waits on decoder readiness, which is what the ordering was protecting.
Measured on loopback, medians of 4 interleaved rounds: start-to-dialled **58 → 52 ms** on the TS
client and **70 → 57 ms** on the WASM one, and the WASM client's penalty over the TS one falls from
12 ms to 5 — the dial now overlaps the larger bundle instead of following it. **Loopback is the
floor for this**: a handshake costs ~0 here and four round trips on a real link
([`proposal-session-open.md`](proposal-session-open.md)), so the saving there is a whole handshake,
not 6 ms. `run_downloader.sh` 46/46 and `run_dispatch.sh` 19/19 still pass.

## The decoders

**Amended 2026-09-19 (P1, from [S12](improvements/2026-09-18.md)): the pool follows the queue, it
is not sized from the device.** A pool sized from `navigator.hardwareConcurrency` is sized for the
machine, and on the target the machine is not what sets the pace — the link is. Arithmetic: at
20 Mbit a cine frame needs 0.34 of a desktop decoder, and at a phone's ~2.5× slower decode still
only ~0.86. **One decoder keeps up with a 20 Mbit link on every fixture in `lab/fixtures/`.**
A pool sized from core count therefore buys nothing on the target and costs two workers and two
50 MB heaps ([`decode/README.md`](decode/README.md) §Heap).

So: **start at one decoder; add one while the decode queue has stayed non-empty across a
dispatch; retire one that has been idle for a grace period.** The pool ends at one on a link that
one decoder covers and grows only where the link outruns it — a fast link, a small frame, a slow
phone. This narrows the pool. It says nothing about decoder *width*: a multithreaded decoder is a
separate question ([`decode/README.md`](decode/README.md) §Threads).

**What it must not lose:** the capability rows below, unchanged, and the two dispatch clauses
`run_dispatch.sh` already asserts — asks served before fill frames when both wait for a decoder,
and never more than two frames outstanding per decoder. A pool that resizes must keep both while
resizing, which is the part worth testing: the bound is per decoder, so it moves when the pool
does.

**Decided by** a container under a rate limit and a CPU throttle, then a phone. Not by this file.

* One decoder object per worker, reused — **only if** `lab/decode-bench/parity.mjs` stays
  byte-identical on every fixture; otherwise one per frame, as today, and say so.
* Pixels written once, into a `SharedArrayBuffer`. That requires cross-origin isolation; the page
  asserts `crossOriginIsolated` at start rather than falling back to a copy.
* Sign extension for signed samples stored in fewer bits than they occupy, and the sample range, in
  the same pass.
* `frame` goes to the consumer; `done` (id, byte count) goes to the downloader. The compressed buffer
  stays in the downloader's worker.

## The consumer

Here, the harness: take each frame, check it against the fixture's `.sha256`, record it with one call.
For any consumer, one rule: frames that were asked for are taken at once, fill frames at background
priority, so a paint never waits behind a fill.

`DownloaderClient.connect(url, certHash, { onFrame, onError, fill, … })` →
`requestExactFrame(index)`, `fill(indices)`, `cancel()`, `stats()`, `close()`. *Amended 2026-09-20
(P1):* every delivered frame carries its `generation`; `cancel()` returns a promise that resolves
when the downloader has ended the stream and dropped that request's work; and
`onError({ frameIndex, reason, generation })` is how a refused **fill** frame reaches the consumer.
A refused *asked* frame still rejects its own promise — a fill frame has no waiter to reject, which
is why it reached nobody before.

## Capabilities

Nothing is removed until every row passes on the new path. Stage 1 fills the middle column against
today's path; Stage 4 fills the last.

Stage 1 filled the middle column on 2026-09-16. **conformance** is `client/conformance/run.mjs`,
which runs every clause against both implementations and is in `scripts/gate.sh`; **server** is
`cargo test -p exact-server`. Clauses marked *new* were written for this stage and are
mutation-checked — §S1 results below. Stage 4 filled the last column the same day, from what
D2–D3 built: "on the downloader arm" is `client/conformance/run_downloader.sh`, "dispatch" is
`run_dispatch.sh`, both in the gate. One row was **not shown** on the new path until D2d closed it (2026-09-19); the other still says so.

| capability | today | downloader |
| --- | --- | --- |
| connect, single ask, fill; shared and per-frame stream modes | conformance `workerSafe`, `cancellable`, **`bothStreamModes`** *(new)*; server `stream_frames_range_arrives_in_order`, `a_batch_arrives_whole_and_in_ask_order` | conformance `workerSafe`, `cancellable`, `bothStreamModes`, **`pushedFill`** on the downloader arm (D2b, D3); `client/harness/downloader.html` against the real server, 12/12 byte-identical (D2) |
| a fill cancelled mid-way, the session still serving afterwards | conformance `cancellable` — incl. "the session still serves a frame after a cancel"; server `end_stream_stops_a_fill_on_the_wire` | conformance `cancellable` on the downloader arm; the harness's "cancel: the session still serves frame 5" (D2); and, since P1, dispatch `lateFramesOfACancelledRequestAreDropped`, `aLateDoneDoesNotDropTheNewRequestsFrame`, `cancelCompletesAndUnblocksTheNextFill` — §P1 results |
| a closed session noticed at once, waiters failed | conformance `noticesClose` | conformance `noticesClose` on the downloader arm — an in-flight ask is woken at once; an ask after the closure re-dials and is served (its own contract) |
| a frame on a live session still owed its full timeout | conformance `noticesClose`, last check | conformance `noticesClose`, last check, on the downloader arm |
| refusals delivered, none lost (`client/harness/refusals.html`) | `refusals.html` headless against a real server, **in the gate** (`client/conformance/run_wire.sh`, D1r): 64 refusals back to back, none lost, both clients, mutation-checked; server side `a_bad_range_is_refused_with_from`, `an_empty_study_is_refused_with_from`, `fod_len_zero_and_huge_are_refused_before_allocation` | **green, P1 2026-09-20.** A refused *ask* reaches the consumer with the server's reason (the `failed` path), and a refused *fill* now reaches it through `onError`: dispatch `aRefusedFillReachesTheConsumer` refuses a run at its first frame and reads every frame of it back on the page, and checks a refused ask still rejects its own promise instead. Found by D1r; the fake gained `pushRefusal`, the control-stream push it had no way to make |
| worker-safe clocks; transferable results | conformance `workerSafe`, `transferable`; `client/scripts/check_worker_safe.sh` | conformance `workerSafe`, `transferable` on the downloader arm: stamps that cross two worker boundaries are non-zero and ordered; a delivered buffer is movable and takes no sibling. Move-not-copy *across* the worker boundary is not page-observable (§S3 results) |
| `stats` | conformance **`reportsStats`** *(new)* | conformance `reportsStats` on the downloader arm — answered on the page, no round trip |
| an ask during a fill, served before the fill's queue | `client/conformance/ask-during-fill.html` against a real server, **in the gate** (D1r): the ask is served mid-fill, the fill ends — 28 of 120 arrive, then nothing — and the rest arrive only once asked again, which the raw client does not do by itself; server `a_data_request_during_a_fill_ends_it_and_is_served_next`, `request_frame_during_fill_switches_to_on_demand` | the same page, `arm=downloader`: the ask is served and the fill completes without being asked again, no frame twice — D3's re-issue on the real wire; dispatch `askBeatsQueuedFill`, `promoteBeatsQueuedFill`, `asksTheWireForAnOwedFrame`, `reissuesAfterAsk`; priced at 10 %, 50 % and 90 % in §Results |
| a session opened at load, first ask served without a dial | conformance **`oneDialServesLaterAsks`** *(new)* | conformance `oneDialServesLaterAsks` on the downloader arm |
| re-dial after closure | conformance **`redialsAfterClosure`** *(new)* | conformance `redialsAfterClosure` on the downloader arm, and the redial branch of `noticesClose` |
| 8-bit multi-component, 16-bit unsigned, 16-bit signed with sign extension | `parity.mjs` covers 8-bit 3-component and 16-bit unsigned over 388 frames, and since F1 **16-bit signed and 12-bit signed, 87 frames each**, against ground truth an independent decoder confirmed (`docs/decode/README.md` §Ground truth, *Signed*); the source build's signed clamp was wrong and is fixed | 8-bit 3-component: `downloader.html`, byte-identical (D2). 16-bit unsigned and signed: the decoder the downloader runs is the package, which `parity.mjs` proves on all of them and which sign-extends 12-in-16 itself, so `decoder.js`'s `finish` is idempotent on it. Not yet run *behind* the downloader on a signed study — the harness decodes c512 only |
| every decoded frame byte-identical to the fixture's `.sha256` | `parity.mjs` (388 frames), `lab/decode-bench/retained/` (120 cells), `decode_bench.mjs` | `downloader.html`: single ask and a 12-frame fill, every frame against the encoder's input; mutation-checked both ways (D2) |
| both clients, TS and WASM, behind the same downloader | every conformance clause runs against both arms — and since 2026-09-18 the gate **requires** `client/transport-wasm/pkg/` rather than skipping the arm | **green, D2d 2026-09-19.** `client/transport-wasm/session-adapter.js` exports `TransportSession` over the package's `TransportSessionHandle`; `lab/scripts/downloader_both_clients.sh` runs the real downloader over each client against a real server. Single ask byte-exact on both, fill a tie (120 / 125 ms), start+dial 52 / 57 ms |

### S1 results

The suite went from 34 checks to **58, green on both arms**. Four clauses were added, and each was
broken on purpose to prove it reports:

| mutant | caught by |
| --- | --- |
| `stats` always reports nothing in flight | `reportsStats` — 2 checks |
| only the first frame of each uni stream is read | `bothStreamModes` (both modes) and `transferable` — 4 checks |
| a closed session's reason is shared, so a re-dial is born closed | `redialsAfterClosure` and 6 others |
| `connect` makes a probe dial before the real one | `oneDialServesLaterAsks` — 2 checks |

**A weakness in the suite itself, fixed.** `transferable` awaited its frames raw, so the second
mutant above took the whole process down at `FRAME_TIMEOUT_MS` — 15 s, no checks counted, no
failure named — instead of reporting. Every frame wait is now bounded (`within`), so a frame that
never arrives fails its own check by name. The first version of the new clauses had the same fault
and the same mutant found it.

**Three rows were not green on 2026-09-16 morning; D1r closed two that evening** (§Against the real server in `proposal-conformance-suite.md`). As found:

* **Refusals** have a browser page and no gate test. The page is real and passes by hand; nothing
  runs it in CI, so the row rests on a manual step.
* **An ask during a fill** is proven on the server and nowhere on the client. L16 measures what it
  costs; no test asserts the client gets it.
* **16-bit signed could not be tested that morning** — no signed fixture, and none makeable with
  the encoder's `-signed true` path, which saturates negatives before coding. **F1 closed it the same
  day:** the fixture is made by encoding unsigned and setting the sign bit in SIZ, with ground truth
  an independent decoder confirmed (`docs/decode/README.md` §Ground truth, *Signed*). The
  disagreement recorded here at the time — "the package saturates negatives, the source build does
  not" — was read off codestreams the encoder had already damaged and was the wrong way round: the
  package was right, the source build's clamp was wrong, and is fixed. `parity.mjs` now says what it
  covers.

## Stages

Each stage is a queue row. Code goes on the agent's own branch, never onto the queue's branch.

**S1 — capabilities, before any code.** For every row above, name the test that proves it on today's
path, or write it — mutation-checked, reported. Rows that cannot be tested without a browser run in
headless Chromium. Done when the middle column is full and green.

**S2 — the downloader.** Worker, decoders, messages, per-frame record, two-priority queue, direct
pixel ports, decoder-side sample work, cancel. Built beside today's path as a new harness arm; nothing
existing is removed. Uses today's `startExactFrames` / `waitExactFrame`. Done when S1's tests pass
against it.

### S2 results

Built and running on `claude/downloader-s2-worker`: `client/downloader/` (worker, decoders,
consumer) and `client/harness/downloader.html`, beside today's path with nothing removed.

Against the real server and 12 real HTJ2K frames, in headless Chromium, cross-origin isolated:

```
started, dialled and decoders up in 59 ms
single ask   frame 3: 512x512x3 8-bit signed=false range 39..212 786432 B  sha ok
             pixels arrived in a SharedArrayBuffer: true
fill 12:     12/12 frames in 113 ms, every frame byte-identical to the fixture
stamps:      ask→lastByte 4.34 ms, dispatch→decodeEnd 29.70 ms, all non-zero and in order: ok
cancel:      the session still serves frame 5 afterwards: ok
re-dial:     a session opened after a closure serves frame 1: ok
```

Mutation-checked: perturbing one decoded sample turns every `sha` line to `MISMATCH`, and dropping
every fifth frame makes the fill report 9/12. A decode arm whose ground-truth check does not fire
is worth nothing, so both were run.

**D2b closed what S2 owed (2026-09-16): the clauses drive this arm.** The clauses live in
`client/conformance/clauses.ts` against a rig; `fake-session.ts` is the module `config.transport`
names, evaluated inside the downloader's worker, where it installs the fake `WebTransport` and
answers the page over a `BroadcastChannel`. `client/conformance/run_downloader.sh` runs every
clause against the downloader in headless Chromium — **35 checks, green** — and `scripts/gate.sh`
runs it, skipping loudly without Chromium. Two clauses read from the rig what this arm does
differently by design: its fill sends `request_frames`, and an ask after a closure re-dials and
is served (§The downloader) where the raw sessions fail it. Mutation-checked clause by clause —
stamps zeroed, `end_stream` dropped, frames sharing one buffer, closure never noticed, a
swallowed failure, a dropped delivery, lying `stats`, a dial per command, a cached client, and
the fake left uninstalled: each fails its checks by name and the suite still completes. One
limit, found by a mutant that *passed*: a dropped transfer list arrives as a clone that still
detaches, so move-not-copy across the worker boundary is S4's metric, not a clause here.

**D2c asserted two of the three (2026-09-16):** the priority *ordering* under contention and the
two-outstanding-per-decoder bound. `client/conformance/dispatch-rig.ts` drives the downloader
against a **stalling** decoder (`fake-decoder.js`) so the queue backs up on purpose — contention
forced, not waited for — and reads the order each frame started (`decodeSeq`) and the most a
decoder ever held (`maxInFlight`) back off every frame. Three clauses, **9 checks green in the
gate**: a fresh ask starts right after the frames in flight and before the queued fill; an ask for
a frame *already* in the fill is promoted (not re-asked) and does the same; and no single decoder
ever holds more than `perDecoder`, proven with one decoder and again per-decoder with two.
Mutation-checked: a fill-first queue, a `promote()` that does nothing, and a raised outstanding
cap each fail their clauses by name. `config.decoderWorker` is the seam that made this possible,
a decoder analogue of `config.transport`. **Still unasserted:** sign extension — it cannot be
asserted at all until there is a signed fixture (`cloud-queue.md` §Blocked).

### P1 results — the cancel and refusal paths

2026-09-20. Four clauses in `dispatch-rig.ts`, **29 → 43 checks green in the gate**: a frame decoded
for a cancelled request is dropped rather than delivered under the new request's index; that
request's late `done` leaves the new record alone, so the new frame still arrives; `cancel()`
completes, aborts the asks it dropped and frees the count that gates the fill, and a late settlement
of a cancelled ask does not leave a fill free to run beside a live one; and a refused fill reaches
the consumer through `onError` while a refused ask still rejects its own promise. The fake gained
`pushRefusal`, the control-stream push it had no way to make, and `client/harness/downloader.html`
dropped a 300 ms sleep for `await c.cancel()`.

| mutant | caught by |
| --- | --- |
| the page's generation guard on a delivered frame removed | `lateFramesOfACancelledRequestAreDropped` — 3 checks, incl. the cancelled request's bytes under the new request's key — and `aLateDoneDoesNotDropTheNewRequestsFrame` |
| `onDone` deletes by index with no generation check | `aLateDoneDoesNotDropTheNewRequestsFrame` — 2 checks; the new frame is dropped in `arrived()` for want of a record |
| `cancel` does not reset the count of asks in flight | `cancelCompletesAndUnblocksTheNextFill` — 2 checks: nothing after `end_stream` on the wire, no frames |
| `cancelled` is never posted | `cancelCompletesAndUnblocksTheNextFill` — `cancel() completes` |
| a refused fill frame reaches nobody again | `aRefusedFillReachesTheConsumer` |
| `onError` fires for an asked frame as well | `aRefusedFillReachesTheConsumer`, last check |
| the ask count decremented across a cancel | `cancelCompletesAndUnblocksTheNextFill`, last check |

**One guard has no clause, and is recorded rather than claimed.** The page also drops a `failed`
stamped with a superseded generation. A failure is only ever posted with the worker's *current*
generation, so the only window is the page's `cancel()` racing the worker's — and no deterministic
clause opens it, because against the fake every await on that path resolves in microtasks. The
mutant that removes that guard passes. It is kept because one rule — anything older is dropped
where it lands — is easier to hold true than the same rule with an exception.

**S3 — fills pushed.** Both clients deliver a fill's frames as they arrive instead of through a waiter
per frame; the conformance suite covers the new form against both implementations. The downloader
switches to it. Report lines removed against lines added.

### S3 results

Built on `claude/downloader-s2-worker` (2026-09-16). Both clients gained the fill as a **push**:
`fillFrames(from, to, onFrame, onError?)` — `stream_frames` on the wire, every owed frame straight to
the callback as it lands, no waiter and no timer per frame, `endStream()` or a later fill dropping
the rest (`CLIENTS.md` §Fills are pushed). The downloader switched to it: one contiguous run of what
is still wanted at a time, the remainder re-issued once an ask settles, and an ask for a frame the
fill still owes sent to the wire rather than waited for.

**Why `stream_frames`, and not the `request_frames` the downloader used to send.** The planner turns a
`request_frames` batch into one `Ask::Frame` per index and serves them in order, so an ask behind a
200-frame batch waited for all 200; a `stream_frames` fill is dropped the moment an ask is in hand
(L16). The pushed fill is what gives an ask the wire.

**Checks.** Conformance clause `pushedFill`, both stream modes, both clients and the downloader arm:
**84/84** in Node (was 62), **46/46** on the downloader arm (was 35). Two downloader clauses in
`dispatch-rig.ts`, `reissuesAfterAsk` and `asksTheWireForAnOwedFrame`: **19/19** (was 9). What they
assert is the wire sequence — `stream_frames 0-7`, `request_frame 50`, `stream_frames 4-7` — because
the fake cannot drop a fill the way the server does; against the fake a fill "completes" either way,
so completion alone proves nothing there.

| mutant | caught by |
| --- | --- |
| TS: `deliver` never routes to the fill | `pushedFill`, both modes — nothing lands |
| TS: `endStream` keeps the fill | `pushedFill` — the late frame is pushed |
| TS: the fill wins over an ask's waiter | `pushedFill` — the ask is pushed and its promise starves |
| WASM: the guard inverted (`!owed`) | `pushedFill` on the wasm arm only — strays pushed, owed dropped |
| downloader: no re-issue after an ask | `reissuesAfterAsk`, `asksTheWireForAnOwedFrame` — no second run on the wire |
| downloader: delivered frames never retired from `wanted` | both — the re-issue repeats `0-7` |
| downloader: any known record promoted, never asked | `asksTheWireForAnOwedFrame` — no `request_frame` |

The WASM mutant first "passed" — against a pkg that had not rebuilt, a `cargo build` failure hidden
behind a `tail`. The pkg's timestamp gave it away; the row above is from a build whose exit code was
read. A mutant that passes is a finding about the rig before it is one about the test.

**One honest loose end.** In one full gate run the dispatch arm reported 16/17 — a clause threw
before its checks — and the gate's `| tail -2` swallowed the line that named it. Eleven serial runs
since, and two more gates, have passed 19/19, so no mechanism was established. Two things changed
because of it, not one: `drive_downloader.cjs` now echoes every `FAIL`/`threw` line on stderr, so
the gate can no longer hide a name; and `dispatch-rig.ts` bounds `open()` at 5 s, the one await on
that path that had no bound. Worth knowing if it recurs; not worth believing as a finding.

**Lines removed against lines added.** The downloader lost the promise per fill frame and the
`waitExactFrame` loop and gained run-splitting and the re-issue: −24 / +67. TS session −8 / +50;
WASM session −15 / +93 (its two media pumps now share one `deliver`), `lib.rs` +13. The
waiter-per-frame forms — `startExactFrames` / `waitExactFrame`, `startStreamFrames` — stay: the
harness, `refusals.html` and the recorder use them, and removing today's path follows acceptance
(§Not in this proposal). Net, the pushed fill is **more code, not less**; what it removes is a
promise, a timer and a `waitExactFrame` round trip *per frame at run time*, and the stray timeouts a
cancelled fill used to leave armed.

**Open, and D4's.** An ask for a frame the fill has already handed to a decoder only moves up the
decode queue, as before; an ask for one the fill still owes now goes to the wire and costs the fill
a re-issue. Whether that is the right trade at 10 %, 50 % and 90 % of a fill is the measurement S4
names. The recorder (`client/record/`) wraps `waitExactFrame` and does not see a pushed fill —
S4's metrics question. `onError` (a refused range) is wired in both clients and asserted by nothing:
the fake has no control-stream push. D1r, which makes refusals a gate test, inherits it.

**S4 — validation and metrics.** The last column of §Capabilities. Per frame: messages, thread
crossings, copies, allocations, main-thread handling time. Threads, heaps and peak memory. Time
against today's harness path — fill, single ask, and an ask at 10 %, 50 % and 90 % of a fill —
interleaved and container-measured: reported, not decided on. Results go in §Results below.

## Decided elsewhere

The browser campaign on the workstation decides adoption. Details that measurements already queued
will settle: pixels copied against kept in the decoder heap (L14),
wire priority for an ask (L16), a faster decoder build (L17), BYOB reads (L2, L18).

## Not in this proposal

Removing today's path, which follows acceptance. A bounded fill window, the cache seam, paint. Pool
sizing for a device.

## Results

### The first fill handed to `start`

2026-09-19, workstation, 8 cores, `lab/fill-at-start/` (its README says how). `exact-server` in
shared mode over `lab_queue_large` — 20 frames of ~51 KB, realistic sizes and not valid HTJ2K, so
decode is off and "received" means the bytes are in the downloader's worker. Two arms, one fresh
page and one fresh session each, **12 rounds**, arm order reversed on odd rounds: **after**, the
page awaits `started` and then calls `fill()`; **start**, the same indices handed to `connect`.
Median [min … max] from the page's call to `connect()`, and start's rounds-better out of 12.

**Over a 50 ms round trip** (`lab/scripts/link_impair.py --udp 5555:4433 --delay-ms 25`), with the
main thread held 300 ms from 25 ms in — the worker alive and dialling, `started` not yet back,
which is the viewer's ordering:

| | after | start | start better |
| --- | --- | --- | --- |
| the downloader has the fill (ms) | 327 [327 … 327] | **19 [17 … 24]** | 12/12 |
| first frame received (ms) | 486 [484 … 487] | **335 [331 … 339]** | 12/12 |
| all 20 frames received (ms) | 748 [744 … 754] | **599 [593 … 605]** | 12/12 |

Three clean sweeps, ranges that do not overlap: the page round trip is worth **151 ms** on the fill
here, which is the blocked main thread minus the part of it the worker was going to spend dialling
anyway. A private viewer rig measured the same change on a real SDK boot the same day — the ask out
at 451 → 102 ms, all frames received 527 → 221 ms, all decoded 958 → 644 ms, n = 10, 10/10 on each.

**The other cells are ties, and each says something.** With the main thread free the change moves
only when the downloader learns what to fetch, not when the fill lands: over the same 50 ms link
the downloader has the fill at **189 [187 … 196] → 21 [17 … 23] ms, 12/12**, while all 20 frames
are received at **609 [600 … 613] → 609 [604 … 639] ms, 5/12**. Nothing can go on the wire before
the handshake is up, so a free page's round trip — ~2 ms — hides behind it. On loopback the same
pair reads 41 [32 … 71] → 25 [20 … 35] ms, 12/12, and 53 [40 … 98] → 48 [39 … 76] ms, 9/12.

**A main thread blocked in `connect()`'s own task takes the worker with it**, and this is the
limit of the change. Held 300 ms from inside that task, over the 50 ms link, the downloader has the
fill at **485 [483 … 488] → 316 [316 … 320] ms, 12/12** but all frames are received at **905 [901 …
910] → 906 [902 … 913] ms, 5/12**. A blob worker created immediately before a 300 ms busy loop
first replies at **304 ms**, against 8 ms with the thread free: in Chrome 148 a dedicated worker
does not start while the main thread is blocked. So the change is worth a whole boot task only
where the worker was already alive when the task began — which is the viewer's case and the row
above, and is not something the downloader can arrange for itself.

### D7 — the same path on a decoder built with a 4 MB floor

2026-09-19. S4's decode arm cost **161.6 MB**, 150 MB of it three decoder heaps at the package's
link-time 50 MB floor (L1). The source build takes that floor as a parameter. Rebuilt at 4 MB
(emscripten pinned at 3.1.74, L17; F1's signed clamp fix included) and pointed at by the
downloader's existing decoder seam — `?decoder=source` on the campaign page, no product change —
the Dd arm, 3 rounds, arms interleaved with the order reversed each round:

| decoder | page + workers | workers alone | fill ms | cold ask ms |
| --- | ---: | ---: | ---: | ---: |
| the package (50 MB floor) | **161.4 MB** | 160.4 MB | 80.0 | 86.0 |
| the source build (4 MB floor) | **16.3 MB** | 15.3 MB | 80.0 | 86.0 |

**Ten times less memory, and the clock does not move.** 161.4 MB reproduces S4's 161.6 MB, which
is the check that the two runs are measuring the same thing. Fill and cold ask are identical to the
tenth of a millisecond across arms — the floor is preallocation, so lowering it returns memory the
work never used rather than taking anything away.

**Correctness is `parity.mjs`, not this table.** The campaign's `checksum` is a sampled rolling
hash accumulated in arrival order, so it moves with delivery order and is not an oracle. The
4 MB build was checked the proper way first: **byte-identical to the package and to the encoder's
input on all six fixture sets, 40 frames, signed and 12-bit-in-16 included.**

**What it does not settle.** This is one container, and the figure that matters is a phone's. It
also does not make the source build the shipping decoder: that is a supply question — the package
is a pinned npm artifact with a recorded checksum, and the source build is compiled here — and
[`decode/README.md`](decode/README.md) §A build of our own holds it. What is settled is that the
50 MB is a link-time choice and costs 145 MB for nothing.



**S4, 2026-09-16, container-measured** (`lab/downloader-campaign/`, its README says how). 4 cores,
loopback, `exact-server` in shared mode over 87 real HTJ2K frames of 512×512×3 (c512, ~430 KB
each). Three arms, one fresh session each, arm order rotated every round, **8 rounds**, 120 runs,
no errors: **H**, today's harness path — the TS session on the page, the fill as a waiter per
frame, `touch` on the bytes; **Dw**, the downloader with decode off — the same bytes delivered
from its worker, the like-for-like comparison; **Dd**, the downloader decoding with three
decoders, the product path — strictly more work, reported on its own. Median [min … max], and
Dw's rounds-better out of 8 against H. Reported, not decided on: adoption is the workstation's
browser campaign.

**What is settled — three clean sweeps, ranges that do not overlap.** Over an 80-frame fill the
page's main thread does **95 ms [85 … 128] of work on H against 14 ms [11 … 18] on Dw**, 8/8;
the renderer collects **139 times [122 … 156] on H against 0 on Dw**, 8/8; the page's JS heap
peaks at **59 MB [55 … 70] on H against 31 MB [27 … 33] on Dw**, 8/8. That is the offload the
proposal argued for, priced: the frame parsing, the per-frame promise and its timer, and the
garbage they make, leave the main thread.

**What is a tie.** The fill itself: issue → last frame at the page, **233 ms [203 … 255] on H
against 230 ms [193 … 278] on Dw**, 5/8 — the worker hop costs the fill nothing measurable, and
gains it nothing. A cold ask: **4.98 ms [4.11 … 7.66] on H against 5.87 ms [5.23 … 8.04] on Dw**,
2/8, ranges overlapping — the hop to the worker and back costs the single ask under a millisecond
at the median, and this rig cannot resolve it further. The in-page handling of delivered bytes is
under a millisecond per fill on every arm and at the clock floor.

**An ask during a fill, at 10 %, 50 % and 90 %** (a fill of frames 0–79, the ask for frame 86):

| | H | Dw | Dw better | Dd |
| --- | --- | --- | --- | --- |
| ask → delivered at 10 % (ms) | 40.6 [25.7 … 45.9] | 36.7 [28.7 … 45.0] | 4/8 | 77.5 [64.5 … 92.8] |
| ask → delivered at 50 % (ms) | 36.1 [32.6 … 40.3] | 40.1 [33.8 … 49.9] | 1/8 | 41.1 [32.6 … 78.8] |
| ask → delivered at 90 % (ms) | 36.2 [30.7 … 41.3] | **24.0 [22.8 … 27.8]** | **8/8** | 32.9 [29.9 … 38.2] |
| fill frames delivered after an ask at 10 % | **23 [18 … 23]** of 80 | 80 | | 80 |
| fill frames delivered after an ask at 50 % | **53 [52 … 53]** of 80 | 80 | | 80 |
| fill frames delivered after an ask at 90 % | 80 | 80 | | 80 |
| fill issue → last frame, ask at 10 % (ms) | 63 (dead) | 230 [200 … 241] | | 478 |
| fill issue → last frame, ask at 50 % (ms) | 144 (dead) | 239 [200 … 275] | | 478 |

On both arms the ask waits behind the frames already in flight, as L16 said it would — ~35–40 ms
here, where the window holds some fifteen 430 KB frames — and at 10 % and 50 % the two arms are
ties. At 90 % Dw is faster in every round with ranges that do not overlap; the likely mechanism
is that on H the ask's own delivery competes with the fill's parsing on the one thread, and that is
offered as a mechanism, not established. **What differs is the fill.** On H the server ends it and
nothing re-issues it: 23 and 53 frames arrive, the rest never do, and the page holds waiters that
would sit out 15 s. On Dw the downloader re-issues the remainder once the ask settles and the fill
completes in the time a plain fill takes — 230 ms against 230, the re-issue itself costing nothing
this rig can see.

**The decode arm, on its own.** 80 frames decoded and delivered as pixels in **472 ms [435 …
481]** — decode-bound: three decoders and everything else on 4 cores, so nothing about that
number transfers to a device, and the arm is here to be measured, not compared. Its memory does
transfer: **161.6 MB after a fill, 160.5 MB of it in the workers**, which is three decoders holding
the package build's 50 MB link-time heap (L1) — the L8 build at its 4 MB floor would make that
~12 MB. Its main-thread time is 33 ms [17 … 55], its page JS heap peak 1.7 MB (the pixels live in
`SharedArrayBuffer`s the page never copies), and its 355 GCs [338 … 366] are in the decoder
workers, not the page. A cold ask costs 39.6 ms [37.0 … 52.5], which is one decode. An ask during
a fill at 10 % costs 77.5 ms: it waits, as designed, behind the two frames each decoder already
holds (`perDecoder`, D2c) — a real cost of the dispatch bound, and the number to weigh it against.

**Per frame, from the code — counted, not measured:**

| | H | Dw | Dd |
| --- | --- | --- | --- |
| messages | 0 | 1 (worker → page) | 3 (compressed to a decoder; pixels to the page; `done` back) |
| thread crossings of the frame | 0 | 1, a move | 2: compressed as a move, pixels shared |
| copies of the frame's bytes | 1 (out of the stream chunk) | 1 (the same, in the worker) | 3 (out of the chunk; into the WASM heap; out of it into the `SharedArrayBuffer`) |
| per-frame state on the page | a promise and a 15 s timer | none | none |
| threads besides the page | 0 | 1 | 4 |

**Not shown, and why.** The WASM transport behind the downloader has not been run
(§Capabilities, last row). Refusals and signed data are not green on either path (rows 21, 22).
The recorder does not see a pushed fill, so its per-frame telemetry is not what measured this —
CDP did. And every millisecond above is loopback in a container: the window that the ask waits
behind is this host's, and a long fat link holds more of it.
