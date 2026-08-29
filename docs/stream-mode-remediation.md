# Stream mode — remediation

**For:** wt-pacs implementer · 2026-08-29 ·
**Why:** [`stream-mode-decision-report.md`](stream-mode-decision-report.md) §X

The X3 campaign produced **no usable answer**. Correcting the write-up is necessary but not
sufficient — it leaves the question we set out to answer permanently open. This is the work to close
it.

---

## R0a · Who does what — read first

The last campaign failed on **judgment**, not on typing: a failed control went unnoticed, a stop gate
was overridden, and one depth was used for two modes with different `D_min`. Those are analysis
errors. The fix is not a sterner brief — it is **not routing analysis through the implementer.**

| | owner |
| --- | --- |
| **R2** diagnosis — why the timeout, why the 150 ms gap, why `D_min` 2 vs 8 | **design/analysis.** Not the implementer |
| **R5** cell selection — demand ÷ supply, is the cell live | **design/analysis.** Cells arrive as *parameters*, already checked |
| **R3** `set_priority` | implementer, to spec |
| **R4** rerun | implementer, to a **fully specified grid** — exact cells, exact per-arm depths, exact commands |
| P1/P2/P4 client fixes (`client-runtime-experiment-plan.md` §3) | implementer, unblocked now |

Two standing rules for the implementer, from what went wrong last time:

- **Report raw numbers. Do not interpret them.**
- **If a gate trips, stop and report. Do not decide whether to continue.**

**R4's grid is written after R2 lands**, because R2 may change what the right depths are. Until then
the implementer works R3 and the client fixes.

---

## R0b · Where this work lands — read before writing any code

`server/`, `client/`, `common/`, `ingest/`, `tools/` are **product**. `lab/` is the lab.
`cleanup-plan-2026-08.md` §1 exists to **delete** an unmeasured mechanism from the product server
(`queue.rs`, 37% of it). Nothing here may reverse that.

| | lands where |
| --- | --- |
| **R2** diagnosis | reading and measuring — no product change |
| **R3** `set_priority` | **branch only.** It touches `server/src/transport/server.rs`, and it is meaningless unless per-frame survives R4 |
| **R4** rerun | `lab/` scripts |

**R3 and R4 happen on a branch, not on `main`.** R4's outcome decides what lands:

- **per-frame wins** → `set_priority` merges, with the measurement that justifies it
- **shared wins** → **delete per-frame mode from the product server entirely** — the flag, the `None`
  arm, the `JoinSet`, and both clients' per-stream readers. That is a simplification, not a revert,
  and it is the outcome the standing rule requires: *a rejected design leaves an ADR, not a code path*

Either way the branch does not sit half-merged. Say which outcome happened in the ADR.

---

## R1 · Correct the record — done

The report now carries a retraction banner and §X. **Nothing further needed** unless the rerun changes
the conclusion.

---

## R2 · Diagnose the two unexplained behaviours — **analysis, not implementer work**

These are not experiment hygiene. They are **unexplained behaviours in our own code**, and either
could be a more valuable finding than the campaign was. They are also exactly the kind of open-ended
diagnosis the last campaign got wrong, so they are **not delegated** — see R0a.

**a · The `mild_cell` trace timed out.** Unexplained. It was swapped for an 80-step trace and the run
continued. Find out why it timed out. A server or client that stalls on a realistic trace is a defect,
not a test-harness inconvenience.

**b · X2's 18.2% mode gap at 150 ms RTT.** Both modes reach the same throughput at RTT ≤ 60 ms and
diverge at 150 ms. Unexplained. Until it is, no per-frame number is trustworthy at any RTT.

Related and probably the same family: X2 measured `D_min` **per-frame = 8** against **shared = 2** at
250 KB / 60 ms. Why does per-frame need four times the depth to saturate? The fair-sharing model in
§X predicts *some* of this. Confirm it does, or find what else is going on.

---

## R3 · Wire `set_priority`

`wtransport::SendStream::set_priority(i32)` exists in the version already in the tree. Per-frame mode
currently opens every stream at equal priority, so QUIC fair-shares bandwidth across all of them and
every frame finishes late.

Set priority by ask order — earliest-asked stream highest — so the frame the reader is waiting for is
transmitted first. **A few lines**, in the `None` arm of `write_payload`.

Without this, per-frame is not the design worth testing, and any rerun repeats the same mistake.

### Priority levels — decided 2026-08-29, keep as implemented

`feat/set-priority-per-frame` assigns `i32::MAX - ask_seq`, a distinct level per frame. That was
queried against quinn's warning that *"using many different priority levels per connection may have a
negative impact on performance."*

**Keep it.** The warning concerns the ordering structure over **concurrently pending** streams, and at
depth `D` = 2–8 only that many are ever live; the value is unbounded across a session but never
concurrently. And "earliest ask wins" is what `adr-reject-server-ordering.md` already settled — *the
client encodes priority as ask order, and a FIFO server transmits that order unchanged.* Per-stream
priority expresses the same rule at the transport layer.

No change needed. Recorded so it is not re-queried.

Note: this also delivers what `adr-frame-framing-and-loop-shape.md` §4 called *"the finding worth
carrying forward"* — *fill ahead, but never delay the frame the reader needs now*, as a transport
primitive rather than an application queue.

---

## R4 · Rerun X3 — implementer, to a spec that does not yet exist

Only after R2 and R3. **The grid below is the shape, not the spec.** Exact cells and exact per-arm
depths are written after R2, and arrive as parameters — the implementer does not derive them.

| | |
| --- | --- |
| Depth | **each arm at its own `D_min`** from X2 — not a shared constant. This was the decisive flaw |
| Trace | the full trace, not 80 steps. p95 needs more than ~4 tail samples |
| Priority | per-frame arm with `set_priority` wired (R3); record that it is on |
| Loss | 0 / 0.1 / 0.5 / 2%, as before |
| Control | **the 0%-loss row is a gate.** If the arms differ meaningfully with no loss, stop — the run is measuring something other than loss |
| Stop gates | honour them. X2's >10% gate was overridden last time and that is how a stop condition became a footnote |

---

## R5 · A pattern worth fixing — and why cell selection is not delegated

Three campaigns have now produced unusable data, and **two failed on cell selection rather than
execution**:

| | how it failed |
| --- | --- |
| **E4** | ran in a **dead cell** — demand/supply ≈ 0.75, `frame_modulo: 3` gave 3 unique frames, so every wait was 0. Its own summary: *"FAIL in a dead cell is not evidence."* |
| **E2** | inconclusive — miss magnitude outside the 20% band |
| **X3** | unequal depths, failed control, overridden gate, thin statistics |

**Before running anything, state what result would be impossible in the chosen cell.** If "no signal"
is a possible outcome for reasons unrelated to the hypothesis, the cell is wrong and the run is
already void. `window-saturation-experiment.md` §0b has the demand-÷-supply precondition; it exists
because of E4 and it is not being applied.

**This is why cell selection moved out of the implementer's scope (R0a).** Deciding whether a cell can
produce a signal is the judgment E4 already failed. Cells now arrive as parameters with the
demand-÷-supply arithmetic already done and shown.
