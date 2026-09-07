# Lane L2 — continuation plan (2026-09-07)

**Where the branch stands.** `main` is merged in. The harness measures depth and prefetch
separately, emulates a path RTT, and reports lateness by step; ten smoke gates pass on loopback.
A FIFO simulator reproduces the v2 rig rows within 1.2 %. The design document,
[`../l2-ask-policy-design-2026-09-06.md`](../l2-ask-policy-design-2026-09-06.md), answers the
lane's two questions on T2-local evidence: bounding depth matters only when a large lookahead
meets a jump, and dynamic depth has nothing left to adapt to. What remains is the loss axis, the
policy in a browser, and closing the lane. This plan sequences that work and names what each
phase must produce before the next one starts.

The earlier fix plan, [`L2-ask-policy-harness-fix.md`](L2-ask-policy-harness-fix.md), is done
(design doc §6 scores it item by item). Do not reopen it.

## 0 · Rules this plan inherits

- Every number cited comes from a run someone can repeat with a script in `lab/`. Rows go under
  `.local/` and git history; `docs/` holds conclusions and the tables that carry them.
- The v1–v3 rankings are void (`../measurements/r2/l2_ask_policy_STOP.txt`). Quote the v2 rows
  only through the model that explains them.
- Product client code changes are proposed as a diff and approved for readability before they
  land; the lab moves first. **This branch does not edit `client/transport-ts` or
  `client/transport-wasm` ask paths.** If a product-shaped loop is needed, copy or overlay it
  under `lab/` or `client/harness/` (Phase 3a).
- Loss-free bake-off on this box: `lab/scripts/l2_ask_policy_v4_local.sh` (seven arms, `--rtt-ms`,
  no netem). The cloud v4 script is for loss only.
- The rig is shared with L1 (`lab/scripts/rig_lock.sh`). One netem at a time.

## 1 · Decisions that gate the phases

| # | Decision | Unlocks | Default if unanswered |
| - | - | - | - |
| D1 | adopt the fixed forward window with an in-flight cap as the client's ask policy (design doc §5) | Phase 3, Phase 5 | proceed in the lab only (3a); product diff waits |
| D2 | run the v4 loss campaign, or close the lane on the model | Phase 1, Phase 2 | run the reduced v4 (one RTT) first; full grid only if it shows an effect |
| D3 | where the harness rework lands relative to L1's | Phase 4 | keep both until the first branch merges; the second ports flags |

## 2 · Phases

### Phase 0 — Reproduce before touching anything (half a day)

1. `cargo build -p window-harness -p exact-server --release`; `cargo test -p window-harness`;
   `cargo clippy -p window-harness --all-targets` — zero warnings is the bar.
2. Start the shared-mode server on `lab/fixtures/frames_32k` (command in `lab/README.md`), run
   `lab/scripts/l2_harness_smoke.sh` → 10/10 with the negative control failing as designed.
3. `python3 lab/scripts/l2_policy_sim.py --validate` → "model reproduces the v2 grid".
4. `lab/scripts/l2_local_crosscheck.sh` → the saturated cells agree within 1 %, the ordering of
   the seven policies is the same in both columns.

Exit: all four green on the tip you start from. Anything else is a regression to fix first.

### Phase 1 — The loss axis on the rig (one rig day, half a day of analysis) — gated by D2

The model has no loss term; this is the one question it cannot answer. The v2 loss cells
(n = 9 per arm, sd larger than the means) say nothing either way.

1. Prerequisites: the rig key (`docs/cloud-rig-access.md`), `rig_lock_acquire` as `L2-v4`, and
   `lab/scripts/l2_e0_v4_profile.sh` on the exact netem profile the campaign uses (rate, delay,
   loss, and the explicit `limit` the v4 script sets). A profile that does not validate does not
   run. (`e0_netem_validation.sh` is the older 250 KB live-cell check; it is not this grid.)
2. Reduced grid first: `RTTS=60 lab/scripts/l2_ask_policy_v4_cloud.sh` — two traces at 40 ms,
   seven arms, loss 0 and 0.5 %, n = 3 / 10, arms shuffled per run. About 180 runs, 15 minutes.
3. Write `lab/scripts/l2_v4_summarize.py`: group by (trace, RTT, loss, arm); median, IQR and p95
   of `p95_lateness_ms`, `lateness_median_ms`, `stranded_bytes`, `netem_drops` across runs; next
   to every loss-0 cell, the simulator's prediction at that run's `achieved_mbps`
   (`l2_policy_sim.py --cell`). Flag any loss-0 cell more than 5 % from the model: that is the rig
   telling you the model does not describe it, and it is reported, not smoothed.
4. Read the three questions off the summary, in this order:
   - at loss 0, does the rig reproduce the design doc's §3 ordering (bulk worst on the jump,
     bounded ≈ ADR window, control worst on the scroll)?
   - at loss 0.5 %, does any arm separate from the others beyond the IQR of its own runs?
   - does depth interact with loss (bounded vs bulk under loss, relative to their loss-0 gap)?
5. Full grid (RTT 20 / 60 / 150) only if question 2 or 3 is a yes at 60 ms.
6. Deliverable: `docs/measurements/r2/l2_ask_policy_v4_SUMMARY.md` — one table per question,
   the void rows counted, nothing raw. Append one dated line to `l2_ask_policy_STOP.txt` and
   point `l2_ask_policy_EVIDENCE.md` at the summary.

Stop rules: any run with `wait_samples = 0` or `run_rc ≠ 0` voids its cell until the cause is
found; `netem_drops` rising in a loss-0 cell means the queue limit, not the policy, is being
measured — raise `NETEM_LIMIT` and rerun the cell; a path-RTT probe more than 20 % off the named
RTT voids the cell's formula depth.

