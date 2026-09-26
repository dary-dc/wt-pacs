# ADR: instrument the browser clients from outside, not with an inline recorder

**Status:** accepted (option G, 2026-08-30; Decision A = A4, 2026-09-06) · **Tags:** telemetry,
client, lab  
**Server side:** [`adr-server-pipeline.md`](adr-server-pipeline.md), which also owns the harvest
that collects both reports.

## Context and Problem Statement

The browser clients had no latency telemetry, and the WASM-against-TS comparison cannot run without
it. Its gate: **both arms must stamp at identical points, or the comparison is unmeasurable no
matter how clean the shell is.**

The obvious move is to copy `server/src/record/`: a write-only seam, compiled out when the
`telemetry` feature is off, with an absence check. Copying it means `rec.ask()`,
`rec.first_byte()`, `rec.last_byte()` threaded through both clients' framing loops and send paths,
roughly eight sites per client: **measurement code living permanently in the product path of both
shipped clients**, proven inert by `#[cfg]` guards and dead-code elimination.

The question is not *whether* to gate telemetry. It is **where the seam belongs**.

## Decision Drivers

- Both arms must stamp at identical points, or the experiment is void
- Default builds must carry no measurement surface
- The clients are shipped product; the lab is not
- Instrumentation must not perturb what it measures
- The measurement environments are not controlled: browser flags cannot be assumed present

## Considered Options

- **A** — Inline recorder calls, mirroring the server
- **B** — Proxy the public session API only
- **C** — Wrap the I/O objects the session acquires (two pass-through lines in `connect`)
- **D** — Chrome NetLog (`--log-net-log`), parsed offline
- **E** — Proc-macro / build-time weaving
- **F** — Product emits domain events; the recorder subscribes
- **G** — **Patch the `WebTransport` global; proxy what it returns**

## Decision Outcome

**Chosen option: G.** Every boundary except `gesture` lives on an object the session obtains from
`WebTransport`, so intercepting the constructor reaches all of them without touching either client.

```js
const Real = globalThis.WebTransport;
globalThis.WebTransport = function (url, opts) {
  return new Proxy(new Real(url, opts), transportHandler);
};
```

The telemetry entry imports this before the client module; ESM evaluates imports in order, so load
order is deterministic rather than a race.

**The decisive property is not tidiness.** `transport-wasm` calls `web_sys::WebTransport`, bindings
to the same JS global, so **one implementation instruments both arms.** The arms cannot stamp at
different points, because it is the same code stamping.

| Rejected | Why |
| --- | --- |
| **A** | Measurement in the product path of both shipped clients, permanently, with ~8 gated sites per client to prove absent. The right seam for the server, the wrong one here |
| **B** | A proxy sees call entry and return only. `ask`, `firstByte` and `lastByte` happen inside the call, so B yields the total and cannot split wire time from copy time, which is the question |
| **C** | Correct and sufficient, but edits `connect()` in both clients and instruments each arm with separate code, reintroducing the risk G removes. **The fallback** if patching the global proves unworkable |
| **D** | True wire arrival, and would fix the event-loop confound, but the environments cannot be guaranteed the flag, and its clock needs an anchor. An optional one-off calibration only |
| **E** | No TypeScript equivalent, so the arms would stamp through different mechanisms |
| **F** | A's call sites with indirection; nothing but the tap would consume the events |

### Consequences

- **No product file changes in either client**, and **the default build contains no telemetry
  code**: no recorder, no null object, no gated call site. Absence is something never added rather
  than something proven inert.
- Everything is stamped in-process on one clock; no cross-domain alignment. Needs no browser flag.
- **Patching a global is action at a distance**: a reader of the client has no sign that its
  `WebTransport` may not be the platform's. This ADR is the mitigation.
- **Correctness depends on `Proxy`, not a look-alike.** `transport-wasm` does
  `dyn_into::<ReadableStreamDefaultReader>()`, an `instanceof` check a substitute object fails; a
  `Proxy` forwards `getPrototypeOf`, and so does every handler in `client/record/proxy.ts`.
  *Corrected 2026-09-26:* this said the trap "carries its own test". None exists in
  `client/record/test/`; the WASM arm of `lab/telemetry-cost` exercises it.
- **`gesture` is not covered**: it happens before the transport is called. The harness shell
  supplies it; without one, `queue` exports `null`.
- The tap sees bytes, not frames, so frame boundaries are recovered arithmetically from byte
  offsets (Decision A), reusing `wire.ts`'s `parseLengthPrefixed`.
- It does **not** fix the event-loop timing confound; only D would.
- **What it cannot see.** A session over the WebSocket fallback (no `WebTransport` to patch), and
  the downloader's pushed fill: the session wrapper wraps `waitExactFrame` and the batch methods,
  not `fillFrames`, so per-frame telemetry is blind to that path until it does.

## Decision A — frame boundaries stay in byte attribution (2026-09-06)

