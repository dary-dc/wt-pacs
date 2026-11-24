state: started
started: 2026-11-24T06:26Z
heartbeat: 2026-11-24T06:50Z
by: MdHdiu8t
outputs: findings in PRs 418 and 419's bodies
## Resume
Built on the tip b7cc007f in /home/user/u; fixtures dbts_a1, -q8-g8-cut, -q8-g16-cut (35 s). Running
/tmp/claude-0/s/run.sh CHECK CONTROLLER SERIES VIEW, rows in /tmp/claude-0/s/rows.jsonl, to be pushed to
docs/queue/DEMO-CHECK-REVIEW/rows.jsonl. Checks: 418, 419, merged (418 + 419's wait, ON_DEMAND = groupsOf),
merged-nowait. Controllers on the tip: orig, B1 (show() on a miss also asks (want+8)%n), A (wantFrom on demand
[c, (c+8)%n]).
Predictions, written before any mutant run (dbts_a1-q8-g8-cut, G 8, 56 frames, window 65 frames > 56, so no
eviction on the tip):
* orig: every check passes, both views.
* B1, page: 419 survives (extras land in groups 1 and 0, atJump 24); 418 and merged kill (16 > 8 before step 8).
* B1, worker: equivalent (the worker view's show() takes the store's branch), every check survives.
* A, page: equivalent on the tip too (page view on demand never calls want()), every check survives.
* A, worker: killed by all three (418/merged: 16 > 8 before step 1; 419: 32 not 24).
* dbts_a1-q8-g16-cut, worker, orig: merged passes 3/3; merged-nowait fails at least 1 of 3 (419's 4 of 5).
## Result
