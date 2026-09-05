# Plan: server telemetry (brief)

**Status:** **S1–S5 implemented** on this branch · **Seam unchanged:** `ProductPipeline` +
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
| **S3** | Contiguous stamps + `overhead_us` | One mark chain; fewer `Instant::now`s; exact partition | Clearer math; **schema + docs** change |
| **S4** | Server integrity block | Mirror client-ish integrity; honest dropped-records name | Trust the artifact |
| **S5** | Readability | Drop `FrameRecordJson` dup; split `tap.rs`; optional `RowBuilder` | Structure only — **not** faster; do after S1–S4, **separate commit** |

Suggested order: **S1 → S2 → S4 → S3 → S5** (one commit per S).  
S3 after S4 because it changes the published invariant and needs doc/absence updates.

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

## S3 · Contiguous stamps + `overhead_us` (agreed design)

### Problem (easy picture)

Today each stage starts its **own** stopwatch; `serve_us` is a separate span from
`begin_frame` → emit. Time *between* stages sits in `serve_us` only.

Also, each stage does roughly **two** clock reads (`Instant::now` at start + `elapsed()` which
reads again at end). Plus `begin_frame` and serve-at-emit → on the order of **~8** `now`s per
happy-path frame.

### Two facts about the identity

1. **`serve_us` is still measured as a full span** (`serve_start` → emit), **not** computed as
   `prepare + locate + send`.  
2. **`overhead_us = serve_us − prepare − locate − send`** (saturating). That is exactly why the
   field can exist: serve is independent; stages are pieces; overhead is the residual.

On a **perfect** contiguous happy path (last stage’s end stamp == serve’s end stamp, and every
gap attributed into the next stage), residual is **0**. Overhead still matters for **refuse /
partial** rows and for any work after the last stage stamp.

### Units: stay on microseconds

Internal pending durations and the JSON report stay **integer µs**.  
Nanos→µs only if we later see real precision pain (e.g. stages stuck at `0` that we care about).
For prepare (disk) / send (network), µs is enough; do not add conversion for its own sake.

### Where to put each `Instant::now` (start vs end)

Contiguous = **one mark**, each boundary closes the previous stage. Two placements:

| Placement | What a stage includes | Misses (tiny) |
| --- | --- | --- |
| **Stamp at start of each method** (+ final close after last) | From entering this step until entering the next (body + return + caller glue + next call setup) | Arg eval *before* the first line of that method (usually in the caller → folded into the *previous* stage when the next method stamps at entry) |
| **Stamp at end of each method** | From previous end until this end (body; gap after previous is in this stage) | Code after the stamp (e.g. `return`) |

Fidelity difference is **noise** next to disk/network. The useful difference is **readability**.

**Agreed choice: stamp at the beginning of each stage method; close the last stage after it finishes (emit).**

Why:

- Predictable: first line of `prepare` / `locate` / `send` is the clock boundary  
- Easy to explain: “when we *enter* locate, prepare is done”  
- Same contiguous math and ~4 `now`s on the happy path  
- Last stage still needs an end stamp (or emit) so `send_us` includes `inner.send`, not only the gap before it  

```text
prepare entry:  serve_start = mark = now()           // 1
locate entry:   now(); prepare = now−mark; mark=now  // 1  (closes prepare)
send entry:     now(); locate  = now−mark; mark=now  // 1  (closes locate)
after send:     now(); send    = now−mark;           // 1  (closes send)
                serve = now−serve_start;
                overhead = serve − prepare − locate − send
```

### Before → after (`RecordedPipeline`, all stages)

**Before:** local `t0` at the start of every stage + `elapsed` at the end (~8 `now`s).

**After — wrap only when env on (`tap: Tap`); boundaries at method entry; refuse closes open stage:**

```rust
async fn prepare(&mut self, frame: u32) -> Result<()> {
    self.tap.begin_frame(frame); // serve_start = mark = now  (entry)
    self.inner.prepare(frame).await
}

fn locate<'a>(&mut self, store: &'a FrameStore, frame: u32) -> Result<&'a [u8]> {
    self.tap.boundary_prepare_done(); // entry: close prepare, mark = now
    let result = self.inner.locate(store, frame);
    if let Ok(bytes) = &result {
        self.tap.note_locate(LocateOutcome::Ok, bytes.len());
    }
    result
}

async fn send(&mut self, frame: u32, bytes: &[u8]) -> Result<()> {
    self.tap.boundary_locate_done(); // entry: close locate, mark = now
    let envelope_len = ENVELOPE_LEN + bytes.len();
    match self.inner.send(frame, bytes).await {
        Ok(()) => {
            self.tap.emit_sent(envelope_len); // after send: close send + serve + overhead
            Ok(())
        }
        Err(e) => {
            self.tap.emit_write_err();
            Err(e)
        }
    }
}

async fn refuse(&mut self, control: &mut SendStream, frame: u32, err: Error) -> Result<()> {
    self.tap.emit_refused(); // closes open prepare/locate; send_us = null
    self.inner.refuse(control, frame, err).await
}
```

Boundary helper (one `now` — do not `elapsed` then a second `Instant::now()`):

```rust
fn close_against_mark(&mut self) -> u32 {
    let now = Instant::now();
    let us = duration_us(self.stage_mark.take().unwrap_or(now), now);
    self.stage_mark = Some(now);
    us
}
```

### Schema / docs / tests

- Add `overhead_us` on the row + JSON  
- README + ADR: inequality → `serve_us == prepare + locate + send + overhead` (define refuse)  
- Absence grep for `overhead_us`  
- Tests: happy-path identity; refuse path  

### Done when

- Happy-path identity holds in a test; refuse documented and tested  
- Docs + absence updated; product `ProductPipeline` untouched  
- Separate commit from S1/S2/S4/S5  

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

## S5 · Readability (planned — separate commit after S1–S4)

Delete `FrameRecordJson` + `From` if `FrameRecord` can `Serialize` directly; split
`record/tap.rs` into hot path / sink / report; optional `RowBuilder`. **No behaviour change
and no efficiency win** — structure only.

---

## Explicitly deferred (already documented elsewhere)

Product send path **P3 → P4 → measure P2 → maybe P1**:
[`plan-readability-and-performance.md`](plan-readability-and-performance.md) §5.  
Not started; not ignored.
