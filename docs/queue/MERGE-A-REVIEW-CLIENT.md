state: started
started: 2026-11-15T20:41Z
heartbeat: 2026-11-15T20:44Z
outputs: findings in PR 401's body (§Review); raw logs in docs/queue/MERGE-A-REVIEW-CLIENT/
## Resume
Done: (a) 62/62 second parents are the frozen A4 tips in order (parents.txt); (b) remerge.txt: 12 merges change paths
beyond their conflicts, every path named in its merge message (beyond-named.txt), all the tip's side except three docs
with the one sentence their messages announce (beyond-sides.txt); conflicted files 351 tip / 10 branch / 40 edited,
the only non-docs non-lab one scripts/gate.sh at fill-split, as its message says (conflict-sides.txt).
Now: run.sh in the background (setup, wasm builds, ingest/tools.sh, gate, cargo build, absence checks, counts) on a
detached worktree /home/user/mac of ed11ea72, CARGO_TARGET_DIR=/home/user/target-mac; then MERGE-A-CLIENT/demo.sh
(needs lab/av1/fetch_data.sh dbts_a1 into /home/user/demo-data and the lab/av1/.venv). A resume reruns run.sh.
## Result
