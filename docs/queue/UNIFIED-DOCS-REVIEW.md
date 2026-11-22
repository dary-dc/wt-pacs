state: done (one blocker open; amendment 17 rows UNIFIED-DOCS-REVIEW-FIX and -FIX-REVIEW appended)
started: 2026-11-22T11:17Z
heartbeat: 2026-11-22T11:24Z
outputs: findings in the bodies of PR 415 (claude/line-docs-3 37bc3756) and PR 416 (claude/av1-corrections-apply f91b59ea), §UNIFIED-DOCS-REVIEW each
## Resume
Done. Next: UNIFIED-DOCS-REVIEW-FIX (not before 11-22 14:00) on claude/av1-corrections-apply, by its brief in docs/queue-2026-11-14.md §The unified track; it also updates docs/lines/codecs.md, the line doc of both PRs, which this findings-only row could not push (neither branch is its own).
## Result
* PR 415: no claim lost from metadata or viewer; codecs' moved sections are verbatim in docs/av1/README.md and docs/htj2k-tiles.md; 376 removed lines searched, 87 read by hand.
* PR tables and branch-ancestry claims match GitHub and origin on 2026-11-22. check_links 0 unresolved and comment budget ok on both tips.
* PR 416: corrections.md §1–§12 all applied in place; x* matches audit-protocols §B0 and §B's rule.
* B1 (both PRs): a test merge in either order conflicts in docs/lines/codecs.md (2 hunks); PR 415 moves harvest §(2) and Open 10 into docs/av1/README.md with their "owed" wording, so keeping 415's side drops 416's two corrections. Fix: merge 415 into 416's branch and carry them over.
* Minor: m1 a discarded idea (top/low split, 2026-11-09) listed as undecided in Waits; m2, m3 superseded items dropped silently; m4 a Generated-by line in PR 415's body (removed); m5 noise-point's quoted rule Qs use the old x*; m6 svc-dominance qualifier applied at 1 of 3 places; m7 glossary's κ_ℓ used nowhere.
* Fixtures: none (docs only); nothing run, the gate not run.
* Owner: nothing to decide now; merge 415 before 416, after the re-review.
