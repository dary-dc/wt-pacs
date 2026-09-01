# Proposal: what `server_work_us` should mean now that prefault exists

**Date:** 2026-09-01 · **Status:** proposal, awaiting decision
· follows [`docs/telemetry/adr-server-frame-sink.md`](telemetry/adr-server-frame-sink.md)
and [`docs/disk-access/adr.md`](disk-access/adr.md).

Answers the three questions in the handoff: what `server_work_us` should mean, where its
interval should be bounded given that prefault is async and telemetry lives in a decorator, and
whether the drift matters for lab analysis.

---

## 0 · What the tree actually does (verified at `9bbfd13`)

```rust
// server/src/transport/server.rs:205
sink.ask(idx);                                        // arms Tap::serve_start
let touch = tokio::task::spawn_blocking(move || store_touch.touch_frame_pages(idx))
    .await                                            // ← prefault: OUTSIDE every stamp
    .context("join frame page touch")?;
match touch {
    Ok(()) => match sink.time_locate(|| store.frame_slice(idx)) {   // ← server_work_us
        Ok(bytes) => sink.send_frame(idx, bytes).await,             // ← server_write_us
```

`RecordedSink::time_locate` stamps `t0`, calls the closure, and calls
`rec.located(t0, …)`, which sets `server_work_us` (`frame_sink.rs`, `tap.rs:124`).
The closure is `store.frame_slice(idx)` alone. The handoff's description is accurate.

Three facts materially change the shape of the answer:

**(a) The total did not move.** `Tap::serve_start` is armed in `ask()` and consumed at row emit
(`tap.rs:120`, `tap.rs:84`), and `sink.ask(idx)` runs *before* the `spawn_blocking`. So
`server_serve_us` still spans ask → emit and **still contains the prefault**. What broke is
attribution, not coverage: `server_work_us + server_write_us` no longer accounts for
`server_serve_us`, and the difference — now the largest server-side term on a cold study — has
no name. Lab is mis-attributed, not blind.

**(b) `server_write_us` got *better* at the same merge.** `wrap()` is gone; `FrameOut::send_frame`
writes `len` / `index` / `codestream` as three `write_all` calls with no full-frame copy
(`frame_sink.rs`). On the pre-merge branch `server_write_us` silently included a whole-frame
`Vec` copy. It no longer does. So exactly one stage regressed in meaning and one improved —
worth saying, because "the merge broke telemetry" is too broad.

**(c) Nothing consumes the number.** The only reference to `server_work_us` outside `tap.rs` in
the whole tree is `server/scripts/check_telemetry_absent.sh:36`, which greps the **string
literal** out of the default binary. `verify_e2e.py` harvests `telemetry-server.json` as a file
and never parses it; `lab/window-harness` mentions it only in a comment about offline join by
`ask_ordinal`. The "schema compatibility" constraint is therefore **far weaker than assumed**: a
rename costs one line of shell plus the `tap.rs` tests. This is the cheapest moment a rename
will ever cost.

---

## 1 · The size of the hole

This is not a rounding-error problem. Per `docs/disk-access/adr.md`, the accepted product
default is **unconditional** `spawn_blocking(touch_frame_pages)` on *every* frame, warm or cold,
and the measured warm cost of that pool hop is **~10–30 µs (lab)**. Cold, E3 puts the fault
itself at p50 28 µs / p99 19 ms (`docs/lanes/L3-executor-stall.md`).

So the currently-unnamed residual inside `server_serve_us` is:

| Regime | Unattributed per frame |
| --- | --- |
| warm | ~10–30 µs — the pool hop the ADR knowingly accepted as the price of executor safety |
| cold | that, plus the whole fault distribution (p99 ~19 ms) |

Meanwhile `server_work_us` reports a ~1 µs mmap index lookup, which rounds to `0` in `u32`
microseconds. The observed "`server_work_us` often 0 on warm/localhost" is the *correct* value
for the interval now being measured — which is precisely why it is dangerous. The report
contract (`docs/telemetry/README.md`) says a stage that ran but took no measurable time exports
`0`, so nothing looks broken; the field is honest about a stage nobody cares about while the
stage the ADR spent a whole lane on is invisible.

**The defect is a missing field, not a wrong one.**

---

## 2 · Question 1 — what should `server_work_us` mean?

**Recommendation: retire the name.** Replace it with stages that each bound one thing:

| Field | Interval | Why it is its own stage |
| --- | --- | --- |
| `prepare_us` | `ask` → prefault join complete (the `spawn_blocking(…).await` round-trip as the session task experiences it) | The cost the disk-access ADR accepted. Unconditional, on every frame. Must be observable or the ADR cannot be audited in situ. |
| `locate_us` | `frame_slice` only | Cheap by construction; valuable as a **control** — if it stops being ~1 µs, the mmap index is wrong. |
| `send_us` | first `write_all` → last `write_all` | Rename of `server_write_us`, whose meaning is now clean (§0b). |
| `serve_us` | `ask` → row emit | Rename of `server_serve_us`. The total, and the audit invariant. |

