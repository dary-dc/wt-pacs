# L1 — second review, and what to do next

**Date:** 2026-09-04 · **Branch:** `cursor/l1-loss-run-dbae`
**Reviews:** `docs/measurements/r2/L1_V2_ADVERSARIAL_REVIEW.md` (v2 verdict) and
[`L1-v3-small-collect-plan.md`](L1-v3-small-collect-plan.md) (awaiting sign-off)

An independent second pass over v2, the v3 harness/rig changes, and the collect plan that is
currently blocking. **This does not restate the v2 review — that verdict stands.** It records where
a second reviewer agreed, one place the first review is wrong, findings it did not cover, and the
work items that follow.

---

## 1 · Concordance — the v2 verdict is confirmed independently

A second review reached the same conclusions from the same 120 rows, without reference to the first.
Where both quantified the same thing:

| finding | first review | second review |
| --- | --- | --- |
| Gain, rtt 60 / 0.5 % | +35.5 %, CI [+3.3, +55.3], p 0.016 | +35.5 %, CI [+3.4, +55.3], p 0.019 |
| Gain, rtt 150 / 0.5 % | +29.2 %, CI [−6.3, +51.6], p 0.101 | +29.2 %, CI [−6.8, +51.3], p 0.082 |
| Null cell (rtt 150, 0 % loss) | +26.0 % | +26.0 % |
| Ask redundancy | 3.8× (D=4), 6.7× (D=7) | 4.05× / 7.09 × simulated; 3.8× / 6.7× observed |
| Wire time vs 4.0 s trace | 7.8 s / 13.7 s | 7.9 s / 13.5 s |
| Real path RTT | ≈ 240 / 300 ms, base ≈ 210 ms | ≈ 233 / 301 ms, ratio 1.29× not 2.50× |
| Formula D at real RTT | 10 and 13 | 10 and 13 |

Two agreeing derivations from independent starting points. **`l1_s_vs_q_loss_v2.tsv` is void; the
`.VOID.tsv` rename and banner are correct and sufficient.** Nothing below reopens that.

The second pass also confirmed what the first review's §8 credits: 120/120 rows internally
consistent (every row implies exactly 81 wait samples; `miss_p95 ≥ p95_all` and
`miss_mean ≥ mean_all` in all 120; no duplicate keys), git provenance matching plausible run times,
and a correct, well-tested nearest-rank percentile. **Nothing was fabricated or miscomputed.** The
failures are in the experiment, not the arithmetic.

---

## 2 · Correction to `L1_V2_ADVERSARIAL_REVIEW.md` §8

> §8: "`peak_outstanding == depth` in every row — the depth was genuinely achieved."

**That inference does not hold for v2, and the line should not be carried into v3 as reassurance.**

In the v2 harness, `emit_window` inserted each frame into `outstanding` *before* awaiting
`ask_frame`. Arrivals took ≥ 230 ms on the real path; D control-stream writes take microseconds. So
`o.len()` reached D within microseconds of the first window **regardless of what was on the wire** —
`peak_outstanding == depth` was guaranteed by construction, not observed. It measured the harness's
own bookkeeping.

This matters twice over for v3:

- It is not independent evidence that v2's depth was real, so it should not soften the void verdict.
- **After S1/S2 the invariant inverts.** With cache-dedup and a forward window, `outstanding` no
  longer fills trivially, and `peak < D` becomes a *legitimate* steady state. A naive `peak == D`
  gate would now void good runs. Neither the v3 scripts nor the collect plan reference
  `peak_outstanding` at all — decide deliberately what it should assert, rather than inheriting the
  v2 reading.

---

## 3 · Findings the first review did not cover

### 3.1 · Four `stream-mode-remediation.md` §R4 requirements were missed, and two were stop gates

§R4 is the standing spec for exactly this rerun. It is not cited anywhere in the v2 lane brief.

| §R4 row | required | v2 |
| --- | --- | --- |
| Depth | "**each arm at its own `D_min`** — not a shared constant. **This was the decisive flaw**" | one shared formula `D`. `L1-loss-run.md` reverses R4 without declaring it a reversal |
| Trace | "the full trace, **not 80 steps**. p95 needs more than ~4 tail samples" | an 80-step trace. After miss-only filtering the p95 sat at rank 65–73 of 68–77 — **exactly 4–5 tail samples** |
| Control | "**the 0 %-loss row is a gate.** If the arms differ meaningfully with no loss, **stop**" | **never implemented.** The only gate was at D=1. The 0 %-loss cell at formula D showed **+26 %** — it would have tripped |
| Priority | "record that it is on" | not recorded in the TSV or logs |

