# L2 harness fix plan — methodology remediation

**Status: Phases 1–6 + smoke + v2 grid done on PR #9.** Remaining gaps (path-RTT
probe, loss axis) are tracked in
[`l2_ask_policy_EVIDENCE.md`](../measurements/r2/l2_ask_policy_EVIDENCE.md). · Depends on
[`l2_ask_policy_METHODOLOGY_REVIEW.md`](../measurements/r2/l2_ask_policy_METHODOLOGY_REVIEW.md)

## Verdict

The committed rows in `l2_ask_policy.tsv` (and `l2_clean_rtt.tsv`) **do not measure ask policy**.
Re-running the same grid would reproduce the same artefacts at higher resolution. **Fix the harness
first.**

This document is the ordered work list. Each phase has **acceptance criteria** that must pass before
the next phase is trusted. The full grid runs only after the smoke script passes on loopback + one
shaped cloud cell.

---

## Phase 0 — bookkeeping (no harness logic)

| # | Task | Done when |
| --- | --- | --- |
| 0.1 | Lane + STOP say rows are **withdrawn**; point here and the methodology review | `L2-ask-policy.md`, `l2_ask_policy_STOP.txt` |
| 0.2 | Do not quote withdrawn TSV for D26 or product policy | team habit |
| 0.3 | Merge or land methodology review on `main` | `l2_ask_policy_METHODOLOGY_REVIEW.md` committed |

---

## Phase 1 — measure the reader, not the ask

**Problem (B1):** `p95_wait_ms` starts at the harness ask. Windowed arms gate on
`wait_outstanding_below` *before* asking, so deferred time never enters the score.

| # | Change | Where |
| --- | --- | --- |
| 1.1 | Record **scheduled step time** per trace index (wall clock when the step *should* display) | `client.rs` / `metrics.rs` |
| 1.2 | Primary metric: **lateness** = displayable time − scheduled step time (ms); cache hits = 0 lateness | `metrics.rs` `wait_stats` on lateness vector |
| 1.3 | Keep **ask→displayable** as diagnostic columns, not the arm ranking | TSV + JSON |
| 1.4 | Report **fraction of steps late** and **p95 lateness** | TSV columns |

**Acceptance**

- [ ] On loopback, control at 26 ms/step has lower p95 lateness than at 16 ms/step **without** lower
      ask→displayable (proves ranking uses reader clock).
- [ ] Fixed at rtt150/loss0 cannot report p95 lateness ≪ wall-clock link time for its byte count.

---

## Phase 2 — reader clock is independent of depth

**Problem (B1):** Depth gate slows the step loop; arms set their own “scroll speed.”

| # | Change | Where |
| --- | --- | --- |
| 2.1 | Step loop sleeps on **trace `step_interval_ms` only** — never blocked on outstanding | `run_windowed` |
| 2.2 | Asks are **async** relative to the step clock (spawn / queue); depth limits *offers*, not step timing | `client.rs` |
| 2.3 | If outstanding ≥ D, **skip or defer** new asks for that step; lateness captures backlog | `emit_window` / caller |

**Acceptance**

- [ ] Wall clock for the trace body ≈ `119 × step_interval_ms` ± small jitter on loopback (not
      stretched to `bytes / link_rate`).
- [ ] An arm that cannot keep up shows **high lateness**, not a longer run.

---

## Phase 3 — same workload across arms

**Problem (B2):** `emit_window` re-asks centre every step, ignores cache; arms pull 119 / 239 / 1120+
asks and 3.8 / 7.6 / 35+ MB.

| # | Change | Where |
| --- | --- | --- |
| 3.1 | Before `ask_frame`, skip if frame ∈ **display cache** or already **in-flight** | `emit_window`, `record_ask` |
| 3.2 | Control arm: define explicitly — **unbounded pipeline** at step cadence (not “series at t=0”) | `run_legacy_schedule` + lane doc |
| 3.3 | Optional second control: **true fire-all** (all unique frames at t=0) if lane still needs it | new mode or arm label |
| 3.4 | TSV: `asks_sent`, `unique_frames_asked`, `duplicate_asks`, `redundant_bytes` | `metrics.rs`, campaign script |
| 3.5 | Row invariant: **unique frames asked** = trace unique frames (± settle); fail run if not | campaign void-stop |

**Acceptance**

- [ ] All three arms ask the **same count of unique frames** on the L2 trace (80 study, 119 steps).
- [ ] `bytes_on_wire` differs only by policy-induced redundancy, reported explicitly — not hidden in
      one column.
- [ ] `asks_sent` no longer scales as ~`119 × D` for windowed arms.

---

## Phase 4 — dynamic estimator input

**Problem (B3):** ask→first-byte on shared ordered stream = path RTT + self-queue; D ratchets to 16;
loopback formula says D=1.

| # | Change | Where |
| --- | --- | --- |
| 4.1 | RTT input = **path RTT** (control-stream ping, QUIC stats, or min over window **only** when
      queue empty) — document choice | `depth.rs`, `client.rs` |
| 4.2 | Remove or gate `--rtt-estimate min` unless proven on shared mode | `depth.rs` |
| 4.3 | Stop condition: **D saturates clamp** for >X% of run (not only A/B oscillation) | `depth.rs`, lane stop rules |
| 4.4 | Oscillation detector watches **computed** D, not adopted | `maybe_adopt` |

