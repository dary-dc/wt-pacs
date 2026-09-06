# Lane L4 — pre-registration: which transport approach, for which case

**Written before the campaign ran.** Hypotheses, predictions and decision rules are fixed
here so that a result cannot be reinterpreted after the fact into a success. Where a
prediction was already contradicted by instrument validation, that is recorded below in
the same document rather than quietly revised.

**Status of each claim is marked H (hypothesis, untested), P (prediction with a number),
or D (decision rule).** Raw data: `docs/measurements/l4/`.

---

## 0 · Instruments, and what they are allowed to answer

| tool | what it does | validated by | may answer | may **not** answer |
| ---- | ------------ | ------------ | ---------- | ------------------ |
| `lab/netsim` | userspace UDP delay / loss / rate / finite queue | E0 below | latency, loss, congestion-control questions | CPU, throughput ceilings |
| `target/lab-arms/exact-server-seg*` | quinn patched to expose `initial_window` (runtime env) and the GSO cap (build time) | E0 check 3 | knob sweeps | anything about product defaults |
| direct loopback rig | `quic_opt_bench.sh` / `quic_opt_multiclient.sh` | prior campaign | CPU per byte, GSO | latency under RTT |

**No `server/` code is modified by this lane.** The extra knobs come from patching quinn
outside the tree (`lab/scripts/quinn_lab_build.sh`), which is why they exist only in
`target/lab-arms/`.

### E0 — instrument validation (run first; a failure here voids everything)

| check | result | verdict |
| ----- | ------ | ------- |
| netsim delay accuracy | cfg 30/60/150 ms → measured +30.2 / +60.3 / +150.4 ms over baseline | **pass** |
| netsim jitter | SD 0.45–0.50 ms across all delays | **pass** |
| netsim loss | 2 % per direction → 3.2 % round-trip measured, 3.96 % expected, n=500 | **pass** (within CI) |
| `QUINN_INITIAL_WINDOW` live | 2400 / 12000 / 48000 / 240000 → 2.50 / 2.75 / 3.00 / 3.25 Mbps, monotonic | **pass — knob is live** |

**netsim forwards datagram-by-datagram in userspace, destroying send-side GSO batching.**
Any CPU or throughput number taken through it is void by construction. This lane uses it
only for latency.

---

## 1 · The hypothesis this lane exists to test, and its first contradiction

**H1** — *p95 time-to-displayable on a WAN is dominated by congestion-window ramp, so the
initial window is the largest available lever.*

**P1 (as written in `transport-optimization-spec.md` §S1)** — a 250 KB frame needs ~5 round
trips at IW10 and ~1–2 at IW≈240 KB, so raising the initial window should cut first-frame
time by **2–5×**.

**P1 is already contradicted by E0 check 3.** At RTT 150 ms, 250 KB frames, serial depth 1,
Cubic: IW 2400 → 240 000 moved per-frame time only from 800 ms to 615 ms — **4.10 round
trips at a window that should have carried the whole frame in one**. The knob is live
(monotonic, and the direction is right) but the magnitude is off by roughly an order.

So the spec's §S1 headline is **wrong as written** and this lane must find out why before
recommending anything. Candidate mechanisms, to be discriminated by E1/E2:

- **M-a · idle restart.** RFC 9002 §7.8 permits reducing the window after an idle period.
  A serial depth-1 pattern idles between every frame, so each frame may restart near the
  initial window regardless of how large it was — which would make a large IW help only the
  *first* frame of a burst, not a steady scroll.
- **M-b · pacing.** quinn paces. A large `cwnd` then yields a *rate* (cwnd/RTT), not a
  burst, so the window cannot be spent in one round trip.
- **M-c · the ask costs a round trip of its own.** Per-frame latency is ask-RTT + delivery,
  so delivery improvements are diluted by a fixed term the window cannot touch.

**D1** — If M-a or M-b holds, **initial window is demoted from "largest lever" and the spec
§S1 must be rewritten**, not softened.

