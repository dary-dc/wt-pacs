state: done
started: 2026-11-16T00:41Z
heartbeat: 2026-11-16T01:12Z
outputs: claude/unified acea7a10 (scripts/gate.sh) and e2357b13 (docs/lines/coordination.md Open 8); PR 402 body corrected (B2, item 3) and §Fix added; logs in docs/queue/MERGE-B-FIX/
## Resume
Done. Next row: MERGE-B-FIX-REVIEW, by a session that wrote neither MERGE-B nor this fix.
## Result
* acea7a10 puts back merge-a-server's step "lab: row 258's verdict rule" and the lab-levers filters
  with_fill_resumes with_an_ask_stream (gate line 5 -> 12 tests), merge-a-server's text exactly.
* Mutants, each run with the gate's own line (mut.log): verdict 0.8 -> 0.5 fails the step; Planner::fill_resumes forced
  off fails 4 of 12; the server's ask_stream lever dropped fails with_an_ask_stream_an_ask_is_read_past_the_unread_fill.
* Full gate at acea7a10: OK in 754 s, 58 steps (57 + the restored one), the same two skips (gate.log).
  gate-1.log failed at the restored step on a stale __pycache__ from the 0.5 mutant (same size, same second), not the
  code. Mutate Python with PYTHONDONTWRITEBYTECODE=1 or clear __pycache__ afterwards.
* PR 402's body: B2's "adds no step the tip lacks" and item 3's "none holds a test the tip lacks" corrected in place.
* Browser checks and demo-check not run again (gate.sh only). Fixtures: committed; one 4-core host, no GPU, no Firefox.
* Seen, not this row's: gate step "lab: M5's rule on made-up rows" runs nothing (also on unified-client) — COMPLEXITY-AUDIT.
