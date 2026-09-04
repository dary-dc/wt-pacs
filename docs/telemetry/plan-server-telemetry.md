# Plan: server telemetry (brief)

**Status:** plan — **not implemented yet** · **Seam unchanged:** `ProductPipeline` +
`RecordedPipeline` ([`adr-server-pipeline.md`](adr-server-pipeline.md))  
**Evidence / backlog:** [`plan-readability-and-performance.md`](plan-readability-and-performance.md)
§4–§5 · **Client track (done):** [`plan-client-telemetry.md`](plan-client-telemetry.md)

---

## What “server telemetry” means

This is the **real** `exact-server` binary, not a separate toy process.

| Build | What runs |
| --- | --- |
| Default (`cargo build -p exact-server`) | Product pipeline only — **no** Tap (absence-checked) |
| Lab harvest (`--features telemetry` + `WTPACS_TELEMETRY=1`) | Same product steps, wrapped by `RecordedPipeline` + Tap |

So the list below improves **how the server records itself when telemetry is on**, and (for
null ≠ 0 / integrity / stamps) **what the JSON means**. It is not “lab-only code paths that
replace the product server.”

**Out of this track for now:** product send-path speedups (P3/P4/P2/P1). Those already live in
[`plan-readability-and-performance.md`](plan-readability-and-performance.md) §5 — deferred, not
forgotten. Do not re-copy them here.

---

## Phases (server telemetry only)

| # | Finding | What | Why first / later |
| --- | --- | --- | --- |
| **S1** | Null ≠ 0 | Distributions skip `None` stages; empty → JSON `null` | **Correctness** — refused frames must not drag means toward 0 |
| **S2** | Per-frame global lock | Clone `SyncSender` into each `Tap`; lock only at setup/shutdown | Lab hot path cheaper; no schema change |
| **S3** | Contiguous stamps + `overhead_us` | Chain stage boundaries; exact partition | Clearer math; **schema + docs** change |
| **S4** | Server integrity block | Mirror client-ish integrity; honest dropped-records name | Trust the artifact |
| **S5** | Readability (optional) | Drop `FrameRecordJson` dup; split `tap.rs`; optional `RowBuilder` | Structure only — same skepticism as client C5; do **after** S1–S4 if the file still hurts |

Suggested order: **S1 → S2 → S4 → S3 → (S5 only if needed)**.  
S3 is listed after S4 because it changes the published invariant and needs doc/absence updates;
S1/S2/S4 do not rewrite the stage story.

---

## S2 · Drop the per-frame global lock (detail)

### Today (easy picture)

There is one process-wide mailbox for finished frame rows. Every emit does:

1. Lock a global mutex  
2. Look at the sender inside  
3. `try_send` the row  
4. Unlock  

```144:157:server/src/record/tap.rs
        if let Ok(guard) = sink_cell().lock() {
            if let Some(tx) = guard.as_ref() {
                match tx.try_send(row) {
                    Ok(()) => {}
                    Err(TrySendError::Full(_)) => {
                        DROP_TOTAL.fetch_add(1, Ordering::Relaxed);
                        self.drops_since_emit = self.drops_since_emit.saturating_add(1);
                    }
                    Err(TrySendError::Disconnected(_)) => {
                        DROP_TOTAL.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
        }
```

The mailbox itself is created once:

```199:207:server/src/record/tap.rs
fn ensure_sink(path: PathBuf) {
    let mut guard = sink_cell().lock().expect("telemetry sink lock");
    if guard.is_some() {
        return;
    }
    let (tx, rx) = sync_channel(RING_CAP);
    *guard = Some(tx);
    // ... spawn drain_loop(rx, path)
}
```

`SyncSender` is already **cloneable**. Locking every frame only to *borrow* that sender is
unnecessary work (and can contend if several sessions emit at once).

### Proposed

At `Tap::for_session()`, after `ensure_sink`, **clone the sender into the Tap**:

```text
Tap { tx: SyncSender<FrameRecord>, … }   // owned clone
try_emit → self.tx.try_send(row)         // no Mutex on the hot path
```

Global `Mutex<Option<…>>` stays for **create once** and **shutdown** (drop the stored sender so
the drain thread’s `recv` loop ends). Last `Tap` drop still triggers shutdown via `ACTIVE_TAPS`.

### Done when

- No `sink_cell().lock()` inside `try_emit`
- Drain thread still writes the report when the last session ends (existing drop contract)
- Unit/regression: last Tap drop terminates drain (channel close)

---

## S3 · Contiguous stamps + `overhead_us` (plan + how the edits look)

### Problem (easy picture)

Today each stage starts its **own** stopwatch, and `serve_us` is a third span from
`begin_frame` → emit:

```155:193:server/src/transport/pipeline.rs
    async fn prepare(...) {
        tap.begin_frame(frame);          // serve_start = now
        let t0 = Instant::now();         // ← new clock
        let result = self.inner.prepare(frame).await;
        tap.record_prepare(micros_since(t0));
        ...
    }
    fn locate(...) {
        let t0 = Instant::now();         // ← another clock (gap since prepare ended)
        ...
    }
    async fn send(...) {
        let t0 = Instant::now();         // ← another clock (gap since locate ended)
        ...
        tap.emit_sent(micros_since(t0), ...);
    }
```

