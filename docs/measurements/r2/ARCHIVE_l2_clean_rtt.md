# Archive — L2 clean-RTT follow-up (PR #7)

**Status: archived · rankings not for ADRs or product policy.**

Follow-up to the v1 ask-policy grid: tried a “clean” min-RTT probe for the dynamic
depth estimator, plus a browser-bridge assessment. The clean-RTT campaign still pinned
dynamic depth at D=16 and did **not** salvage the v1 measurement story.

## Recover the full tree from history

| What | Commit |
| --- | --- |
| Branch tip before compression (landed TSV) | `1d8951d` |
| Clean-RTT STOP note (min probe still D=16) | `fd99399` |
| Clean-RTT campaign + min probe harness + browser blocked | `fcdbdcf` |

Examples:

```bash
git show 1d8951d:docs/measurements/r2/l2_clean_rtt.tsv
git show fcdbdcf:docs/measurements/r2/l2_browser_bridge_BLOCKED.txt
```

## Where to read instead

See also `ARCHIVE_l2_ask_policy_v1.md` (parent campaign). Live L2 evidence continues on
**PR #9** — `l2_ask_policy_EVIDENCE.md` / `l2_ask_policy_v2.tsv`.
