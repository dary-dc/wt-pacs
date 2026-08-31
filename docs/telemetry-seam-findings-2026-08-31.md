# Telemetry seam — session findings and proposals

**2026-08-31** · **Status: findings archive.** Decision C was **accepted** as the
`FrameSink` / `RecordedSink` decorator ([`adr-server-frame-sink.md`](adr-server-frame-sink.md)).
§5 proposals below are historical context; do not re-litigate the seam against them without
amending the ADR.

**Revision note.** First drafted against `64e2c0a`; revised against `9832e9f` after `61dbd29`
removed the `wrap()` memcpy from the send path. §2.3 and §3.1 changed materially in that
revision — §3.1 records a conclusion this document got wrong. All file:line citations were
re-verified against `9832e9f` (line numbers for `server.rs` stamps are obsolete after the
FrameSink move).
Companion to [`telemetry-seam-decision-brief.md`](telemetry-seam-decision-brief.md) (Decision C)
and [`server-frame-pipeline-telemetry-plan.md`](server-frame-pipeline-telemetry-plan.md) (draft).

---

## 0 · What this document is, and how to use it

Output of a design session that only **read** the tree. It records problems found with
file:line evidence, corrections to statements in existing docs that are stale or wrong, and
solution proposals with their tradeoffs. **The choosing was deliberately not done.**

Three rules for whoever picks this up:

1. **Do not implement from this document alone.** §7 lists what the owner must decide first.
   Proposals are written to be accepted, rejected, or combined — not executed as a plan.
2. **Do not bundle the seam change (§5) with the send-path refactor (§6).** They are
   independent decisions with different risk, and §6 is a partial revert of a deliberate commit.
3. **Read §3 before quoting anything from the existing telemetry docs.** Two load-bearing
   statements in them are stale.

---

## 1 · What this session settled

| Question | Settled position | Note |
| --- | --- | --- |
| **What drives the server change** | **Readability**, not measurement. The code must be presentable to other engineers — a source where the main logic is barely visible cannot be discussed or reviewed | Zero-cost in the default build is already met (§3.3 is the one exception) |
| **Line budget** | Not a target. The complaint is *density in one function*, not total count. Relocation beats subtraction | §2.2 |
| **Stamp placement** | **Phase boundaries only.** No stamps inside `write_payload` | Excludes a `stream_open` stage; see §2.3 |
| **Report shape** | **Phases + total.** No derived or speculative fields | Consistent with dropping `path_estimate` |
| **`wrap` as a named phase** | **Dropped by the owner — and moot as of `61dbd29`.** The phase no longer exists in the code | §2.3 records what its removal did *not* fix; §3.1 records the correction |
| **Data compatibility** | Not a constraint. Owner controls all consumers; a hard cut with a schema version key is acceptable | Supersedes the brief's caution about mid-campaign schema drift |
| **Decision B (`path_estimate` / join)** | Unchanged — stays withdrawn | |

Not settled: the seam mechanism (§5), the send-path refactor (§6), Decision A (§2.8).

---

## 2 · Problems found

Severity is about *this workstream*, not the product.

### 2.1 · P1 — Six clock reads per frame produce two phases and a total

Per frame, success path:

| # | Read | Site |
| --- | --- | --- |
| 1 | `Instant::now()` → `serve_start` | `server/src/record/tap.rs:123` |
| 2 | `Instant::now()` | `server/src/transport/server.rs:217` (`let t0 = rec.stamp()`) |
| 3 | `t0.elapsed()` | `tap.rs:129` → `micros_since`, `tap.rs:154-159` |
| 4 | `Instant::now()` | `server.rs:222` (`let t1 = rec.stamp()`) |
| 5 | `t1.elapsed()` | `tap.rs:138` |
| 6 | `serve_start.elapsed()` | `tap.rs:87-91` (inside `try_emit`) |

Reads **#1 and #2 are consecutive statements** — two timestamps of the same instant, because
`ask()` stamps internally *and* the caller opens its own stopwatch.

Boundary stamping produces the same report from **three** reads (ask, after-locate,
after-send) — or **four** if a third phase is ever named. The current design pays for stamps
that *overlap* rather than stamps that *divide*.

**Severity: medium.** Lab-build cost only; the real damage is that it makes the seam look
expensive and forces the `t0`/`t1` locals in P2.

### 2.2 · P2 — Product code holds clock state, contradicting the module's own invariant

