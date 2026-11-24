state: done
started: 2026-11-24T11:46Z
heartbeat: 2026-11-24T12:11Z
by: 39HfyrXq
outputs: claude/us-end-to-end f4d78465d, PR 445 (draft → claude/unified)
## Resume
Done. Nothing left; US-END-TO-END-REVIEW is owed by another session.
## Result
New gate step `scripts/stacks_end_to_end.sh` (+ `ingest/from-dicom/stack_fixture.py`, `docs/FIXTURES.md` §Stacks end
to end): usb_cine 64, usb_cine_rgb 64 (the ingest takes colour), dbts_a1 56 through from_dicom.py, digests held to the
pins, every frame exact in the page and the view worker; 14 s. Full gate OK in 704 s (skips: native painter/window,
cross-codec arm and Firefox, nginx, the pair's invariants). Mutations M1 (valid other series served), M2 (pinned frame
missing), M3 (clip reversed) each fail it. Skipped by name until the sets are fetched (1.7 GB), so CI runs it only
with a cache. Limits: clips lossy-sourced (function check, no bytes or times); 4-core cloud host, no GPU, headless
Chromium/SwiftShader, loopback, HTJ2K and the ts client only. Closes condition 2's DBT half; the US path shown complete.
Owner: none.
