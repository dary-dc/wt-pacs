# Proposal: `FramePipeline` — wrap methods, not closures

**Date:** 2026-09-01 · **Status:** proposal for review — nothing decided, no product code changed
· scope: **server only** (client Proxy seam and Decision A untouched)
· pairs with [`../server-work-us-semantics-proposal.md`](../server-work-us-semantics-proposal.md)

Two separable questions:

| Doc | Question |
| --- | --- |
| `server-work-us-semantics-proposal.md` | **What should the fields mean?** (`server_work_us` after prefault) |
| **this doc** | **What shape should the seam have?** (how much measurement lives in product code) |

The code in §4 was **compiled and run** before this doc was written (§3). The design is not a
sketch.

---

## 1 · What is actually leaking

Not "telemetry in `server.rs`". The leak is **work that isn't a method on something we can
wrap**. Walk today's `send_one_frame` (`server/src/transport/server.rs:199`) and ask, per step,
*can a decorator see this?*

| Step | On the seam? | Why it leaks |
| --- | --- | --- |
| `sink.ask(idx)` | yes — but `LiveSink::ask` is `{ }` | hook with no product work; pure stamping site |
| `spawn_blocking(touch_frame_pages).await` | **no** | free-standing async in the loop, not a method on anything |
| `sink.time_locate(\|\| store.frame_slice(idx))` | **partly** | decorator sees *the call*, not "prepare vs locate" as product steps |
| `store.frame_slice(idx)` | **no** | reached through a caller-supplied closure, not through the seam |
| `write_fod_msg(control_send, FrameError…)` | **no** | free function, **written twice** in the loop |
| `sink.on_locate_failed()` / `sink.on_refused()` | yes — both `{ }` | hooks that exist so the failure paths have a stamping site |
| `sink.send_frame(idx, bytes)` | **yes** | the one method that does product work |

```
send_one_frame (PRODUCT)              LiveSink (PRODUCT)        RecordedSink (LAB)
──────────────────────────            ──────────────────        ──────────────────
sink.ask(idx) ───────────────────────► { }              ······► stamp T0, ordinal
spawn_blocking(touch).await ─────────►  (never reaches it)  ···► ✗ nothing stamps this
sink.time_locate(|| frame_slice) ────► f()              ······► stamp → server_work_us
sink.send_frame(idx, bytes) ─────────► WRITES BYTES     ······► stamp → server_write_us
sink.on_locate_failed() ─────────────► { }              ······► record NotFound
sink.on_refused() ───────────────────► { }              ······► record Refused
```

**Six call sites; one writes bytes.** The ADR wanted to wrap *the send path*; what got wrapped
were **call sites**, not **the story**. Closures and free functions are where the story escapes
the type — and the two escapes (`spawn_blocking`, `write_fod_msg`) are exactly the two things
the decorator cannot see, which is why the prefault ended up unmeasured after the merge.

Compare the client side of the same programme: `client/transport-ts/record/` is ~1130 lines,
referenced **zero** times from product `src/`.

---

## 2 · The proposal

**Make the whole per-frame story a trait of real methods, then wrap the trait.**

```
                serve_one  ← the story, written once
                    │
    ┌───────────────┼───────────────┬──────────────┐
 prepare()       locate()        send()        refuse()      ← leaf methods, all real work
    │               │               │              │
 LivePipeline: spawn_blocking · frame_slice · write bytes · write FrameError
 RecordedPipeline<P>: stamp → delegate → stamp, one row emitted per story
```

- **`LivePipeline`** — every method does product work. No `{ }` bodies.
- **`RecordedPipeline<P>`** — same decorator pattern as `RecordedSink`, but **one level up** and
  **complete**: it intercepts leaves, not a closure someone handed in.
- **The story lives once.** The session loop calls `serve_one` and nothing else.

This is the "Structural" package from the earlier draft (M1 + M2 + S3), stated the way you would
actually build it.

---

## 3 · Corrections found by compiling it

The natural way to write this design **does not compile**. Four fixes; each is load-bearing.

### C1 — `fn locate(&self) -> Result<&[u8]>` is the borrow trap the ADR was avoiding