`server/src/record/mod.rs:3` states the design intent: *"The product path hands facts in and
never reads state back (I2)."*

`Recorder::stamp()` (`mod.rs:35-41`) returns a value the product path stores in `t0` / `t1`
(`server.rs:217`, `server.rs:222`) and hands back in `rec.located(t0, …)` / `rec.wrote(t1, …)`.
**That is the product path reading state back.** It is also the specific thing that makes
`send_one_frame` read as half-measurement — more than the `rec.*` calls themselves.

**Severity: high** for the stated goal. This is the readability defect, precisely located.

### 2.3 · P3 — Cold-page cost is now inside `write_all`, where no boundary can reach it

**Revised against `61dbd29`.** The `wrap()` memcpy this finding originally described is gone
(§3.1). What it was hiding is not.

`server.rs:222-226` still starts one stopwatch before the send and stops it after, so
`server_write_us` contains, in per-frame mode, `connection.open_uni().await.await`
(`server.rs:274-279`) and all three `write_all` calls (`server.rs:266-268`, `server.rs:279-281`).

The study is memory-mapped (`server/src/media/frame_store.rs:23`) and `frame_slice`
(`frame_store.rs:45-59`) is a bounds check plus a slice — **it never touches a page**. Before
`61dbd29`, first touch happened inside `wrap`'s memcpy. Now the codestream slice goes straight to
`write_all`, so **first touch happens inside QUIC's copy into its send buffer**.

For attribution that is worse, not better: page-fault cost and network flow-control blocking are
now inside *the same function call*. No stamp at a phase boundary can separate them, because there
is no boundary between them to place one at. A `wrap` phase could once have isolated the fault
cost; that option is gone.

`lab/cold-page-bench` remains the only place this cost is observable — and is now structurally the
only place it can be.

**Severity: low for the report, but it closes a door.** Recorded so the question is not re-opened
as if the option still existed. If page-fault attribution is ever wanted, it needs a warm/cold A-B
on the bench, not a server stamp.

### 2.4 · P4 — `server_work_us` times a bounds check

`located` measures `store.frame_slice(idx)` — an index lookup and a slice construction, no I/O
and no page touch. Structurally sub-microsecond; it can never be the binding term. The same
call carries `LocateOutcome::NotFound`, which *is* wanted.

**Proposal: keep the event, drop the duration.** Removes a report field that is permanently ~0
and can only invite misreading.

**Severity: low. Cheap to fix, zero information lost.**

### 2.5 · P5 — Feature-compiled-but-disabled builds are not free

`mod.rs:35-41`:

```rust
pub fn stamp(&self) -> Stamp {
    #[cfg(feature = "telemetry")]
    { std::time::Instant::now() }
}
```

No `self.tap.is_some()` check. A binary built `--features telemetry` with `WTPACS_TELEMETRY`
unset still reads the clock twice per frame.

This contradicts `server-frame-pipeline-telemetry-plan.md` §4, which claims that build has
*"no clocks on emit if gated inside `if let Some(tap)`"*. It is aspirational, not current.

**Default builds are unaffected** (`Stamp = ()`, empty body). The consequence is narrower:
**"same binary, telemetry off" is not a valid control arm** for any instrumented-vs-not
comparison.

**Severity: low for production, blocking for anyone who plans that control arm.**

### 2.6 · P6 — Absence is an optimizer outcome, not a compilation fact

The default build's guarantee rests on `Stamp = ()`, empty `#[inline(always)]` bodies, a ZST
`Recorder`, the `recorder_is_zero_sized` test (`mod.rs:89-94`) and an `nm` symbol sweep. That
is good coverage, and no defect is claimed. But the guarantee's *form* is "the optimizer
removed what we wrote", not "nothing was written".

Separately, a real gap: `server/scripts/check_telemetry_absent.sh` checks `nm` symbols and
`cargo tree` only. It does **not** grep the binary for report field-name string literals.
The client twin does, and its own comment calls that *"the check that actually bites"* —
serde field names live in the data section and survive symbol stripping.

**Severity: medium, and independent of every other decision here.** The absence-script gap is
worth closing under any seam choice.

### 2.7 · P7 — A session-scoped decision is re-made every frame

`StreamMode` is a real enum (`server.rs:30-44`), selected once per process
(`main.rs:19-20`) and resolved once per session (`server.rs:120-131`). It is then **discarded
into an `Option<SendStream>`**, and `write_payload` reconstructs the decision by matching that
Option on every frame (`server.rs:264`).

