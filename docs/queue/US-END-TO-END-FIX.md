state: done
started: 2026-11-24T23:26Z
heartbeat: 2026-11-24T23:53Z
by: LmKctNiQ
outputs: claude/us-end-to-end cf09b9d38 (e1f6b817e, 653ebb6d2), PR 445 (body updated); claude/work-ledger docs/queue/US-END-TO-END-REVIEW/findings.md §Fix
## Resume
Done. US-END-TO-END-FIX-REVIEW is owed by another session.
## Result
B1 fixed: gate.yml caches lab/av1/data's three sets (~0.5 GB, keyed on data.json), fetches on a miss, ffmpeg 6.1.1
in apt; no allowed skip added. Not shown on a runner (unified's workflow runs on PRs into it only once PR 442 lands).
m1 fixed: `same` reads the served .sbnd's own metadata; the same-length swap mutant now fails (measured).
m2 fixed: FIXTURES.md and the PR body limit the US path to an uncompressed 8-bit object. Nit left to the sync row.
Step re-run: usb_cine 64/64, usb_cine_rgb 64/64, dbts_a1 56/56 exact in page and worker (measured).
Gate: green to the decoders' docker rebuild, which the container could not run (Docker Hub 429); the three absence
checks after it OK by hand.
Fixtures and limits: clips lossy-sourced (function check), dbts_a1 sound; 4-core cloud host, no GPU, headless
Chromium/SwiftShader, loopback, HTJ2K, ts client.
Owner: none.
