state: done
started: 2026-11-24T13:07Z
heartbeat: 2026-11-24T13:52Z
by: WkTwQhCR
outputs: claude/dial-before-pair 9b2fe8735 (from origin/claude/unified b059388b6), draft PR 448 into claude/unified
## Resume
Done. Commits 7d441019f (Controller `paintAfter`, two tests, mutant G1), 9e0c0bedf (viewer.js: the dial while the pair
is fetched and checked, the worker view's `paired`, the manifest beside the metadata; client/README.md corrected),
d8fd601da (demo-check's held-pair and refused-pair passes, mutants M1-M3), 9b2fe8735 (README §Demo, the line doc).
Next: DIAL-BEFORE-PAIR-MEASURE (not before 11-25 06:00, a session that did not build it).
## Result
The session now dials while an optimal-quality series' pair is fetched and checked, and the decoder manifest is
fetched beside the metadata (it cannot follow the dial: the downloader's start carries the decoder). No frame is
painted or labelled before the check passes, in either view; a refused pair closes the session and paints nothing.
Tests: controller.test.mjs (2, mutant G1) and demo-check.mjs's held and refused pair (both views; M1 the dial awaits
the pair, M2 and M3 each view's gate removed), each failing by name. demo-check green in both views on
dbts_b1-q8-g8. Prediction (theory, candidates.md §4 item 3): -1 to -2 round trips on the first picture, nothing at
10 ms; not measured here (localhost; the tests check the order only).
Gate: every step green but the decoders' rebuild, which did not run (Docker Hub 429 for debian:bookworm-slim, then no
daemon); the three absence checks after it run by hand, OK. Skipped by name: native painter and window (no lavapipe),
the cross-codec arm and Firefox, the web host's check (no nginx).
Fixtures and limits: dbts_b1 and dbts_b1-q8-g8 only (one DBT volume; no ultrasound pair exists); a 4-core cloud
container, headless Chromium, software WebGL and WebCodecs, no relay, Firefox not run.
