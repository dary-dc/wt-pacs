# Proposal: a conformance suite over the transport surface

**For:** wt-pacs implementer · 2026-09-14 · **Status:** proposed; the suite is built, the gate step
is the part that wants a decision.

`docs/client-shape-plan.md` §0 names three clauses the transport surface requires and does not
state, and calls a suite over them milestone 1's real output. This says what that suite is, how it
runs without a browser, and what wiring it into `scripts/gate.sh` costs.

## What makes it possible

Both implementations construct `new WebTransport(url, options)` resolved from the **global scope** —
`client/transport-ts/session.ts` directly, `client/transport-wasm` through `web_sys`, which emits
the same global lookup. So a fake `WebTransport` installed on `globalThis` drives either one, in
plain Node, with no browser and no server.

That is the whole trick, and it is already proved: against the built TS bundle, a fake transport
returns a session from `connect()`, receives `{"op":"request_frame","frame":7}` on its control
stream, hands back one framed envelope, and `requestExactFrame(7)` resolves with the right bytes
and non-zero timings.

The fake speaks the wire format in `client/transport-ts/wire.ts`: `[4B LE len][JSON]` on the
control stream, `[4B BE len][4B BE index][codestream]` on a unidirectional stream. It is about 60
lines and belongs to the suite, not to either implementation.

## Where it lives

```
client/conformance/
  fake-transport.ts     the global WebTransport stand-in, and a frame pusher
  clauses.ts            the clauses, against a rig any arm can supply
  adapters.ts           one surface, two implementations behind it
  run.ts                Node entry: both clients over the fake on the global scope
  fake-session.ts       the fake installed inside the downloader's worker (config.transport)
  downloader-rig.ts     the downloader's rig; downloader.html + run_downloader.sh drive it
  dispatch-rig.ts       the downloader's own behaviours; dispatch.html + run_dispatch.sh
  ask-during-fill.html  the server's semantics seen from the client; run_wire.sh, with
                        client/harness/refusals.html, against a real server
```

Neither implementation owns it, because it tests both. It follows `client/record/test/run.ts`
exactly — TypeScript, bundled by esbuild to `.mjs`, run by `node`, asserting with a counter and a
non-zero exit. No new test framework, no new dependency.

**Adapters, because the two surfaces do not quite agree.** They agree more than expected — the WASM
client exports camelCase JS names, so `requestExactFrame`, `startStreamFrames` and `endStream` line
up. What differs is that `endStream` is a promise on one and synchronous on the other, and that
`startStreamFrames` takes a range object on one and two optional arguments on the other. The
adapter is the only place that knows either. A third implementation writes one and inherits every
test.

## The three clauses, as tests

1. **Worker-safe.** Node has no `window`, which is exactly the environment the bug hid in: the WASM
   client read its clock from `window.performance` and produced zeros, not errors, inside a worker.
   The suite asserts **on values** — every timestamp strictly positive, and `lastChunkMs` at or
   after `askMs` — so a return to silent zeros fails on the number rather than on the absence of an
   exception. `client/scripts/check_worker_safe.sh` is the static half, in the shape
   `check_telemetry_absent.sh` already uses: no built artifact may contain a `window.` reference,
   and the wasm binary may not carry the string at all.

2. **Cancellable.** Start a fill, call `endStream()`, then assert both halves: the client actually
   emitted `{"op":"end_stream"}` on the control stream, **and the session still works** — a
   single-frame request after the cancel completes. Cancelling by closing the session would pass a
   weaker test and is the failure this one is for.

3. **Transferable.** Take a `FrameResult`, transfer its buffer with `structuredClone(buf, {transfer:
   [buf]})`, and assert the source is detached — `byteLength === 0`. A copy leaves it intact and
   fails. A second assertion holds two frames at once and transfers one: the other must survive,
   because frames delivered on one shared stream sharing a backing buffer would make every transfer
   corrupt its neighbour. On the TS client they do not share one today; the test is what keeps that
   true.

4. **A closed session is noticed at once** (added with L4). A request against a closed session must
   fail immediately rather than at `FRAME_TIMEOUT_MS`, a request in flight when the close lands must
   be woken, and a *live* session with no frame must still take the full timeout. The close is
   driven two ways — ending the media stream, and settling `closed` with the stream left open — so
   a client that only watches one signal fails the other. `docs/CLIENTS.md` has the numbers.

5. **A fill is pushed** (added with D3). `fillFrames(from, to, onFrame)` delivers every frame of
   the range to the callback once, in order, with real timings, in both stream modes, and arms no
   waiter; an ask during it is served on its own promise and not pushed as well; a frame arriving
   after `endStream()` is dropped. `docs/CLIENTS.md` §Fills are pushed.

Every test is mutated — the implementation broken on purpose, the test watched failing — and the
report says so.

## What the gate step costs, and the one decision

`scripts/gate.sh` does not build `client/transport-wasm` today. Nothing in the gate needs
`wasm-pack` or the `wasm32-unknown-unknown` target, and a contributor without them is not currently
blocked.

Running the suite against **both** implementations in the gate changes that. Against the TS arm
alone it is free: the bundle is already built two steps earlier.

**The decision: what the gate does when `wasm-pack` is absent.** Three options, and this proposes
the second.

