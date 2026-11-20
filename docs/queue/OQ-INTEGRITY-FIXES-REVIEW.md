state: started
started: 2026-11-20T13:17Z
heartbeat: 2026-11-20T13:19Z
outputs: claude/oq-integrity-build (findings in docs/reviews/oq-integrity.md), PR 368 body
## Resume
Node and Python reverts done here (not yet pushed as findings): fix 1 controller.js reverted -> controller test fails 40/41; screen.js reverted -> screen test fails; decoder.js M1-M4 each killed by the new decoder.test.mjs (old test lets M2 live); coding_error.py sigma(reconstruction) killed. One finding: window drag on a not-as-coded frame (shown.window undefined, viewer.js pointermove). Next: build (client/decode/wasm/build/build.sh, ingest/tools.sh), scripts/demo-series.sh demo-series, run demo-check.mjs page and worker, then with controller.js fix reverted; write docs/reviews/oq-integrity.md section "Fixes review" on claude/oq-integrity-build; PR 368 body.
## Result
