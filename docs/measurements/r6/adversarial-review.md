# R6 — adversarial review

**Sections 1 and 2 were written before the campaign's results were read**, so the attack
surface could not be chosen to spare whichever answer emerged. Section 3 is written after.

Method, unchanged from the previous three rounds: take the data, the pre-registration and
the harness source, and try to **break** the reading rather than confirm it. Findings are
re-verified directly before being accepted, and recorded rather than absorbed.

---

## 1 · Attacks on the harness change itself

The open-loop reader is new code and is the foundation of everything here. If it is wrong,
R6 is worth no more than L4.

### 1.1 · "The arms are scored on different samples" — **checked, does not hold**

If a faster arm turns misses into cache hits, it has fewer informative waits, and a p95
over *its* waits is a different statistic from a p95 over another arm's.

Measured directly:

| arm | cell | `wait_samples` | `nz_n` |
| --- | ---- | -------------- | ------ |
| shared | X1 | **682** | 230 |
| perframe_fair | X1 | **682** | 354 |
| perframe_fifo | X1 | **682** | 195 |
| shared | X3 | **682** | 77 |
| perframe_fair | X3 | **682** | 262 |

`wait_samples` is **682 in every arm of every cell** — one per trace step plus the settle —
because the open-loop reader records exactly one sample per step: a zero on a cache hit, a
resolved wait otherwise, a censored bound if it never arrives. `p95_wait_ms` is therefore
computed over an identical fixed population and the arms are scored on the same steps.

`nz_n` varies precisely because arms differ in how much they deliver in time — that is the
*result*, not the comparison basis. **Attack fails, but the distinction between the two
columns must be stated wherever they appear**, because reading `nz_p95` as the headline
would reintroduce exactly the bias this attack describes.

### 1.2 · "An arm wins by delivering less" — **checked, does not hold**

`frames_on_wire` spans 647–655 and `bytes_on_wire` 41.41–41.92 MB **across every arm and
cell**: a 1.1 % spread. No arm is buying latency by moving less data. This was already a
pre-registered decision rule (an arm with materially higher `censored_frac` is declared
worse regardless of p95); it is now also an empirical fact rather than only a rule.

### 1.3 · "The depth ceiling feeds back on arm speed" — **accepted, a real limit**

The centre frame is exempt from the depth cap up to a hard ceiling of 2 × D. A slower arm
accumulates more outstanding asks, so it drops **more prefetch** asks, so it offers less
load, so its centre frames meet less competition. The comparison is therefore between
*arm + the load that arm induces*, not between arms at equal offered load.

This is realistic — a real client with a bounded request queue behaves exactly this way —
and it is symmetric in mechanism. But it is a genuine limit on interpretation and is
recorded as one. The stronger failure mode, the ceiling suppressing the *measured* frame's
own ask, is caught: `center_asks_dropped` voids the row, and is 0 on every admissible row.

### 1.4 · "Stranding is over-counted on a reversal" — **accepted, minor, symmetric**

A frame arriving outside the current window counts as stranded even if the reader returns
to it two steps later. This inflates `stranded_frames` slightly. It is symmetric across
arms and `stranded_frames` is a gate, not a result, so it changes no conclusion.

### 1.5 · "Waits are quantised by the poll loop" — **fixed by construction**

They were, in the closed-loop path: `wait_displayable` slept 2 ms between checks, so every
wait was rounded to a 2 ms grid. The open-loop reader resolves from `last_arrival`, the
instant recorded when the frame actually landed, so poll granularity cannot enter the
measurement and a frame that arrives and is LRU-evicted before the next poll still scores
as delivered.

### 1.6 · "Per-iteration sleeps would slow the reader for slow arms" — **avoided deliberately**

`sleep(step)` per iteration folds ask-emission cost into the schedule, so a slower arm
gets a slower reader and a gentler test. The reader uses absolute deadlines
(`t0 + i × step`) instead. Confirmed by `reader_lag_ms`: 0.6–2 ms across every run, i.e.
every arm faced the same reader clock to within 2 ms over a 22–180 s run.

---

## 2 · Attacks on the campaign design

### 2.1 · "Cells differ in reader speed, so cross-cell comparisons are invalid" — **accepted, and constrains the reading**

X1 runs at step-scale 2, X2 at 1, X3 and N0 at 8. Absolute latencies are therefore **not
comparable across cells** and must never be quoted side by side as if they were. Only the
*ordering and separation of arms within a cell* may be compared across cells.

This is the price of the pre-registered rule that the operating point is calibrated per
cell and frozen. The alternative — one scale everywhere — puts most cells outside the
admissible band, which is worse.