Should `firstByte` / `lastByte` come from the reader Proxy plus byte-offset attribution (A1), from
session-method totals only (A2), from stamps inside the product framing helpers (A3), or a hybrid
(A4)? **A4 as built: A1 + A2.**

| Criterion | A1 + A2 | A3 |
| --- | --- | --- |
| Stamp fidelity | `lastByte` at `read()` resolution before any copy; `delivered` at method return. An in-loop stamp sits in the same event-loop turn: nothing gained | same |
| Arm parity | one JS patch, same bytes, same arithmetic | two implementations kept identical by review |
| Invasiveness | zero product lines | ~8 sites per client, gated |
| Default-build proof | never added | proven inert in two languages |
| Batch correctness | deterministic byte arithmetic; ask identity from the FoD op | same |
| Cost | tens of µs per frame installed (§What installing it costs) | small, paid in product code |

A1's one real weakness was its first attributor, which re-parsed the accumulated stream on every
read: at 320 frames of 250 KB (4 883 reads of 16 KB) it spent 76 s on the main thread, 15.6 ms a
read, longer than the 80 MB transfer takes at 10 Mbit. The streaming attributor took 5 ms, ~1 µs a
read (localhost, TS arm, not quotable as a wire cost). An implementation defect, not a property of
the seam. A2 alone cannot split wire from copy, so it stays as the `gesture` / `delivered` half.

Carried with the decision:

- The control **readable** is proxied too. A server `frame_error` closes its row as `refused`;
  without it a refused frame left a row open and voided the run with no diagnosis.
- The attributor stays O(1) per read and retains no payload; the tap times its own read path
  (`integrity.tap_read_cost_us`).
- `gesture` is first-write-wins: the shell stamps it when a step becomes due, and the session
  wrapper's stamp at call time applies only when nothing is pending.

**What would reopen it:** a wire change that breaks byte-offset attribution (multi-frame envelopes,
compression), or a stage that can only be stamped inside the session. Neither is planned.

## Turning it on

| Arm | Build | Loaded by |
| --- | --- | --- |
| TS | `client/transport-ts/build.sh` → `dist/session.telemetry.js` (entry `session-telemetry.ts`) | `client/harness/ts.html?telemetry=1` |
| WASM | `WTPACS_TELEMETRY_BUILD=1 client/transport-wasm/build.sh` → `pkg-telemetry/` | `client/harness/index.html?telemetry=1` |

