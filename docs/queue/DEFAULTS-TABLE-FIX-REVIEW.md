state: done
started: 2026-11-24T21:46Z
heartbeat: 2026-11-24T21:50Z
by: VAEX2MKN
outputs: PR 444 body §Re-review; DEFAULTS-TABLE-FIX-2 and DEFAULTS-TABLE-FIX-2-REVIEW appended to docs/queue-2026-11-24.md
## Resume
Done. Next on PR 444: DEFAULTS-TABLE-FIX-2 (round two), by a session that is none of the PR's (aGu8dFAT), its review's
(55NQ2BNp), its fix's (ah4F84Ys) or this re-review's (VAEX2MKN).
## Result
Read the fix's diff (11817b00e..e75bb7782) and every new quote and file:line on claude/defaults-table. B1 closed as
stated (the 23 rows and MAX_FRAME_LEN each have a labelled clause that holds at its line; 0 "no reason found");
m1-m4 and the nits closed; the counts hold (120 rows: 47 none, 44 measured, 21 theory, 5 owner, 3 rule; recounted).
R-B1 (blocker): the new "Every none row says why its value stands" is false for six rows (POOL_CAP, TCP_NODELAY,
ATTEMPTS, the WebCodecs stall, perDecoder, pack-series' fsync), and condition 3's rewording rests on it. r-m1: the
handshake row says "off with --websocket (the default)", the reverse of the code. r-m2: ASKS_AHEAD omits row 259.
r-n1: the body's old count. Round two appended (FIX-2, FIX-2-REVIEW; latests 11-25 20:00, 11-26 12:00).
Nothing run; gate not run (docs only). Limits: the cited measurements are their documents' (19 DBT volumes of one
dataset, 3 timed; 4-core cloud, no GPU; headless Chromium; relay/netem; ultrasound lossy-sourced). Line doc not
touched: a review writes to the PR body only, as DEFAULTS-TABLE-REVIEW did; FIX-2 updates it.
Owner: none from this re-review.
