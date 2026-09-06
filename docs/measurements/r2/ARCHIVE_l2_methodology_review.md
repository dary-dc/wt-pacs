# Archive — L2 ask-policy methodology review (PR #8)

**Status: archived pointer · the review itself remains citable from history.**

PR #8 established that the v1 ask-policy campaign **did not measure ask policy**. The full
write-up and loopback replicate script live in git history (SHAs below). This tip keeps a
short summary on `main` without the experimental lab tree.

## Four blockers (summary)

1. **Wrong primary metric** — `p95_wait_ms` timed ask→displayable after depth-gated asks,
   rewarding late asks.
2. **Unequal workloads** — arms re-asked / ignored cache; byte and ask counts differed by
   an order of magnitude.
3. **HOL-contaminated dynamic RTT** — ask→first-byte on a shared ordered stream includes
   self-queue; D ratcheted to clamp.
4. **Mislabelled RTT axis** — netem egress-only, delay N/2, WAN base unrecorded; formula
   used nominal labels.

## Recover the full review from history

| What | Commit |
| --- | --- |
| Full methodology review + STOP withdrawn marking | `9fcfe6f` (branch tip before compression) |
| Review body committed | `3a6d210` |
| Loopback replicate script | `3a6d210` → `lab/scripts/l2_review_replicate.sh` |

```bash
git show 3a6d210:docs/measurements/r2/l2_ask_policy_METHODOLOGY_REVIEW.md
```

## Where to read instead

Live corrected campaign + decision freeze: **PR #9** —
`docs/measurements/r2/l2_ask_policy_EVIDENCE.md` (also carries a copy of the methodology
review on that branch). Sibling archives: `ARCHIVE_l2_ask_policy_v1.md`,
`ARCHIVE_l2_clean_rtt.md`.
