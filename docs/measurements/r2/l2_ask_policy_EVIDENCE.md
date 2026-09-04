# L2 ask-policy — evidence freeze (harness v2)

**Status: evidence base for ADRs · 2026-09-02** · Branch tip:
`cursor/l2-harness-fix-plan-c999` (PR #9)

This is the **only** document that should be quoted when updating
[`adr-client-window-depth.md`](../../adr-client-window-depth.md) or D26-style product
policy from the L2 ask-policy campaign. Older TSVs and older PR tips are **withdrawn**.

## What to keep vs history

| Keep on tip (cite this) | History-only (reachable via git, not ADR inputs) |
| --- | --- |
| This file | Withdrawn `l2_ask_policy.tsv`, provisional TSVs, `d_current` dumps |
| `l2_ask_policy_v2.tsv` (54 rows) | Raw JSON under `l2_ask_policy_v2/raw/` |
| `l2_ask_policy_METHODOLOGY_REVIEW.md` (why v1 was void) | Pre-v2 harness behaviour on other PR branches |
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
| Integrity | every arm: `unique_frames_asked=80`, `wait_samples=119`, `asks_sent=80` |
| Primary metric | **`p95_lateness_ms`** (displayable − reader schedule) |
| Smoke | `lab/scripts/l2_harness_smoke.sh` passed on loopback before the grid |

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

### Loss = 0.5%

| RTT label | control | fixed | dynamic | note |
| --- | ---: | ---: | ---: | --- |
| 20 | 2024 | 1853 | 2969 | **huge run variance** (outliers to 8–13 s) |
| 60 | 3738 | 1831 | 1748 | control worst; fixed ≈ dynamic |
| 150 | 2279 | 2019 | 2216 | fixed best of three medians |

**0.5% alone is not enough to lock a loss story.** Several cells have CV > 0.5 with n=3;
medians are unstable. See loss-expansion plan below.

## Decision implications (safe claims)

1. **Under corrected methodology, “dynamic always wins” is false.** That ranking was a
   harness artefact (see methodology review).
2. **On this path and fixture, unbounded control is competitive or best at 0% loss** on
   `p95_lateness_ms`. Bounding depth does not automatically win the reader-lateness contest.
3. **Adaptivity did not earn complexity on this grid** — not because the estimator was
   proven useless, but because **fixed and dynamic both ran at D=16** for essentially the
   whole trace (see caveats). The D26 question remains **open** until an interior-D cell exists.
4. **Do not amend ADRs from loss=0.5% medians yet** — expand the loss axis and/or repeats first.

## Caveats that block ADR lock-in (analyzed)

### A — Path RTT probe (fixed on this branch; WAN clamp still expected)

**Fixed (commit `adc938f`):** harness now records `ask_first_byte_ms` /
`median_ask_first_byte_ms`. Campaign `measure_path_rtt` uses the median of **3**
one-frame **ask→first-byte** probes (not ask→displayable). Smoke still passes.

**v2 contamination (historical):** probes of ~469–663 ms were ask→displayable and
included `Tf ≈ 25.6 ms`. That alone is not why D hit 16 on Oracle SP.

**WAN reality:** true path RTT agent→Oracle is still **hundreds of ms**. For
32 KB @ 10 Mbps, formula D reaches the clamp at RTT ≳ 400 ms. So on this rig,
**D=16 for fixed/dynamic at 0% loss is the correct BDP answer**, not only a probe
bug. Interior-D proof for the estimator remains the **loopback smoke**
(`d_max ≤ 2` with `--path-rtt-ms 0`).

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
| Harness methodology corrected + smoke | **yes** |
| Shaped fair-workload grid at 0 / 0.5% | **yes** (with caveats A–B) |
| Dynamic-vs-fixed as a real comparison | **partial** — probe fixed; on WAN both sit at BDP clamp at 0% loss; loss axis is where dynamic can shrink |
| Loss story for ADR | **blocked** — v3 script ready; needs rig SSH + campaign run |
| Browser confirmation | **deferred** (not required for this phase) |
| Final adversarial review for ADR lock-in | **after** v3 loss TSV lands |

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
