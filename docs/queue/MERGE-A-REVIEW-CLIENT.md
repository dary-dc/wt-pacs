state: started
started: 2026-11-15T20:41Z
heartbeat: 2026-11-15T21:51Z
outputs: findings in PR 401's body (§Review); raw logs in docs/queue/MERGE-A-REVIEW-CLIENT/
## Resume
Done: (a) 62/62 second parents are the frozen A4 tips in order (parents.txt); (b) remerge.txt: 12 merges change paths
beyond their conflicts, every path named in its merge message (beyond-named.txt), all the tip's side except three docs
with the one sentence their messages announce (beyond-sides.txt); conflicted files 351 tip / 10 branch / 40 edited,
the only non-docs non-lab one scripts/gate.sh at fill-split, as its message says (conflict-sides.txt).
Also: lost.py (branch lines absent from result and final tree): the large items are direction's line-doc rewrite
(c2f97d44, dropped whole, recovery named in its message, left for §6 item 5) and M2's code to the tip; no Rust test
and no test file of the base is gone (265 -> 274 test fns). run.sh's decode WASM build hit Docker Hub 429: rebuilt
with pins.sh pointed at mirror.gcr.io at the pinned digest (restored after), then run2.sh (gate on; its first launch failed, not executable, relaunched 21:52Z with bash) in the
background. Next: gate result, counts vs baseline, then MERGE-A-CLIENT/demo.sh adapted (data fetched to
/home/user/demo-data), then PR 401 body §Review and the Result.
## Result