The WASM crate's `telemetry` feature is vacant: `pkg-telemetry/` is the product wasm in its own
directory, and the recorder is the same JS patch. Both outputs are gitignored. The code is `client/record/` (`install.ts` patches the global;
`proxy.ts`, `wrap-session.ts`, `attribution.ts`, `clock.ts`, `rows.ts`, `report.ts`, `tap.ts`),
shared by both arms. The report is read from `window.__wtpacsTelemetry()`; the harvest writes it to
`telemetry-client.json` ([server ADR §Harvest](adr-server-pipeline.md#harvest)).

## What it records

One row per asked frame, integers in µs, **null ≠ 0** (a stamp that never happened is `null`; a
stage that ran in no measurable time is `0`):

| Stage | Interval |
| --- | --- |
| `queue_us` | `gesture` → `ask` |
| `serve_plus_path_us` | `ask` → first byte |
| `transfer_us` | first byte → last byte; frames that arrived in one read are left out of its distribution |
| `deliver_us` | last byte → `delivered`: the receive-side copy and hand-off |
| `total_us` | `gesture` (else `ask`) → `delivered`, or → last byte for a fill row; `total_spans` names which |

`decode`, `paint`, `stall` and `preload_to_decode` are `null`; nothing here measures them. `deliver`
is measurable on its own: 180 µs p50, 425 µs p95 against a 5 µs clock on the TS arm (250 KB frames,
localhost, 2026-09-06), forty clock ticks, not one.

Report shape: `summary → client_frames → run_end`.

- **`closed_at`:** `last_byte` · `delivered` · `batch_delivered` (the batch method returned; not a
  per-frame delivery) · `refused` (server `frame_error`, reason carried) · `timeout` · `error`.
  `summary.outcomes` counts rows by it. Failed rows have no stages and are not usable, but they
  close their row, so a refusal does not void a run.
- **First ask:** the run's earliest ask by ask time is `summary.first_ask_row`, excluded from every
  mean and headline whatever its frame index; first stream, cold pages and JIT land on it
  (×5 on `serve_plus_path` in the run that found it).
- **Fill:** one gesture and one ask stamp per fill, so `summary.fill_queue_us` is reported once and
  `distributions.queue` covers interaction rows only. Preload rows close at `last_byte`; a later
  `delivered` mark fills their `deliver_us`.
- **Long tasks:** `integrity.long_tasks` counts only tasks overlapping [first ask, last row end]
  (`long_tasks_outside_window` holds the rest; WASM compile lands there). Per row,
  `main_thread_busy_us` is the overlap with [ask, close]; rows with any overlap are left out of
  distributions and headlines and counted in `busy_rows_excluded`.
- **Integrity:** `summary.integrity.valid` is false on open/closed disagreement, byte-closure
  failure, first-write conflicts, or ring evictions. `open_rows` lists rows never closed with the
  stamps they have. `marks_after_close` is recorded but does not void alone.
- **Ring:** `run_end.ring_capacity` (default 4 096 closed rows) is enforced; evictions are counted
  and void the run.
- **Binding:** `summary.binding` counts which stage bound each usable frame.
- **Copies:** `mean_frame_bytes` is the mean of per-frame `bytes`, not a heap measure;
  `copies_per_frame_declared` (TS 1, WASM 2) and `copies_source` are a source read, not measured.
- **Compare within a cell only:** on-demand with on-demand, fill with fill.

Not telemetry: the product's `FrameResult.timing` reports `chunks: 1` and `firstChunkMs ===
lastChunkMs`, one stamp after the whole envelope was parsed. Do not read it as wire timing.

## Absence

```bash
client/scripts/check_telemetry_absent.sh
```

Builds the default bundle if missing; fails if `dist/session.js` contains a recorder string
(`record/install`, `__wtpacsTelemetry`, report field names), if the default WASM `pkg/` exports
telemetry or carries its field literals, or if importing `dist/session.js` alone patches
`WebTransport`. `scripts/gate.sh` runs it with the server's check, and also runs
`client/record/test` and type-checks `client/record/`.

## What installing it costs

**Added 2026-09-14.** `integrity.tap_read_cost_us` (~1 µs a read) is the tap timing its own read
path. It does not include the Proxy dispatch that gets it there, or the per-frame row bookkeeping.
This is the other number: the same client driven identically with the seam installed and not.

`lab/telemetry-cost/cost.mjs` runs it in Node, no browser and no server: the seam is a patched
global `WebTransport`, which is what `client/conformance/`'s fake occupies. **Three arms, not two.**
`off` runs twice; the second is a null control whose difference from the first is the rig's
resolution. Arms interleave and rotate every round.

Per frame, at 800 frames of 64 KB, against chunks per frame:

| chunks/frame | transport-ts | on worse | transport-wasm | on worse |
| --- | --- | --- | --- | --- |
| 1 | +9.7 µs | 20/21 | +20.2 µs | 14/15 |
| 2 | +10.4 µs | 21/21 | +20.0 µs | 15/15 |
| 4 | +9.3 µs | 20/21 | +23.7 µs | 14/15 |
| 8 | +15.7 µs | 21/21 | +30.8 µs | 15/15 |
| 16 | +21.6 µs | 21/21 | +28.7 µs | 15/15 |
| 32 | +25.5 µs | 21/21 | +39.6 µs | 15/15 |

The null control stayed between 4/21 and 15/21 and within ±5 µs (TS) and ±9 µs (WASM), so the rig
resolves around 5–9 µs a frame and these are above it. Marginal ranges overlap, since round-to-round
drift is larger than the effect, but the comparison is paired within each round, which is what
21/21 and 15/15 count.

**It scales with reads, not with frames or bytes alone.** Three components:

* a fixed per-frame cost: ~10 µs on the TS arm, ~20 µs on the WASM arm, which copies a chunk twice
  where the TS arm copies once;
* **~0.5 µs a read**: 32 chunks cost about 16 µs more than one. This is the component a real link
  moves;
* a sub-linear byte term: with one chunk a frame, from nothing at 16 KB (12/25, unresolved) to
  +31.4 µs at 512 KB (20/25).

Per-frame cost is nearly flat in frame count (+11.4 µs at 200 frames, +13.4 at 800, +19.1 at 3 200
on the TS arm), so a run's total is frames × per-frame.

**In a browser** (Chromium sampling profiler at 200 µs, medians of 2, 2026-09-08; the profiling
driver is not in the tree): on-demand, 32 KB frames, D = 4, 2 000 frames, the recorder added 25–30 µs
of main-thread time a frame, +17 % busy on TS and +11 % on WASM, and moved wall time by at most 7 %
(TS; 0 % WASM). In a fill of 80 × 250 KB it did not show; the copies dominate. Inside it: the
control write decoded and parsed a second time to open the row (14 ms TS, 31 ms WASM per 2 000
asks), the clock, then the Proxy traps (`bindGet` allocates a bound function per property read).
`tap_read_cost_us` saw about a fifth of that cost. Relative comparisons carry the same instrument in
both arms and stand; **an absolute on-demand figure from a telemetry build should subtract it.**

**What this does not say.** It does not say the seam is cheap or expensive relative to anything
else; only one side of that comparison was measured. The number to carry into it is *tens of
microseconds per frame*, not the ~1 µs the tap reports for itself. Every figure is
container-measured; the shape is the claim, not the microseconds. The fake delivers without a real
link's jitter, and its chunk counts are imposed, not observed: which row applies is whatever a real
session produces, which nothing here measures.

## The server — deliberately different

The server has no global to patch. It wraps its own pipeline steps in a lab type compiled only with
`--features telemetry`: [`adr-server-pipeline.md`](adr-server-pipeline.md).