```87:88:server/src/record/tap.rs
    pub(crate) fn begin_frame(&mut self, frame_index: u32) {
        self.serve_start = Some(Instant::now());
```

```126:130:server/src/record/tap.rs
        let serve_us = self
            .serve_start
            .take()
            .map(|t| micros_since(t))
            .unwrap_or(0);
```

**Gaps** between “prepare ended” and “locate’s `Instant::now`” (and locate→send) are inside
`serve_us` but **not** inside any stage. Hence the soft rule:

`serve_us ≥ prepare_us + locate_us + send_us`

Readers must interpret the leftover. Clock is also read many times per frame.

### Goal

One timeline. End of stage *k* = start of stage *k+1*. Publish:

```text
serve_us = prepare_us + locate_us + send_us + overhead_us   // exact (happy path)
```

- **Happy path (all three stages):** with contiguous boundaries, stage sums cover
  `[begin_frame, emit]`, so `overhead_us` is ~0 (or only tiny bookkeeping if we keep any
  work outside the chain on purpose).
- **Refuse / partial path:** missing stages stay `null`; `overhead_us` (or absent send) makes
  the partition still honest — document the refuse rule in the same change.

This **changes** the README / server ADR invariant (inequality → equality + `overhead_us`).
Absence greps must learn the new field name.

### Suggested shape of the code change

**A. Tap holds a stage cursor** (not only `serve_start`):

```rust
// conceptual — not landed
serve_start: Option<Instant>,
stage_mark: Option<Instant>,  // end of last closed stage = start of next

begin_frame:
  let t = Instant::now();
  serve_start = Some(t);
  stage_mark = Some(t);
  clear pendings…

record_prepare / record_locate:  // or a shared close_stage()
  let us = micros_since(stage_mark.take());
  stage_mark = Some(Instant::now());  // next stage starts now
  store us in pending_*

emit_*:
  let send_us = … from stage_mark …
  let serve_us = micros_since(serve_start);
  let overhead_us = serve_us
      .saturating_sub(prepare.unwrap_or(0))
      .saturating_sub(locate.unwrap_or(0))
      .saturating_sub(send.unwrap_or(0));
  // row gains overhead_us: Option<u32> or u32
```

**B. RecordedPipeline stops creating a fresh `Instant::now()` before each inner call.**  
Either:

- pass nothing and let Tap own the marks (prepare calls `tap.stage_begin` / `tap.record_prepare`
  around `inner.prepare` without a local `t0`), or  
- pass the shared mark into helpers — Tap ownership is simpler and keeps product `P` free of clocks.

Sketch for `prepare` after the change:

```rust
async fn prepare(&mut self, frame: u32) -> Result<()> {
    if let Some(tap) = &mut self.tap {
        tap.begin_frame(frame); // sets serve_start + stage_mark
    }
    let result = self.inner.prepare(frame).await;
    if let Some(tap) = &mut self.tap {
        tap.record_prepare_end(); // closes prepare against stage_mark, advances mark
    }
    result
}
```

Same pattern for `locate` / `send` / `refuse` (refuse: emit with `send_us = None`, compute
`overhead_us` from whatever stages ran).

**C. Schema / docs**

- Add `overhead_us` on `FrameRecord` (+ JSON).
- Invariant in `docs/telemetry/README.md` and `adr-server-pipeline.md`.
- `check_telemetry_absent.sh` greps the new literal in default builds.
- Unit test: happy-path row asserts
  `serve_us == prepare + locate + send + overhead`; refuse row asserts absent send and a
  defined rule for overhead.

### Size / risk (why it feels like “several lines”)

It touches **pipeline wrappers + Tap row + JSON + docs + absence + tests** — not huge logic,
but a **wide** change. That is why it is its own phase and not mixed into S1/S2.

### Done when

- Happy-path identity holds in a test  
- Refuse path documented and tested  
- Docs + absence updated  
- No change to the wire or to product `ProductPipeline` bodies  

---

## S1 · Null ≠ 0 (short)

Today `RunAccumulator` does `row.send_us.unwrap_or(0)` (and the same for prepare/locate) into
distribution vectors. **Fix:** push only `Some(us)`; empty distribution → `null` (match client).
Unit test: refused row does not insert zeros.

---

## S4 · Integrity block (short)

Add `summary.integrity` on the server report (rows opened/closed/dropped, sessions,
`ring_capacity`, clock kind). Rename or clarify process-wide `dropped_records` so it is not
read as per-run. Optional later: `valid` / `invalid_reasons` like the client — can land with
S4 or follow once the fields exist.

---

## S5 · Readability (short — optional)

Delete `FrameRecordJson` + `From` if `FrameRecord` can `Serialize` directly; split
`record/tap.rs` into hot path / sink / report; optional `RowBuilder`. **No behaviour change.**
Skip unless editing that file for S1–S4 leaves it painful — same bar as client C5.

---

## Explicitly deferred (already documented elsewhere)

Product send path **P3 → P4 → measure P2 → maybe P1**:
[`plan-readability-and-performance.md`](plan-readability-and-performance.md) §5.  
Not started; not ignored.
