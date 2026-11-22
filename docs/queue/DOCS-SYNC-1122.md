state: blocked
started: 2026-11-22T06:22Z
heartbeat: 2026-11-22T06:23Z
outputs: none; claude/unified unchanged at 4a2b4277; nothing merged, no PR commented on or closed
## Resume
Blocked by this session's own instructions (the brief's last line). To finish: a session allowed to merge runs
`git merge --no-ff origin/claude/engines` on origin/claude/unified (4a2b4277 if unmoved), then check_links, the
comment budget and `scripts/gate.sh --quick`, and pushes claude/unified.
## Result
* One docs-only branch is due: claude/engines (PR 410, base claude/unified; 46 files, all under docs/;
  ENGINE-REVIEW-FIX-REVIEW done 2026-11-21 with no blocker open). Not merged: PR 410's base is claude/unified, so
  pushing the merge merges PR 410, and this session's instructions say "Draft PRs only, through
  mcp__github__create_pull_request; never merge or close a PR".
* Held, docs only: report-plan (REPORT-RUN-2 still running, REPORT-VERDICT-2 not done); vl-criterion
  (VL-CRITERION-REVIEW not done); line-docs-3 (UNIFIED-DOCS-REVIEW not done); sync-reconcile, transport-design §6.6,
  next-ideas-cdydy8, repo-inventory (no review row); merge-order-2026-10-28/-29 ("not to merge"); work-ledger and
  reviews-* (excluded by the brief).
* No checks run: no new tip.
* Owner, last: whether DOCS-SYNC's merge of a PR's own branch into its base counts as merging that PR under the
  workers' "never merge or close a PR". If yes, DOCS-SYNC goes to a session without that line; if no, say so in the
  worker prompt.
