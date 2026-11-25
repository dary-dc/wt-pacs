state: done
started: 2026-11-25T06:26Z
heartbeat: 2026-11-25T06:59Z
by: G7Y7FaWy
outputs: PR 448 body §DIAL-BEFORE-PAIR-MEASURE; claude/work-ledger docs/queue/DIAL-BEFORE-PAIR-MEASURE/ (findings.md, README.md, open.mjs, rows.jsonl, summary.py, summary.txt); claude/dial-before-pair 367f61ff3 (docs/lines/client.md)
## Resume
Done. Nothing left to run.
## Result
* Standing review: controller.test.mjs 46/48 on the tip with PR 448's tests, 48/48 on the PR, mutant G1 caught; demo-check passed in both views on the PR, mutant M1 failing the held and refused pair. Nothing else touched.
* Measured, first picture, cold, dbts_b1-q8-g8 through one relay delaying both planes, 7 interleaved rounds, A/A pair: PR - tip -230 / -794 ms (page, 100 / 400 ms RTT), -206 / -790 ms (worker): -2.0 to -2.3 round trips, every round below zero; 10 ms: -10 to -12 ms, inside the noise. A/A within +-15 ms.
* Against the prediction (-1 to -2 round trips, nothing at 10 ms): met, at its upper end. Fill: -2.1 round trips at 400 ms, unresolved at 100 ms, nothing at 10 ms (decode-bound there).
* A non-regressor: PR 448 left for a sync row (no blocker; no fix row appended).
* m1 (minor): the manifest is fetched with the pair once viewer.js runs, not beside the metadata; it still precedes the dial (~2 round trips on this host). A manifest preload (theory) would save more: for the next IMPROVE round / BRIEF-WEEKEND's list. n1: two awaits dropped in an existing test.
* Fixtures and limits: dbts_b1 and dbts_b1-q8-g8 only, no ultrasound; 4-core cloud container, no GPU, headless Chromium, software WebGL/WebCodecs; userspace relay, round trip only; HTTP/1.1 dev static host (the round-trip count is this host's); 168 visits, 20 VOID, 148 kept; Firefox not run.
