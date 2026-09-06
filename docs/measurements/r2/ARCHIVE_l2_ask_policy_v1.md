# Archive — L2 ask-policy campaign v1 (PR #6)

**Status: archived · rankings not for ADRs or product policy.**

This branch held the first shaped ask-policy grid (control / fixed / dynamic) and the
harness work that produced it. Those rows were later shown **not to measure ask policy**
(see methodology review SHA below). Do not quote TSV rankings from this experiment.

## Recover the full tree from history

| What | Commit |
| --- | --- |
| Branch tip before compression (lane “campaign-complete”) | `5357323` |
| Full post-review grid TSV + `d_current/` | `af85b69` |
| Harness remediations before that grid | `ec8f384` |
| First L2 dynamic-depth + nearest-rank p95 | `de5bdb9` |

Examples:

```bash
git show af85b69:docs/measurements/r2/l2_ask_policy.tsv
git show af85b69:docs/measurements/r2/l2_ask_policy_STOP.txt
```

## Why withdrawn

Adversarial review: commit `3a6d210` (`l2_ask_policy_METHODOLOGY_REVIEW.md` in history /
later PR tips). Four blockers (wrong primary metric, unequal workloads, HOL-contaminated
dynamic RTT, mislabelled RTT axis).

## Where to read instead

Live L2 evidence work continues on **PR #9** (`cursor/l2-harness-fix-plan-c999`).
On that branch, see `docs/measurements/r2/l2_ask_policy_EVIDENCE.md` and
`l2_ask_policy_v2.tsv` — and treat any archived v1 conclusions as superseded.
