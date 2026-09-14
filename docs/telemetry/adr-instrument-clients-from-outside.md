# ADR: instrument the browser clients from outside, not with an inline recorder

**Status:** accepted (client Proxy G; Decision A decided 2026-09-06) · **Date:** 2026-08-30 ·
**Tags:** telemetry, client, lab  
**Decision A:** A4 — byte attribution (A1) for `firstByte` / `lastByte`, session-method wrapping (A2)
for `gesture` / `delivered` / failures. See § Decision A below. Server Decision C is settled in
[`adr-server-pipeline.md`](adr-server-pipeline.md).

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

## Decision A — frame boundaries stay in byte attribution (2026-09-06)

The open question was whether `firstByte` / `lastByte` should come from the reader Proxy plus
byte-offset attribution (A1), from session-method totals only (A2), from stamps inside the
product framing helpers (A3), or a hybrid (A4). **A4 as built: A1 + A2.**

| Criterion | A1 + A2 | A3 |
| --- | --- | --- |
| Stamp fidelity | `lastByte` at `read()` resolution before any copy; `delivered` at method return. An in-loop stamp sits in the same event-loop turn — nothing gained | same |
| Arm parity | one JS patch, same bytes, same arithmetic — parity by construction | two implementations kept identical by review |
| Invasiveness | zero product lines | ~8 sites per client, gated |
| Default-build proof | never added | proven inert in two languages |
| Batch correctness | deterministic byte arithmetic; ask identity from the FoD op | same |
| Cost | ~1 µs per read at 320 × 250 KB frames (`review-2026-09-06.md` §7), which is the tap timing *itself*; the installed-vs-not delta is larger — see §What installing it costs | small, paid in product code |

A1's one real weakness was the cost of the first attributor (quadratic per read); that was an
implementation defect, fixed by the streaming attributor, not a property of the seam. A2 alone
cannot split wire time from copy time, so it stays as the other half.

**Amendments carried with the decision:**

- The control **readable** is proxied too. A server `frame_error` closes its row as `refused`;
  without it a refused frame left a row open and voided the run with no diagnosis.
- The attributor must stay O(1) per read and retain no payload; the tap times its own read path
  (`integrity.tap_read_cost_us`) so a regression here shows in every report.
- `gesture` is first-write-wins: the shell stamps it when a step becomes due, and the session
  wrapper's stamp at call time applies only when nothing is pending.

**What would reopen it:** a wire change that breaks byte-offset attribution (multi-frame
envelopes, compression), or a stage that can only be stamped inside `session.*`. Neither is
planned.

## What installing it costs

**Added 2026-09-14.** The `~1 µs per read` above is `integrity.tap_read_cost_us`: the tap timing its
own read path. It does not include the Proxy dispatch that gets it there, or the per-frame row
bookkeeping around it. This is the other number — the same client driven identically with the seam
installed and not installed.

`lab/telemetry-cost/cost.mjs` runs it in Node with no browser and no server: the seam is a patched
global `WebTransport`, which is exactly what `client/conformance/`'s fake occupies, so the whole
thing runs on the conformance harness. **Three arms, not two.** `off` runs twice, and the second is
a null control: whatever it shows against the first is this rig's resolution, and an overhead
smaller than that is not a measurement. Arms interleave and rotate every round.

Per frame, at 800 frames of 64 KB, against chunks per frame:

| chunks/frame | transport-ts | on worse | transport-wasm | on worse |
| --- | --- | --- | --- | --- |
| 1 | +9.7 µs | 20/21 | +20.2 µs | 14/15 |
| 2 | +10.4 µs | 21/21 | +20.0 µs | 15/15 |
| 4 | +9.3 µs | 20/21 | +23.7 µs | 14/15 |
| 8 | +15.7 µs | 21/21 | +30.8 µs | 15/15 |
| 16 | +21.6 µs | 21/21 | +28.7 µs | 15/15 |
| 32 | +25.5 µs | 21/21 | +39.6 µs | 15/15 |

The null control stayed between 4/21 and 15/21 across every cell and within ±5 µs on the TS arm and
±9 µs on the WASM arm, so the rig resolves something around 5–9 µs per frame and these are above it.
Marginal ranges overlap — round-to-round drift is larger than the effect — but the comparison is
paired within each round, which is what 21/21 and 15/15 are counting.

**It scales with reads, not with frames or with bytes alone.** Three components, and the middle one
is the one a real link moves:

* a fixed per-frame cost — ~10 µs on the TS arm, ~20 µs on the WASM arm, which copies a chunk twice
  where the TS arm copies once (`install.ts` declares that difference and it shows here);
* **~0.5 µs per read**, which is the row above: 32 chunks costs about 16 µs more than one. This is
  the component consistent with the `~1 µs per read` figure the tap reports for itself;
* a sub-linear byte term: with one chunk per frame, the overhead runs from nothing at 16 KB
  (12/25 rounds, unresolved) to +31.4 µs at 512 KB (20/25).

Per-frame cost is nearly flat in frame count — +11.4 µs at 200 frames, +13.4 at 800, +19.1 at 3200
on the TS arm — so a run's total is frames × per-frame, and the slight rise with count is not
separated from noise here.

**What this does not say.** It does not say the seam is cheap or expensive relative to anything
else: the belief it was written to test is a comparison, and this lane measured only one side of it.
The number to carry into that comparison is *tens of microseconds per frame*, not the ~1 µs the
tap reports for itself. Every figure is container-measured; the shape is the claim, not the
microseconds. The fake also delivers frames without a real link's jitter, and the chunk counts are
imposed rather than observed — the right chunk count to read off the table is whatever a real
session actually produces, which nothing here measures.

## The server pipeline — deliberately different from the browser

**Updated 2026-09-02.** See [`adr-server-pipeline.md`](adr-server-pipeline.md).

The browser keeps Proxy-on-`WebTransport` (option G). The server has no equivalent global.
It uses `ProductPipeline` (product) and `RecordedPipeline` (lab wrapper + `Tap`) in
`server/src/transport/pipeline.rs`. Wire writes go through `FrameOut` in `frame_out.rs`.
The session loop calls only `serve_one` on a generic `FramePipeline`.

The Tap report schema is unchanged; this ADR’s client decision is unchanged.
