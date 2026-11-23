state: done
started: 2026-11-23T10:47Z
heartbeat: 2026-11-23T10:49Z
outputs: PR 417 body §Re-review; claude/sync-reconcile 2671cd3bf (docs/lines/metadata.md); docs/queue/SYNC-RECONCILE-REVIEW-FIX-REVIEW/ (recheck.py, output.txt) here
## Resume
Done. Reviewed at 9f9634c66, 27 min after the fix's last push (10:19). Next: PR 417 may merge into claude/unified at a
sync row (DOCS-SYNC-1123, after 12:00) with the gate there (amendment 28 rule 1).
## Result
* No blocker open. B1 closed: both conditions (zstd on the metadata call; rsync's listing <= 34.2 KB ct, <= 221.5 KB
  at 2 000 on ADSL 0.5) at every carried place; recomputed by an independent script, every number matches (*derived*).
  Satellite bounds 96.7 KB (ct) and 534 KB (2 000) at 1 Mbit/s exceed M-R2's raw tops: "the raw listing passes" holds.
* B2 closed (§6's ranking corrected in place); the review's m1-m3 closed.
* New minor: m1 the PR body's summary still carries "provisional on M-R2 / <= 0.6x"; m2 §6.1's new row leaves ct "—"
  where 60 KB x 0.6 gives 1.03 s, P3. Nits n1-n2 of the review left open; a mid-sentence line break.
* Docs only: check_links 0 unresolved, comment budget ok, merge-tree clean into claude/unified; the gate not run.
* Fixtures: none run; arithmetic on #234's estimates and #223's bytes (five parser series, a synthetic 2 000).
* Owner: none now; pacs-sync.md item 3's yes stands on P4's two conditions (M-R2, M-R3 not run).