```rust
let bytes = self.locate(idx)?;      // immutable borrow of *self, alive while bytes lives
self.send(idx, bytes).await         // needs &mut self  →  E0502
```

> `error[E0502]: cannot borrow *self as mutable because it is also borrowed as immutable`

Verified against `rustc 1.94.1`. This is *precisely* why the pre-pipeline `FrameSink` ADR chose
`time_locate(|| …)`: the closure ties the slice to the **store**, not to the sink. Any pipeline
proposal that owns the store and hands out slices walks straight back into it.

**Fix — thread the store as a parameter so the two borrows are disjoint:**

```rust
/// Slice is tied to `'s` (the store), NOT to `&mut self` — so the borrow of self ends
/// at return, and `send(&mut self, …)` is free afterwards.
fn locate<'s>(&mut self, store: &'s FrameStore, idx: u32) -> Result<&'s [u8]>;
```

This buys `&mut self` on `locate`, which **removes the need for `RefCell` in the wrapper** — the
recorded impl mutates its row builder directly.

### C2 — `async fn` in the trait loses `Send`

`handle_incoming` runs under `tokio::spawn`, so the session future must be `Send`. Bare `async fn`
in a trait desugars to RPITIT with no auto-trait guarantee — which is why the *existing*
`FrameSink` already writes `-> impl Future<Output = Result<()>> + Send`. Keep that discipline:

```rust
fn prepare(&mut self, store: &Arc<FrameStore>, idx: u32)
    -> impl Future<Output = Result<()>> + Send;
```

Verified: the story survives `tokio::spawn` with these bounds and fails without them.

### C3 — `on_ask` stays hollow unless the story is a free function

A default `serve_one` body cannot be called explicitly by an override, so a wrapper that wants to
bracket the story must otherwise re-state it — or keep a hollow `on_ask` hook, which is the
smell we set out to remove.

**Fix — story as a free generic function; the trait default delegates to it; the wrapper
overrides `serve_one` *only* to open and close the row:**

```rust
async fn serve_story<P: FramePipeline>(p: &mut P, store: &Arc<FrameStore>, idx: u32) -> Result<()>
```

The story is written exactly once and `on_ask` disappears. Verified: leaf calls inside
`serve_story` dispatch to the *recorded* impls when called with the wrapper as `P`.

### C4 — `refuse(control: &mut SendStream, …)` threads a stream that only refusal uses

`control_send` is used for exactly one thing: writing `FodMsg::FrameError`. `run_session` reads
from `control_recv`, never writes. So **move `control_send` into the pipeline** — then `refuse`
needs no stream parameter and the session loop's signature shrinks again.

### C5 — the row must be emitted exactly once, on all four paths

The sketch emits inside `send` regardless of outcome, and sets `row.locate_ok` inside `prepare`
— conflating a **prefault** failure with a **locate** failure (a conflation today's
`on_locate_failed` also has). Record the failing stage *where it fails*:

| Path | prepare_us | locate_us | send_us | outcome |
| --- | --- | --- | --- | --- |
| sent | ✓ | ✓ | ✓ | `Sent` |
| write error | ✓ | ✓ | ✓ | `WriteErr` |
| locate failed | ✓ | ✓ | `null` | `LocateFailed` |
| **prefault failed** | ✓ | `null` | `null` | `PrepareFailed` |

`null` where a stage did not run — which the report contract already requires and today's
`0`-for-everything refusal rows quietly violate.

---

## 4 · The shape (verified)

```rust
// server/src/pipeline/mod.rs

/// The per-frame story, written once. The trait default delegates here so a wrapper can
/// bracket it without re-stating it.
async fn serve_story<P: FramePipeline>(p: &mut P, store: &Arc<FrameStore>, idx: u32) -> Result<()> {
    if let Err(e) = p.prepare(store, idx).await {
        return p.refuse(idx, e.to_string()).await;
    }
    let bytes = match p.locate(store, idx) {
        Ok(b) => b,
        Err(e) => return p.refuse(idx, e.to_string()).await,
    };
    p.send(idx, bytes).await
}

