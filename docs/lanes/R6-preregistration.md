# Lane R6 — pre-registration: stream shape, measured where it can actually differ

**Written before the campaign ran.** Hypotheses, numeric predictions, decision rules and
void conditions are fixed here so a result cannot be reinterpreted after the fact into a
success. Where a prediction contradicts a conclusion this project previously published,
that is stated in the same breath as the prediction.

Companion to [`L4-preregistration.md`](L4-preregistration.md), which this supersedes for
stream-shape questions only. The controller conclusions from L4 stand and are not re-opened
here.

---

## 0 · Why this lane exists

L4 concluded "keep one shared stream". **That conclusion has been withdrawn**
([`../transport-conclusions.md`](../transport-conclusions.md) §2) because the harness could
not produce the condition that decides the question.

A shared stream is worse than per-frame streams only when the reader is stuck behind bytes
it no longer wants. The old reader blocked on each frame before advancing:

```
for each cursor:  sleep(step) → emit_window(cursor) → wait_displayable(cursor) → wait_outstanding_below(D)
                                                      ^^^^^^^^^^^^^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^^^^^^^^^
                                                      both block
```

so the reader travelled at the speed of the transport, and every byte in flight was a byte
it still wanted. Head-of-line blocking had no opportunity to occur.

`--reader-mode open` advances on the trace's own wall clock instead. That is the whole
change under test, and **the first job of this lane is to prove the change works** — not to
compare arms.

---

## 1 · Instruments, and what may void a row

New counters, each of which exists to void a row rather than decorate it:

| counter | meaning | voids the row when |
| ------- | ------- | ------------------ |
| `reader_lag_ms` | how far behind its own clock the reader finished | — (diagnostic) |
| `stranded_frames` / `stranded_bytes` | data that arrived for a position the reader had left | `== 0` in a cell meant to strand |
| `censored_waits` / `censored_frac` | wants the run never satisfied, scored at their bound | `> 0.25` |
| `center_asks_dropped` | steps whose measured frame was never actually asked for | `> 0` |
| `peak_outstanding` | concurrency actually achieved | `< depth` |

`center_asks_dropped` deserves its own note. The centre frame is exempt from the depth cap
— a viewer prioritises what is on screen — but only to a hard ceiling of 2 × D, because
nothing retires an ask except the frame arriving. Without the ceiling a reader that outran
the transport would issue one more ask every step forever and flood its own link. When the
ceiling binds, the step measured the harness's ask policy rather than the transport, so the
row is void.

### E0-R6a — the reader change works

Run the same cell twice, `closed` and `open`. **Open must show reader lag and stranded
bytes where closed shows neither.** If it does not, `--reader-mode open` is not doing what
its name says and nothing below may be run.

### E0-R6b — the operating point is calibrated, once, and then frozen

The reader's offered load must be set against the rate the link can **achieve**, not the
rate it is labelled with. This is not a detail. At 1 % loss and 600 ms RTT, Cubic's Mathis
ceiling is **0.24 Mbps** while a 30 fps reader over 64 KB frames demands **~15 Mbps** — a
62× overload. The first validation run sat exactly there and produced 93 % censoring with
597 of 681 centre asks dropped: every arm collapses identically and nothing is
distinguished.

`--step-scale` sets reader speed. Calibration runs **once per cell, on the incumbent arm
(shared stream)**, and the chosen scale is then **frozen across every arm in that cell**.
Tuning the operating point per-arm would let the rig be shaped to fit whichever answer had
started to look right, which is how three previous campaigns went wrong.

Admissible band, fixed here before any arm runs:

```
center_asks_dropped == 0        the frame being measured was always actually asked for
stranded_frames     >  0        something arrived that the reader no longer wanted
censored_frac       <= 0.25     the arm did not simply collapse
nz_n                >= 30       there is a tail to take a percentile of
```

---

## 2 · Hypotheses and predictions

### H4 · Receiver-side head-of-line blocking — the classic argument

*Under loss, a shared stream delays every frame queued behind the lost packet, because
QUIC delivers a stream's bytes in order. Per-frame streams confine the damage to the one
frame that lost a packet.*

**P4** — in a cell with **both loss and stranding**, per-frame beats shared on p95.
In a cell with **stranding but no loss**, they tie: with nothing to retransmit there is
nothing to block behind.

**D4** — carried over unchanged from L4's D3, deliberately: per-frame must beat shared by
**> 15 % p95**, separated by the non-overlap rule, to justify the client-side cost of
out-of-order arrival. **A tie is not a reason to change a working design.**

### H5 · Sender-side scheduling — and this one contradicts what this project published

*With `send_fairness(true)`, N concurrent streams round-robin, so a newly asked centre
frame starts receiving bandwidth immediately — about 1/N of the link — instead of queueing
behind every stale frame ahead of it. With `send_fairness(false)`, `reinsert_pending`
drains each stream to completion in ask order, so the centre frame waits for all of them.*

**P5** — under stranding, **fairness ON beats FIFO for the centre frame**, reversing the
ordering found in every closed-loop campaign in this project.