Downstream cost: `send_one_frame` needs `connection` *and* `shared` *and* `acks` because it
cannot know which it will need until it re-checks — hence seven parameters and
`#[allow(clippy::too_many_arguments)]` (`server.rs:205-214`). The `acks` JoinSet exists only
for per-frame mode but is threaded through shared-mode code. Both FoD arms
(`server.rs:164-186`) then repeat the same nine-argument call.

**This is a product-code finding, not a telemetry one.** See §3.2 before proposing a fix, and
§6 for why it must be decided separately.

**Severity: medium. It is the reason the function is hard to read at all.**

### 2.8 · P8 — The brief's Decision A table does not match the tree

`telemetry-seam-decision-brief.md` presents A1–A4 as open. What is built is **A4 (hybrid)**:
`client/transport-ts/record/proxy.ts` (A1, byte-level via the patched global) plus
`wrap-session.ts` (A2, gesture and delivered on public methods). It is validated through
phase 8 locally — `docs/measurements/client-telemetry-phase8-local.json` records
`byte_closure_ok` true, `instanceof` surviving the Proxy, `crossOriginIsolated` with a measured
5 µs clock, and the client absence check green.

The argument for closing A is a **failure-mode asymmetry**, not aesthetics: A1/A4's weakness
(offset arithmetic) is self-checking — footprints must sum to the cumulative byte count or the
report declares itself invalid. A3's weakness (the TS and WASM arms drifting to different
stamp points) is **not** self-checking; no field in the report would reveal it. A1 fails
loudly, A3 fails silently.

**Owner has kept A open.** Recorded as open, with the above as the standing argument to beat.
The concrete improvement available inside A is **not** A3; it is P9.

**Severity: low. Documentation accuracy.**

### 2.9 · P9 — The client infers phases; the server observes them

`record/offsets.ts` reconstructs frame boundaries from a `(timestamp, cumulative bytes)` log
and known footprints. The server, under any §5 proposal, stamps boundaries it actually sits on.

That is a permanent, structural difference in how much each side's per-phase numbers can be
trusted — the client's are *derived*, the server's are *observed*. Defensible, and the
integrity check makes it honest. It should be a written decision rather than something a
reader discovers when the two reports disagree.

**Severity: low now, high the first time somebody reads the two files side by side.**

### 2.10 · P10 — `frame_envelope::wrap` is now dead product code

After `61dbd29` the server imports `ENVELOPE_LEN` only (`server.rs:18`). The sole remaining caller
of `wrap` is its own unit test (`common/frame-envelope/src/lib.rs:36`); no client, lab or tool
crate calls it. `unwrap` is still used by clients — only `wrap` is orphaned.

**Severity: trivial, and outside this workstream.** Recorded because it is exactly the residue an
essentialist pass exists to catch.

---

## 3 · Corrections to the record

### 3.1 · `wrap` has been removed — and this document's earlier reasoning was wrong

**Superseded by `61dbd29` (2026-08-31), which landed after the first draft.**

The original text of this section stated that `wrap` was still in the send path and that removing
it would require **a wire change** — citing the route written down in `send-path-copy-costs.md`
(carry the display index in a header field; hand out `Bytes` pointing into the mapping) — and
concluded it was therefore out of scope.

**That conclusion was wrong.** `61dbd29` removed the copy with the wire untouched, by not
assembling a contiguous envelope at all: three `write_all` calls — length prefix, 4-byte display
index, mmap codestream slice — instead of one buffer. Clients needed no update. This document had
followed the only removal route that was written down, and missed the simpler one that was not.

Two residues for anyone working from the old text:

- `docs/send-path-copy-costs.md` **no longer exists.** Its enduring content is now `docs/WIRE.md`
  § *"Server send path (copy discipline)"*. Citations to the old file are dead.
- **One full-frame copy remains and is not removable here.** `wtransport` exposes only
  `write_all(&[u8])`, so QUIC copies the codestream into its send buffer for retransmission.
  That ceiling is unchanged; WIRE.md documents it, and the link-rate knee sweep is still open.

### 3.2 · `FrameSink` already existed and was deliberately deleted

Commit `569f16a` ("feat(server): separate stream modes with FrameSink (option C)") introduced
`server/src/transport/sink.rs` — 206 lines, a `StreamMode` enum, `FrameSink::{Shared,
PerFrame}`, an ack channel, and a `PeerAckStamp` trait with impls for `()` and `Instant`.

