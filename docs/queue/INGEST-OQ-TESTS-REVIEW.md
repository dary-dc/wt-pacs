state: done
started: 2026-11-22T13:16Z
heartbeat: 2026-11-22T13:46Z
outputs: PR 421 body §INGEST-OQ-TESTS-REVIEW; claude/ingest-oq-tests ff49feb3c (line doc)
## Resume
Done: findings in PR 421's body (footer removed), line doc ff49feb3c on claude/ingest-oq-tests. Nothing left.
## Result
No blocker; no fix rows appended. Reviewed 12d921a8b (contains origin/claude/unified).
Every claim fails on today's code for its stated reason (marks removed: 7 fail); an independent scratch fix, never committed, flips every mark to "gap closed" and passes unmarked; the D 17 cell caught that fix admitting 17 bits.
Mutants on the fix: 13 of 15 killed; survivors out of scope (cut truncating: T1's) or equivalent (digests(av1) hashes source frames). F1: TOMG/TON~x0 recomputed from contract.md; 5 grammar mutants killed.
m1: a known gap accepts any failure, not the stated one. m2: F1's guards omit the server's even length 2–44. m3: the PR body's Generated-by footer, removed.
Gate: scripts/gate.sh --quick, GATE OK in 592 s (PYTHON and INGEST_BUILD absolute: a relative INGEST_BUILD fails from-parser's build.rs). Skipped by name: --quick's rebuild and absence checks, native painter and window, viewer cross-codec and Firefox, nginx, nested workers.
Fixtures: synthetic 64x48, 9 frames, one 4-core cloud host; nothing timed, no DBT volume, checkPair in node.
Owner: nothing new.
