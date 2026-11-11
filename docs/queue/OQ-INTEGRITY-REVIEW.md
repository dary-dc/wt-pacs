state: done
started: 2026-11-11T18:57Z
heartbeat: 2026-11-11T19:06Z
outputs: claude/oq-integrity-build dc989114, docs/reviews/oq-integrity.md (on PR #368's branch; no new PR)
## Resume
Done. Docs only (the review and docs/lines/optimal-quality.md): no gate run. Chromium protocol not re-run; rows read as committed.
## Result
Every new test fails with its change reverted (av1, decoder, controller, screen, lossy_test, coding_error_test); the
protocol's I2 mutants all killed. Not held: reverting downloader.js, viewer.js, index.html leaves every client test green.
1. A frame refused as not as coded leaves the previous frame's green "Optimal quality ✓" on screen (reproduced on the
   controller rig): I3's "not as coded" label is not built.
2. The mended frame is not held by the gate: decoder.js mutants M2–M4 survive (M3 would label the failed samples ✓);
   only the Chromium row shows it.
3. No demo-check.mjs check per label state, though I3 named it.
4. coding_error_test misses sigma(reconstruction) in place of sigma(source).
5. The unit-byte-50 mutant rows were caught by a decode failure, not the digest; run.mjs keeps only the last error.
6. Cost rows match the protocol and rule (+3.7 % / +1.9 % fill, max +7.8 % at 4x); first picture +7.8 % median at 1x
   (to +12.9 %) is recorded but not weighed, and the docs' "+0 to +13 %" omits four negative cells; order unbalanced.
Fixtures: three DBT volumes of one dataset; one 4-core cloud host, no GPU, no hardware AV1 decoder.
Owner decisions: none new; PR #368's open choices stand, choice 1 now also covers the refused frame's label.