pub(crate) trait FramePipeline: Send {
    /// Prefault off the executor (disk-access ADR invariant).
    fn prepare(&mut self, store: &Arc<FrameStore>, idx: u32)
        -> impl Future<Output = Result<()>> + Send;

    /// Resolve the mmap slice. Borrows the store, not self — see C1.
    fn locate<'s>(&mut self, store: &'s FrameStore, idx: u32) -> Result<&'s [u8]>;

    /// Write the frame on the media uni stream.
    fn send(&mut self, idx: u32, bytes: &[u8]) -> impl Future<Output = Result<()>> + Send;

    /// Write FodMsg::FrameError on the control stream. Real I/O, not a hook.
    fn refuse(&mut self, idx: u32, reason: String) -> impl Future<Output = Result<()>> + Send;

    fn drain_acks(&mut self) -> impl Future<Output = ()> + Send;

    fn serve_one<'a>(&'a mut self, store: &'a Arc<FrameStore>, idx: u32)
        -> impl Future<Output = Result<()>> + Send + 'a
    where Self: Sized
    { serve_story(self, store, idx) }
}
```

**Product impl — every method carries work:**

```rust
pub(crate) struct LivePipeline { out: FrameOut, control: SendStream }

impl FramePipeline for LivePipeline {
    async fn prepare(&mut self, store: &Arc<FrameStore>, idx: u32) -> Result<()> {
        let store = Arc::clone(store);
        tokio::task::spawn_blocking(move || store.touch_frame_pages(idx))
            .await.context("join frame page touch")?
    }
    fn locate<'s>(&mut self, store: &'s FrameStore, idx: u32) -> Result<&'s [u8]> {
        store.frame_slice(idx)
    }
    async fn send(&mut self, idx: u32, bytes: &[u8]) -> Result<()> {
        self.out.send_frame(idx, bytes).await
    }
    async fn refuse(&mut self, idx: u32, reason: String) -> Result<()> {
        write_fod_msg(&mut self.control, &FodMsg::FrameError { frame_index: idx, reason }).await
    }
    async fn drain_acks(&mut self) { self.out.drain_acks().await }
}
```

**Lab wrapper — stamp, delegate, stamp; one row per story:**

```rust
#[cfg(feature = "telemetry")]
pub(crate) struct RecordedPipeline<P> { inner: P, row: RowBuilder, tap: Option<Tap> }

#[cfg(feature = "telemetry")]
impl<P: FramePipeline> FramePipeline for RecordedPipeline<P> {
    async fn prepare(&mut self, store: &Arc<FrameStore>, idx: u32) -> Result<()> {
        let t0 = Instant::now();
        let r = self.inner.prepare(store, idx).await;
        self.row.prepare_us = Some(micros(t0));
        if r.is_err() { self.row.failed_at = Stage::Prepare; }   // C5
        r
    }