Commit `8f367c4` ("refactor(server): inline stream mode and collapse Record to Recorder",
2026-08-28) **deleted it**, in the same commit that replaced the `R: Record` generic with the
concrete zero-sized `Recorder`. That commit removed 547 lines and added 374. It was an
explicit de-ceremony pass.

Two consequences, both binding on this document:

- **§6 (send-path type) is a partial revert of `8f367c4`.** It must argue against that commit's
  reasoning, not around it. The mitigating distinction: the deleted `FrameSink` carried a
  telemetry generic (`S: PeerAckStamp`) and an ack channel through it. A mode-only type with
  no generics and no channel is a much smaller object than what was removed — but that has to
  be demonstrated, not asserted.
- **§5.4 (wrapper over a trait) is a fuller revert of the same commit.** `mod.rs:89` names the
  deleted machinery directly: *"The guarantee the deleted `Record`/`Noop` type parameter used
  to provide."* Reintroducing a recorder trait walks back a simplification already paid for.

### 3.3 · The server plan's zero-cost claim for the middle build is aspirational

See P5. `server-frame-pipeline-telemetry-plan.md` §4's middle row does not describe the
current code.

---

## 4 · Constraints any proposal must satisfy

Carried from the brief and this session. A proposal that breaks one of these is out, not
negotiable in review.

1. **Default build carries no telemetry surface.** No symbols, no report string literals; CI
   absence check must still pass — and should be strengthened per P6.
2. **Stamps at phase boundaries only.** Nothing inside `write_payload`.
3. **`ask(idx)` stays an explicit, index-carrying call.** `RequestFrames` is one control
   message and *N* sends; no wrapper can recover the frame index positionally. Zero telemetry
   tokens in the send path is therefore impossible, and is not the goal.
4. **Product code reads no clock.** The Recorder owns every timestamp.
5. **Product code never formats a report.**
6. **Wire unchanged.**
7. **Null ≠ 0.** Absent stages export `null`.
8. **No derived metrics as first-class outputs.** Two independent JSON files, no join.

---

## 5 · Seam proposals

Numbered S1–S5 to avoid collision with the brief's C1–C4. Each is stated with what the loop
reads like and what it costs. **Ranking in §5.6; the choice is not made here.**

### 5.1 · S1 — Move the clocks inside the Recorder

Smallest change that fixes the actual defect (P2). No structural change, no new concept.

```rust
rec.ask(idx);
let bytes  = store.frame_slice(idx);
rec.located(&bytes);                 // Tap holds the previous stamp itself
let payload = wrap(idx, bytes?);
write_payload(connection, shared, acks, &payload).await?;
rec.sent(payload.len());
```

- **Removes:** `t0` / `t1` from product code; two of the six clock reads (P1); the I2 violation.
- **Leaves:** three or four `rec.*` lines visible in the loop.
- **Risk:** very low. Touches `record/` and the call sites, nothing else.
- **Does not achieve:** a loop with no telemetry tokens.

### 5.2 · S2 — Expression macro at the phase boundary

The option missing from the earlier analysis, and the direct answer to *"is this the best Rust
can do?"* It is what `tracing` does structurally, without adopting `tracing` (§5.5).

```rust
// lab build (feature = "telemetry")
macro_rules! phase {
    ($rec:expr, $name:ident, $e:expr) => {{
        let __out = $e;
        $rec.$name(&__out);   // stamp; outcome derived from &__out
        __out
    }};
}

// default build — expands to the bare expression
macro_rules! phase {
    ($rec:expr, $name:ident, $e:expr) => { $e };
}
```

The loop:

```rust
rec.ask(idx);
match phase!(rec, located, store.frame_slice(idx)) {
    Ok(bytes) => {
        let payload = wrap(idx, bytes);
        phase!(rec, sent, write_payload(connection, shared, acks, &payload).await)?;
    }
    Err(err) => { /* existing FrameError path */ }
}
```

**Why this is the strongest candidate on the stated criteria:**

- **Absence becomes a compilation fact, not an optimizer outcome (P6).** In default builds the
  macro expands to the product expression and nothing else — there is no empty function to
  inline away and no `()` stamp to eliminate. This is a *stronger* guarantee than today's, and
  it is the only proposal here that improves R1 rather than merely preserving it.
- **No trait, no generic, no restructure, no borrow-checker fight.** It does not revert
  `8f367c4` in any part.
