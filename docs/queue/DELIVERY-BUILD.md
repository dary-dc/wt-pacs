state: started
started: 2026-11-20T12:16Z
heartbeat: 2026-11-20T12:24Z
outputs: claude/delivery 34426f22 (merge of claude/phone-run), draft PR 406
## Resume
Done: claude/delivery 34426f22 = --no-ff merge of origin/claude/phone-run (conflict docs/lines/client.md resolved: both kept).
The container runs the relay's TUN plane: `apt-get install -y iproute2` (absent from the image), then
`unshare -rn` + `lab/scripts/link_impair.py --tun --delay-ms 10 --self-timing`: READY, a UDP echo in the server netns
at 10.77.0.2 read RTT 20.75 ms, self-timing p99 0.24 ms (2026-11-20 12:40Z).
Pushed e8390ef7: lab/delivery/plan.mjs (cells, arms, order) and predict.mjs (§4.1 model, predictions.json,
XXH3 by the product hasher), predict.test.mjs 25 claims, 10 mutants killed. Pushed 952b64ca: judge.mjs (§6-§8), judge.test.mjs 23 claims, 14 mutants killed.
Next: lab/delivery/ (driver over the viewer's round levers through the TUN relay; prefix series; C1's 1 s gap;
K1-K3 + predictor -> predictions.json; judge), tests failing first, mutants of protocol §10; smoke one round a cell.
## Result
