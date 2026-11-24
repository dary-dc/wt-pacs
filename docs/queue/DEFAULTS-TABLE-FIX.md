state: done
started: 2026-11-24T21:17Z
heartbeat: 2026-11-24T21:22Z
by: ah4F84Ys
outputs: claude/defaults-table 3a2cb08d9 (docs/defaults.md), e75bb7782 (docs/lines/coordination.md); PR 444 body §DEFAULTS-TABLE-FIX
## Resume
Done. Next on PR 444: DEFAULTS-TABLE-FIX-REVIEW, by a session that is none of the PR's, its review's (55NQ2BNp) or this fix's (ah4F84Ys).
## Result
B1 closed: each of the 23 "no reason found" rows and MAX_FRAME_LEN now says why it stands in one labelled clause
(code, derived, harmless, untested); none was left without a reason; the untested ones are listed for the owner in
§What this table finds. m1 wireBuffers measured; m2 the receiver's fsync row beside pack-series'; m3 exact counts
(120 rows: 47 none, 44 measured, 21 theory, 5 owner, 3 —); m4 aomenc's --threads=1 row; nits fixed; m5 left to the
sync row (PR 443's rename). Docs only: check_links 0 unresolved, comment budget green, gate not run. Nothing measured;
the cited measurements are each document's own (19 DBT volumes of one dataset, 3 timed; 4-core cloud hosts without a
GPU; headless Chromium; relay or netem; ultrasound fixtures lossy-sourced).
