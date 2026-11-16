state: done
started: 2026-11-16T01:41Z
heartbeat: 2026-11-16T02:22Z
outputs: findings in PR 402's body (§Fix review, also docs/queue/MERGE-B-FIX-REVIEW/review.md); claude/unified ff2bc154 (docs/lines/coordination.md Open 8); logs in docs/queue/MERGE-B-FIX-REVIEW/
## Resume
Done. Nothing owed by this row. Next for this file's queue: COMPLEXITY-AUDIT and PR-TRIAGE (their need, MERGE-B-FIX-REVIEW
done with no blocker open, is met).
## Result
Reviewed claude/unified at e2357b13 (PR 402): **no blocker; amendment 17's loop closes after one round.**
* The fix's diff (fb864a8f..e2357b13): scripts/gate.sh's two lines, merge-a-server 1597e37c60's text exactly, and the
  line doc; nothing else.
* Own mutants (mut.log), each killed: exec_gap_summary.py:39 med<0 -> med>0 and abs(med)<=res -> abs(med)<0 fail the
  step; server.rs:198 fill_resumes not read from the lever fails with_fill_resumes_an_ask_goes_first...; link.rs:74 the
  ask stream ignored fails with_an_ask_stream_an_ask_is_read_past_the_unread_fill. Unmutated, the line runs 12 tests.
* PR 402's body corrections (B2, item 3) present.
* Full gate at e2357b13 (gate.log): OK 584 s, 58 steps, one skip (viewer cross-codec arm and Firefox), as the fix's.
  Earlier runs kept: gate-0/1 stopped on missing prerequisites (transport WASM; README's venv), gate-2 OK 736 s with
  3 more skips for host packages (lavapipe, Xvfb, xdotool, nginx), installed for gate.log.
* demo-check and the deploy images not run again (the fix touches the gate only).
Fixtures: the repository's committed ones; one 4-core cloud host, no GPU, headless Chromium (Playwright 1.63.0), no Firefox.
