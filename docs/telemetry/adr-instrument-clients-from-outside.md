# ADR: instrument the browser clients from outside, not with an inline recorder

**Status:** accepted (client Proxy G) · **Date:** 2026-08-30 · **Tags:** telemetry, client, lab  
**Open:** Decision A — whether frame-level `firstByte`/`lastByte` keep byte attribution (A1),
session-method totals only (A2), product framing edits (A3), or a hybrid (A4). Server Decision C
is settled in [`adr-server-pipeline.md`](adr-server-pipeline.md).

As-built module: [`README.md`](README.md).

## Context and Problem Statement

The browser clients had no latency telemetry
([`client-runtime-experiment-plan.md`](../client-runtime-experiment-plan.md) §3 P3). The WASM-vs-TS
comparison cannot run without it, and its stated gate is that **both arms must stamp at identical
points or the comparison is unmeasurable no matter how clean the shell is.**

The obvious move is to copy `server/src/record/`, which is a working, tested implementation of exactly
the contract required: write-only seam, zero-sized `Recorder` when the `telemetry` feature is off, and
`check_telemetry_absent.sh` proving absence in a default build.

Copying it means `rec.ask()`, `rec.first_byte()`, `rec.last_byte()` calls threaded through
`session.ts` and `session.rs` — roughly eight sites per client, in the framing loop and the send path.
**That is measurement code living permanently in the product path of both shipped clients**, and it
must then be proven inert by a distributed set of `#[cfg]` guards and dead-code elimination.

The question is not *whether* to gate telemetry. It is **where the seam belongs**.

## Decision Drivers

- Both arms must stamp at identical points, or the experiment is void
- Default builds must carry no measurement surface
- The clients are shipped product; the lab is not
- Instrumentation must not perturb what it measures
- The measurement environments are not controlled — browser flags cannot be assumed present

## Considered Options

- **A** — Inline recorder calls, mirroring the server
- **B** — Proxy the public session API only
- **C** — Wrap the I/O objects the session acquires (two pass-through lines in `connect`)
- **D** — Chrome NetLog (`--log-net-log`), parsed offline
- **E** — Proc-macro / build-time weaving
- **F** — Product emits domain events; the recorder subscribes
- **G** — **Patch the `WebTransport` global; proxy what it returns**

## Decision Outcome

**Chosen option: G** — *every boundary except `gesture` lives on an object the session obtains from
`WebTransport`, so intercepting the constructor reaches all of them without touching either client.*

```js
const Real = globalThis.WebTransport;
globalThis.WebTransport = function (url, opts) {
  return new Proxy(new Real(url, opts), transportHandler);
};
```

The telemetry entry point imports this before the client module; ESM evaluates imports in order, so
load order is deterministic rather than a race.

**The decisive property is not tidiness.** `transport-wasm` calls `web_sys::WebTransport`, which is
bindings to the same JS global — so **one implementation instruments both arms.** The hardest
constraint in the experiment plan is dissolved rather than enforced: the arms cannot stamp at
different points, because it is the same code stamping.

### Why the others were rejected

| | |
| --- | --- |
| **A** | Puts measurement in the product path of both shipped clients, permanently, and requires ~8 gated sites per client to prove absent. It is the right seam for the server (§ below) and the wrong one here |
| **B** | A proxy sees only call entry and return. `ask`, `firstByte` and `lastByte` all occur inside the call, so B yields the total and nothing else — it cannot split wire time from copy time, which is the question being asked |
| **C** | Correct and sufficient, but still edits `connect()` in both clients, and instruments each arm with separate code — reintroducing the identical-stamping risk G removes. **Retained as the fallback** if patching the global proves unworkable |
| **D** | Gives true wire arrival and would fix the event-loop confound. Rejected as a dependency: **the measurement environments cannot be guaranteed to have the flag**, and its timestamps are on a different clock, requiring an anchor. Kept as an optional one-off calibration |
| **E** | No TypeScript equivalent exists, so the two arms would stamp through different mechanisms — defeating the one constraint that matters |
| **F** | Same call sites as A, with indirection. Nothing but the tap would consume the events |

### Positive consequences

- **No product file changes in either client.** `session.ts` and `session.rs` are untouched
- **The default build contains no telemetry code at all** — not a `Recorder`, not a null object, not a
  gated call site. Absence stops being something to prove inert and becomes something that was never
  added. The absence check reduces to "the default entry point does not reach `record/install.js`"
- One implementation instruments both arms, removing the experiment's principal validity threat
- Everything is stamped in-process on one clock, so no cross-domain alignment error
- Works wherever the page's script load order can be controlled; needs no browser flag

### Negative consequences

- **Patching a global is action at a distance.** It is invisible at the point of use, and a reader of
  `session.ts` has no indication that its `WebTransport` may not be the platform's. This ADR and
  [`README.md`](README.md) are the mitigation
- **Correctness depends on using `Proxy`, not a look-alike object.** `transport-wasm` does
  `dyn_into::<ReadableStreamDefaultReader>()`, an `instanceof` check that a substitute object fails.
  A `Proxy` forwards `getPrototypeOf` so `instanceof` passes. This is a standing trap and carries its
  own test
- **`gesture` is still not covered.** It happens before the transport is called, so no object exists to
  wrap. The harness supplies it; where there is no harness, `queue` exports `null`
- The tap sees bytes, not frames, so frame boundaries are recovered arithmetically from byte offsets
  (Decision A). This is a partial length-prefix parser in telemetry code — reusing `wire.ts`'s exported
  `parseLengthPrefixed`
- It does **not** fix the event-loop timing confound. Only D does, and D is not a dependency

## The server pipeline — deliberately different from the browser

**Updated 2026-09-02.** See [`adr-server-pipeline.md`](adr-server-pipeline.md).

The browser keeps Proxy-on-`WebTransport` (option G). The server has no equivalent global.
It uses `ProductPipeline` (product) and `RecordedPipeline` (lab wrapper + `Tap`) in
`server/src/transport/pipeline.rs`. Wire writes go through `FrameOut` in `frame_out.rs`.
The session loop calls only `serve_one` on a generic `FramePipeline`.

The Tap report schema is unchanged; this ADR’s client decision is unchanged.