§R5 additionally requires the demand ÷ supply precondition before any run. `cloud_common.sh:31`
implements it as `cloud_precheck_ratio`. **It has never been called** — not by v2, and not by any v3
script. `L1-v3-action-plan.md` §A1 says so itself ("was never used to *choose* the cadence") and is
right to.

The pattern §R5 describes — three campaigns lost to cell selection — is now four. **The governance
that already existed would have caught v2 before the first row.**

### 3.2 · The protocol change kept its own control rows

At `1a07f26` the step interval went 185 → 50 ms and nine D=4 rows were deleted. The commit message
says "keep only D=1 control rows after the methodology tweak." Those ten rtt-60 D=1 rows are
byte-identical to `a2201e6` (verified) and shipped in the final file, taken at 185 ms — while the
rtt-150 controls were taken at 50 ms. **The two halves of the grid had controls from different
protocols, and the TSV had no column that could reveal it.**

The mechanism is still live: `row_exists` keys only on `(arm, fixture, rtt, loss, depth, run)`, so a
resume across any protocol change silently keeps stale rows. v3's S11 freeze rule addresses the
policy; **the runner still needs a protocol/config hash in the row key** to enforce it.

### 3.3 · The rig-idle detector cannot detect anything

`l1_wait_rig_then_v2.sh:32` runs `ss -tn state established '( sport = :4435 )'` — `-tn` is **TCP**;
the server is WebTransport over QUIC/**UDP**. That check returns 0 unconditionally, so
"RIG FREE … conn=0" (`:88`) is vacuous. The first review correctly notes the lock is advisory and
displacing; the idle gate meant to back it up was dead code. Use `ss -uan`, or drop the check rather
than let it read as protection. (Less pressing now that v3 runs rig-local on a private veth pair,
but the wrapper is still on disk and still the documented entry point.)

### 3.4 · Three guards the project declared mandatory are still absent

`window-saturation-experiment.md` §"Guards now required" lists five. v3 has improved two of the
three that were missing, but not the first:

| guard | v2 | v3 |
| --- | --- | --- |
| **Frame-size assertion** — "this is what exposed defect 3" | ❌ | ❌ **still absent.** No v3 script compares observed bytes/frame against the fixture's `meanFrameBytes` |
| Never discard server output | ❌ | ⚠️ raw JSON is now committed; server-side log retrieval still not in the collect path |
| Fresh port per cell | ❌ fixed 4435 | ⚠️ per-*arm* ports (4435 S / 4437 Q), not per cell |

### 3.5 · Minor code items, unchanged

- `l1_loss_run_v2_cloud.sh:44` sets `REPEATS_LOSSLESS` without `export`, but `:359` reads it via
  `os.environ.get`. Works only because the default matches; override it as a shell var and the D=1
  control silently gates on 5.
- `wait_outstanding_below` returns `Ok(())` on timeout — a wedged outstanding set proceeds silently
  rather than voiding.
- Lane doc says a harness failure writes a `FAIL` row; `run_cell:313` writes `VOID`.
- `L1-loss-run.md` says "32 KB"; the fixture is 32000 B decimal.

---

## 4 · Review of the small-collect plan — the live gate

The plan asks for sign-off on five checklist items. Four have answers below; two further blockers
are not on its checklist.

### 4.1 · BLOCKER — the null gate is looser than the decision it protects

> Plan, hard stop gates: "Null smoke | S vs Q miss_p95 at 0 % within **25 %** rel or 200 ms abs"

The decision rule is **Q beats S by > 15 %**. A null gate that tolerates a 25 % arm difference with
no loss present **permits a zero-effect discrepancy larger than the effect the campaign exists to
detect.** It cannot certify the decision cell; a cell that passes it can still be dominated by
whatever produced the null difference.

The 25 % / 200 ms figure is inherited from v2's *D=1* control, where it was a rig-stability check.
It is the wrong number for a null control at operating depth.

**Fix:** the null gate must be **at most** the decision threshold, and stated as an interval, not a
point — *the null cell's 95 % CI must exclude 15 %*. If the null cell cannot clear that with 10
repeats, that is itself the finding: the design is not yet able to resolve 15 %.

### 4.2 · BLOCKER — `cache_misses ≥ ~15` makes `miss_p95` a maximum, not a p95

> Plan: "Miss budget | decision rows need enough positive waits (aim `cache_misses ≥ ~15`)"

Nearest-rank p95 at N=15 is `rank = ceil(0.95 × 15) = 15` — **the largest of 15 samples.** At N=20 it
is the 19th of 20. The statistic is a max estimator with the variance of a max.

`stream-mode-remediation.md` §R4 already forbade this — "p95 needs more than ~4 tail samples" — and
v2 violated it at 4–5. **A ≥15 budget is worse than the thing that was already ruled out.** For the
p95 to rest on ~5 samples you need ≈100 positive waits per run.

`lab/traces/l1_one_way_160.json` and `lab/fixtures/frames_32k_160/` were built for exactly this (A7).
**No v3 script uses them** — `l1_v3_path_validate.sh:20`, `l1_v3_pilot_cadence.sh:26` and
`l1_v3_isolate_rtt_excess.sh:21` all hardcode the 80-frame trace with `FIX_FC=80`, and the collect
plan does not name a trace, so it would inherit 80.

**Fix:** run the collect on the 160-frame trace, and state the miss budget as a *tail-sample* count
(≥ 5 samples at or above the p95), not a raw miss count. If a cell cannot reach it, report the miss
distribution or the mean and say the p95 is unavailable — do not publish a max as a p95.

### 4.3 · The pilot outliers are bimodal, not noise — median-of-3 hides a regime

> Plan flag 1: "Loss cells: 1-of-3 outlier pilots. Median still tracks the 'good' cluster."

The three loss cells each have one pilot at **2.5–3.4× off** the other two (12.52 vs 32.2; 9.65 vs
31.7; 7.92 vs 28.4), while the lossless pilots have a spread of ≈1.0. That is not dispersion around
a mean — it is **two regimes, one of which occurred in 1 of 3 pilots.**

v2 showed the same signature: in the rtt-60 / 0.5 % S block, five runs clustered at hit ≈ 0.23 /
miss_p95 ≈ 170–260 ms and four at hit ≈ 0.07 / miss_p95 ≈ 340–442 ms. The same bimodality, in the
same conditions, in a different campaign.

Neither remedy the plan offers is right. More pilots estimate the mixture better but still freeze one
number. **Outlier rejection deletes the regime.** A cadence calibrated only to the fast regime will
run the reader too fast whenever the slow regime occurs, producing BACKLOG rows in ~1/3 of runs — and
BACKLOG is not missing-at-random with respect to the arm.

**Fix:** diagnose the slow regime before freezing a cadence (the `raw/l1v3/pilot/*.json` are
committed — compare `wait_ms`, `asks_sent` and `step_loop_ms` between the fast and slow pilots). If
it is real and loss-triggered, the cadence must be safe in *both* regimes, or the run must record
which regime it was in.

### 4.4 · Checklist item "A1 factor 0.9 vs ~1.1" — decide it from the reader, not the metric

The plan's flag 2 is correct on the arithmetic: `1000/(0.9 × f_cell)` makes the reader ≈ 0.9× the
delivery rate, i.e. **slower** than delivery, while the A1 prose says "marginally faster."

The deeper point: **choosing the factor by whether it produces misses is v2's failure re-entering
through the back door.** v2's protocol drift was `step_interval_ms` retuned until the miss gate
passed. Calibrating from a measured `f_cell` is a large improvement — but if the factor is then
selected for miss yield, the operating point is again set by the instrument.

**Fix:** state what the factor represents about a *reader* — a clinical scrub rate, or an explicit
"reader marginally outruns delivery" stress case — and derive it from that, once, in the lane doc.
Per §R5, state what result the chosen cell **cannot** produce. If a realistic cadence yields almost
no misses at 0 % loss, **that is the finding** (A1 predicts exactly this once the path is fixed):
report it and change the decision metric, rather than speeding the reader until misses appear.

### 4.5 · Not on the checklist, and required

- **Interleaving (S6) is not stated in the plan.** The grid gives "repeats/arm" with no ordering, and
  the only existing multi-arm runner, `l1_v3_path_validate.sh:260`, is blocked (`for arm in S Q`).
  Arm-blocked collection is the confound that made v2's decision cell unreadable — in v2, splitting a
  *single* arm's repeats first-5/last-5 moved the median 19–22 %, larger than the 15 % rule. **The
  collect must interleave and stamp every row with a timestamp** before it takes a single row.
- **`cloud_precheck_ratio` still not called** (§3.1). Run it per cell and put the demand ÷ supply
  line in the plan.
- **Frame-size assertion still absent** (§3.4).
- **"Directional only" must be binding.** 10 repeats/arm at the observed spread gives ≈0.27 power for
  a 15 % effect. The plan says this correctly; make it a property of the artifact — write
  `DIRECTIONAL — NOT A DECISION` into the TSV header, as `.VOID.tsv` does.

---

## 5 · Residual risk to carry forward

Path validation is a genuine fix and passed on its own terms: netem now shapes **both** directions on
a rig-local veth pair, the harness runs in the client netns, and `ping` confirms 60.28 / 150.30 ms
against 60 / 150 labels. That closes the v2 RTT defect properly.

But `PATH_VALIDATION.md` records an unexplained **RTT-proportional excess** of ≈ 23 ms at RTT 60 and
≈ 72 ms at RTT 150 over `RTT + Tf`, and gate S4b passes against an **empirically fitted band**
(`1.5·RTT + Tf ±15 %`) — described honestly as "a fit for the gate, not a claim." Isolation A/B has
narrowed it to the post-enqueue QUIC path.

**A gate fitted to the observed data cannot detect what it was fitted to.** The decision cells compare
arms across two RTTs, and an unmodelled RTT-scaling term sits inside both. This does not block the
small collect — it is a smoke test — but **it must be resolved before any powered run**, and before
any RTT-axis claim is made. Track it as a v3 blocker, not a footnote.

---

## 6 · Next steps

Ordered. Owners follow `stream-mode-remediation.md` §R0a: cell selection and power are
design/analysis, not implementer work.

### Blocking the small collect — implementer, unless marked

| # | do | fixes | done when |
| --- | --- | --- | --- |
| **N1** | Tighten the null gate to ≤ the decision threshold, expressed as "null CI excludes 15 %" | §4.1 | plan and collect runner both carry the new gate |
| **N2** | Move the collect to `l1_one_way_160.json` + `frames_32k_160`; restate the miss budget as ≥ 5 tail samples at/above the p95 | §4.2 | `FIX_FC`/`TRACE` are parameters, not hardcoded; gate rejects a cell that cannot reach the tail count |
| **N3** | **Design/analysis:** diagnose the bimodal pilot regime from the committed `raw/l1v3/pilot/*.json` before freezing cadence | §4.3 | the slow regime is explained, and the frozen cadence is safe in both or the regime is recorded per row |
| **N4** | **Design/analysis:** fix the A1 factor from a stated reader model; record the §R5 demand ÷ supply line and what the cell cannot produce | §4.4, §3.1 | lane doc states the factor, its justification, and the precheck output per cell |
| **N5** | Interleave arms run-by-run (S,P,Q,S,P,Q…), randomise order, stamp every row with a timestamp | §4.5 | consecutive rows within a cell alternate arms (S6's own check) |
| **N6** | Call `cloud_precheck_ratio` per cell; add the frame-size assertion against `meanFrameBytes` | §3.1, §3.4 | both run in the collect path and can STOP a cell |
| **N7** | Write `DIRECTIONAL — NOT A DECISION` into the small-collect TSV header | §4.5 | header line present before the first row |

### Before any powered run

| # | do | fixes |
| --- | --- | --- |
| **N8** | Resolve the RTT-proportional excess, or state it as a known additive term and show it is arm-independent at both RTTs | §5 |
| **N9** | Add a protocol/config hash to the row key so a resume cannot keep rows from an earlier protocol | §3.2 |
| **N10** | Decide what `peak_outstanding` should assert post-dedup, and gate on that — do not inherit `peak == D` | §2 |
| **N11** | **Design/analysis:** power the grid (first review: ≈40 runs/arm at RTT 60, ≈80 at RTT 150) and pre-register the aggregation. Prefer pooled miss samples over median-of-p95 | §4.2 |
| **N12** | Housekeeping: `ss -uan` in the idle detector, `export REPEATS_LOSSLESS`, void-on-timeout in `wait_outstanding_below`, `FAIL`/`VOID` wording, "32 KB" → 32000 B | §3.3, §3.5 |

### What lands where

`server/`, `client/`, `common/`, `ingest/`, `tools/` are **product**; `lab/` is the lab. N1–N12 are
`lab/` and `docs/` only. **No product change is authorised here.** The S-vs-Q outcome still decides
what lands, per `stream-mode-remediation.md` §R0b — and that outcome is not yet known.
