# Proposals: reshaping the server telemetry seam

**Date:** 2026-09-01 · **Status:** proposals for review — nothing decided, no code changed
· scope: **server only** (client Proxy seam and Decision A untouched)
· companion to [`../server-work-us-semantics-proposal.md`](../server-work-us-semantics-proposal.md)

Two different questions, deliberately kept apart:

| Doc | Question |
| --- | --- |
| `server-work-us-semantics-proposal.md` | **What should the fields mean?** (`server_work_us` after prefault) |
| **this doc** | **What shape should the seam have?** (how much measurement lives in product code) |

They can be decided independently, in either order.

---

## 1 · The problem, in one picture

`docs/telemetry/adr-server-frame-sink.md` says product code should read as
`ask → locate → send / refuse`, with "clocks and outcome enums in `RecordedSink`". Here is what
`send_one_frame` actually does today (`server/src/transport/server.rs:199`):

```
send_one_frame (PRODUCT)              LiveSink (PRODUCT)        RecordedSink (LAB)
──────────────────────────            ──────────────────        ──────────────────
sink.ask(idx) ───────────────────────► { }              ······► stamp T0, ordinal
spawn_blocking(touch).await ─────────►  (not in the sink)  ····► ✗ nothing stamps this
sink.time_locate(|| frame_slice) ────► f()              ······► stamp → server_work_us
sink.send_frame(idx, bytes) ─────────► WRITES BYTES     ······► stamp → server_write_us
sink.on_locate_failed() ─────────────► { }              ······► record NotFound
sink.on_refused() ───────────────────► { }              ······► record Refused
```

Read the middle column. **Six call sites; one writes bytes.** `time_locate` is a pass-through
around work the caller supplied; `ask`, `on_locate_failed`, `on_refused` are literally `{ }` in
the product type. They exist so the decorator has somewhere to stamp.

So the count of measurement-shaped calls in the session loop is unchanged from the old inline
version — the *type* moved out (`rec.ask` → `sink.ask`), the *shape* did not:

```
before the ADR                     after the ADR
──────────────                     ─────────────
rec.ask(idx)                  →    sink.ask(idx)
rec.located(t0, …)            →    sink.time_locate(…)
rec.wrote(t1, Refused, 0)     →    sink.on_refused()
```

For contrast, the client side of the same programme: `client/transport-ts/record/` is ~1130
lines and product `src/` references it **zero** times. Same stated goal, one side achieved it.

### Two more things the picture shows

- **The expensive step is unmeasured.** The prefault hop never enters the sink, so nothing
  stamps it — the subject of the companion doc.
- **The refuse path is duplicated in product code.** `send_one_frame` contains two nearly
  identical `warn! + write_fod_msg(FrameError) + sink.on_refused()` blocks. That duplication
  exists because refusal is a telemetry *hook* rather than a sink *method*.

---

## 2 · A measuring stick

So proposals can be compared instead of argued. Five properties, all checkable by reading:

| # | Property | How to check |
| --- | --- | --- |
| **P1** | Product call sites per frame that exist **only** to be measured | count them in `send_one_frame` |
| **P2** | Product method bodies that are empty `{ }` | count them in `LiveSink` |
| **P3** | **Drift-safe?** Can moving a line silently change what a field means? | is the interval bounded by one construct, or by call order? |
| **P4** | Default-build absence proof | does `check_telemetry_absent.sh` still hold, and at what cost? |
| **P5** | New dependency / platform requirement | Cargo.toml, kernel, privileges |

Today: **P1 = 4** (`ask`, `on_locate_failed`, ×2 `on_refused`) · **P2 = 3** · **P3 = no**
(the merge proved it) · **P4 = holds** · **P5 = none**.

---

## 3 · Mechanism proposals

Four options, cheapest first. Each shows the `send_one_frame` it produces.

### M1 — Every seam method must do product work

*Keep the trait. Delete the hooks that don't earn their place.*

Fold `ask` into the acquire call (the index is already an argument). Make `refuse` a **real**
method that writes the `FodMsg::FrameError` — then it is product work, not a hook, and the
duplicated refuse block collapses into it.