    fn locate<'s>(&mut self, store: &'s FrameStore, idx: u32) -> Result<&'s [u8]> {
        let t0 = Instant::now();                                  // &mut self → no RefCell (C1)
        let r = self.inner.locate(store, idx);
        self.row.locate_us = Some(micros(t0));
        if r.is_err() { self.row.failed_at = Stage::Locate; }
        r
    }

    async fn send(&mut self, idx: u32, bytes: &[u8]) -> Result<()> {
        let t0 = Instant::now();
        let r = self.inner.send(idx, bytes).await;
        self.row.send_us = Some(micros(t0));
        self.emit(match r { Ok(()) => Outcome::Sent(bytes.len()), Err(_) => Outcome::WriteErr });
        r
    }

    async fn refuse(&mut self, idx: u32, reason: String) -> Result<()> {
        let r = self.inner.refuse(idx, reason).await;
        self.emit(Outcome::Refused);                              // stages that never ran → null
        r
    }

    async fn drain_acks(&mut self) { self.inner.drain_acks().await }

    /// Overridden ONLY to open the row. The story itself is not restated (C3).
    async fn serve_one<'a>(&'a mut self, store: &'a Arc<FrameStore>, idx: u32) -> Result<()> {
        self.row = RowBuilder::start(idx, self.next_ordinal(idx));
        serve_story(self, store, idx).await
    }
}
```

**Wiring — and this deletes today's duplicated `cfg` blocks in `handle_incoming`:**

```rust
let pipeline = LivePipeline::new(out, control_send);
#[cfg(feature = "telemetry")]
let pipeline = RecordedPipeline::new(pipeline);          // shadow; one call site below
run_session(pipeline, control_recv, store, is_shared).await
```

```rust
// the loop, in full
FodMsg::RequestFrame  { frame }  => pipeline.serve_one(&store, frame).await?,
FodMsg::RequestFrames { frames } => for f in frames { pipeline.serve_one(&store, f).await?; },
```

### Compile evidence

A standalone harness with this exact trait shape (stub `FrameStore`, real `tokio`) compiles and
runs on `rustc 1.94.1`: two `serve_one` calls through `RecordedPipeline` produce **exactly two
rows**, every row has `prepare_us` and `locate_us` populated, and the story survives
`tokio::spawn` (proving `Send`). The measured `prepare_us` in that harness was **131 µs** — the
`spawn_blocking` hop, which is the quantity today's `server_work_us` does not contain.
The variant with `locate(&self)` fails to compile with `E0502`, as described in C1.

---

## 5 · What it buys

| Concern | Today | `FramePipeline` |
| --- | --- | --- |
| Closures in the product path | `time_locate(\|\| slice)` | **gone** — `locate` is a method |
| Prefault outside the seam | free-standing in `server.rs` | **`prepare()`** — wrappable |
| Hollow bodies | `ask`, `on_locate_failed`, `on_refused` | **none** — `on_ask` deleted, `refuse` is real I/O |
| Duplicated refuse block | twice in `send_one_frame` | **once**, in `serve_story` |
| Drift when steps move | move a line → field silently re-points | stamps follow **methods**; the story is one function |
| Adding a stage later | new hook + new session-loop call | new **method**; the wrapper stamps it |
| `null` vs `0` | refusal rows report `0` everywhere | stages that didn't run are `null` (C5) |
| Testing the story | needs a live WebTransport session | a fake impl gets `serve_one` free — the four paths become unit-testable |

Scorecard (defined in the earlier draft of this doc):

| | P1 telemetry-only call sites | P2 empty product bodies | P3 drift-safe | P4 absence proof | P5 new deps |
| --- | --- | --- | --- | --- | --- |
| today | 4 | 3 | **no** | holds | none |
| `FramePipeline` | **0** | **0** | **yes** | holds (`RecordedPipeline` never named by default) | **none** |

---

## 6 · What it costs — honestly

1. **The store is a parameter, not a field.** Forced by C1: a pipeline that owns the store cannot
   hand out slices that outlive `&self`. Defensible (the store is session-scoped shared state;
   the pipeline is per-session send machinery) but it is a consequence, not a preference.
2. **`serve_one` carries `where Self: Sized`**, so `FramePipeline` is not object-safe. Fine today —
   it is used generically, never as `dyn` — but it forecloses a runtime-selected pipeline.
3. **`control_send` moves into the pipeline** (C4). Any future control-plane write outside the
   per-frame flow would have to go through it or take the stream back.
4. **Bigger refactor than a patch:** landed as `pipeline.rs` + `frame_out.rs` (was `frame_sink.rs`),
   plus `server.rs`, `record/`, tests, ADR. `FrameSink`/`LiveSink`/`RecordedSink` are **deleted**;
   `FrameOut` survives as `LivePipeline`'s field.
5. **A new leaf method could be added un-stamped.** The row would simply lack a field — a soft
   failure. Mitigate with a row-completeness test over all four paths (§3 C5 table).
6. **`Recorder` should go with it.** It exists so *product* code can call it without knowing
   `Tap`; no product code calls it any more, so `RecordedPipeline` holds `Option<Tap>` directly and
   `record/mod.rs`'s cfg fork is deleted. The `recorder_is_zero_sized` test goes too — the
   replacement guarantee is absence-by-construction at `handle_incoming` plus the existing script.

---

## 7 · Alternatives considered

| Option | Verdict | Why |
| --- | --- | --- |
| **Keep `FrameSink` as-is; fix field semantics only** | viable minimum | The number stops lying, but the closures, hollow hooks and duplicated refuse block stay. Choose if appetite is one commit. |
| **`tracing` spans + a lab `Layer`** | plausible, needs a spike | Spans are legitimate operability; no bespoke trait. **But** span field names are string literals that only vanish via `tracing`'s `release_max_level_*` feature, and Cargo features are *additive* — so the lab build must become `--no-default-features --features telemetry`, and any crate enabling that feature poisons the absence check. Prototype against `check_telemetry_absent.sh` before adopting. |
| **External observation (eBPF/uprobe), zero server code** | cross-check, not a seam | Frame index under `RequestFrames` needs register reads (the objection that killed Decision C option C2); `touch_frame_pages` may inline away in release; `verify_e2e.py` still expects a `telemetry-server.json`; rig `CAP_BPF` unknown. |
| **`Prepared<'a>` token carrying stamps** | folded in | The typed version of "the row travels with the bytes". Unnecessary once `locate` borrows the store (C1) — the wrapper holds the row directly. Revisit only if stages ever need to outlive `serve_one`. |

