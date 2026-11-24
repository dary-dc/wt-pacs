state: started
started: 2026-11-24T13:07Z
heartbeat: 2026-11-24T13:14Z
by: WkTwQhCR
outputs: claude/dial-before-pair 9e0c0bedf (from origin/claude/unified b059388b6), PR pending
## Resume
Done: 7d441019f Controller `paintAfter` (nothing painted or labelled before it settles), two tests in
client/view/controller.test.mjs, mutant G1 (the await removed) killed; 9e0c0bedf viewer.js dials while the pair is
fetched (pairing awaited after connect; refusal: fail(), hooks.report, the client closed), the worker view's `paired`
intent, the decoder manifest fetched once a page beside the metadata (wasm-glue.js), client/README.md corrected.
Next: an order test in client/viewer/demo-check.mjs (the exact series' metadata delayed by a playwright route:
boot.connect before boot.pair; a refused pair delayed past the first frames paints nothing), mutated; needs an AV1 pair:
`BUILD=$PWD/ingest/.build ingest/tools.sh` (pip install meson ninja first), `OUT=$PWD/lab/av1/data
lab/av1/fetch_data.sh dbts_b1`, then demo-series.sh's ingest() for dbts_b1 and dbts_b1-q8-g8 only; demo-check in both
views; scripts/gate.sh; draft PR into claude/unified; docs/lines/client.md.
## Result