```rust
// send_one_frame — the whole body
let bytes = match sink.acquire(idx, prefault(store, idx), || store.frame_slice(idx)).await {
    Ok(b) => b,
    Err(e) => return sink.refuse(control_send, idx, e).await,
};
sink.send_frame(idx, bytes).await
```

```
      product                        LiveSink                    RecordedSink
      ───────                        ────────                    ────────────
      acquire ──────────────────────► prefault.await; locate()  ► stamp ask/prepare/locate
      refuse  ──────────────────────► write FrameError          ► record refusal
      send_frame ───────────────────► write bytes               ► stamp send
```

The closure stays because the ADR chose it for a reason: it lets the decorator stamp *without*
borrowing the mmap slice out of `&mut self`. Async-fn-in-trait is stable (rustc 1.94 here) and
`FrameSink` is used generically, never as `dyn` — no `async-trait`, no boxing.

| P1 | P2 | P3 | P4 | P5 |
| --- | --- | --- | --- | --- |
| **0** | **0** | improved (prefault bounded by one construct) | unchanged | none |

**Cost:** `LiveSink` inherits the "don't fault on the executor" invariant, so
`docs/disk-access/adr.md` must say where prefault now lives. The closure argument is still a
slightly odd thing to see in product code.

---

### M2 — Split the source from the sink; drop the closure

*The borrow problem the closure solves disappears if acquisition takes `&self`.*

```rust
trait FrameSource { async fn acquire(&self, idx: u32) -> Result<Prepared<'_>>; }  // &self!
trait FrameSink   { async fn send(&mut self, p: Prepared<'_>) -> Result<()>;
                    async fn refuse(&mut self, …) -> Result<()>; }
```

```rust
// send_one_frame — no closures, no telemetry vocabulary at all
let prepared = match source.acquire(idx).await {
    Ok(p) => p,
    Err(e) => return sink.refuse(control_send, idx, e).await,
};
sink.send(prepared).await
```

`acquire(&self)` can return `&'a [u8]` tied to `&'a self`, so nothing needs a closure. This is
the best-reading product code of the four.

**The catch, stated plainly:** one telemetry row spans both traits (ask/prepare/locate from the
source, send from the sink), so the two halves must share state. Three ways, none free:

| Way | Cost |
| --- | --- |
| `Rc<RefCell<Tap>>` shared by both decorators | session-local, no contention, but two owners of one Tap |
| `Prepared` carries the stamps as a `#[cfg(feature = "telemetry")]` field | zero-sized by default, but a cfg token appears in a product type |
| `Prepared` generic over a marker type (`Prepared<'a, M = ()>`) | no cfg in the type, more type machinery |

| P1 | P2 | P3 | P4 | P5 |
| --- | --- | --- | --- | --- |
| **0** | **0** | **best** — stamps travel *with* the row (see S3) | unchanged | none |

---

### M3 — No bespoke trait: `tracing` spans + a lab `Layer`

*Instrumentation that the product wants anyway.* The server already depends on `tracing` and
uses it in 13 places. Spans are legitimate operability, not measurement scaffolding; the lab
build attaches a `Layer` that turns span-close events into Tap rows.

```rust
// product — reads as diagnostics
async fn send_one_frame(…) -> Result<()> {
    let prepared = trace_span!("prepare", frame = idx).in_scope(|| …);
    …
}
// lab — server/src/record/layer.rs
impl<S: Subscriber> Layer<S> for TapLayer { fn on_close(&self, id, ctx) { …build row… } }
```

| P1 | P2 | P3 | P4 | P5 |
| --- | --- | --- | --- | --- |
| 0 (spans are product diagnostics) | **0** — no trait at all | order-independent (spans nest) | **⚠ see below** | none |

