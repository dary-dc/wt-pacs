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
| `fill` | frame indices |
| `ask` | one frame index |
| `cancel` | — |
| `close` | — |

| to the consumer | fields |
| --- | --- |
| `frame` | index, pixels, width, height, bits, components, signed, min, max, byte count, stamps |
| `failed` | index, reason |
| `closed` | reason |

Stamps are epoch milliseconds (`timeOrigin + now`), converted once by the consumer: ask, first byte,
last byte, dispatched, decode start, decode end.

## The downloader

* **Started by the page at load**, before anything else runs, with the URL of its config. It fetches
  the config, dials, and holds the session. Holding an idle session open is the server's keep-alive
  (`docs/transport/adr-idle-sessions.md`).
* **One record per frame:** not asked, on the wire, waiting for a decoder, decoding, delivered. An
  ask for a frame already in flight moves it up the queue instead of asking the wire again.
* **One queue, two priorities.** Asks before fill frames. Dispatch never leaves a decoder idle: up to
  two outstanding per decoder (`docs/decode/README.md` §Dispatch). `N` is a start parameter; the
  comparison campaigns use 3.
* **Fill frames are pushed by the session** (Stage 3). Asks keep their waiter.
* **Closure:** outstanding frames fail with the session's reason, as today; the next command re-dials.
* **Cancel:** end the stream, drop queued work by generation, fail outstanding asks with an
  `AbortError` distinct from the timeout. The reason's name is pending confirmation before adoption.

## The decoders

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

## Capabilities

Nothing is removed until every row passes on the new path. Stage 1 fills the middle column against
today's path; Stage 4 fills the last.

Stage 1 filled the middle column on 2026-09-16. **conformance** is `client/conformance/run.mjs`,
which runs every clause against both implementations and is in `scripts/gate.sh`; **server** is
`cargo test -p exact-server`. Clauses marked *new* were written for this stage and are
mutation-checked — §S1 results below.

| capability | today | downloader |
| --- | --- | --- |
| connect, single ask, fill; shared and per-frame stream modes | conformance `workerSafe`, `cancellable`, **`bothStreamModes`** *(new)*; server `stream_frames_range_arrives_in_order`, `a_batch_arrives_whole_and_in_ask_order` | |
| a fill cancelled mid-way, the session still serving afterwards | conformance `cancellable` — incl. "the session still serves a frame after a cancel"; server `end_stream_stops_a_fill_on_the_wire` | |
| a closed session noticed at once, waiters failed | conformance `noticesClose` | |
| a frame on a live session still owed its full timeout | conformance `noticesClose`, last check | |
| refusals delivered, none lost (`client/harness/refusals.html`) | **browser page, not in the gate** — server side covered by `a_bad_range_is_refused_with_from`, `an_empty_study_is_refused_with_from`, `fod_len_zero_and_huge_are_refused_before_allocation` | |
| worker-safe clocks; transferable results | conformance `workerSafe`, `transferable`; `client/scripts/check_worker_safe.sh` | |
| `stats` | conformance **`reportsStats`** *(new)* | |
| an ask during a fill, served before the fill's queue | **server only** — `a_data_request_during_a_fill_ends_it_and_is_served_next`, `request_frame_during_fill_switches_to_on_demand`; no client-side test | |
| a session opened at load, first ask served without a dial | conformance **`oneDialServesLaterAsks`** *(new)* | |
| re-dial after closure | conformance **`redialsAfterClosure`** *(new)* | |
| 8-bit multi-component, 16-bit unsigned, 16-bit signed with sign extension | `parity.mjs` covers 8-bit 3-component and 16-bit unsigned over 388 frames. **Signed is untestable today** — see §S1 results | |
| every decoded frame byte-identical to the fixture's `.sha256` | `parity.mjs` (388 frames), `lab/decode-bench/retained/` (120 cells), `decode_bench.mjs` | |
| both clients, TS and WASM, behind the same downloader | every conformance clause runs against both arms — **but only when `client/transport-wasm/pkg/` exists**; otherwise one arm is skipped and the gate still passes (`cloud-queue.md` §Blocked) | |

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

**Three rows are not green, and none of them is the downloader's fault.**

* **Refusals** have a browser page and no gate test. The page is real and passes by hand; nothing
  runs it in CI, so the row rests on a manual step.
* **An ask during a fill** is proven on the server and nowhere on the client. L16 measures what it
  costs; no test asserts the client gets it.
* **16-bit signed cannot be tested at all today.** There is no signed fixture, the generator has no
  signed mode, and one cannot be made with the encoder in this tree: `ojph_compress -signed true`
  over its raw reader does not survive its own `ojph_expand` — every negative sample saturates to
  the bottom of the range, at 12- and 16-bit alike, in-range data included. So there is no ground
  truth to test a decoder against, and **no claim is made here about how either decoder handles
  signed data**. What is measurable without ground truth: the package build and
  `lab/decode-bench/wasm` **disagree** on the same signed codestream — the package saturates every
  negative sample to 32767, the source build does not — so `parity.mjs`'s byte-identical result
  covers unsigned data only. Getting this row green needs a signed fixture from a source other
  than this encoder path.

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

**S2 is not done, and owes one thing: S1's clauses do not yet drive this arm.** They run in Node
against a fake `WebTransport`; the downloader dials inside its own worker, so the fake has to be
installed there and driven from the page. `config.transport` — a module URL exporting
`TransportSession`, defaulting to today's — is the hook that makes that possible and is in place.
What remains is a conformance runner that supplies a fake transport module and a control path to
it. Until then these rows are shown on the arm rather than by the suite.

**Implemented but asserted by nothing yet**, and so not claimed: the two priorities' *ordering*
under contention (an ask arriving mid-fill is promoted, but no test watches the order it comes
back in), the two-outstanding-per-decoder dispatch bound, and sign extension — which cannot be
asserted at all until there is a signed fixture (`cloud-queue.md` §Blocked).

**S3 — fills pushed.** Both clients deliver a fill's frames as they arrive instead of through a waiter
per frame; the conformance suite covers the new form against both implementations. The downloader
switches to it. Report lines removed against lines added.

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

Empty until S4.
