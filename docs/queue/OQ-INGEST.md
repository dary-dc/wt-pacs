state: done
started: 2026-11-14T21:15Z
heartbeat: 2026-11-14T23:40Z
outputs: claude/oq-ingest at 7a459b23 (from origin/claude/unified-client e5b20cba), draft PR #390 into claude/unified-client
## Resume
Done. For OQ-INGEST-REVIEW: build per README cloud lines (ingest/tools.sh, .venv from ingest/requirements.txt), then
`cargo test -p from-parser`, `.venv/bin/python ingest/from-parser/same_test.py`, the PR body's mutant list.
## Result
Built: `ingest/from-parser --optimal-quality [Q] [--group G]` (Rust ingest, INGEST-OQ's R), off by default, Q 8 bare,
G 8 default; writes `<stem>-q<Q>-g<G>[-cut].sbnd` after the exact series. Unsigned D > 10 always the cut; signed over
10 bits and RGB refused by name, exact kept (S2). Tests failing first, 21 mutants all killed.
Parity: byte-identical to ingest.py's `lossy` on synthetic sets at --jobs 1, 2, 4 (gate); on dbts_a1 Q 8 G 8 cut the
56 payloads equal the lab tool's (4,640,828 B), fingerprint equal, checkPair accepts. Metadata differs only by display
keys (phase 2). Full gate OK, 712 s (skipped: lavapipe, Xvfb, GL/Firefox, nginx). Not run: demo-check.mjs on the pair.
Not built: reconstruction digest (PR 368 not adopted), G per modality (none measured).
Owner: (1) S1 or S2 for signed > 10 bits (S2 built); (2) PR #321, the 11-09 work on the same branch into claude/core,
now shows the unified history after the fast-forward: keep, retarget or close is yours.