**Acceptance**

- [ ] Unit test: loopback, shared mode, path RTT ≈ 0, formula D=1 → **adopted D stays ≤ 2** for full
      trace (regression in `depth.rs` tests).
- [ ] `l2_review_replicate.sh` dynamic: `d_max` ≤ formula answer + 1 on loopback.
- [ ] Campaign void-stop if `frac_at_D_max > 0.5` (configurable).

---

## Phase 5 — network axis is measured, not labelled

**Problem (B4):** netem egress-only, delay = N/2 not N; WAN base unrecorded; `formula_depth` uses label.

| # | Change | Where |
| --- | --- | --- |
| 5.1 | Run **`e0_netem_validation.sh`** (or equivalent) before shaped grid; record result in TSV | campaign script |
| 5.2 | Per cell: **achieved RTT ms**, **achieved Mbps**, **netem profile**, **harness location** | TSV columns |
| 5.3 | `formula_depth` uses **achieved RTT**, not nominal label | `l2_ask_policy_cloud.sh` |
| 5.4 | Document in campaign header: egress delay adds **N/2** RTT, asks unshaped | `cloud_netem.sh` comment + lane |

**Acceptance**

- [ ] E0 pass or explicit waiver row in measurements doc.
- [ ] No shaped row with empty `achieved_rtt_ms`.
- [ ] Fixed depth matches `formula_depth(achieved_rtt, …)` within rounding.

---

## Phase 6 — auditable, fair collection

**Problems (S1–S7):** bytes short by D frames; raw in `.local/`; arm order fixed; control ≠ brief.

| # | Change | Where |
| --- | --- | --- |
| 6.1 | Post-settle window: **drain** before `EndSession` or do not count those asks in `asks_sent` | `run_windowed` |
| 6.2 | Drain helpers: **fail or flag** on timeout, not silent `Ok(())` | `wait_frames_on_wire`, `wait_outstanding_below` |
| 6.3 | Commit per-run JSON or `wait_ms` / lateness vectors under `docs/measurements/r2/` | campaign script |
| 6.4 | **Interleave or randomize** arm order within each (rtt, loss) cell | `l2_ask_policy_cloud.sh` |
| 6.5 | Outlier policy stated **before** run (e.g. report all 3, median for summary) | lane doc |
| 6.6 | `outstanding`: count **in-flight asks**, not `HashSet` frame indices | `client.rs` |

**Acceptance**

- [ ] `asks_sent × 32004 − bytes_on_wire` = 0 for all rows (or flagged `drain_incomplete=1`).
- [ ] Raw vectors committed for every row in the new campaign.
- [ ] `cargo test -p window-harness` green.

---

## Smoke gate — run before full grid

Script: `lab/scripts/l2_harness_smoke.sh`

Runs on **loopback** (harness `LinkPacer` @ 10 Mbps) + optional one **shaped** cloud cell after E0.

| Gate | Pass |
| --- | --- |
| G1 | Three arms: same `unique_frames_asked` |
| G2 | Trace wall ≈ 1.90 s at 16 ms/step (not 6–30 s) |
| G3 | Dynamic loopback: `d_max` ≤ 2 (not 16) |
| G4 | Control step 26 ms: better p95 **lateness** than 16 ms; ask→display unchanged |
| G5 | No systematic bytes shortfall = D |
| G6 | `l2_review_replicate.sh` facts still match (asks/bytes order) |

Full grid (`l2_ask_policy_cloud.sh`) runs only when **G1–G6** pass.

---

## After harness fix

1. ~~Shaped campaign → `l2_ask_policy_v2.tsv`~~ **done** (PR #9).
2. Browser bridge — **deferred** (see EVIDENCE.md worth-it note).
3. Interpretation → [`l2_ask_policy_EVIDENCE.md`](../measurements/r2/l2_ask_policy_EVIDENCE.md).
4. **Next:** path-RTT probe fix → loss-axis expansion (plan in EVIDENCE.md).

---

## File touch list (implementation)

| Area | Files |
| --- | --- |
| Metrics / lateness | `lab/window-harness/src/metrics.rs` |
| Step loop, cache skip, drain | `lab/window-harness/src/client.rs` |
| Dynamic + stops | `lab/window-harness/src/depth.rs` |
| CLI / JSON | `lab/window-harness/src/main.rs` |
| Campaign | `lab/scripts/l2_ask_policy_cloud.sh`, `l2_harness_smoke.sh` |
| Lane | `docs/lanes/L2-ask-policy.md`, this file |

---

## Checklist (copy for PR)

```
Phase 1 reader metric     [x]
Phase 2 independent clock [x]
Phase 3 same workload     [x]
Phase 4 dynamic RTT       [x]  (path RTT CLI + clean samples; probe still contaminated — see EVIDENCE)
Phase 5 measured path     [~]  (column exists; probe = ask→display, not true RTT — fix before v3)
Phase 6 audit + drain     [x]
Smoke G1–G6               [x]
Shaped smoke (1 cell)     [x]
Full grid 54/54           [x]  → l2_ask_policy_v2.tsv
```