- **Product expressions stay where they are.** `store.frame_slice(idx)` and
  `write_payload(...).await` are unmoved and fully visible; the macro annotates, it does not
  relocate.
- **The outcome enums leave the product path.** Recorder methods take `&Result<…>` and derive
  the outcome, so `LocateOutcome::Ok`, `WriteOutcome::Sent` and `WriteOutcome::WriteErr`
  (`record/types.rs`) stop being named in `server.rs` at all — three more telemetry tokens gone
  from product code.

**Costs and traps, to be weighed by whoever chooses:**

- A macro in the product path is its own readability tax; some reviewers dislike macros on
  sight. One small macro with a doc comment is the mitigation, and `tracing`'s ubiquity is the
  precedent.
- `$e` must be able to contain `.await` and be followed by `?` outside the macro. The sketch
  above does this correctly; a test should pin it.
- **Unused-variable warning trap:** in default builds the macro never mentions `$rec`. `rec`
  stays live only because `rec.ask(idx)` remains a real call (constraint §4.3). If `ask` is
  ever macro-ised too, default builds will warn — and warnings are how this regresses silently.
- Macro hygiene: `__out` must not shadow anything the caller passes. `macro_rules!` hygiene
  covers this, but a test with a caller-side `__out` is cheap insurance.

### 5.3 · S3 — Stamps inside per-phase leaf functions

Each phase becomes its own function that stamps at its own boundary; `send_one_frame` reads as
pure narrative with zero telemetry tokens.

**Judged too invasive by the owner.** Recorded with its one non-obvious constraint, which any
future attempt will hit: the phases must be **free functions taking `store` and `rec` as
separate parameters**, not `&mut self` methods. A `&mut self` method returning `&[u8]`
borrowed from `self` blocks the next `&mut self` call — the readable version does not compile.

### 5.4 · S4 — Wrapper type over a trait (`Recorded<S: SendPath>`)

Product type holds zero telemetry tokens; default builds never instantiate the wrapper, so
absence is structural — the Rust analogue of the browser Proxy, and the most elegant on paper.

**Recommend against, on the tree's own history.** Per §3.2 this is a fuller revert of
`8f367c4`, which deleted exactly this shape (`R: Record` generic + `PeerAckStamp` trait). It
also spreads a type parameter through `run_session`. The owner's assessment — *"a lot of
ceremony"* — matches what the commit log already concluded once.

### 5.5 · S5 — `tracing` spans

`tracing` is already a workspace dependency and is used in `server.rs` (`info!`, `warn!`).
`trace_span!(...).entered()` with static max-level features is the answer a senior reviewer
will reach for, so it needs a written rebuttal even though it is not recommended.

**Why it likely loses here:**

- The report contract needs ask ordinals (`take_ordinal`), nearest-rank percentiles, null≠0
  discipline, and an integrity block. Producing that from spans means writing a custom `Layer`
  that reimplements the existing Tap inside a general-purpose framework.
- Span machinery allocates per span in lab builds, perturbing what it measures — the Tap's
  bounded ring was chosen precisely to avoid that.
- Absence would depend on `tracing`'s static-level dead-code elimination, which is weaker
  evidence than S2's "nothing was emitted".

**Where it wins:** familiarity, and free integration with existing log output. If the owner
ever wants operational tracing *in production* (a different requirement from lab telemetry),
this is the seam for that — and it should be kept separate from this contract.

### 5.6 · Ranking, for the chooser to accept or overturn

| Rank | Proposal | One-line case |
| --- | --- | --- |
| 1 | **S2 (macro)** | Only option that *strengthens* the absence guarantee; no revert, no restructure, no ceremony |
| 2 | **S1 (clocks inside Recorder)** | Fixes the located defect (P2) with near-zero risk; a valid stopping point on its own |
| — | S3 | Only if §6 happens for independent reasons |
| — | S4 | Documented and rejected — reverts `8f367c4` |
| — | S5 | Documented and rejected for lab telemetry; the right seam for production tracing |

**S1 and S2 compose.** S1 first (Recorder owns the clocks, methods take `&Result`), then S2 is
a mechanical wrapping of the resulting call sites. Landing S1 alone is a coherent outcome if
S2 is rejected; landing S2 without S1 is not.

---

## 6 · The send-path refactor (P7) — a separate decision

