state: done
started: 2026-11-19T11:46Z
heartbeat: 2026-11-19T12:14Z
outputs: claude/oq-integrity-build (51fe60ab0), draft PR 368 (body updated)
## Resume
Done. Next row: OQ-INTEGRITY-FIXES-REVIEW (not before 11-20 12:00), by a session that wrote none of these fixes.
## Result
* Review findings 1-4 of docs/reviews/oq-integrity.md fixed on claude/oq-integrity-build (PR 368, still a proposal, off by default), one commit each.
* 1 (1ffd60be9): a frame refused as not as coded labels its step "Optimal quality — not as coded", refused before or after the step; failing test first; 6 mutants killed.
* 2 (97f95bd7a): decoder.test.mjs with a WebCodecs stand-in that decodes wrong; the review's M1-M4 killed, and a group losing its first payload.
* 3 (eda808ca0): demo-check.mjs reads ✓ on an integrity series and "not as coded" on a step to a frame whose digest is wrong; passed under ?view=page and ?view=worker; fails with fix 1 reverted and with either label text mutated.
* 4 (5c1902884): coding_error_test.py, a denoised reconstruction reads ratio 1.0041; mutant σ(reconstruction) killed.
* Weighed in PR 368's body, not changed: finding 5 (the inter-unit row), the first picture's +7.8 % (measured, 2026-11-11 rows).
* Gate OK at 51fe60ab0 (706 s); skipped: native painter and window (no lavapipe, Xvfb), the viewer's cross-codec arm and Firefox, nginx.
* Fixtures: synthetic stand-ins in node tests; the browser check on dbts_a1-q8-g8-cut alone (one DBT volume of one dataset), one 4-core cloud host, headless Chromium on SwiftShader, loopback; no phone, no GPU, no hardware AV1 decoder.
* Owner decisions (PR 368's, unchanged): take PR 368; choice 2, block (built) or paint with a red mark.
