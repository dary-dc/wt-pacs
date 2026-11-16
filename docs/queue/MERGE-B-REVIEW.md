state: started
started: 2026-11-15T23:43Z
heartbeat: 2026-11-16T00:09Z
outputs: findings in PR 402's body (§Review); raw logs in docs/queue/MERGE-B-REVIEW/
## Resume
Done: remerge.sh (stage A review's) and sides.sh over 4520a441..f0278742 (remerge.txt, sides.txt); test fns of the
five inputs against the result; gate lines of the five inputs against the result.
Found so far: B2 took the tip's scripts/gate.sh saying "the server side adds no step the tip lacks", but
merge-a-server's gate runs two the result lacks: "lab: row 258's verdict rule" (lab/scripts/exec_gap_summary_test.py)
and the lab-levers line's `with_fill_resumes with_an_ask_stream` filters (12 tests there, 5 here): a blocker candidate.
B4's "no tests.rs holds a test the tip lacks" misses server/src/transport/link/tests.rs's two FrameStreams tests
(hygiene's code, not carried): minor.
Gate 1 failed at run_browser.sh (1 worker outlived its client, dispatch over ts; gate-1.log); the step alone passed 4/4 after. Running: SKIP_BUILDS=1 run.sh (gate 2, counts, images).
Next: demo.sh after the gate; the two dropped gate lines run by hand; server image with an https-apt variant; PR body.
## Result
