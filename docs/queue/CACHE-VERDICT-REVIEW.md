state: started
started: 2026-11-19T08:46Z
heartbeat: 2026-11-19T08:49Z
outputs: claude/cache-plan (docs/client/evidence/cache-plan.md §Verdict review), claude/docs-client (design.md §Open, one line)
## Resume
Done: every bar recomputed from the rows of claude/cache-arms e988f9c6 by an independent script (scratch, to be committed
as lab/cache-arms/rows/verdict_check.py? no: docs-only row; quoted in the review). §9's table holds cell for cell;
one error: Firefox none at S2 4x 18 % and S3 4x 34 % missed (saturated), §9 says 0.0-0.2 %.
T (Chromium OPFS-SYNC): store-worker.js verify() counts a miss and a SHA mismatch alike; in a reading tab a failed
XXH3 is a miss (store.js:96). Probing in Chromium whether getFile() reads fail while a sync handle writes.
Next: the probe; then §Verdict review in cache-plan.md on claude/cache-plan; design.md §Open one line on claude/docs-client.
## Result