Assertable invariant: `serve_us >= prepare_us + locate_us + send_us`, residual = loop overhead.
A unit test on this is what turns "the interval quietly moved" into a failing build.

Do **not** keep `server_work_us` as an alias for `prepare_us + locate_us`. A name whose meaning
already changed silently once should not be re-pointed at a third interval; that ambiguity is
the entire cost of this episode. Hard cut, with `schema: "server-pipeline-v1"` in the report —
§0(c) shows there is nothing to stay compatible with.

**On units.** Keep µs (the contract in `docs/telemetry/README.md` says µs, and the client side
matches). `prepare_us` at 10–30 µs and `send_us` are comfortably above the floor; only
`locate_us` sits under it, and a control that reads `0` is doing its job. If sub-µs locate ever
matters, promote that one field to ns rather than re-unitising the report.

---

## 3 · Question 2 — where should the interval be bounded?

The constraint that decides it: `send_one_frame` must read as product flow, telemetry stamps
live in the decorator, and default builds carry no tokens.

Note *why* locate is outside the sink today. The ADR gives the reason explicitly: "`time_locate(|| …)`
lets the decorator stamp **without borrowing the mmap slice from `&mut self`**." That is a
borrow-checker accommodation, not a judgement that prefault belongs in `server.rs`. The same
trick generalises, which is what makes P1 available.

### P1 — Widen the hook to cover both phases (recommended)

Keep the closure for locate (it solves the borrow); add the prefault future beside it:

```rust
/// Product: make frame bytes safe to write. Prefault off the executor, then locate.
fn acquire<'a, Fut>(
    &mut self,
    prefault: Fut,
    locate: impl FnOnce() -> Result<&'a [u8]>,
) -> impl Future<Output = Result<&'a [u8]>> + Send
where
    Fut: Future<Output = Result<()>> + Send;
```

- `LiveSink::acquire` = `prefault.await?; locate()` — zero telemetry tokens.
- `RecordedSink::acquire` stamps `t0`, awaits the prefault, stamps `t1` → `prepare_us`, runs the
  closure, stamps → `locate_us`. Both phases bounded in the decorator, neither in `server.rs`.
- The slice is still produced by a caller-owned closure, so the `&'a [u8]` never comes out of
  `&mut self` — the exact property the ADR chose `time_locate` for.
- Async-fn-in-trait is stable (rustc 1.94 here) and `FrameSink` is used generically
  (`run_session<S: FrameSink>`), never as `dyn` — **no `async-trait`, no boxing on the hot path**,
  same as the existing `send_frame` / `drain_acks` RPITIT methods.
- `send_one_frame` becomes ask → acquire → send / refuse: strictly more readable than today's
  nested `match touch { Ok(()) => match sink.time_locate(…) }`. It also retires the
  `TODO(readability): hide Arc` at `server.rs:208` — the `Arc::clone` moves into a small
  `prefault(store, idx)` helper next to the store rather than sitting in the session loop.
- Cost: `LiveSink` now owns the "don't fault on the executor" invariant. That is arguable *for*
  it — how bytes are safely acquired is a property of the byte source, not of the session loop —
  but `docs/disk-access/adr.md` must then be amended to point at the new home, or the next reader
  will look for `spawn_blocking` in `server.rs` and not find it.

### P2 — Second hook, prefault stays in `server.rs`

`sink.time_prepare(fut).await?` beside `time_locate`. Smallest diff. But `time_prepare` has **no
product meaning** — it is a pure measurement call in the session loop, which is the thing the
FrameSink ADR was adopted to remove. It re-admits `rec.*`-by-another-name, and the next stage
added will cite the precedent. Take it only if P1's lifetimes prove genuinely unworkable.

### P3 — Change nothing; derive prefault offline as `serve − work − write`

Zero code, and it works *today* because of §0(a). But it is undocumented arithmetic every reader
must re-derive, the residual silently absorbs loop overhead, and it leaves `server_work_us`
pointing at an interval nobody meant. **Stopgap, not an answer** — and acceptable only if paired
now with a comment in `tap.rs` and a line in `docs/telemetry/README.md` stating that
`server_work_us` excludes prefault as of `dafc1ed`. An unremarked lying field is the actual harm;
the arithmetic is fine, the silence is not.

### Where *not* to stamp

Stamping **inside** the `spawn_blocking` closure would give fault-only time with pool queueing
excluded. Don't: it puts a telemetry token inside a product closure (violating the seam), and the
queueing it excludes is real latency the client pays. Decorator-side wall clock — pool hop
included — is the honest number for a serve-latency report. Fault-only attribution belongs to the
disk-access instrument (§4).

### Adjacent honesty fix (either way)