**⚠ The honest cost — P4.** `check_telemetry_absent.sh` greps the default binary for symbols and
string literals. Span field names are string literals. They compile away **only** if
`tracing`'s `release_max_level_*` feature strips the callsite, and Cargo features are
*additive* — you cannot un-set that feature when `--features telemetry` is on. So the lab build
must become `--no-default-features --features telemetry`, and **any** crate in the graph that
enables the max-level feature poisons it. This is a real operational sharp edge, not a
formality; it should be prototyped against the absence script before M3 is chosen.

Secondary: field names become stringly-typed, and `ask_ordinal` bookkeeping moves into the Layer.

---

### M4 — Zero server code: observe from outside

*The client ADR's philosophy, applied to the server.* No trait, no feature flag, no absence
check — because there is nothing in the binary to be absent.

```
# no server diff at all
uprobe:exact-server:*touch_frame_pages  { @t[tid] = nsecs }
uretprobe:exact-server:*touch_frame_pages { @prepare = hist(nsecs - @t[tid]) }
```

| P1 | P2 | P3 | P4 | P5 |
| --- | --- | --- | --- | --- |
| **0** | **0** | n/a | **vacuous — nothing to check** | **Linux + CAP_BPF; symbol stability** |

**Why this probably loses anyway** — worth writing down so it stops being re-proposed:

1. **Frame index under `RequestFrames`.** The objection that already killed Decision C option
   C2 applies unchanged: one control message, N serial sends. Recovering per-frame identity from
   a probe means reading argument registers, which is ABI-fragile.
2. **Inlining.** `touch_frame_pages` and `frame_slice` are small and generic; there may be no
   symbol to probe in a release build.
3. **Harvest contract.** `verify_e2e.py` expects a `telemetry-server.json` beside the client
   file. An external collector must reproduce that file, or the two-file contract breaks.
4. **The rig.** Whether `CAP_BPF` is available on the shaped cloud rig is unknown
   (`docs/cloud-rig-access.md`) — a blocker to confirm before, not after.

Best use: as a **cross-check** on whatever seam is chosen, not as the seam.

---

### Mechanism comparison

| | M1 hooks earn their place | M2 source/sink split | M3 tracing + Layer | M4 external |
| --- | --- | --- | --- | --- |
| Telemetry-only call sites (P1) | 0 | 0 | 0 | 0 |
| Empty product bodies (P2) | 0 | 0 | 0 | 0 |
| Product code reads as | ask/acquire → send/refuse | acquire → send/refuse | plain flow + spans | plain flow |
| Drift-safe (P3) | improved | best | good | n/a |
| Absence proof (P4) | unchanged ✅ | unchanged ✅ | **needs new build discipline** ⚠ | vacuous |
| New deps / platform (P5) | none | none | none | **kernel + privs** ❌ |
| Diff size | small | medium | medium | none in `server/` |
| Reversible if wrong | easily | easily | easily | n/a |

---

## 4 · Scope proposals — a ladder, pick a rung

Independent of mechanism. Each rung is landable on its own and leaves the tree consistent.

```
S1  fields mean what they say          ── semantics only, no seam change
S2  + seam repair (M1 or M2)           ── product code stops carrying measurement
S3  + row-as-value                     ── drift becomes impossible to express
S4  + delete the Recorder layer        ── removes a wrapper with no remaining caller
S5  + schema version cut               ── one clean break, one round of doc updates
```

**S1 — Semantics only.** The companion doc's rename (`prepare_us` / `locate_us` / `send_us` /
`serve_us`) plus the `serve ≥ prepare + locate + send` invariant test. No seam change. *Buys:* the
number stops lying. *Leaves:* empty hooks, state-machine Tap.

**S2 — Seam repair.** Apply the chosen mechanism. *Buys:* P1 and P2 → 0, and the duplicated
refuse block collapses. *Leaves:* Tap's cross-call state.

**S3 — Row as value.** Today `Tap` is a state machine: `serve_start`, `pending_work_us`,
`pending_bytes`, `pending_locate` are carried across three calls that must occur in order.

```
 today                                   S3
 ─────                                   ──
 ask()      → tap.serve_start = now      acquire() ─┐
 located()  → tap.pending_work_us = …               ├─► Row { ask_at, prepare, locate, … }
 wrote()    → emit(pending_* + write)    send() ────┘   └─► emit once
```

