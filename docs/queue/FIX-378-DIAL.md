state: done
started: 2026-11-17T09:17Z
heartbeat: 2026-11-17T09:33Z
outputs: claude/lossless-under-loss e5fc7406 (failing test), 30968d78 (fix), 8425d1f2 (README), ae64ec70 (docs); PR 378 body §FIX-378-DIAL
## Resume
Done. Nothing owed by this row; its review (a session that wrote none of it) is owed.
## Result
* An ask whose own re-dial fails (`live()` on the `ask` command, the session already dead) now fails as `lost`, so it is named AskLostError and asked once more after 1 s; an ask after the consumer closed is not lost.
* Test failing first (e5fc7406: lost=false), then fix (30968d78), downloader/consumer/controller tests pass (controller 42/42).
* Mutants 6, killed 5 (flag always, never, inverted, the old path, no-session ask); survivor: the generation guard (a cancel during a failing dial; the consumer drops a stale generation).
* docs/reviews/lossless-under-loss.md: the 2026-11-15 "not marked lost" sentence corrected in place, a new section; docs/lines/optimal-quality.md Open 16 one line; client/README one clause.
* scripts/gate.sh --quick OK in 551 s on ae64ec70 (browser steps included); check_lab_absent.sh OK. Skipped: decoders' rebuild (no Docker daemon), two other absence checks (--quick), numpy/pydicom and the ingest build, lavapipe, Xvfb, Firefox, nginx. demo-check.mjs and the blackout rig not re-run.
* Fixtures: unit tests with stand-in sessions, one 4-core cloud host without a GPU; no link, no phone.
* Owner: whether one re-ask is enough (unchanged, owed since 2026-11-15).