### 2.2 · "Eight comparisons at ~10 % false-positive each" — **accepted, and it is the main statistical limit**

Three repeats with a min/max non-overlap rule carries roughly a 10 % false-positive rate
per comparison. R6 makes two comparisons per cell across four cells: **eight**. Expected
false positives under a global null are therefore near one.

Two guards, both pre-registered: an effect must clear **15 %** as well as separate, and
**N0 must show nothing**. A single unreplicated separation in one cell is not a result no
matter how clean it looks.

### 2.3 · "One trace, one fixture, one cache size" — **accepted, unmitigated**

Every number comes from a single synthetic trace (`radiologist_review_500`, 681 steps, 59
jumps ≥ 20 frames) over a fixture of one repeated byte, with a 64-frame LRU cache chosen
rather than measured from a target device. A different jump distribution could reorder the
arms. Nothing here rules that out.

### 2.4 · "X3 is not the isolation it is named for" — **conceded in advance**

Stated in the pre-registration before running: loss and stranding are not independently
controllable, because loss lowers achievable throughput and that is itself what causes
stranding. X3 is loss-dominant with weak stranding, not loss without stranding. X2 and N0
remain logically clean in the other direction — at 0 % loss nothing is retransmitted.

### 2.5 · "The fairness arm may not actually be fair" — **checked, it is**

`quinn-proto-0.11.17/src/config/transport.rs:373` sets `send_fairness: true` by default,
and `server/src/transport/tuning.rs` leaves it unset unless the flag is passed. So
`perframe_fair` is genuinely fairness-on and `perframe_fifo` genuinely off. quinn's own
test (`state.rs:1528-1541`) pins the behavioural difference: fair re-queues a stream
*after* its priority peers (`a,b,c,a,b,c`), unfair *before* them (`a,a,a,b,b,b`).

The setting is a no-op for `shared`, which has one stream — so the shared arm is unaffected
by it, as intended.

### 2.6 · "netsim is not a network" — **accepted, the tier limit**

T2 throughout. One host, a userspace path simulator, constant bandwidth, constant RTT, one
drop-tail queue depth, no AQM, no ECN, no handovers, no cross-traffic. The real-path leg
was blocked ([`oracle-runbook.md`](oracle-runbook.md)) and its absence is a limit on every
conclusion below, not a footnote.

---

## 3 · Attacks on the results

*Written after the data was read.*

### 3.1 · The negative control failed, and the failure is mine — **accepted, narrows the campaign**

The pre-registration says: *"If any arm separates in N0, the rig is measuring something
other than what it claims and the whole campaign is void — not adjusted, void."*

An arm separated in N0.

| arm | N0 p95 (r1) | vs shared |
| --- | ----------- | --------- |
| `shared` | 79.47 ms | — |
| `perframe_fifo` | **79.53 ms** | **+0.08 %** |
| `perframe_fair` | 134.44 ms | **+69 %** |

**The control was mis-specified, and saying so after seeing the data is exactly the move
this project has been guarding against — so the reasoning has to stand on its own.**

It does, on a mechanism established independently of R6 and before it. Fairness round-robins
across *concurrent streams*; it needs nothing but more than one of them. N0 has depth 8, so
a jump asks up to 8 frames at once and fairness advances all 8 together, finishing them all
late instead of finishing the measured one first. That requires neither stranding nor loss.
quinn's own test pins the behaviour (`state.rs:1528-1541`): fair yields `a,b,c,a,b,c`,
unfair `a,a,a,b,b,b`. N0 removes loss and stranding; it does not and cannot remove
concurrency.

So N0 polices what it was built to police for two of the three arms and not for the third:

- **Valid for `shared` vs `perframe_fifo`.** Both are FIFO-ordered, so any difference
  between them in N0 would have to be spurious. They agree to **0.08 %** — better agreement
  than this rig has shown anywhere, and direct evidence it introduces no artifact between
  the two shapes. **This is the comparison the campaign's headline rests on**, and it is
  clean.
- **Invalid for anything involving `perframe_fair`**, whose effect is live in every cell
  including the control.

**Consequence, applied rather than argued around:** `perframe_fair` results are reported as
confirming a previously known fairness penalty, and **may not be used to attribute anything
to head-of-line blocking or stranding**, because the control cannot separate those from the
fairness effect. Only the `shared` vs `perframe_fifo` contrast carries the head-of-line
question.

The honest summary is that R6 shipped with a control that covers two arms out of three, and
the third arm's rows are demoted accordingly.
