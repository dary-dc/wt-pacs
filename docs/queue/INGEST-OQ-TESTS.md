state: done
started: 2026-11-21T10:17Z
heartbeat: 2026-11-21T10:41Z
outputs: claude/ingest-oq-tests 12d921a8b, draft PR 421 into claude/unified
## Resume
Done: 1db499ea2, 9ff3e68ea, 12d921a8b on claude/ingest-oq-tests; draft PR 421 into claude/unified. Nothing left.
## Result
T2 and T3 of docs/reviews/ingest-oq.md §7 are tests against ingest.py (ingest/coded-frames/pair_contract_test.py, a new gate step); F1 of §6 is in client/viewer/pair.test.mjs. No fix.
Known gaps, each failing today for the review's reason, printed and kept green, and failing the test once it holds:
unsigned D 11, 12 and 16 are not cut by default (ingest.py leaves the cut to its caller); signed D 12 is coded, not refused;
ingest.py writes no optimal-quality metadata (T3's other claims are skipped by name); pairOf admits neither `~` nor <Study>/<Series>.
The Rust ingest's optimal::form (#390) already cuts and refuses as proposed, so the first two gaps are the reference's.
Mutants (PR 421 body): five on today's code and six on a scratch fix, never committed, each killed; with the marks kept, the fix fails as "gap closed"; F1's two grammar mutants killed.
Gate: scripts/gate.sh --quick, GATE OK in 716 s, with PYTHON=.venv/bin/python and ingest/tools.sh's build.
Skipped by name: --quick's decoder rebuild and absence checks; the native painter and window; the viewer's cross-codec arm and Firefox; nginx's web host check.
Fixtures: synthetic 64x48, 9 frames, one 4-core cloud host; nothing timed, no DBT volume, checkPair in node, no browser.
Owner: nothing new. S1/S2, which ingest writes the pair, and the serving grammar for F1 stay as docs/reviews/ingest-oq.md §8 lists them.
