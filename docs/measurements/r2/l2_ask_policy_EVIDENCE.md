# L2 ask-policy — evidence freeze (harness v2)

> **STATUS 2026-09-04 — NOT AN ADR SUBSTRATE. The v2 arm ranking is withdrawn.**
> [`l2_ask_policy_V2_ADVERSARIAL_REVIEW.md`](l2_ask_policy_V2_ADVERSARIAL_REVIEW.md) shows the
> loss=0 ranking is reproduced to within 0.66 % by a FIFO model with **no depth term**, fitted on
> the control arm alone — it is an artefact of `window_frames()` walking a ring across the study
> boundary, and it vanishes entirely with a forward-only prefetch window
> (`python3 lab/scripts/l2_v2_order_model.py`). Read that review before quoting anything below.
> The corrections it forces are marked **[WITHDRAWN]** / **[REVISED]** inline.

**Status: superseded as decision input · frozen 2026-09-02, reviewed 2026-09-04** · Branch tip:
`cursor/l2-harness-fix-plan-c999` (PR #9)

This was the only document to be quoted when updating
[`adr-client-window-depth.md`](../../adr-client-window-depth.md) or D26-style product
policy from the L2 ask-policy campaign. Older TSVs and older PR tips are **withdrawn**; as of the
adversarial review, so are this campaign's arm rankings. **No v2 cell may be cited in an ADR.**

## What to keep vs history

| Keep on tip (cite this) | History-only (reachable via git, not ADR inputs) |
| --- | --- |
| This file | Withdrawn `l2_ask_policy.tsv`, provisional TSVs, `d_current` dumps |
| `l2_ask_policy_v2.tsv` (54 rows) | Raw JSON under `l2_ask_policy_v2/raw/` |
| `l2_ask_policy_METHODOLOGY_REVIEW.md` (why v1 was void) | Pre-v2 harness behaviour on other PR branches |
| **`l2_ask_policy_V2_ADVERSARIAL_REVIEW.md` (why v2's ranking is void)** | — |
| **`lab/scripts/l2_v2_order_model.py` (reproduces the §A1 finding)** | — |
| [`ARCHIVE_L2_OVERRIDE.md`](ARCHIVE_L2_OVERRIDE.md) | — |

**Archives on `main` (PRs #6 / #7 / #8 merged):** see
[`ARCHIVE_L2_OVERRIDE.md`](ARCHIVE_L2_OVERRIDE.md). Those pointers are history markers;
**this branch overrides them** — do not treat archive merge as validation of old rankings.

**Other open L2 PRs:** #6 / #7 / #8 are merged as archive-only tips. Live work stays on PR #9.

## Campaign that counts

| | |
| --- | --- |
| Harness | window-harness **v2** (lateness metric, cache skip, independent reader clock) |
| Grid | 3 arms × 3 RTT labels × 2 loss × 3 repeats = **54/54** |
| TSV | [`l2_ask_policy_v2.tsv`](l2_ask_policy_v2.tsv) |
| Integrity | every arm: `unique_frames_asked=80`, `wait_samples=119`, `asks_sent=80`, `bytes_on_wire=2560320` — **this part of the remediation is real and holds**. Note the committed `lateness_ms`/`wait_ms` vectors are in *completion* order, not step order (review §B5). |
| Primary metric | **`p95_lateness_ms`** (displayable − reader schedule) |
| Smoke | `lab/scripts/l2_harness_smoke.sh` passed on loopback before the grid — **but G2/G3/G5 cannot fail, G6 is not implemented, and it ran at `DEPTH=2`, the one depth where the §A1 ring wrap does not exist. Review §C.** |

Withdrawn (do not quote for decisions): `l2_ask_policy.tsv`,
`l2_ask_policy_PROVISIONAL_pre_review.tsv`, any clean-RTT follow-up ranking from PR #7.

## Headline results (median `p95_lateness_ms`)

### Loss = 0%

| RTT label | control | fixed | dynamic | rank (best → worst) |
| --- | ---: | ---: | ---: | --- |
| 20 | 1521 | 1617 | 1614 | control ≪ dynamic ≈ fixed |
| 60 | 1641 | 1745 | 1745 | control ≪ fixed ≈ dynamic |
| 150 | 1909 | 2011 | 2013 | control ≪ fixed ≈ dynamic |

Zero-loss cells are **tight** (CV ≈ 0). Fixed and dynamic are within a few ms — they are
not different arms on this grid (see caveats).

**[WITHDRAWN]** The `control ≪ fixed ≈ dynamic` ordering above is an ask-order artefact, not a
depth result. A two-parameter FIFO model fitted on control alone predicts every windowed cell
here within 0.66 % with no notion of depth; with the ring wrap removed the gap is 0.0 ms. See
adversarial review §A1. The numbers transcribe the TSV correctly — the *interpretation* is void.

### Loss = 0.5%

| RTT label | control | fixed | dynamic | note |
| --- | ---: | ---: | ---: | --- |
| 20 | 2024 | 1853 | 2969 | **huge run variance** (outliers to 8–13 s) |
| 60 | 3738 | 1831 | 1748 | control worst; fixed ≈ dynamic |
| 150 | 2279 | 2019 | 2216 | fixed best of three medians |

**0.5% alone is not enough to lock a loss story.** Several cells have CV > 0.5 with n=3;
medians are unstable. See loss-expansion plan below.

**[REVISED]** The loss cells are **bimodal**, not merely noisy: a run either lands at 1.7–2.4 s
(indistinguishable from loss=0) or blows up to 8–14 s. A median of n=3 over a bimodal
distribution reports "did ≥2 of 3 runs escape a bad event", not a central tendency — so the
ranking above is a coin flip, not a weak signal. Also: the "outliers" are not anonymous.
`dynamic_rtt20_loss0.5_run3` (9674 ms) tripped `depth_oscillating`, a **declared lane stop
condition**, and the TSV has no column for it. See review §B3/§B4/§D4.

## Decision implications (safe claims)

1. **Under corrected methodology, “dynamic always wins” is false.** That ranking was a
   harness artefact (see methodology review).
2. ~~**On this path and fixture, unbounded control is competitive or best at 0% loss** on
   `p95_lateness_ms`. Bounding depth does not automatically win the reader-lateness contest.~~
   **[WITHDRAWN — review §A1/§A2.]** Control's advantage is the harness's ring-wrap prefetch
   penalising the windowed arms, and the arms differ in *two* variables at once (outstanding cap
   **and** prefetch shape). There is no `unbounded+window` or `bounded+no-prefetch` arm, so no
   cell in this grid attributes anything to depth.
3. **Adaptivity did not earn complexity on this grid** — the D26 question remains **open**.
   **[REVISED — review §A3/§B4.]** The stated reason ("both ran at D=16") understates it. The
   campaign passes `--path-rtt-ms`, which **overrides** the lane-specified 8-frame RTT median
   outright (`depth.rs:140`) with the same constant `formula_depth` gives fixed — so the dynamic
   arm could only ever differ from fixed through the throughput term, and the specified estimator
   was never run. Separately, D left 16 in exactly 3 of 18 dynamic runs, and those 3 are the
   3 worst dynamic runs in the campaign (12599 / 9674 / 2969 ms vs 1612–2246 ms for the 15 that
   held at 16). Causation is ambiguous and the campaign cannot resolve it.
4. **Do not amend ADRs from loss=0.5% medians yet** — expand the loss axis and/or repeats first.
   **[WIDENED]** Do not amend ADRs from **any** v2 cell, at any loss level.

## Caveats that block ADR lock-in (analyzed)

### A — Path RTT probe (fixed on this branch; WAN clamp still expected)

**Fixed (commit `adc938f`):** harness now records `ask_first_byte_ms` /
`median_ask_first_byte_ms`. Campaign `measure_path_rtt` uses the median of **3**
one-frame **ask→first-byte** probes (not ask→displayable). Smoke still passes.

**[CLARIFIED — review §B1.]** That fix landed *after* the grid and has never run against the rig.
Neither field exists in any of the 54 committed raw JSONs. The `path_rtt_ms` column in
`l2_ask_policy_v2.tsv` is a **single** ask→**displayable** sample from the pre-fix probe
(`b0c00ee`), reused for all 9 rows of its cell.

**v2 contamination (historical):** probes of ~469–663 ms were ask→displayable and
included `Tf ≈ 25.6 ms`. That alone is not why D hit 16 on Oracle SP.

**WAN reality:** true path RTT agent→Oracle is still **hundreds of ms**. For
32 KB @ 10 Mbps, formula D reaches the clamp at RTT ≳ 400 ms. So on this rig,
**D=16 for fixed/dynamic at 0% loss is the correct BDP answer**, not only a probe
bug. Interior-D proof for the estimator remains the **loopback smoke**
(`d_max ≤ 2` with `--path-rtt-ms 0`).

**[WITHDRAWN — review §B2/§C.]** Both halves of that are unsupported. (a) The clamp threshold is
RTT ≈ 405 ms; the only number available is one contaminated sample (~443 ms after subtracting the
known `Tf`), so "correct BDP answer" rests on a single measurement sitting ~38 ms above the line
that decides whether the comparison was possible at all. (b) The loopback smoke is not a proof:
with `--path-rtt-ms 0`, `compute_d()` evaluates `ceil(0.95×(1+0)) = 1`, clamped to `D_MIN`. G3 and
the unit test `path_rtt_zero_keeps_d_shallow` assert that 0.95 rounds to 1. They cannot fail.

**Still required for v3 cloud grid:** SSH key `id_ed25519_rig_agent` in this
environment (missing after rebuild) — campaign scripts cannot reach the rig until
restored.


### B — RTT axis labels are nominal netem profiles, not achieved RTT

`cloud_netem.sh` adds **one-way** delay `N/2` on **server egress** only; client→server asks
are unshaped. WAN base dominates (~450+ ms). Cells should be cited as
`netem_profile=N` + measured path RTT (once probe is fixed), never as “RTT = 20 ms.”

### C — Browser bridge (worth-it?)

**Defer.** Harness-only was the lane design (“finding transfers”). Shared-mode browser
telemetry is still blocked; building it now delays the higher-value work (path-RTT fix +
loss axis). Revisit only if an ADR requires “shipping client confirms harness rank” —
not required to answer “does adaptivity beat fixed under a correct metric?”

## Loss-axis expansion plan (next experiment)

**Why:** 0 and 0.5% undersamples the space where depth policy matters (retransmit delay,
HOL interaction on shared stream). Loss cells already show unstable medians at n=3.

### Goals

1. Map how **control vs fixed vs dynamic** rank as loss increases.
2. Keep integrity gates (same unique frames, lateness metric, fair workload).
3. Run only **after** path-RTT probe fix so D is not forced to 16.

### Proposed grid (additive to v2, new TSV name)

| Axis | Values | Rationale |
| --- | --- | --- |
| Loss % | **0, 0.1, 0.5, 1.0, 2.0** | span light → harsh QUIC loss; 0.1 catches “barely lossy” |
| RTT profile | **60, 150** only for first pass | mid/high delay; drop 20 until path RTT fixed (or keep 20 if probe fixed) |
| Arms | control, fixed, dynamic | unchanged |
| Repeats | **5** under loss>0; **3** at loss=0 | cut median noise |
| Fixture / link | frames_32k @ 10 Mbps netem | unchanged |

Cell count (first pass, 2 RTT × 5 loss × 3 arms × ~4 avg repeats) ≈ **120 runs** — similar
wall time to one prior 54-cell day if path RTT is fixed and saturation no longer aborts.

Optional second pass: add RTT 20 and/or 5% loss only if rank flips between 1% and 2%.

### Acceptance before quoting loss results

- [x] Path RTT probe no longer includes full-frame `Tf` (ask→first-byte; smoke OK).
- [~] Interior `d_max` on **loopback** with path_rtt=0 — yes (smoke G3). On Oracle WAN,
      formula D=16 at measured path RTT is expected; not a void condition for v3.
- [ ] Per loss>0 cell: report median **and** IQR / max; void-stop if `wait_samples` empty.
- [ ] No ADR text cites a single outlier run as the cell winner.
- [ ] **v3 cloud campaign executed** (`l2_ask_policy_v3_loss.tsv`) — blocked until rig SSH key restored.


### Output

- `docs/measurements/r2/l2_ask_policy_v3_loss.tsv` (new; do not overwrite v2)
- Short addendum section in **this** file (not a new ADR input doc)

## Phase readiness

| Gate | Ready? |
| --- | --- |
| Harness methodology corrected + smoke | **no** — equal-workload (Phase 3) and drain (Phase 6) hold; Phase 2 is untested (G2 measures bytes/rate, not wall clock) and the ask order is wrong (§A1) |
| Shaped fair-workload grid at 0 / 0.5% | **workload yes, comparison no** — identical bytes on every row, but the arms differ in depth *and* prefetch shape (§A2) |
| Dynamic-vs-fixed as a real comparison | **no** — the estimator's RTT input is overridden by a constant equal to fixed's (§A3) |
| Loss story for ADR | **blocked** — needs rig SSH, and v3 inherits §A1/§A2/§A4 unchanged |
| Browser confirmation | **deferred** (not required for this phase) |
| Final adversarial review for ADR lock-in | **done, 2026-09-04** — [`l2_ask_policy_V2_ADVERSARIAL_REVIEW.md`](l2_ask_policy_V2_ADVERSARIAL_REVIEW.md); run its 9-item fix list before the next campaign |

## Commit / PR references (history)

Cite these when compressing older PRs (tip → one doc + SHA pointers):

| Artifact | Where |
| --- | --- |
| This freeze pack | `docs/measurements/r2/l2_ask_policy_EVIDENCE.md` on PR #9 |
| v2 TSV | commit `78638fc` · `l2_ask_policy_v2.tsv` |
| Methodology review (void v1) | PR #8 · `l2_ask_policy_METHODOLOGY_REVIEW.md` |
| Harness v2 implementation | commits `d0a08fe`…`d79fe5b` on PR #9 |
| Withdrawn full grid | PR #6 (do not use rankings) |
| Clean-RTT attempt | PR #7 (not salvageable for D ranking) |

**Compress recipe for PR #6 / #7 / #8 tips:** replace experimental trees with a short
note: “Superseded by PR #9 evidence freeze; see `l2_ask_policy_EVIDENCE.md`. Prior
commits remain in branch history: &lt;list SHAs&gt;.” Do not copy their conclusion
tables into ADRs.
