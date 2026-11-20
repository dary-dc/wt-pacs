state: started
started: 2026-11-20T12:16Z
heartbeat: 2026-11-20T12:39Z
outputs: claude/delivery 34426f22 (merge of claude/phone-run), draft PR 406
## Resume
Done: claude/delivery 34426f22 = --no-ff merge of origin/claude/phone-run (conflict docs/lines/client.md resolved: both kept).
The container runs the relay's TUN plane: `apt-get install -y iproute2` (absent from the image), then
`unshare -rn` + `lab/scripts/link_impair.py --tun --delay-ms 10 --self-timing`: READY, a UDP echo in the server netns
at 10.77.0.2 read RTT 20.75 ms, self-timing p99 0.24 ms (2026-11-20 12:40Z).
Pushed e8390ef7: lab/delivery/plan.mjs (cells, arms, order) and predict.mjs (§4.1 model, predictions.json,
XXH3 by the product hasher), predict.test.mjs 25 claims, 10 mutants killed. Pushed 952b64ca: judge.mjs (§6-§8), judge.test.mjs 23 claims, 14 mutants killed.
Pushed 8f43a8ead: lab/devices beacon lastByte + pressAfter (tests failed first); lab/delivery/prefix.py (4 mutants);
run.mjs, the driver: one CLEAN round on the synthetic pair (synth, 64x48, 20 frames) ran all five arms ok.
Findings for the run: the viewer's page must be a secure context, so the page server runs at 10.77.0.2 beside the
series servers and Chromium (channel "chromium"; the headless shell ignores it) gets
--unsafely-treat-insecure-origin-as-secure for its two origins; navigator.hardwareConcurrency reads 2 under taskset.
Next: inputs.mjs (K1 bytes, K2 bench, K3 via claude/transport-arms run.mjs WT-TS), README, the driver mutants, gate.
Was next: lab/delivery/ (driver over the viewer's round levers through the TUN relay; prefix series; C1's 1 s gap;
K1-K3 + predictor -> predictions.json; judge), tests failing first, mutants of protocol §10; smoke one round a cell.
## Result
