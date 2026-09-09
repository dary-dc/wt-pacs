# L2 ask-policy — adversarial methodology review

**Verdict: the campaign in `l2_ask_policy.tsv` does not measure ask policy. Do not use it for D26,
and do not re-run the grid until the harness is fixed — the grid is not what is wrong.**

Scope: the L2 lane as it stands at `5357323` — `docs/lanes/L2-ask-policy.md`,
`lab/scripts/l2_ask_policy_cloud.sh`, `lab/window-harness/src/{client,depth,metrics,wire}.rs`, and
the 54 committed rows plus 18 `d_current` trajectories.

Four findings are blocking: each one, on its own, is enough to explain the entire ranking in the TSV
without any of the three arms differing in ask policy. They compound rather than cancel.

## How this review was checked

Three independent ways, so that no finding rests only on reading the code:

1. **Arithmetic on the committed rows.** `bytes_on_wire`, `asks_sent` and the fixture's frame size
   are enough to bound each run's link time and to expose a systematic shortfall. Needs no rig.
2. **A local replication** (`lab/scripts/l2_review_replicate.sh`) that runs the three arms against a
   local `exact-server`, with the harness's own `LinkPacer` supplying the 10 Mbps cap
   (`--read-bps 10000000`) instead of `tc`. It reproduces the committed campaign's ask counts, byte
   counts, D trajectory and p95 ordering. **This box has no `sch_netem`** — not in the root netns
   and not under `unshare --net` — so it is unshaped loopback, which the R2 house rules rightly say
   is not a substitute for a shaped path. It is used here only for facts that are not
   RTT-proportional: how many asks each arm sends, how many bytes it pulls, where D goes, and how
   long the run takes relative to the trace. Every one of those matches the rig data.
3. **A path measurement to the rig** — five TCP connects to `168.138.130.163:22`, the port
   `cloud_netem.sh` deliberately leaves unshaped, from a cloud-agent container of the same kind the
   lane script defaults its SSH key to.

---

## Blocking findings

### B1 · The metric rewards asking late, and each arm chooses its own ask times

`p95_wait_ms` is the time from **the harness's ask** to displayable (`wait_displayable`, spawned per
step). It is not the time from the reader's scheduled step. The windowed arms gate every step on
`wait_outstanding_below(outstanding, d-1)` before they ask, so an arm that falls behind the link
stops offering the trace's 16 ms cadence and starts asking at the link's pace — and every ask it
defers is time that never enters the measurement.

The committed rows prove the deferral without needing the rig. The fixture is 80 frames × 32 004
bytes and the cap is 10 Mbps, so a run cannot be shorter than `bytes_on_wire / 1.25 MB/s`, while
the trace is 119 steps × 16 ms = **1.90 s** of reader time:

| cell | arm | bytes | link time ≥ | reported p95 |
| --- | --- | --- | --- | --- |
| rtt150 / loss0 | control | 3.81 MB | 3.05 s | 1822 ms |
| rtt150 / loss0 | fixed | 17.83 MB | **14.26 s** | **841 ms** |
| rtt150 / loss0 | dynamic | 46.63 MB | **37.30 s** | 3459 ms |

A run that occupies the link for 14.3 s to serve a 1.90 s scroll has left the reader waiting for
more than twelve seconds beyond schedule. It reports 841 ms. The only way both numbers can be true
is if the asks were issued late, which is exactly what the depth gate does.

Locally the same three arms take **3.21 s / 6.36 s / 29.87 s** of wall clock for that 1.90 s trace —
each within 5% of its own `bytes / 10 Mbps`. All three arms are link-limited; the "winner" is simply
the arm that spread its asks over the longest window.

The sharpest version of this: **the control arm, with no depth bound at all, scores a better p95
than every arm in the campaign if you slow its steps by 10 ms.** Same policy, same 3.81 MB, same
wall clock:

| arm | step interval | p95 | mean | wall | bytes |
| --- | --- | --- | --- | --- | --- |
| control | 16 ms (campaign) | 699.4 ms | 297.8 ms | 3.21 s | 3.81 MB |
| control | 26 ms | **26.5 ms** | 5.9 ms | 3.27 s | 3.81 MB |
| control | 53 ms | 3.6 ms | 2.3 ms | 6.46 s | 3.81 MB |