*Buys:* the field's meaning is bounded by where the row is built, not by call order — which is
exactly the failure mode the merge produced. Also makes `null` natural (`Option<u32>`) instead of
0-means-two-things. Pairs naturally with M2, whose `Prepared` token is already the carrier.

**S4 — Delete `Recorder`.** `Recorder` is a cfg-forking wrapper that exists so *product* code can
call it without knowing about `Tap`. Since the ADR landed, **no product code calls it** —
`RecordedSink` is itself `#[cfg(feature = "telemetry")]`, so it can hold `Option<Tap>` directly.
*Buys:* deletes `record/mod.rs`'s cfg branches and the `Stamp = ()` alias. *Note:* the
`recorder_is_zero_sized` test goes with it; the replacement guarantee is absence-by-construction
at `handle_incoming` (which the ADR already claims) plus the existing absence script.

**S5 — Schema cut.** `schema: "server-pipeline-v1"`, refused stages `null`, absence-script
literals updated. Cheap: the only reference to `server_work_us` outside `tap.rs` in the entire
tree is a string literal in `check_telemetry_absent.sh:36`.

| Rung | Files touched | Net LOC | Risk |
| --- | --- | --- | --- |
| S1 | `tap.rs`, absence script, docs | + small | very low |
| S2 | `frame_sink.rs`, `server.rs` | ≈ 0 | low — behaviour-preserving |
| S3 | `frame_sink.rs`, `tap.rs` | ≈ 0 | low; needs row-completeness tests |
| S4 | delete `record/mod.rs` fork | **−** | low |
| S5 | `tap.rs`, absence script, docs, README | + small | low (no numeric consumer) |

---

## 5 · Sensible combinations

| Package | = | Good when |
| --- | --- | --- |
| **Minimal** | S1 | You only want the number to stop lying, now. |
| **Clean seam** | M1 + S2 + S5 | You want the ADR's stated goal actually met, small diff, no new concepts. |
| **Structural** | M2 + S2 + S3 + S4 + S5 | You want the drift bug class gone and are willing to spend one refactor to get it. |
| **Explore first** | prototype M3 against `check_telemetry_absent.sh` | You suspect the bespoke trait is the wrong abstraction and want evidence before committing. |

If one opinion is wanted: **Clean seam now, Structural if the lab is going to keep growing
stages.** M4 is a cross-check, not a seam. But the point of this doc is that all four are
defensible and the scorecard, not taste, should pick.

---

## 6 · What each choice obliges you to amend

| Choice | Amend |
| --- | --- |
| any M | `docs/telemetry/adr-server-frame-sink.md` — "Decision" section describes `time_locate`, which would no longer exist |
| M1 / M2 | `docs/disk-access/adr.md` — prefault moves out of `server.rs`; say where it lives |
| M3 | ADR + a new note on the `--no-default-features` lab build; re-run both absence scripts |
| S3 / S4 | `docs/telemetry/README.md` code map; drop `recorder_is_zero_sized` from the guarantees list and state the replacement |
| S5 | `README.md` report contract, `check_telemetry_absent.sh:36`, `tap.rs` tests |

---

## 7 · Questions for the reviewer

1. Is "product code contains no line that exists only to be measured" the actual goal, or is
   "product code contains no *clock* and no *Tap type*" enough? Today's seam meets the second
   and not the first; **which one did the ADR intend?**
2. Is `LiveSink` the right owner of the executor-safety invariant (M1/M2 both move prefault
   into it), or must `spawn_blocking` stay visible in the session loop for reviewability?
3. Is the lab expected to gain more stages (write progress, ask queueing, batch position)? If
   yes, S3 stops being optional — each new stage adds another ordering dependency to Tap.
4. Is a `#[cfg(feature = "telemetry")]` **field** on a product type (M2, second variant)
   acceptable, given the ADR's "absence by construction" framing?
5. Does the shaped cloud rig grant `CAP_BPF`? Only matters if M4 is to be kept alive even as a
   cross-check.