### Phase 2 — Loss in the model (two days) — only if Phase 1 shows an effect

Add one mechanism to `l2_policy_sim.py`, not a parameter sweep: a lost packet stalls the FIFO for
one RTT plus the retransmit timer, and every byte behind it waits. Validate on the v4 loss-0.5 %
rows the way `--validate` does on v2 (fit nothing on the arms being predicted). If it does not
reproduce them within the rows' own spread, say so and stop; a model that needs a knob per cell
explains nothing.

### Phase 3 — The policy in a browser (lab first, product second) — gated by D1

The harness is a Rust client. The WASM and TS clients bulk-ask (`requestExactFrames`), and the
client harness (`client/harness/shell.js`) already has `ondemand` (one ask per step, `d` in flight)
and `fill` (one bulk ask) cells — but not the recommended policy.

3a. **Lab.** Add a `window` cell to `client/harness/shell.js`: the on-screen frame asked at once,
    prefetch `K` frames in the direction of travel, at most `D` in flight; `K` and `D` from the
    query string. Derive lateness by step from the recorder's ask/first-byte/done marks against
    the schedule (`client/record/`), so the browser reports the same distribution the harness does.
    Run `fill` vs `window` vs `ondemand` on the scroll and jump traces at 40 ms. On loopback this
    proves the mechanics (ask order, stranded bytes, no regression); the numbers that matter need a
    shaped path — the rig, or a machine with netem — because the browser has no read pacer.
    Exit: on the shaped path, `window` matches the harness's ordering; on the jump, stranded bytes
    and p95 lateness are within 10 % of the harness's `adr` cell.

3b. **Product.** Propose the diff, do not land it: an ask policy in `client/transport-ts/session.ts`
    and `client/transport-wasm/src/session.rs` with two entry points — ask for the frame on screen,
    and offer a prefetch window given a direction — while `requestExactFrames` stays for preload.
    Port the harness's window-order tests. Keep the telemetry recorder untouched: it already stamps
    every ask. The diff goes to the user with the 3a numbers; readability is the acceptance test.

3c. **ADR.** Update `docs/adr-client-window-depth.md`: the two regimes; the cap bounds prefetch,
    never the on-screen ask; `K` is sized in reader time (`ceil((RTT + Tf) / step)`); dynamic depth
    rejected with the reason (no transport RTT in the browser, and nothing to adapt to); the bulk
    ask kept for preload only. One dated status line, a link to the design doc, no rewrite.

### Phase 4 — One harness, not two (one day) — gated by D3

`cursor/l1-loss-run-dbae` reworks the same crate for its own campaign. The differences to
reconcile, with the recommended resolution:

| L2 (this branch) | L1 | Resolution |
| - | - | - |
| `--depth` caps prefetch; on-screen frame exempt | `center_first` exempt too | same semantics, keep |
| a prefetch that does not fit is deferred to the next arrival | dropped, counted as `center_asks_dropped` | add `--prefetch-miss defer|drop` only if an L1 cell needs `drop`; default `defer` |
| `--window-shape forward|ring` | `WindowShape::Symmetric|Forward` (both wrap) | forward-clamped is the correct one; keep `ring` for reproducing v2 only |
| `--ipv4` | `--bind IP` | `--bind` is more general; accept both, document one |
| `p95_lateness_ms`, `lateness_*` | `late_p95_ms`, `late_max_ms`, `on_time_rate` | pick one vocabulary at merge; the summariser scripts are the only consumers |
| reader is always open-loop | `ReaderMode::Closed|Open` | keep L1's flag; L2 cells run `open` |
| `stranded_bytes` | `stranded_bytes` | same |

Whichever branch merges second does this port in one commit with the tests of both sides green.

### Phase 5 — Reader traces from a real viewer (when one exists)

The 16 ms and 40 ms synthetic traces bracket the regime boundary for this fixture; they are not
reader behaviour. When a viewer session can be recorded, capture (frame index, time) per scroll
event into the trace JSON format, and re-run `l2_local_crosscheck.sh` and the Phase 3a cells on
it. Until then, every number is conditional on the synthetic cadence, and the docs say so.

### Phase 6 — Close the lane (one hour)

Update the status line of `L2-ask-policy.md` to the design doc's answer plus the v4 summary if
it ran; the EVIDENCE file cites those two and nothing older; the campaign scripts for v1–v3 stay
as the record and are marked as predating the flags in their header comments.

## 3 · What not to do

- Do not re-run the 16 ms scroll grid. Every policy is equal there by structure; it measures the
  link, not the policy.
- Do not add a fourth RTT input to the estimator. The three are characterised; the conclusion does
  not depend on which one wins.
- Do not put raw rows, profiles, or `d_current` traces under `docs/` again; `.local/` and history.
- Do not land a product client change on this branch. Propose it (3b); the user approves it.

## 4 · Effort and order

| Phase | Effort | Needs | Produces |
| - | - | - | - |
| 0 | ½ day | a box with Chromium for the probe, otherwise nothing | green baseline |
| 1 | 1 rig day + ½ day | rig key, D2 | v4 summary, EVIDENCE pointer |
| 2 | 2 days | Phase 1 effect | loss term in the model, or a recorded failure to model |
| 3a | 1–2 days | D1 | `window` cell, browser lateness by step, shaped-path numbers |
| 3b | 1 day + review | 3a numbers | proposed client diff |
| 3c | 1 hour | 3a | ADR status update |
| 4 | 1 day | D3, one branch merged | one harness |
| 5 | when a viewer exists | — | real traces |
| 6 | 1 hour | 1 or D2 = close | lane closed |

Phase 0 first, always. Then 1 and 3a in parallel if two people; 3b after 3a; 4 whenever the first
of the two harness branches lands; 6 last.