A 26× improvement in the lane's primary metric, and 190× at 53 ms/step, produced by changing
nothing except how fast the client asks. At 16 ms/step the trace demands 62.5 f/s against a 39 f/s
link (the deliberate `demand/supply ≈ 1.6` live cell); at 26 ms/step demand meets supply and the
queue disappears. The column measures the backlog implied by the offered cadence — and each arm
sets its own cadence.

Underneath this is a modelling error worth naming separately: **the depth policy is allowed to
change how fast the reader scrolls.** In a client, the cursor moves on the user's clock whatever the
window is doing. Here the gate makes the reader's clock a function of the network, so the three arms
are not serving the same user.

### B2 · The arms do not request the same data

`emit_window` asks for the centre frame **every step, unconditionally**, plus neighbours at ±1, ±2 …
out to `d`, and it never consults the display cache the harness already keeps. So depth does not
bound a fixed workload; it multiplies it. Over the same 80-frame study:

| arm | asks | duplicate asks | most asks for one frame | bytes |
| --- | --- | --- | --- | --- |
| control | 119 | 39 (the trace's own revisits) | 2 | 3.81 MB |
| fixed (d=2) | 239 | 159 | 5 | 7.58 MB |
| dynamic | 1120 | 1040 | **28** | 35.81 MB |

93% of the dynamic arm's asks are repeats of a frame it has already asked for. The committed rig
rows show the same pattern (239 / 359 / 564 asks for `fixed` at d = 2 / 4 / 7; 1032–1499 for
dynamic).

On a link that is already over-subscribed by design, a 2–12× difference in bytes requested is not a
second-order effect — it is the dominant term in every latency number in the table. Whatever the TSV
ranks, it is not "unbounded vs bounded ask depth".

### B3 · The dynamic estimator is a feedback loop that can only end at the clamp

The estimator's RTT input is `ask → first-byte`. On a **single shared, ordered stream**, served by a
server that reads one ask, writes that whole frame, then reads the next ask
(`server/src/transport/server.rs`), the first byte of frame *k* cannot arrive until every frame
queued ahead of it has been drained. That quantity is `RTT + queueing`, and the queue is set by `D`.
`D = ceil(U × (1 + RTT/Tf))` then raises `D`, which raises the next sample, and so on. The ADR that
defines the formula is explicit that `RTT` there is the path round trip — "how many frame-times fit
inside one round trip" — not the delay the client's own backlog is causing.

The trajectories confirm it, in all 18 dynamic runs: `D` ratchets **monotonically** to the clamp of
16 within 24–120 completed frames and never comes back down, in every cell, at every RTT, with and
without loss. `d_max_observed` is 16 in every dynamic row of the TSV; `d_min_observed` is just the
warm-up constant.

The decisive test is the local one. On loopback the path RTT is ~0.05 ms and `Tf` ≈ 25.6 ms, so the
formula's answer is `D = 1`. The estimator still went 2 → 4 → 14 → 16 and spent **91% of the run** at

16. This is not a tuning problem and no grid can fix it: the estimator is reading its own queue.

Consequently the dynamic arm is a fixed-depth-16 arm for 88–98% of every run, and lane question 2
("does adaptivity earn its complexity over a fixed constant?") has no evidence in this data at all.

Note also which direction the last remediation moved this. Before it, the pre-review rows have
`d_max = 4` and dynamic p95 of 110–370 ms; after "ask→first-byte + FIFO pairing", the same cells give
`d_max = 16` and p95 of 3.4–18.4 s. A 30–100× change in the headline number from harness edits alone,
on the same grid and the same rig, was recorded as a completed campaign rather than as the anomaly it
is.

### B4 · The RTT axis is not the RTT axis

Two separate errors, both unrecorded:

- `cloud_netem.sh` attaches netem to the **server's** root qdisc, so the delay applies to
  server→client only. The campaign profiles set one-way delay `= N/2`, which yields an added round
  trip of `N/2`, not `N`. Asks travel unshaped.
- The harness runs wherever the operator is, across the open internet to São Paulo, and neither the
  script nor any row records the base path RTT. From a cloud-agent container — which is what the
  lane script's default `SSH_KEY=~/.ssh/id_ed25519_rig_agent` implies — that base is **~143 ms**
  (five TCP connects to the unshaped SSH port: 135.5, 143.7, 144.3, 144.4, 144.7 ms).

If the campaign was run from such a container, the cells labelled 20 / 60 / 150 were approximately
**153 / 173 / 218 ms**: a 1.4× span reported as 7.5×. If it was run from somewhere else, the true
numbers are different but equally unrecorded, which is the point. The row shows a label, not a
measurement.

This lands on the `fixed` arm directly: its depth comes from `formula_depth` applied to the
**nominal** label (2 / 4 / 7). If the real path is ~150–220 ms, the formula's own answer is 7–9
everywhere, so the arm named "the formula depth for the cell" is not that in any cell.

The repo already has the check that would have caught this — `lab/scripts/e0_netem_validation.sh`,
whose header says to run it *before* the emulated grid — and the R2 brief says in as many words to
confirm the shaped RTT "before trusting anything". The L2 campaign script does neither, and records
no achieved RTT or throughput per cell.

---

## Serious findings

These do not each invalidate the campaign on their own, but every one of them corrupts a specific
column or a specific claim that has been made about the run.

### S1 · `bytes_on_wire` is short by exactly `D` in every windowed row

`asks_sent × 32 004 − bytes_on_wire` is 0 for all 18 control rows and **exactly `d_max_observed`
frames** for all 36 windowed rows: −2 at d = 2, −4 at d = 4, −7 at d = 7, −16 for every dynamic row.

The cause is in `run_windowed`: after the drain, it sends one more window of up to `D` asks around
`wanted`, counts them in `asks_sent`, then waits only for `wanted` — which is already cached, so
`wait_displayable` returns 0 immediately — and returns. `EndSession` and a 50 ms sleep follow, and
the connection closes on top of `D` in-flight responses. Nothing flags it, because both
`wait_frames_on_wire` and `wait_outstanding_below` return `Ok(())` on timeout: a drain that never
completes is indistinguishable from one that did.

Separately, the column counts received application payload. It excludes ask traffic, headers and
retransmissions, which is why every control row reports byte-identical totals at 0% and 0.5% loss.
It cannot support the "bytes on the wire" comparison the brief asks for.

### S2 · The oscillation stop condition cannot fire for the failure it names

The brief's stop rule is "`D` oscillates every evaluation despite the damping rule". Damping adopts
only after two *consecutive equal* computations, so a computed sequence that alternates A, B, A, B
never adopts anything. The detector in `maybe_adopt` only ever inspects adopted values
(`recent_adopts`). The specified pattern therefore produces no adopts, no entries, and no stop.

`CAMPAIGN_EXIT=0 (no oscillation stop)` in `l2_ask_policy_STOP.txt` is not evidence that `D` did not
oscillate; it is evidence that this detector cannot say. (Here it is moot — `D` pinned to the clamp —
but the stop condition should not be reported as satisfied.)

### S3 · The wait samples are not comparable across arms

- Control contributes 119 samples, the windowed arms 120. The extra one is the post-settle re-ask of
  `wanted`, which is always a cache hit and always scores exactly 0.
- 39 of the trace's 119 steps are revisits (forward 0→79, then back 78→40). `wait_displayable`
  returns 0 for anything already in `cache`, and `cache` is never evicted. Those zeros mean "already
  had it", not "arrived fast", and they land differently per arm: 23 of 119 for control versus 40 of
  120 for fixed in the local run. They shift both the mean and the nearest-rank index.

The nearest-rank p95 fix itself is correct and correctly tested; the problem is the sample set it is
applied to.

### S4 · The control arm is not the arm the brief specifies

The brief defines control as today's shipping behaviour — "the shipping client asks for every frame
in the series **at once**" — and `run_legacy_schedule` is even commented "Fire-all". It is not
fire-all: it asks one frame per 16 ms step, with no outstanding bound. That is a reasonable arm, but
it is a *different* arm, and it is the one the lane's first question is answered against. Nothing in
this campaign measures the ask-everything-at-t0 behaviour that the window design exists to replace.

### S5 · Run order is confounded with arm, and there is no outlier policy

Arms run in fixed order (control → fixed → dynamic) within a cell, repeats back-to-back, no
interleaving and no randomisation, on a box that is round-robined with L1 and reached over a shared
WAN. Any drift within a cell maps onto arm. Two control rows are 5–7× their siblings — 11 753 ms at
60/0.5 and 10 601 ms at 150/0.5 — and both are run 3 of a loss cell. With n = 3 and no stated policy
for handling them, those cells have no usable central value.

### S6 · The result is not auditable

Per-run JSON, including the `wait_ms` vector every reported statistic is derived from, is written to
`.local/r2/l2_ask_policy/raw/` — gitignored. Only p95 and mean were committed, so no reader can
recompute the percentile, count the structural zeros in S3, or check the tail. The R2 brief is
explicit that `.local/` never reaches anyone and that results must be committed under
`docs/measurements/r2/`.

### S7 · Bookkeeping

`l2_ask_policy_STOP.txt` says the campaign is complete; `docs/lanes/L2-ask-policy.md` still says
"shaped rows provisional; re-run required". The commit that claims to reconcile them
(`5357323`, "mark lane status campaign-complete") is empty — it changes no files.

---

## Smaller things, still worth fixing

- **`outstanding` is a `HashSet<u32>`.** Duplicate asks for the same index collapse to one entry, and
  the first response removes it while a second is still in flight. The depth gate and
  `peak_outstanding` therefore both undercount concurrency — and `peak_outstanding` is the documented
  invariant whose failure is supposed to void a run.
- **`depth.rs` deviates from a spec that says not to.** The `span_factor = (n-1)/n` throughput
  correction is not in the brief, which says to implement the estimator exactly and to stop and
  report rather than substitute.
- **Silent timeouts.** `wait_outstanding_below` and `wait_frames_on_wire` return `Ok(())` when they
  expire; no column records that a run ended on a timeout rather than on completion.
- **The server serialises asks anyway.** It reads one ask, writes that frame to completion, then
  reads the next. Depth never produces concurrent service here; it only lengthens the queue that a
  cache miss waits behind. That is worth stating explicitly in any depth result from this rig.
- **Constant frame sizes.** The fixture is 80 identical 32 000-byte frames, so the `Tf` estimator's
  "median frame bytes" is never exercised against the per-frame size variance the ADR names as the
  reason `Tf` needs an estimator at all.

---

## What has to change before a re-run

Re-running the grid would produce the same artefacts at higher resolution. In rough dependency
order:

1. **Anchor the metric to the reader's clock.** Report lateness against each step's scheduled display
   time, and the fraction of steps that missed it. Keep ask→display as a diagnostic, never as the
   arm ranking. Until this changes, any arm can win by asking later.
2. **Decouple the step loop from the depth gate.** The trace's cadence is the reader; a policy under
   test must not be able to slow it down. If an arm cannot keep up, that must appear as lateness,
   not as a stretched run.
3. **Make the arms request the same frames.** Dedupe asks against the display cache and against
   in-flight asks, so `D` bounds concurrency instead of multiplying the workload. Add a row-level
   invariant: unique frames delivered must match the trace's unique frames, and redundant bytes must
   be reported, not hidden in the same column as useful bytes.
4. **Give the estimator an input that is not its own queue.** Either measure path RTT out of band on
   the control stream, or subtract the known service backlog. Pin it with a regression test: on a
   link where the formula's answer is 1, the estimator must not adopt 16. The current code fails that
   test on loopback today.
5. **Measure the path, don't label it.** Run E0, record achieved RTT and throughput per cell in the
   TSV, and label cells by what was measured. Note that netem on server egress adds `N/2`, not `N`.
6. **Commit the raw per-run `wait_ms` vectors**, so percentiles can be recomputed by someone who did
   not run the campaign.
7. **Randomise or interleave arm order within a cell**, and state an outlier policy before
   collecting.

Two further points on the stop conditions themselves. The oscillation rule needs to watch *computed*
values, not adopted ones. And the set of stop conditions has no rule for the failure that actually
occurred here — a `D` that saturates its clamp and stays there is as much a broken estimator as one
that oscillates, and nothing in the lane's rules noticed it across three campaigns.

## Reproduction

```bash
cargo build -p window-harness -p exact-server --release
bash lab/scripts/gen_tf_fixtures.sh && bash server/scripts/gen_dev_cert.sh
./target/release/exact-server --port 4433 --study lab/fixtures/frames_32k/frames_32k.sbnd \
  --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem --stream-mode shared &
bash lab/scripts/l2_review_replicate.sh
```

Arithmetic checks on the committed rows (the `D`-frame shortfall in S1, the link-time bound in B1)
need only `l2_ask_policy.tsv` and the 32 004-byte frame size.

**Remediation plan:** `docs/lanes/L2-ask-policy-harness-fix.md` — implement before re-run; smoke:
`lab/scripts/l2_harness_smoke.sh`.
