# Plan: telemetry readability and performance

**Date:** 2026-09-03 · **Status:** plan — **nothing implemented**, no product or lab code changed
· **Scope:** client recorder (`client/transport-ts/record/`), server Tap (`server/src/record/`),
server send path (`server/src/transport/`), and the shape of both JSON reports.

**Client track (brief):** apply via [`plan-client-telemetry.md`](plan-client-telemetry.md)
(C1 streaming attributor first). This file keeps evidence and the full backlog.

Pairs with [`README.md`](README.md) (as-built contract),
[`adr-server-pipeline.md`](adr-server-pipeline.md) (server seam),
[`adr-instrument-clients-from-outside.md`](adr-instrument-clients-from-outside.md) (client seam).
**No decision in either ADR is reopened here.** The seams stay where they are; this plan changes
what happens *behind* them.

---

## 0 · The one-paragraph version

The client recorder is **quadratic in bytes received**. On every `read()` it concatenates every
byte the stream has delivered so far, re-parses every frame from offset 0, and re-walks the whole
chunk log. Measured on a 100-frame × 250 KB fill run, that is **3.4 seconds of blocking
main-thread work** interleaved between the very reads it is timing — and the client plan's own
§5.2 says a busy main thread makes `read()` stamps late. **The recorder is currently the dominant
source of the jitter it warns about, and `transfer` and `serve_plus_path` are the two numbers it
corrupts.** A streaming attributor with O(1) memory fixes it: same outputs, verified against the
existing implementation on 300 randomized cases, **3367 ms → 1.2 ms**. Alongside that: the server
folds absent stages into `0` in its distributions (breaking the repo's own null ≠ 0 rule, which the
client already fixed), takes a process-wide mutex once per frame on the serve path, and prefaults
every frame serially when it could overlap disk with network.

---

## 1 · Evidence

