# L1 v3 — complete plan (behavior-first)

**Status:** active plan · **Date:** 2026-09-05 · **Branch:** `cursor/l1-loss-run-dbae`  
**Supersedes (as the decision philosophy):** the 15%-centric reading of
[`L1-v3-small-collect-plan.md`](L1-v3-small-collect-plan.md); that file remains as the prior
smoke sketch and is rewritten by **Phase C** below.  
**Incorporates:** second review N1–N12 ([`L1-v3-second-review.md`](L1-v3-second-review.md)),
path/isolation results, and the product discussion of 2026-09-05.

**Product question (unchanged):** under loss, should FoD send frames on **one shared QUIC
stream (S)** or **one stream per frame**, optionally with ask-order priority (**P** / **Q**)?

**How we answer it (changed):** trust **mechanism-shaped behavior** (null sanity + dose-like
response + regime clarity) before any fixed “Q beats S by 15 %” ship bar. The 15 % figure is a
**possible later product threshold**, not a literature-derived effect size and not the primary
gate for early phases.

---

## 0 · Principles (non-negotiable)

1. **Behavior over a magic percent.** Prefer: arms close at 0 % loss; effect that **responds to
   loss dose** (not necessarily linear); concurrency/depth behavior consistent with HOL if that is
   the claimed mechanism. Do **not** green-light because a point estimate cleared 15 %.
2. **Short ≠ skip.** Early phases may use fewer repeats and one RTT for **fast feedback**. They may
   **not** drop null sanity, regime identity, honest tails, interleaving, or prechecks. Final ship
   decisions require powered runs + full gates.
3. **Name the regime.** Production is not one network. Isolate regimes when proving mechanism;
   run a mixed regime only when that is the explicit question. Never average unlabeled regimes.
4. **Pick the reader explicitly.** Cadence comes from a stated reader model, not from “tune until
   misses appear” (that is v2 protocol drift).
5. **Fixture is part of the experiment.** Trace length and frame size set what tails and which
   bottlenecks you can see. Invest in them deliberately.
6. **Label the strength of evidence.** Small collects are `DIRECTIONAL — NOT A DECISION`. Only a
   pre-registered powered analysis may claim a product outcome.
7. **Lab/docs only until S-vs-Q is decided.** No product stream-mode change is authorized by this
   plan alone (`stream-mode-remediation` §R0b).

---

## 1 · What we already have (do not redo)

| Artifact | Role |
| --- | --- |
| v2 TSV voided + dual adversarial reviews | Prior campaign is not evidence |
| Harness S1/S2/C4, `--ask-priority` (Q) on this tree | Arms are runnable and attributable (S / P / Q) |
| Path validation PASSED | Shaped veth RTT/D gates OK |
| Isolation A/B | D=1 excess ≈ post-enqueue QUIC/path; not FoD ask/disk |
| Recv-window ADR | Keep quinn defaults; do not equalize for fairness theater |
| A1 pilots + `l1_v3_cadence.json` | First cadence draft — **not final** until Phase B |
| `l1_one_way_160.json` + `frames_32k_160` | Exist; **not yet wired** into collect runners |
| `PHASE=collect` refuses | Correct; stays refused until Phase C sign-off |

---

## 2 · Decision philosophy (gates that matter)

### 2.1 Primary evidence (early + final)

| Signal | Pass looks like | Fail looks like |
| --- | --- | --- |
| **Null sanity** | At 0 % loss, S vs Q (and S vs P) show **no meaningful unrelated gap** | Large arm gap with no loss → stop; fix measurement |
| **Dose-like response** | Gain (or wait reduction) of Q vs S **does not collapse** as loss increases across the planned cells; shape is interpretable | Random / inverted dose with no regime explanation |
| **Attribution** | P vs Q separates “per-frame” from “priority” where it matters | Q wins but P identical → priority not the lever (still useful) |
| **Regime integrity** | Every row stamps regime; BACKLOG / slow-mode called out | Unlabeled mixture; cadence only fits fast mode |

### 2.2 The 15 % bar

