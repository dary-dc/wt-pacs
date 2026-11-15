state: done
started: 2026-11-15T09:17Z
heartbeat: 2026-11-15T09:52Z
outputs: claude/cache-arms 2d38383f, 192a72ea, ac517958 (lab/cache-arms/arms/cachestorage.js, arms/cachestorage.test.mjs; README §CACHESTORAGE as built; scripts/gate.sh; docs/lines/client.md), draft PR 394 (its CACHE-BUILD-CACHESTORAGE section)
## Resume
Done. Nothing owed by this row; CACHE-BUILD-REVIEW judges it with the other builds. Firefox smoke not run; a later firing may add it without changing the arm.
## Result
CACHESTORAGE as §7.4 has it: a Cache per series, a response per frame under a string key, the manifest a record;
buffered (own reused ArrayBuffer, slot let go, inflight 1|3) or streamed (the slot's 1 MiB shared views, slot held).
- Forced by the seam: at inflight=3 a refusal is thrown by a later write, whose retry re-puts from kept buffers;
  written means handed to the arm there. No harness change.
- Tests: arms/cachestorage.test.mjs on an in-memory Cache Storage, in the gate; 33 code mutants killed, 2 equivalent.
- Smoke (not results), Chromium 153: every row check passed in L S1-S3 (and streamed, inflight=3 at S2), W, R-idle,
  R-busy, B, O, K (2 rounds), Q, T, P; E S3's sets missed.
- For CACHE-RUN: space freed by caches.delete comes back late on Chromium; under the override the store's estimate()
  wait ends at once, so C stopped after 5 frames and D landed beside B and C. An amendment for all four (probe the room).
- Streamed: shared-view bodies accepted and exact on Chromium 153 (the pilot's first check passes there).
- gate.sh --quick passes with the two pre-existing link paths set aside locally; check_lab_absent.sh passes.
Fixtures: 4-vCPU cloud host, no GPU, synthetic 16-bit S1-S3, feeders not decoders, warm page cache, one round a cell;
no Firefox, no WebKitGTK, no phone.