| | |
| --- | --- |
| require it | honest, and blocks every contributor who has not installed a Rust wasm toolchain to run a check about TypeScript |
| **skip the arm, loudly** | the gate prints that the WASM arm was skipped and why, and passes. CI installs the toolchain and gets both arms; a laptop gets one and is told so |
| drop the WASM arm | cheapest, and gives up the only thing that makes this a *conformance* suite rather than a unit test |

The second keeps the gate usable and keeps the suite honest, at the cost of a check that is
conditional — which is a real cost, because a conditional check is one that can quietly stop
running. The mitigation is that it is loud: skipped arms are named in the gate's output, not
silent.

## The downloader arm (added 2026-09-16, D2b)

The downloader dials inside its own worker, where the test process's global scope cannot reach.
Two additions close that. The clauses moved to `clauses.ts`, written against a rig — open a
session, drive the fake, count dials — so the same checks run wherever the fake lives. And
`fake-session.ts` is the module `config.transport` names during a conformance run: evaluated
inside the downloader's worker, it installs the fake there, answers the page's commands over a
`BroadcastChannel` named in its own URL query, and exports the real `TransportSession` over it.

The fake says `listening` on that channel once it is up, and the page posts nothing before it
hears that (added 2026-09-23). Chromium can drop a message posted to a channel a worker has
already constructed: on Chrome 148, a worker that builds its channel and then tells the page
over `postMessage` lost 10 of 5,000 pings the page sent at once, and 0 of 5,000 when the page
waited for `listening` instead (five rounds each, interleaved, one headless page per round).
In the suite, three commands follow `open()` with no pause, and the gate once failed one of them,
"the fake took the server's close (closed before the ask)". There the loss is rarer — 1 in 3,500
opens on this host, none in 110 whole-suite runs — so the fix is shown by forcing the order: with
the fake's channel created 300 ms late, the page without the wait passes 4 of 18 checks, and
with it all 53.

`run_downloader.sh` serves the repo with `server/dev-server.py`, drives
`client/conformance/downloader.html` in headless Chromium, and fails on any failed check.
The gate runs it, and skips loudly when playwright or Chromium is missing — the WASM-arm
decision above, applied again.

Two clauses read what an arm does from the rig rather than special-casing a test: this arm's
fill goes out as `request_frames` (the downloader fills by explicit indices), and an ask after
a closure **re-dials and is served** rather than failing — the downloader's own contract
(`proposal-downloader.md` §The downloader). One thing the page cannot see: whether the worker
*moved or copied* a frame's buffer across the boundary, because a dropped transfer list arrives
as a clone that still detaches. The clause holds delivered-buffer semantics — movable, no
sibling coupling; the copy cost is S4's metric.

## Against the real server (added 2026-09-16, D1r)

Two rows the fake cannot reach: refusals back to back on the real control stream, and what an
ask does to a running fill under the server's own planner. `run_wire.sh` builds a debug
`exact-server` and `pack-study`, packs 200 random 256 KB frames as a study, makes its own cert
under a temp dir, and runs the server with a 2 MB send window — so a fill is still running when
an ask lands and few enough frames are in flight that its end is observable. Nothing in the tree
is touched; the pages take `wt=`/`hash=` overrides. About 18 s warm, in the gate, skipping loudly
without Chromium.

`client/harness/refusals.html`, both clients: 64 out-of-range asks in one `request_frames`, every
waiter rejected promptly with the server's reason — none lost to the 15 s timeout. Its mutant, the
TS control pump dropping one `frame_error`: **63 of 64, 1 timed out**, the wasm arm untouched.

`ask-during-fill.html`. On the raw client: the ask is served mid-fill; the fill ends — 28 of 120
arrive (20 delivered at the ask, 8 the window held), then nothing; the rest arrive only once asked
again, which the test does and the raw client does not. On the downloader: the ask is served, the
fill completes without being asked again, no frame twice. Two mutants: a planner that keeps the
fill past an ask — the raw client reports **120 of 120 arrived, then nothing**, while the
downloader survives it, since it re-issues only what is still wanted and a fill the server failed
to drop is superseded, not duplicated; and a downloader that never re-issues — **28 of 120**.

What this found and did not fix: a refused *fill* never reaches the downloader's consumer. The
session's `onError` fails the run's records, but the consumer API has `onFrame` only, so the page
is never told. A refused *ask* does reach it, with the reason. `proposal-downloader.md`
§Capabilities carries the row.

## Known gap: the suite is not type-checked

`scripts/gate.sh` type-checks the product code and not this. The suite imports `node:fs`,
`node:path` and `node:url`, which needs `@types/node`, which `client/transport-ts` does not carry —
and `client/record/tsconfig.json` already excludes its own node-side test file for the same reason.
Following that precedent costs a type-check; adding the dependency costs a dependency. This takes
the precedent, and esbuild still fails the build on anything malformed. Worth revisiting if a third
implementation arrives and the adapter surface starts carrying real weight.

## Not in scope

The suite proves the client half against a fake. It says nothing about whether the **server**
honours `end_stream` mid-fill — `server/src/transport/server.rs` has that under its own test — and
nothing about real network behaviour. It is a contract test, not an integration test, and a third
implementation passing it is conformant, not proven correct.