- **Not** required to interpret early directional runs.
- **Not** documented as a physics/literature constant in this lane.
- **May** be reintroduced later as an explicit **product ship bar** (“is the win large enough to
  pay the complexity?”) **after** behavior checks pass — or replaced by another product bar.
- Null gate must **not** be looser than whatever claim we eventually make. For directional phases,
  null means: “no large unexplained arm gap at 0 %,” reported with CIs — not “within 25 % of a
  15 % story.”

### 2.3 Secondary / later

- Depth sweep (A4): gain should grow with D if HOL concurrency is the story.
- Bursty loss (A6): scopes whether i.i.d. wins transfer.
- RTT-axis claims: blocked on understanding arm-independence of the post-enqueue RTT excess (N8).

---

## 3 · Phased work plan

### Phase A — Methodology locks (implementer · blocks any collect)

**Goal:** runners and docs cannot silently recreate v2’s soft gates.

| ID | Work | Done when |
| --- | --- | --- |
| **A1** | Parameterize `TRACE` / fixture (`80` vs `160`); default collect path to **160-frame** + `frames_32k_160` | No hardcoded `FIX_FC=80` on collect/pilot entrypoints that claim decision-quality tails |
| **A2** | Miss budget = **≥ 5 samples at/above empirical p95** (tail count), not `cache_misses ≥ 15` | Gate rejects/mark cell if tail count unmet; do not publish max-as-p95 |
| **A3** | Interleave arms run-by-run; randomize start order; timestamp every row | Consecutive rows in a cell alternate arms; S6 check exists |
| **A4** | Call demand÷supply precheck per cell; assert observed frame bytes ≈ fixture mean | Either can STOP a cell |
| **A5** | Small-collect TSV header: `DIRECTIONAL — NOT A DECISION` | Present before first data row |
| **A6** | Protocol/config hash in row identity (prepare for resume safety) | Resume cannot keep rows from an older recipe (can land before powered run; recommended before small collect) |

**Maps to second review:** N2, N5, N6, N7, (N9 early).

---

### Phase B — Regime + reader model (design/analysis + light implementer · blocks freezing cadence)

**Goal:** know what we are testing; stop hiding the slow loss mode.

| ID | Work | Done when |
| --- | --- | --- |
| **B1** | Diagnose bimodal pilots from `raw/l1v3/pilot/*.json` (waits, asks, step_loop, miss tails: fast vs slow) | Written note: cause hypothesis + how to detect regime per row |
| **B2** | Define **named regimes** for this lane, e.g. `clean`, `loss_stable`, `loss_slow`, optional `mixed` | Lane doc table: netem + reader + pass/fail meaning per regime |
| **B3** | Explicit **reader model** (pick one and freeze): e.g. (i) clinical scrub ≤ delivery, or (ii) stress reader slightly above delivery. Derive factor from that — **not** from miss yield | Factor + one-sentence justification in lane doc; A1 prose/formula match |
| **B4** | Re-pilot under the chosen model (enough repeats to see both modes if loss-triggered); cadence safe in both **or** regime stamped per row | New `l1_v3_cadence.json` (or regime-specific cadences) + note replacing median-of-3-only freeze |

**Maps to:** N3, N4, discussion points 3–4.

---

### Phase C — Rewrite small collect (directional feedback only)

**Goal:** ~1–2 h of **honest** feedback: does researched behavior start to show?

| Cell | RTT | loss | D | arms | repeats/arm | role |
| --- | ---: | ---: | ---: | --- | ---: | --- |
| null | 60 | 0 % | 4 | S,P,Q | 10 | null sanity |
| dose-low | 60 | 0.5 % | 4 | S,P,Q | 10 | directional + attribution |
| dose-high | 60 | 2 % | 4 | S,Q | 10 | dose-like response smoke |
| (optional) regime probe | 60 | 0.5 % | 4 | S,Q | 10 | if B1 says slow mode needs a dedicated cell |

- Trace: **160 frames**; cadence from Phase B; interleave; prechecks on; header directional.
- **Readouts (not ship):** null gap + CI; gain vs loss **shape**; P vs Q split; backlog/regime rates.
- **Hard stops:** asks bound; backlog policy; tail-count gate; null “large unexplained gap” stop;
  cadence/regime stamps present.
