state: started
started: 2026-11-14T21:15Z
heartbeat: 2026-11-14T21:40Z
outputs: claude/oq-ingest (from origin/claude/unified-client), draft PR into claude/unified-client (not yet)
## Resume
Design (from INGEST-OQ's R): the Rust ingest `ingest/from-parser` gains `--optimal-quality [Q]` (off by default, Q 8
when bare, 1-63) and `--group G` (default 8: no per-modality G is measured yet). After the exact bundle is written,
the OQ bundle `<stem>-q<Q>-g<G>[-cut].sbnd` beside it: aomenc 3.15.1 subprocess with ingest.py's lossy_args, one run
per group, every frame decoded from its keyframe through libdecode's av1_decode; unsigned D > 10 always the cut;
signed over 10 bits after the offset and RGB refused by name (exact kept). Reconstruction digest: PR 368 not in the
docs, named as the next step. Parity: same.py/same_test.py extended (Rust OQ vs ingest.py's `coded(lossy=)`).
Branch claude/oq-ingest fast-forwarded to origin/claude/unified-client e5b20cba (its old 11-09 commits are in it).
Next: Rust tests first (src/optimal.rs), then same_test parity, gate.
## Result