This prediction is the opposite of the current published finding, which is that per-frame
without `send_fairness(false)` is consistently worse. Both can be true without
contradiction: fairness spreads bandwidth across all outstanding frames, which is bad when
every outstanding frame is wanted (the closed-loop case) and good when most of them are
not (the open-loop case). **P5 is stated in advance precisely because it is the result I
would otherwise be tempted to explain away.**

**D5** — if P5 holds, the published claim "per-frame requires `send_fairness(false)`"
becomes conditional on reader behaviour and must be rewritten, not softened. If P5 fails,
the existing claim is strengthened and the mechanism above is wrong.

### H6 · The two mechanisms are separable

*H4 needs loss; H5 needs stranding. A cell with one and not the other isolates each.*

**P6** — the loss-only cell moves per-frame vs shared and leaves fairness flat; the
stranding-only cell moves fairness and leaves per-frame vs shared flat.

---

## 3 · Cells

Chosen by arithmetic, not by label. `achievable` is the Mathis ceiling where loss binds,
the link rate where it does not; the operating point targets the admissible band above.

All four share one path — 50 ms RTT, 20 Mbps — and differ only in loss and reader speed.
Holding the network fixed and moving only the reader is deliberate: it means a difference
between X1 and N0 cannot be a difference of link.

| cell | loss | step-scale | measured stranding | isolates |
| ---- | ---- | ---------- | ------------------ | -------- |
| **X1** | 0.1 % | 2 | 152 frames | deployment case — both mechanisms live |
| **X2** | 0 % | 1 | 137 frames | **H5 alone.** Zero loss means nothing is ever retransmitted, so H4 is impossible *by construction* and any arm difference is sender-side scheduling |
| **X3** | 1 % | 8 | 35 frames | **loss-dominant**, weak stranding |
| **N0** | 0 % | 8 | 0 frames | **negative control** |

Stranding figures are from the E0-R6b calibration on the incumbent arm, not predictions.

**X3 is honestly labelled.** It is *not* "loss without stranding": no such operating point
exists on this trace, because loss lowers achievable throughput and lower throughput is
itself what causes stranding. The two factors are not independently controllable on a
path that behaves like a path. X3 is the cell where loss dominates and stranding is
weakest — 35 frames against X1's 152 — and it is read that way, not as a clean isolation.

X2 and N0 *are* logically clean: at 0 % loss there is nothing to retransmit, so
receiver-side head-of-line blocking cannot occur there whatever else does.

**N0 is the control that matters.** No loss, and a reader slow enough that it strands
nothing: all arms must tie. **If any arm separates in N0, the rig is measuring something
other than what it claims and the whole campaign is void** — not adjusted, void.

### Arms

| arm | server flags | tests |
| --- | ------------ | ----- |
| `shared` | `--stream-mode shared` | incumbent |
| `perframe_fair` | `--stream-mode per-frame` (fairness default on) | H5 fairness-on |
| `perframe_fifo` | `--stream-mode per-frame --send-fairness false` | H5 fairness-off |

**Fixed-N pool is not an arm.** It requires a server change and this lane is constrained
not to modify `server/`. It stays untested, and is recorded as untested rather than
inferred about.

---

## 4 · Decision rules, fixed now

1. **Separation rule** — min/max non-overlap across repeats, as in L4. With n = 3 this
   carries a ~10 % false-positive rate per comparison, so **only effects well outside it
   may be quoted**. An effect under ~15 % at n = 3 is not a result.
2. **D4 threshold** — per-frame needs > 15 % p95 improvement over shared to be adopted.
3. **Censoring dominates p95.** An arm with materially higher `censored_frac` than the
   reference is **declared worse regardless of its p95**. An arm cannot win by delivering
   less.
4. **Per cell, never pooled.** "Which approach for which case" is answered per cell.
5. **Voids are written, not dropped.** A failed run is emitted as a VOID row. Deleting
   failed runs biases the survivors, because failures are systematically the slowest runs —
   this already happened once, in R2.
6. **A recommendation may not exceed its evidence tier.** This lane is **T2**: one host, a
   userspace path simulator, no real network.

---

## 5 · Anti-bias measures

- **Calibrate once per cell on the incumbent arm, then freeze.**
- **Interleave every arm within each repeat.** Host drift is not common-mode.
- **Vary the seed per repeat**, so repeats resample loss rather than replaying it.
- **Report every cell**, including ones that make a favoured arm look bad.
- **State P5 in advance** — the prediction that contradicts the published finding.
- **Adversarial review before any conclusion is written**, by a reviewer given the data and
  asked to break the reading rather than confirm it.

---

## 6 · What this lane cannot answer, stated before it runs

- **CPU and throughput.** `netsim` forwards datagram-by-datagram in userspace and destroys
  send-side GSO batching. Any density number taken through it is void by construction.
- **Real radio behaviour.** Handovers, variable bandwidth and variable RTT are unmodelled
  ([`../transport-assumption-audit.md`](../transport-assumption-audit.md) A1–A3). For a
  mobile reader these plausibly dominate everything measured here.
- **Fixed-N pools.** Server-side change, out of scope by constraint.
- **Competing-flow fairness.** Not measured, and the main BBR deployment risk.
- **A real network.** The Oracle rig was intended to supply one and is unreachable from
  this environment — see [`../measurements/r6/README.md`](../measurements/r6/README.md).
  The runbook to execute this same campaign there is written and ready.