Both refusal hooks stamp `t0 = rec.stamp()` and immediately record against it
(`on_locate_failed`, `on_refused` in `frame_sink.rs`), so refusal rows carry
`server_work_us = 0` / `server_write_us = 0` — indistinguishable from a fast success. With
`locate_outcome` / `write_outcome` on the row a reader *can* disambiguate, but the row would be
better with those stages explicitly `null`. Cheap to fix while the schema is open.

---

## 4 · Question 3 — does this matter for lab, and for L3?

Three consumers, three different answers.

**Product: no.** Prefault → locate → send is unchanged by any option here. Wire, ordering, and
copy discipline untouched; e2e passing is not evidence about the metric either way. The handoff
is right that this is a measurement-semantics question.

**Lab serve-vs-send analysis: yes, and specifically for the question the disk-access ADR left
open.** That ADR accepted a per-frame pool hop on *every* frame — warm included — as the price of
executor safety, on ~10–30 µs lab bench numbers. `telemetry-server.json` is the artifact that
would show what that hop costs **in the real send path, under the real stream mode, at the real
ask rate**. Right now it is the one server cost the report cannot show. On cold studies it is
most of the server's time. Under P3 it sits in an unnamed residual; taken at face value,
`server_work_us` says the server does no preparation work — false on exactly the runs that matter.

**L3 / executor-stall: no — and this should be written down.** `Tap` measures the *session
task's* wall time; the L3 invariant is about the *executor* being blocked. After prefault these
diverge by construction: `prepare_us` can be 19 ms while executor-blocking time is ~0, which is
precisely L3's success condition. **No Tap field can confirm or refute the L3 invariant**, and
none should be added to try — that needs runtime-level observation (blocking-pool metrics, or
the neighbour-p99 method `docs/disk-access/RERUN.md` cell C2 already uses).

This resolves the "undefined relationship" flagged in the handoff. Write the split into both ADRs:

| Question | Owner |
| --- | --- |
| Does a fault block the executor? Cold vs warm fault cost. Neighbour p99 under pressure. | disk-access instrument (`docs/disk-access/`, `lab/cold-page-bench`) |
| How long did the server take to prepare and send frame *k*, as the client's latency budget sees it? | `telemetry-server.json` |

`prepare_us` is the single field touching both, and it is a **latency** number, not a **fault**
number. Say so in its doc comment, or it will be quoted as one.

---

## 5 · Recommendation, in order

1. **Decide the vocabulary** (§2): `prepare_us` / `locate_us` / `send_us` / `serve_us`, µs,
   `schema: "server-pipeline-v1"`, refusal stages `null`. Hard cut, no dual-write.
2. **Land P1** — `acquire(prefault, locate)` on `FrameSink`; `spawn_blocking` moves out of
   `server.rs` into `LiveSink` (or a `prefault` helper it calls).
3. **Update the guards:** `check_telemetry_absent.sh:36` literals; `tap.rs` tests; add the
   `serve_us >= prepare_us + locate_us + send_us` invariant test; `recorder_is_zero_sized`
   unchanged; re-run both absence scripts.
4. **Amend the docs:** `docs/disk-access/adr.md` (prefault's home is now `frame_sink.rs`),
   `docs/telemetry/adr-server-frame-sink.md` (hook is `acquire`, not `time_locate`),
   `docs/telemetry/README.md` (stage table + §4 ownership split).
5. **Validate cheaply:** one warm localhost run — expect `prepare_us` ≈ the ADR's 10–30 µs pool
   hop and `locate_us` at the clock floor — and one `posix_fadvise(DONTNEED)` cold run on the same
   study, expecting `prepare_us` to carry the E3 cold distribution. That warm/cold pair is
   sufficient evidence that the interval contains what its name claims; **no shaped-cloud campaign
   is needed to validate a naming decision.**

If sequencing forbids step 2 now, land **P3-with-a-note** (§3) as an explicit bridge and open a
follow-up — but do not leave `server_work_us` undocumented for another campaign.

## 6 · Against the success criteria

| Criterion | How this meets it |
| --- | --- |
| Documented meaning matching how the code stamps | Every stage bounded by one hook in one place, plus a machine-checked `serve_us >=` invariant — so the next reordering fails a test instead of surfacing months later as "often 0". |
| No product regression / default-build absence | P1 removes tokens from `server.rs` rather than adding them; `LiveSink` bodies stay token-free; `Recorder` stays ZST; absence script updated for the new literals. |
| Lab can still answer its questions | Serve-vs-send improves (prefault named, not residual); cold-vs-warm is answered by `prepare_us`; executor-stall is explicitly reassigned to the disk-access instrument instead of being silently expected of Tap. |

## 7 · Non-goals honoured

Client telemetry / Decision A, client↔server schema unification, wire and copy discipline, and
shaped-cloud re-runs are all untouched. The only schema change is server-side field names, whose
blast radius §0(c) measures at one line of shell.
