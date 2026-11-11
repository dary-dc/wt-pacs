state: done
started: 2026-11-11 02:03 UTC
heartbeat: 2026-11-11 03:04 UTC
outputs: claude/demo-e2e-2-fixes 25c49738, draft PR #362 into claude/demo-fixes-0; docs/reviews/demo-e2e-2.md
## Resume
Done. Nothing left to resume.
## Result
README §Demo word for word from a fresh clone of claude/demo-fixes-0 (36d286cd), one 4-core cloud host, headless
Chromium (Playwright 1.63 in place of 1.56.1) on SwiftShader; fixtures dbts_a1/b1/c1, one dataset, no cine.
Once block ran as written; 23 series in 658 s, bytes equal to the record's; all 20 series passed the loop.
demo-check.mjs mutated: cert renewal removed with a cert ending within a day -> killed (fill never completes);
route, dav1d refusal, failed digest, label order, console error -> killed.
Fixed, each mutant passing before and failing after: Lossless not checked against the paint that wrote it
(0b2dc8a6; the record's "never before the paint" came from an uncommitted copy); Home's paint unchecked after a
30 s stall on 9 of 14 a1/c1 runs (8c410843). Loop after the fixes: 16-32 s a series, no stall.
Not fixed: the loop's tail -1 hides the failing claim; its guard file may be partial; two on-demand mutants
asking a group ahead survived, cause not traced (for REDTEAM-DEMO / FIX-1).
Gate: full stopped at the decoders' docker rebuild (Docker Hub 429); --quick OK in 236 s.
Owner decisions: findings 3 and 4 touch README §Demo's wording; apply them or not.
