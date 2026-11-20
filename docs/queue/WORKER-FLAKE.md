state: started
started: 2026-11-20T15:17Z
heartbeat: 2026-11-20T16:31Z
outputs: claude/worker-flake (loop 46307cf9; rows landing)
## Resume
Reproduced: run 83 of the loop (lab/worker-flake/rows.jsonl line 83, 16:27 UTC) failed "&fill=0: on demand, 13 steps and
a jump asked the whole groups, 24 frames: ... received 23". Mechanism (code): on demand the want is [current]; the jump
to frame 56 makes serveWant end group 0's run (`ended`, forgetEnded drops records still on the wire), so group 0's tail
(frames 14-16) arrives only if it left the wire before the jump. The product drops it by design ("A late frame of an
ended run ... is dropped", downloader.js); the check's exact count of 24 is the race. #418 (DEMO-CHECK-MUTANTS) keeps
that exact count. Next: stop the loop at 100 runs; failing test = demo-check under `--link "--rate-kbit N"` so the
tail is on the wire at the jump (expect received < 24, check fails, product right); fix = the count bounded (at least
the frames painted plus the jump's whole group, at most the whole groups); mutate; gate --quick; draft PR into
claude/unified naming the overlap with #418; docs/reviews/worker-flake.md; docs/lines/client.md.
## Result
