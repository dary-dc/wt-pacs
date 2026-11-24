state: done
started: 2026-11-24T20:27Z
heartbeat: 2026-11-24T20:33Z
by: 55NQ2BNp
outputs: findings in PR 444's body §DEFAULTS-TABLE-REVIEW (claude/defaults-table 11817b00e, unchanged); DEFAULTS-TABLE-FIX and -FIX-REVIEW appended to docs/queue-2026-11-24.md
## Resume
Done. Nothing pushed to claude/defaults-table (a review). Next: DEFAULTS-TABLE-FIX (another session), not before 11-24 21:00.
## Result
PR 444 (docs/defaults.md, claude/defaults-table 11817b00e against claude/unified b059388b6) reviewed: every quote
found in the document its row names; every file:line read at the tip holds its value; quinn-proto 0.11.18's defaults
read from the crate (idle 30 s, initial RTT 333 ms, send window 10 MB, cubic initial window 12 000), so those rows
are source. One blocker: B1, 23 rows say "no reason found" without the "why it stands" the brief asks. Minor: m1
wireBuffers is measured (decode/README.md §The wire buffer ring), labelled theory; m2 the receiver fsyncs every
staged file (disk.rs, package.rs:453) while the table's row reads "no fsync"; m3 the counts are 49 none / 42
measured / 19 theory / 5 owner / 3 rule of 118, not "about 51"; m4 aomenc --threads=1 has no row; m5 PR 443 renames
coordination.md, which this PR edits (the sync row's order). Nits: askDepth's quote drops a link; TLS_PORT/TLS_DIR
lines swapped; two kind labels; ingest.py:243. Fix loop started (DEFAULTS-TABLE-FIX, -FIX-REVIEW).
check_links 0 unresolved; nothing run, gate not run (docs only). Limits: the cited measurements are their documents'
(19 DBT volumes of one dataset, 3 timed; 4-core cloud, no GPU; headless Chromium; relay/netem; ultrasound lossy-sourced).
Owner: none from this review (the table's condition-3 rewording stays DEFAULTS-TABLE's yes for BRIEF-WEEKEND).
