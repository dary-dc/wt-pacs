# MERGE-A-REVIEW-SERVER: claude/merge-a-server at 1597e37c (draft PR 399)

Reviewed 2026-11-15 by a session with no commit on the branch. Verdict: **no blocker**.

* (a) Resolutions. 11/11 second parents are MERGE-INVENTORY-2 §4 A2's frozen tips, in order. The five -s ours merges
  (M1) leave the tree equal to their first parent. Conflicted files match the plan's §3 A2 note (scroll-policies: the
  tip's code, new lab files kept, each added lever behind lab-levers) and each merge message's rule. Lines a side added
  that the result lacks (`lost.txt`, `lostlines.sh`) are rewrapped or unioned text: server/README.md's lever sentence,
  main.rs's two lever tests (now list all three levers), deploy/README.md's rootless-podman row (closed 2026-11-09,
  by M4's later-text rule).
* (b) The tree. `remerge.txt`: in every --no-ff merge no path differs from git merge-tree's mechanical merge outside
  its conflicted files (the three paths flagged belong to -s ours merges whose subject the script cut at 70
  characters). No conflict marker in any tracked file. No non-merge commit on the branch.
* (c) Gate, browser checks, baseline. Full scripts/gate.sh OK in 494 s, 38 steps, the baseline's one skip (the
  viewer's cross-codec arm and Firefox); the gate's suite lines equal the baseline's but dispatch over ts 789 -> 793;
  cargo test counts (counts.md) 19, 2, 2, 12, 148, 145, 68, equal to MERGE-A-SERVER's and none below the baseline
  (140/143 -> 145/148, lab-levers 5 -> 12 with the gate's wider filter); one default-build warning (tokio
  AsyncFd::with_interest), the baseline's; comment budget ok.
* (d) Absence checks: the gate's (no telemetry symbols, no lab controller, no lab lever in the default build) OK;
  scripts/check_lab_absent.sh not on this tip, as in the baseline.
* For COMPLEXITY-AUDIT (not blockers): the downloader's lab config scroll/refill in a product file, not behind a
  build feature; deploy-dry-run's behaviour change (no default series, no transport file), merged by the plan's §2.
* PR 399's body ended with a Generated-by line and a session link: removed.

Fixtures and limits: the repository's committed fixtures for the gate; no demo series (no demo-check.mjs step on the
server line); one 4-core cloud host, no GPU, headless Chromium (playwright 1.63.0, not the pinned 1.56.1), no
Firefox; the server image not built.