---

## 2 · The confound the previous campaign never broke

**H2** — *the earlier "BBR is 4–6 % worse" verdict conflated the controller with its
window.* quinn's BBR ships `initial_window = 240 000` against Cubic's 12 000, so any
comparison at defaults measures both at once.

**D2** — BBR and Cubic must be compared **at matched initial windows**. A BBR win that
disappears at matched IW is a window result, not a controller result, and must be reported
as such. Conversely a BBR win that survives matched IW is a genuine controller result.

---

## 3 · The question three campaigns have failed to answer

**H3** — *per-frame streams beat a shared stream under loss, because a lost packet blocks
only its own frame.* Untested: campaign v2 was lossless, X3 was retracted.

**P3** — the effect must appear at 2 % loss or it does not exist. At 0 % the two are
expected to tie.

**D3 (unchanged from `L1-loss-run.md`, deliberately)** — per-frame must beat shared by
**> 15 % p95 at 0.5 % loss** to justify the client-side cost of out-of-order arrival.
A tie is not a reason to change a working design.

**H3b** — `send_fairness(false)` substitutes for per-stream `set_priority`. Tested as its
own arm so the cheap mechanism is not credited to the expensive one.

---

## 4 · Deployment cells — "which approach for each case" is answered per cell

Chosen to bracket a browser viewer on the public internet, not to flatter any arm.

| cell | RTT | rate | loss | stands for |
| ---- | --- | ---- | ---- | ---------- |
| **A** | 30 ms | 50 Mbps | 0 % | same-region broadband |
| **B** | 60 ms | 25 Mbps | 0.5 % | typical remote radiologist |
| **C** | 150 ms | 10 Mbps | 2 % | poor link / mobile / distant region |

Primary metric **p95 time-to-displayable**; secondary mean, and `fill_rate` as a sanity
check that an arm is not winning p95 by delivering less.

---

## 5 · Pre-committed stop conditions

Any of these voids the affected cells, and the finding is the stop, not a workaround:

1. **`p95_wait_ms == 0`** — wrong harness mode; the exact failure that voided campaign v2.
2. **`peak_outstanding < D`** — the harness is not producing the concurrency it claims.
3. **Client CPU ≥ 0.9 core** — the row measures the load generator, not the server.
4. **netsim `dropped_queue` > 0 in a 0 %-loss cell** — the simulator is the bottleneck, not
   the emulated link.
5. **Arms not interleaved within a repeat** — host drift is not common-mode. This host has
   already been replaced twice mid-session.

## 6 · Pre-committed anti-bias measures

- **Interleave every arm within each repeat.** Non-negotiable; it has already produced one
  wrong answer in this work.
- **Report every cell, including the ones that make a favoured arm look bad.** The
  initial-window contradiction above is the first test of this rule and is recorded in the
  same breath as the hypothesis.
- **Negative controls with a known answer.** The GSO segment cap must show **no effect**
  at these rates — it is a syscall-batching lever and these cells are RTT-bound. If it
  shows an effect, the rig is measuring something unintended.
- **Adversarial review before the conclusion is written**, by a reviewer given the data and
  asked to break the reading, not to confirm it.
- **A recommendation may not exceed its evidence tier.** T2 (this rig) is a synthetic
  userspace path, not a network.

---

## 7 · Adversarial review outcome — three defects that void the first campaign's headline

An independent reviewer was given the data, the pre-registration and the simulator source
and asked to break the claims, not confirm them. It succeeded. Each finding below was
re-verified directly before being accepted.

### 7.1 · The path was never congested, so every loss was exogenous — **fatal to E12/E6**

The three cells were specified with **rate × RTT constant**, so all of them have the same
bandwidth-delay product:

