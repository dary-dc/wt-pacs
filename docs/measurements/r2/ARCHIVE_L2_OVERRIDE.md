# OVERRIDE — archived L2 results on `main` are not reliable

**Date:** 2026-09-04 · **Branch:** `cursor/l2-harness-fix-plan-c999` (PR #9)

`main` now contains three archive pointers merged from PRs #6, #7, and #8:

| On `main` | From |
| --- | --- |
| [`ARCHIVE_l2_ask_policy_v1.md`](ARCHIVE_l2_ask_policy_v1.md) | PR #6 |
| [`ARCHIVE_l2_clean_rtt.md`](ARCHIVE_l2_clean_rtt.md) | PR #7 |
| [`ARCHIVE_l2_methodology_review.md`](ARCHIVE_l2_methodology_review.md) | PR #8 |

Those files are **history markers only**. They exist so the old campaigns are not forgotten
and so their commits stay easy to find. They are **not** an endorsement of the rankings,
TSVs, or product conclusions those campaigns produced.

## Do not use for ADRs or decisions

- v1 ask-policy grid rankings — **unreliable** (wrong metric, unequal workloads, HOL RTT, mislabelled axis).
- clean-RTT follow-up rankings — **unreliable** (did not fix the measurement; still D=16).
- Methodology review archive — the **diagnosis** is still valid; use it as “why v1 is void,”
  not as a substitute for corrected results.

## What to cite on this branch instead

| Artifact | Role |
| --- | --- |
| [`l2_ask_policy_V2_ADVERSARIAL_REVIEW.md`](l2_ask_policy_V2_ADVERSARIAL_REVIEW.md) | **Read first** — why the v2 ranking is void and what to fix before the next campaign |
| [`l2_ask_policy_EVIDENCE.md`](l2_ask_policy_EVIDENCE.md) | Campaign record, annotated with the review's withdrawals — **not** an ADR substrate |
| [`l2_ask_policy_v2.tsv`](l2_ask_policy_v2.tsv) | Corrected 54-cell grid — rows are sound, the arm ranking is not |
| Full methodology review (this branch) | [`l2_ask_policy_METHODOLOGY_REVIEW.md`](l2_ask_policy_METHODOLOGY_REVIEW.md) |

**As of 2026-09-04 there is no L2 result that may be cited in an ADR.** v1 is void for the reasons
in the methodology review; v2's workload fixes hold but its ranking measures ask *order*, not ask
*depth*.

PR #9 is **not** merged to `main` yet; work continues here. When ADRs are updated, pull
claims only from the evidence freeze on this branch (after remaining caveats in that file
are closed), never from the archive pointers alone.
