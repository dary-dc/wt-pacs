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

| capability | today | downloader |
| --- | --- | --- |
| connect, single ask, fill; shared and per-frame stream modes | | |
| a fill cancelled mid-way, the session still serving afterwards | | |
| a closed session noticed at once, waiters failed | | |
| a frame on a live session still owed its full timeout | | |
| refusals delivered, none lost (`client/harness/refusals.html`) | | |
| worker-safe clocks; transferable results | | |
| `stats` | | |
| an ask during a fill, served before the fill's queue | | |
| a session opened at load, first ask served without a dial | | |
| re-dial after closure | | |
| 8-bit multi-component, 16-bit unsigned, 16-bit signed with sign extension | | |
| every decoded frame byte-identical to the fixture's `.sha256` | | |
| both clients, TS and WASM, behind the same downloader | | |

## Stages

Each stage is a queue row. Code goes on the agent's own branch, never onto the queue's branch.

**S1 — capabilities, before any code.** For every row above, name the test that proves it on today's
path, or write it — mutation-checked, reported. Rows that cannot be tested without a browser run in
headless Chromium. Done when the middle column is full and green.

**S2 — the downloader.** Worker, decoders, messages, per-frame record, two-priority queue, direct
pixel ports, decoder-side sample work, cancel. Built beside today's path as a new harness arm; nothing
existing is removed. Uses today's `startExactFrames` / `waitExactFrame`. Done when S1's tests pass
against it.

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