All numbers below are measured on this checkout (`3b8f8a6`), Node 22, this container. Method in
[§9](#9--how-the-numbers-were-produced). They are **relative** measurements of recorder cost, not
transport results — nothing here is quotable as a wt-pacs latency claim (evidence tier unchanged).

### 1.1 Client recorder cost, by run size

Driving the real `Tap` through `onMediaRead()` with a synthetic shared-stream byte river,
48 KB reads (a plausible browser chunk size):

| Run | Bytes | Reads | Blocking main-thread work | Bytes memcpy'd |
| --- | --- | --- | --- | --- |
| 20 frames × 250 KB | 5.1 MB | 105 | **188 ms** | 273 MB |
| 50 frames × 250 KB | 12.8 MB | 261 | **1 193 ms** | 1 681 MB |
| 100 frames × 250 KB | 25.6 MB | 521 | **3 367 ms** | 6 684 MB |
| 200 frames × 250 KB | 51.2 MB | 1 042 | **17 775 ms** | 26 709 MB |

10× the frames costs **95×** the time. That is the quadratic signature, and it is not a
micro-optimisation question: at 200 frames the recorder spends ~18 s of main-thread time inside a
run whose transport work is a few seconds.

### 1.2 The same workloads with the proposed streaming attributor

| Run | Current | Proposed | Ratio |
| --- | --- | --- | --- |
| 20 frames | 188 ms | **0.5 ms** | ~380× |
| 50 frames | 1 193 ms | **0.2 ms** | ~6000× |
| 100 frames | 3 367 ms | **1.2 ms** | ~2800× |
| 200 frames | 17 775 ms | **2.6 ms** | ~6800× |
| 2 000 frames | *(hours — not run)* | **8.3 ms** | — |

Linear, and small enough to disappear into the noise floor it is supposed to be measuring.

### 1.3 Correctness of the proposed attributor

The streaming design was checked against the existing `attributeFrames()` on **300 randomized
cases** (1–8 frames, random frame lengths 1–400 B, random read boundaries 1–200 B, so headers
straddle reads constantly): **0 mismatches** on `first_byte_us`, `last_byte_us`, `chunks`, `bytes`,
`start`, `end`, and `byte_closure_ok`.

Two real bugs surfaced during that check, both in the straddling-header case, and both are the
reason this design must not be written from intuition — see [§3.2](#32--the-trap-firstbyte-when-a-header-straddles-reads).

### 1.4 Install-time clock probe

`Tap`'s constructor runs a 50 000-iteration `performance.now()` loop, keeps a 50 000-element array,
and sorts it. Measured cost here: **29 / 44 / 29 ms** across three runs.

`install_t0_ms` is stamped *before* that loop, so the probe lands **inside `connect_ms`**. It is
also long enough to register as a long task, polluting `integrity.long_tasks` — the field used to
**void a run** when the two arms disagree.

---

## 2 · Findings, ranked

Ordered by what a reader of a harvested report would be most misled by.

| # | Finding | Where | Effect on published numbers |
| --- | --- | --- | --- |
| **C1** | Per-read re-concat + re-parse + re-walk is quadratic | `record/tap.ts:148` `tryAttributeStream` | **Inflates `transfer` and `serve_plus_path`**; grows with run size, so bigger runs look worse than they are |
| **C2** | Every received byte is retained for the life of the page | `record/tap.ts:30` `streamBytes` | Memory pressure and GC pauses land inside timed reads |
| **C3** | 30–44 ms clock probe runs inside the constructor | `record/tap.ts:64` | **Inflates `connect_ms`**; can add a long task and void a run |
| **S1** | Absent stages folded to `0` in server distributions | `record/tap.rs:278` `RunAccumulator::push` | **Breaks null ≠ 0.** A refused frame drags `send_us` mean/percentiles toward zero |
| **C4** | `rows.find()` linear scan per media frame and per delivery | `record/tap.ts:183,204` | Quadratic in frame count; small next to C1 but same shape |
| **S2** | Process-wide `Mutex` acquired once per frame on the serve path | `record/tap.rs:144` in `try_emit` | Lab-build serve cost; contends across concurrent sessions |
| **S5** | `JoinSet` of ack tasks never reaped mid-session | `transport/frame_out.rs:74` | Unbounded task/memory growth in per-frame mode over a long session |
| **C5** | `Math.min(...arr)` / `Math.max(...arr)` spread | `record/tap.ts:369,371` | Throws above ~65 k rows; a long run dies at report time |
| **S6** | 8 `Instant::now()` reads per frame, with unmeasured gaps between stages | `transport/pipeline.rs` | Why the invariant is `serve_us >= Σ stages` and not `==`; residual is unattributed |
| **S3** | `FrameRecord` / `FrameRecordJson` are near-duplicates | `record/tap.rs:26,395` | ~40 lines of mechanical copying; a new field must be added in three places |
| **S4** | `tap.rs` mixes hot path, global sink, drain thread, JSON schema and stats | `record/tap.rs` (589 lines) | Hard to change one without reading all |
| **C6** | `tap.ts` mixes clock, stamps, attribution, stage math and report assembly | `record/tap.ts` (496 lines) | Same |
| **R1** | Neither report says "is this run valid?" in one place | both reports | Reader must check 4 integrity fields by hand; a void run reads as a result |
| **R2** | Server report has **no integrity block at all** | `record/tap.rs` | Client can declare itself void; server cannot |

### 2.1 Two findings worth stating plainly

**S1 contradicts a rule this repo already adopted on the other side.** Commit `3a5520e`
("empty distributions are null, not zero vectors") made the *client* honour null ≠ 0. The server
still does `row.send_us.unwrap_or(0)` into the distribution vector. A run with refusals therefore
reports a `send_us` mean that includes zeros for frames that never sent. The two halves of one
contract disagree.

**C1 is not a performance nit; it is a measurement-validity bug.** The client plan §5.2 accepts
that `read()` stamps are late when the main thread is busy, and argues the error is tolerable
because it is small against a 200 ms transfer. That argument holds only if nothing large is running
on the main thread. The recorder puts 3.4 s there. Until C1 is fixed, `transfer` on a fill cell is
measuring the recorder.

---

## 3 · Proposed change — client attribution

### 3.1 Shape

Replace "accumulate everything, re-derive on each read" with a per-stream cursor that consumes
reads once and emits a frame's timing the moment its last byte arrives.

```
today                                    proposed
─────                                    ────────
onMediaRead(chunk)                       onMediaRead(chunk)
  parts.push(chunk)          ← retains     attributor.onRead(chunk, t)
  buf = concat(parts)        ← O(n)          advance cursor, emit finished frames
  parseFootprints(buf)       ← O(n)        (retains ≤ 8 bytes; no codestream kept)
  parseFootprints(buf) again ← O(n)
  attributeFrames(chunks, footprints) ← O(F×C)
  frames.find(...) per new footprint  ← O(F)
```

Invariants preserved exactly (this is what §1.3 verifies):

- `firstByte(k)` = first read delivering **any** byte of frame *k* — including a read carrying only
  part of its 8-byte header
- `lastByte(k)` = first read reaching frame *k*'s end
- `chunks(k)` = reads overlapping `[start_k, end_k)`
- `byte_closure_ok` = every byte seen landed inside an attributed frame

### 3.2 The trap: `firstByte` when a header straddles reads

The obvious implementation stamps `firstByte` when the 8-byte header **completes**. That is wrong,
and the randomized check catches it immediately:

```
ref: frame 0 first_byte_us = 1020     ← the read that delivered the first header byte
got: frame 0 first_byte_us = 1032     ← the read that completed the header
```

The frame's first byte arrived on the earlier read. `firstByte` must be remembered from the moment
the *first* header byte is taken (`pendingFirstUs` below), not from header completion. The same
error appears one frame later when a read finishes frame *k* and carries part of frame *k+1*'s
header.

**A reviewer should require the randomized cross-check against `attributeFrames()` before this
lands.** Both bugs pass a hand-written test with tidy frame-aligned reads.

### 3.3 Reference design (validated, not yet in the tree)

```ts
/** O(1) work per read, O(1) memory. Semantics match offsets.ts attributeFrames(). */
export class StreamAttributor {
  private cum = 0;                 // bytes seen on this stream
  private nextStart = 0;           // river offset where the next frame begins
  private hdr = new Uint8Array(8); // carry for a header split across reads
  private hdrLen = 0;
  private hdrChunks = 0;           // reads that carried partial header bytes
  private pendingFirstUs = 0;      // read that first delivered bytes for the next frame
  private cur: { start: number; end: number; index: number; firstUs: number; chunks: number } | null = null;
  private bad = false;

  onRead(value: Uint8Array, tUs: number): void {
    if (this.bad || value.length === 0) return;
    const prevCum = this.cum;
    this.cum += value.length;
    if (this.cur) this.cur.chunks += 1;   // this read contributes bytes to the open frame

    let off = 0;
    while (off < value.length) {
      if (this.cur === null) {
        // firstByte is the read that first delivered ANY byte of this frame,
        // which may be the read carrying only part of its 8-byte header.
        if (this.hdrLen === 0) this.pendingFirstUs = tUs;
        const take = Math.min(8 - this.hdrLen, value.length - off);
        this.hdr.set(value.subarray(off, off + take), this.hdrLen);
        this.hdrLen += take;
        off += take;
        if (this.hdrLen < 8) { this.hdrChunks += 1; return; }

        const dv = new DataView(this.hdr.buffer, 0, 8);
        const len = dv.getUint32(0, false);
        if (len < 4 || len > this.maxFrameLen) { this.bad = true; return; }
        this.cur = {
          start: this.nextStart,
          end: this.nextStart + 4 + len,
          index: dv.getUint32(4, false),
          firstUs: this.pendingFirstUs,
          chunks: this.hdrChunks + 1,
        };
        this.hdrLen = 0;
        this.hdrChunks = 0;
      }

      const take = Math.min(this.cur.end - (prevCum + off), value.length - off);
      off += take;
      if (prevCum + off >= this.cur.end) {
        this.emit({ /* frame_index, first/last_byte_us, chunks, bytes, start, end */ });
        this.nextStart = this.cur.end;
        this.cur = null;
      } else {
        return;                            // frame continues into a later read
      }
    }
  }

  closureOk(): boolean {
    return !this.bad && this.cur === null && this.hdrLen === 0 && this.cum === this.nextStart;
  }
}
```

`parse.ts::parseFootprintsFromBytes` stays for the tests and for offline replay; it is no longer on
the hot path. `offsets.ts::attributeFrames` **stays in the tree as the test oracle** — deleting it
removes the thing that proves the new code correct.

### 3.4 The rest of the client work

| Finding | Change |
| --- | --- |
| **C2** | Falls out of 3.3 — `streamBytes` / `streamCum` / `streamAttributed` are deleted |
| **C3** | Move the clock probe out of the constructor: run it **after** the run, at `finish()`, or once at page load behind an explicit call the harness makes before `install_t0_ms` is stamped. Cut to ~2 000 iterations tracking a running minimum — no array, no sort. Record the probe's own cost in `integrity` so it is auditable |
| **C4** | Index open rows: `Map<frame_index, OpenRow[]>` beside the existing array. `onAskFlush` walks only rows awaiting flush, not all rows |
| **C5** | Replace spread with a `reduce` min/max |
| **C6** | Split `tap.ts` (496 lines) into `clock.ts` (now, resolution probe, long tasks), `rows.ts` (row lifecycle + stage math), `attribution.ts` (§3.3), `report.ts` (spine, distributions, headline). `tap.ts` keeps only the coordinator and the `getTap`/`setTap` module state |

Also worth fixing while in `report.ts`: the `distKeys` if-chain becomes a table of accessors, and
`pickBinding` uses `chunks > 1` to match the distribution filter (it currently uses `chunks !== 1`,
so a `chunks === 0` row — no media — can still name `transfer` as binding).

---

## 4 · Proposed change — server telemetry

### 4.1 Null ≠ 0 (S1) — the correctness fix

`RunAccumulator` must carry `Option<u32>` and drop `None` rather than pushing `0`:

```rust
// today — a refused frame contributes 0 to the send_us distribution
self.send.push(row.send_us.unwrap_or(0));

// proposed — absent stages are absent
if let Some(us) = row.send_us { self.send.push(us); }
```

`distribution_stats` then returns `Option<DistributionStats>` (serialised as `null` for an empty
sample), matching what the client already does after `3a5520e`. Each distribution also carries its
own `count`, so a reader can see that `send_us` covers 98 of 100 rows.

### 4.2 Drop the per-frame global lock (S2)

`try_emit` currently does `sink_cell().lock()` → `guard.as_ref()` → `try_send` for **every frame**.
`SyncSender` is `Clone` and `try_send` takes `&self`, so the sender can be cloned into the `Tap`
once at `for_session()`:

```rust
pub struct Tap {
    tx: SyncSender<FrameRecord>,   // owned clone; no global lock on the hot path
    …
}
```

The global `Mutex<Option<…>>` stays, but only for setup and shutdown. Shutdown then keys on
`ACTIVE_TAPS` reaching zero **and** every `Tap` (and its sender clone) being dropped — which is
already the `Drop` contract, so the drain thread still terminates on channel close.

### 4.3 Contiguous stamps (S6)

`RecordedPipeline` reads the clock 8× per frame and leaves the gaps between stages unmeasured —
which is exactly why the invariant is `serve_us >= prepare + locate + send`. Threading one `Instant`
through the stages (end of one stage is the start of the next) halves the clock reads and makes the
residual explicit rather than emergent:

```
serve_us = prepare_us + locate_us + send_us + overhead_us     // exact partition
```

Adding `overhead_us` as a real field turns an inequality a reader must interpret into an identity
they can check. **This changes the invariant documented in `README.md` and the server ADR** — see
[§7](#7--what-must-be-amended).

### 4.4 Readability (S3, S4)

- **S3:** derive `Serialize` on `FrameRecord` directly (`#[serde(skip_serializing_if = "Option::is_none")]`,
  `kind` via a unit field or `serialize_with`). Deletes `FrameRecordJson` and its `From` impl — a new
  stage then needs one edit, not three.
- **S4:** split `record/tap.rs` (589 lines) into `record/tap.rs` (hot path: `Tap`, row building,
  `try_send`), `record/sink.rs` (global channel, drain thread, file write), `record/report.rs`
  (JSON types, `RunAccumulator`, `distribution_stats`, `percentile`). The hot path becomes readable
  on its own.
- The `pending_*` fields are a state machine spread across five methods. A `RowBuilder` that
  `begin_frame` creates and `emit` consumes makes the lifetime obvious and removes the "did I
  remember to reset this?" class of bug (`begin_frame` currently resets four fields by hand).

### 4.5 Server integrity block (R2)

The client can declare a run void; the server cannot. Add, mirroring the client's field names:

```jsonc
"integrity": {
  "rows_opened": 320, "rows_closed": 320, "rows_dropped": 0,
  "sessions": 1, "ring_capacity": 4096,
  "dropped_records_process_total": 0,   // renamed: this counter is process-wide, not per-run
  "clock": "std::time::Instant"
}
```

`run_end.dropped_records` reads today as a per-run number but is a process-global atomic. Either
name says so, or make it per-run.

---

## 5 · Proposed change — server send path (product code)

Separate from telemetry. **All of this is a plan; none of it is implemented.**

| # | Change | Why | Risk |
| --- | --- | --- | --- |
| **P1** | **Overlap prefault with send.** `serve_one` is strictly serial: `prepare(k) → locate(k) → send(k) → prepare(k+1)`. Under `RequestFrames` the disk prefault of frame *k+1* could run while frame *k* is on the wire | Each `prepare` is a `spawn_blocking` round trip (thread-pool scheduling + fault time) fully serialized with the network. Overlapping hides disk behind transfer for every frame after the first | **Medium.** Changes the pipeline story; needs a decision on how far to look ahead and what happens on a refused lookahead. `prepare_us` already measures the win |
| **P2** | **Batch the prefault for one `RequestFrames`.** One `spawn_blocking` touching all N frames instead of N round trips | Cheaper than P1 and much simpler. Removes N−1 thread-pool round trips per batch ask | **Low**, but it front-loads all disk before the first byte — the opposite trade from P1. Measure before choosing |
| **P3** | **One 8-byte header write** instead of two 4-byte `write_all` awaits in `FrameOut::send_frame` | Halves the small-write awaits per frame; wire bytes identical | **Low** |
| **P4** | **Reap acks incrementally** — `acks.try_join_next()` each send in per-frame mode (S5) | `JoinSet` currently only drains at session end, so it grows without bound over a long session | **Low** |

**P1 and P2 are alternatives, not a sequence.** Recommendation: **P3 and P4 first** (small, safe,
independently useful), then **measure P2**, and only take P1 if the batch prefault leaves a visible
`prepare_us` on the critical path. P1 is the only item here that touches the story the server ADR
just settled, and it should not be spent before the cheap wins are in.

The `wrap()` full-frame copy this plan would otherwise have targeted **is already gone** —
`FrameOut::send_frame` writes len, index and the mmap slice separately. No action.

---

## 6 · Proposed change — report readability

The reports are machine shapes that a human currently has to decode. Three additions, no removals.

### 6.1 A verdict, in one place (R1)

Today a reader must check `rows_opened == rows_closed`, `byte_closure_ok`, `marks_after_close`,
`first_write_conflicts` and compare `long_tasks` between arms — and the rule that a mismatch makes
the run **void, not a footnote** lives only in the plan doc. Put it in the artifact:

```jsonc
"integrity": {
  "valid": false,
  "invalid_reasons": ["rows_opened 320 != rows_closed 318", "byte_closure_ok false"],
  …existing fields unchanged…
}
```

The recorder already knows every input to that judgement. A reader who checks one field cannot
publish a void run by accident.

### 6.2 Say what bound the run

Per-row `binding_term` exists but nothing rolls it up. In `summary`:

```jsonc
"binding": { "transfer": 94, "serve_plus_path": 4, "deliver": 0, "queue": 0, "none": 2 }
```

One line answers the question the whole report exists to answer.

### 6.3 A renderer, not a richer schema

Rather than growing the JSON for human consumption, add `server/scripts/render_report.py` that
prints a harvested run as one screen:

```
run 2026-09-03T14:02Z · transport-ts · shared · fill · 100 frames   VALID
                  count      p50       p95       max
serve_plus_path      99   61.1ms   780.2ms   781.0ms
transfer             99  203.9ms   244.1ms   251.7ms
deliver              99    1.8ms     3.1ms     4.0ms
queue                 0        —         —         —      (no gesture source)
binding: transfer 94 · serve_plus_path 4 · none 2
frame 0 excluded · clock 5µs · COI true · long tasks 3
```

Keeps the artifact machine-shaped and gives the reader something to paste into a brief. It reads
both files in a run folder and prints them side by side — **without joining them**, which stays
rejected (`README.md`, seam brief Decision B).

### 6.4 Field-name honesty

- `run_end.dropped_records` → say it is process-global, or make it per-run (§4.5)
- `copies.js_heap_bytes_per_frame` is a **mean of `bytes`**, not a measured heap figure. Either
  rename to `mean_frame_bytes` or compute what the name claims — the plan calls this the *primary*
  structural evidence for the arm comparison, so the name must not overstate it

---

## 7 · What must be amended

| Doc | Change |
| --- | --- |
| `docs/telemetry/README.md` | Invariant `serve_us >= prepare + locate + send` becomes the exact partition with `overhead_us` (§4.3); server report gains an integrity block (§4.5); note that server distributions honour null ≠ 0 (§4.1) |
| `docs/telemetry/adr-server-pipeline.md` | Same invariant change under "Report schema"; if P1 is taken later, the serial story in "Decision" needs its own ADR amendment |
| `server/scripts/check_telemetry_absent.sh` | Add any new report string literals (`overhead_us`, `integrity`, `invalid_reasons`) to the absence grep — new field names are exactly what that check exists to catch |
| `client/scripts/check_telemetry_absent.sh` | Same, for new client field names |

**No change to:** the wire, either seam ADR's decision, the two-file harvest, the rejection of a
join product, or the evidence tier of any existing measurement.

---

## 8 · Work plan

Phases are independently landable and ordered by value per unit of risk.

| Phase | Work | Findings | Done when |
| --- | --- | --- | --- |
| **T1** | Streaming attributor behind the existing `Tap` API; `attributeFrames` retained as test oracle | C1, C2 | Randomized cross-check green (≥300 cases); existing `record/test/run.ts` green unchanged; recorder cost linear in a replay bench |
| **T2** | Clock probe out of the constructor; row index; spread → reduce | C3, C4, C5 | `connect_ms` no longer contains the probe; probe cost recorded in `integrity` |
| **T3** | Server null ≠ 0 in distributions; `Option<DistributionStats>` | **S1** | Unit test: a refused row leaves `send_us` distribution `count` short and does not push a 0 |
| **T4** | Server sender clone; drop the per-frame global lock | S2 | Drain thread still terminates on last `Tap` drop (test); no `lock()` in `try_emit` |
| **T5** | Report readability: `integrity.valid` + reasons, `binding` rollup, field-name honesty, server integrity block | R1, R2, §6.4 | A void run says so in one field; absence checks updated |
| **T6** | Split `tap.ts` and `tap.rs`; `RowBuilder`; delete `FrameRecordJson` | C6, S3, S4 | No behaviour change — reports byte-identical to T5 output on a replayed run |
| **T7** | Contiguous server stamps + `overhead_us`; docs amended | S6 | `serve_us == prepare + locate + send + overhead` exactly, asserted in a test |
| **T8** | `render_report.py` | §6.3 | Prints both files of a run folder; no join |
| **P-track** | Send path: P3, P4, then measure P2 | S5, §5 | Separate branch; `prepare_us` before/after on the same fixture |

**T1 first, and on its own.** Every stage number harvested before it is suspect on fill cells, so it
gates re-running the campaign more than anything else here. T6 is deliberately last: a
no-behaviour-change refactor is easy to review only once the behaviour changes are already in.

### 8.1 Tests each phase must add

- **T1:** the randomized cross-check (§1.3) as a checked-in test, not a one-off; straddling-header
  cases explicitly, since both prototype bugs lived there; `byte_closure_ok` false on a truncated
  stream; a read that ends exactly on a frame boundary; a single read carrying several whole frames
- **T3:** refused row excluded from every stage distribution it has no value for
- **T4:** drain thread terminates when the last `Tap` drops (regression guard for the lock removal)
- **T7:** the exact-partition identity, on a row with a refusal and a row without
- **T6:** golden-report test — same synthetic input in, byte-identical JSON out, before and after
  the split

---

## 9 · How the numbers were produced

Reproducible without adding anything to the build:

- **§1.1** — instantiate the real `Tap` from `client/transport-ts/record/tap.ts`, open rows with a
  synthetic `request_frames` FoD write, then feed `onMediaRead()` a synthetic
  `[4B len][4B index][codestream]` river in fixed-size slices; time the loop.
  `node --experimental-strip-types`
- **§1.2** — same river and slice sizes through the §3.3 attributor
- **§1.3** — 300 seeded trials; random frame count/lengths/read boundaries; compare the attributor's
  emissions field-for-field against `attributeFrames()` on the same chunk log and footprints
- **§1.4** — the constructor's probe loop in isolation, three runs

These are **recorder-cost** measurements on this container. They say nothing about wt-pacs transport
latency and are not comparable to any harvested run.

---

## 10 · Out of scope

- Both seams (Proxy on the client, `FramePipeline` on the server) — unchanged
- Client Decision A (byte attribution vs session totals) — this plan makes A1 *cheap*, which is
  evidence for that decision but does not settle it
- Unifying client and server schemas — still deferred (`README.md`)
- Any join or `path_estimate` product — still rejected
- The wire, stream-mode logic, and the evidence tier of any existing measurement
- New stages (decode, paint, cache) — their `null` slots already exist