Collapsing `Option<SendStream>` into a type that names the mode would delete the per-frame
re-branch, the seven-argument signature, the `too_many_arguments` allow, and the duplicated
call in both FoD arms. It is a product-code improvement with no telemetry motive, which is the
bar the owner set.

**It is also a partial revert of `8f367c4` (§3.2), and must not be bundled with §5.**

Whoever takes it up should answer, in writing, before touching code:

1. What in `8f367c4`'s reasoning has changed? "Readability" was that commit's motive too.
2. Can the type be mode-only — no generics, no ack channel, no `PeerAckStamp` — and how many
   lines is it? The deleted `sink.rs` was 206 lines; if the replacement approaches that, the
   commit was right and this should not happen.
3. Does the per-frame `finish()`-off-the-loop behaviour (`server.rs:285-289`, required by
   `adr-frame-framing-and-loop-shape.md`) survive unchanged?

If the answers are unconvincing, the correct outcome is **no refactor**, and S1 or S2 applied
to the current shape.

---

## 7 · Open questions the owner must answer before implementation

1. **Seam choice: S2, S1, or S1-then-S2?** (§5.6 ranks them; the ranking is not a decision.)
2. **P4** — drop `server_work_us`'s duration while keeping the `NotFound` event?
3. **§6** — is the send-path refactor authorised as an independent change, or deferred?
4. **P5** — fix the feature-on/env-off clock read, or accept it and delete the plan's §4 claim?
5. **P6** — extend the server absence script with a string-literal sweep? (Recommended under
   every branch; no dependency on 1–4.)
6. **Decision A / P8-P9** — kept open by the owner. What evidence would settle it, and is the
   client-infers / server-observes asymmetry (P9) accepted as a written position?
7. **Schema** — hard cut with `schema: "server-pipeline-v1"`, given §1 removes the
   compatibility constraint?

---

## 8 · Acceptance checks for whichever proposal is chosen

Mechanical where possible, so "clean enough" stops being a matter of taste.

- `send_one_frame` contains **no `Instant`, no `Stamp`, and no local holding a timestamp**.
- `record/types.rs` outcome enums are **not named in `server/src/transport/`** (S2 only —
  under S1 they may remain).
- `cargo build --release -p exact-server` (default features): `check_telemetry_absent.sh`
  passes, **including a new report-field-literal sweep of the binary** (P6).
- `recorder_is_zero_sized` still passes.
- Clock reads per frame in the lab build are **counted and recorded** in the PR description —
  the claim in P1 must be verified, not assumed.
- Under S2: a test proving the macro forwards `.await`, composes with `?`, and is hygienic
  against a caller-side `__out`.
- Under S2: a default-build compile with `-D warnings` — the unused-`rec` trap in §5.2 must be
  proven absent.
- A **golden-output test**: fixed synthetic session in, byte-identical JSON out modulo
  timestamps. Without it, "do not regress the trusted numbers" is a hope, not a check.

---

## 9 · Documents to amend once decisions land

| Document | Amendment |
| --- | --- |
| `telemetry-seam-decision-brief.md` | Decision A table is stale — what is built is A4, not "open" (P8). Decision C options gain S1/S2/S5. Record that data-compatibility is not a constraint (§1) |
| `server-frame-pipeline-telemetry-plan.md` | Remove "Chosen: domain events" once C is decided. Correct §4's middle-row zero-cost claim (P5 / §3.3). Answer its open question 1 with the §1 hard-cut position |
| `adr-instrument-clients-from-outside.md` | Its closing paragraph offers "wrap `frame_slice` and `write_all`, leave `rec.ask(idx)` inline" as the cheap 80%. Whichever of S1/S2 lands supersedes that sketch |
| `client-frame-pipeline-telemetry-plan.md` | §10's percentile reconciliation is still outstanding work regardless of C |
| `WIRE.md` | Now carries the send-path copy discipline absorbed from the deleted `send-path-copy-costs.md` (§3.1). Any doc still citing that filename needs repointing |
| A new or amended ADR | The server seam decision, stated against `8f367c4` rather than in ignorance of it |

---

## 10 · Out of scope for this workstream

- Removing the remaining QUIC send-buffer copy — a `wtransport` upstream limit, not a seam
  question (§3.1). The avoidable copy is already gone as of `61dbd29`.
- A `stream_open` stage — excluded by the boundary rule (§4.2), and null in shared mode.
- Any join, `path_estimate`, or derived cross-file metric.
- Changing the browser seam.
- Production tracing (§5.5), which is a different requirement with a different seam.