| cell | rate × RTT | BDP | max offered (D=4 × 32 003 B) |
| ---- | ---------- | --- | ---------------------------- |
| A | 50 Mbps × 30 ms | 187 500 B | 128 012 B = **0.68 × BDP** |
| B | 25 Mbps × 60 ms | 187 500 B | 128 012 B = **0.68 × BDP** |
| C | 10 Mbps × 150 ms | 187 500 B | 128 012 B = **0.68 × BDP** |

The window never fills the pipe, so the bottleneck queue never builds, `--queue-pkts 500`
is dead configuration, and **no loss in E12 or E6 was ever generated by congestion**. All
of it was injected, uniform and independent of what the sender did.

That makes a loss-blind controller optimal *by construction*, and quinn's BBR is exactly
that. Cubic's measured rate tracks the Mathis formula (cell B 2.77 predicted vs ~3.3
observed Mbps; cell C 0.554 vs ~0.64), so those cells measured a closed-form equation
rather than a network. **E12's −72 %/−83 % is not a deployment result** and the rig could
not have shown BBR's known cost — a standing queue — because no queue existed.

### 7.2 · Repeats did not resample loss

`netsim`'s `--seed` defaulted to a constant and the campaign never varied it, so all three
"repeats" replayed an identical loss sequence. `cubic_b20` in cell B records
`bytes_on_wire = 23 138 892` in **all three** runs. The reported ranges therefore measured
host jitter only, and the non-overlap rule in `l4_analyse.py` was firing on noise. With
~4–10 loss events per run at burst 5/20, true Poisson variation is 30–50 %.

### 7.3 · `p95_wait_ms` was not a p95

`cine_scrub_30fps` runs forward then reverse over a cache that never evicts, so ~80 of the
161 samples are **structural zeros**. A nominal p95 over all samples is roughly the 89th
percentile of the informative ones — and in cell A, where only ~20 samples are non-zero,
close to their median.

### 7.4 · Two reported numbers fail the lane's own rule

Re-checked with the non-overlap test this document pre-committed to:

| reported | actual | verdict |
| -------- | ------ | ------- |
| "at burst 5, cell B, BBR is 38 % worse" | bbr 52.9–75.7 vs cubic 53.1–53.7 | **ranges overlap — not a result** |
| "at burst 20 the two tie (+3.2 %)" cell C | bbr 179.1–182.2 vs cubic 159.7–175.7 | **3/3 separated — BBR is worse** |

Both errors overstated certainty. Recorded rather than quietly corrected.

### 7.5 · Also accepted, lower impact

- **Stop condition 4 never ran.** `netsim`'s counters are collected but never printed, so
  no cell was ever checked for the simulator being the bottleneck.
- **Arms do unequal work.** The client's window re-asks frames already in its cache, so
  runs transfer 296–723 frames where only 80 unique frames exist. BBR moved ~1.9× the
  frames Cubic did. `wait_samples` is 161 by construction and can never flag this.
- **netsim adds 1.6–4.6 ms of its own latency with a ~1.2 ms load-dependent component**,
  which is larger than the entire cell-A effect. Cell A resolution is not trustworthy.
- **Burst loss is packet-counted, not time-bounded**, so a 20-packet outage lasts longer
  in wall-clock for a slower sender — the burst arms are not "the same path, clustered".
- **MTU discovery is unpinned**, so arms may settle at different MTUs and therefore take
  different numbers of loss events per frame.

### 7.6 · What was fixed, and what is re-run

Fixed: seed varies per repeat; a forward-only trace removes the structural zeros;
percentiles are now computed over non-zero waits (`nz_p50/p95/p99/max`, plus `nz_n` so a
thin tail is visible). **E7 re-runs the controller comparison at depth 16 — 2.7 × BDP —
so the queue actually overflows and the loss is congestive**, which is the condition E12
could not produce and the one real paths mostly have.

**E12 and E6 are retained as data but must not be quoted as deployment guidance.** They
characterise behaviour under exogenous rate-independent loss at 0.68 BDP, which is a
legitimate but narrow regime — roughly, a wireless link with bit errors and an
application that never fills the pipe.