---

## 8 · Landing order

Each rung is independently landable and leaves the tree consistent.

```
1. semantics      prepare_us / locate_us / send_us / serve_us + `serve ≥ Σ stages` test
2. pipeline       FramePipeline + LivePipeline + RecordedPipeline   ← this doc
3. row-as-value   RowBuilder replaces Tap's serve_start / pending_*
4. delete         Recorder cfg fork, FrameSink, LiveSink, RecordedSink
5. schema         `schema: "server-pipeline-v1"`, null stages, absence-script literals
```

Rungs 2–4 are naturally one change (the wrapper needs the row builder; the row builder obsoletes
`Recorder`). Rung 1 can go first or last — it is independent. Rung 5 is cheap: the only reference
to `server_work_us` outside `tap.rs` in the whole tree is a string literal in
`check_telemetry_absent.sh:36`.

**Docs to amend:** `docs/telemetry/adr-server-pipeline.md` (amended 2026-09-02; describes
`time_locate`, which would no longer exist — this is an amendment, not a reversal: the decorator
principle is kept and completed), `docs/disk-access/adr.md` (prefault moves from `server.rs` into
`LivePipeline::prepare`), `docs/telemetry/README.md` (code map, stage table).

---

## 9 · Questions for the approver

1. **Is the ADR's intent "no line that exists only to be measured", or just "no clock and no Tap
   type in product code"?** Today's seam meets the second, not the first. This proposal is only
   worth its refactor if the first is the goal.
2. Is `LivePipeline` the right owner of the executor-safety invariant, or must `spawn_blocking`
   stay visible in the session loop for reviewability?
3. Is threading `store` as a parameter (§6.1) acceptable, given the alternative does not compile?
4. Is the lab expected to gain more stages (write progress, ask queueing, batch position)? If yes,
   rung 3 stops being optional — every new stage adds an ordering dependency to today's `Tap`.
5. Should rung 1 (field names) land first, so a campaign can run on corrected numbers before the
   refactor?

---

## Appendix · Reproducing the C1 check

Minimal repro of the borrow trap, so a reviewer can confirm §3 C1 without rebuilding the server.
`cargo check` on a scratch crate with `anyhow` + `tokio`:

```rust
trait FramePipeline: Send {
    fn locate(&self, idx: u32) -> Result<&[u8]>;                       // ← the trap
    async fn send(&mut self, idx: u32, bytes: &[u8]) -> Result<()>;
    async fn serve_one(&mut self, idx: u32) -> Result<()> {
        let bytes = self.locate(idx)?;
        self.send(idx, bytes).await      // error[E0502]: cannot borrow `*self` as mutable
    }
}
```

Changing the signature to `fn locate<'s>(&mut self, store: &'s FrameStore, idx: u32) ->
Result<&'s [u8]>` and passing the store in from the session compiles, runs, and keeps the
future `Send` across `tokio::spawn`. That single signature is what makes the rest of §4 possible
without `RefCell`, without a `Prepared` token, and without a closure.