- **Explicitly not claimed:** Q ships; 15 % win; RTT-150 product behavior.

**Maps to:** revised small-collect plan; N1 reframed around null sanity + future claim, not 15 % idolatry.

---

### Phase D — Fixture investment (parallel track after C or overlapping B)

| ID | Work | Why |
| --- | --- | --- |
| **D1** | Standardize on 160-frame (or longer) for any claim involving miss p95 | Real tails |
| **D2** | Design a **large-frame** cell (multi‑MB class — use/extend `frames_250k` / new fixture); separate TSV label | Surfaces cwnd / multi-flight / serve path; do not mix with 32k directional smoke |
| **D3** | Only after D2’s own path smoke: optional directional S/Q on large frames | Production-like payloads |

---

### Phase E — Powered decision collect (only after C looks clean)

| ID | Work |
| --- | --- |
| **E1** | Pre-register analysis: dose-response clauses + null CI rule + optional product bar (15 % or replacement) |
| **E2** | Powered repeats (order-of-magnitude: ~40/arm RTT60 decision cells; RTT150 only if N8 addressed) |
| **E3** | A4 depth sweep; A6 bursty cell — scope the claim |
| **E4** | Frozen analyzer only; no mid-campaign cadence edits (S11) |

**Maps to:** N8, N10, N11, work-order S9–S12 spirit.

---

### Phase F — Product landing (after E)

Per remediation governance: S-vs-Q outcome decides whether per-frame (+priority) lands in product.
This plan does **not** authorize that merge by itself.

---

## 4 · Short phase vs skip (cheatsheet)

| Allowed in early phases | Not allowed |
| --- | --- |
| Fewer repeats, RTT-60 only | Soft null while talking about a loss effect |
| Directional header | p95 from tiny tails |
| Looking for dose-like **shape** | Arm-blocked campaigns |
| One regime at a time | Unlabeled fast/slow mixture |
| Deferring the 15 % **ship** bar | Tuning reader until the metric “looks good” |

---

## 5 · Execution order (checklist)

```
[ ] Phase A — A1…A6 methodology locks in runners/docs
[ ] Phase B — B1…B4 regime diagnosis + reader model + cadence re-freeze
[ ] Review sign-off on A+B (adversarial OK to re-run here)
[ ] Phase C — small directional collect (160-frame); interpret shape only
[ ] Phase D — large-frame track (as capacity allows)
[ ] Phase E — powered collect + A4/A6 only if C is clean
[ ] Phase F — product decision from E, not from C
```

`PHASE=collect` remains refused until Phase A+B signed and Phase C plan text matches this doc.

---

## 6 · Open choices to confirm in review (design)

1. **Reader model:** stress (slightly faster than delivery) vs clinical (at/under delivery)?  
2. **Null numeric rule for Phase C:** e.g. stop if null CI for relative gap excludes 0 and lower bound > X — pick X from “unrelated gap” tolerance, **not** from 15 % lore.  
3. **Large-frame size target** for Phase D (order: tens of MB vs hundreds of MB).  
4. Whether Phase C’s dose-high cell is required before any RTT-150 work (recommended: yes).

---

## 7 · References

- [`L1-v3-second-review.md`](L1-v3-second-review.md) — N1–N12  
- [`L1-v3-small-collect-plan.md`](L1-v3-small-collect-plan.md) — prior smoke sketch (to be aligned to Phase C)  
- [`L1-v3-action-plan.md`](L1-v3-action-plan.md) — C2 dose-response; A1–A7 background  
- [`L1-v3-work-order.md`](L1-v3-work-order.md) — step gates S0–S12  
- `docs/measurements/r2/raw/l1v3/ISOLATION_RTT_EXCESS.md` — post-enqueue excess  
- `docs/adr-quic-stream-receive-window-defaults.md` — window defaults  
- `docs/measurements/r2/l1_v3_cadence.json` — draft cadence (pending Phase B)
