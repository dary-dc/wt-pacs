state: started
started: 2026-11-24T15:47Z
heartbeat: 2026-11-24T15:51Z
by: Eh9ts3Aw
outputs: claude/delivery 893f04aad (lab only; PR 406)
## Resume
Done: 893f04aad on claude/delivery: plan.mjs (6 arms, 12 rounds, FIT/SPLIT levers, k3PrimeLoads), inputs.mjs (wireCurves from B loads only; fit inputs), predict.mjs (curve wire, askLastByte, zoomLatency, split); predict.test reproduces A2.7 and A2.3 to the digit; inputs/predict mutants killed.
Next: judge.mjs (10 of 12 rounds, FIT zoom and C1 ask → last byte clocks, judged:false, regime null for SPLIT, C2 out, FIT's prefix-bytes refusal, VOID `escaped`) and judge.test; then the client side (fit series via lab/av1/decode/resolution-level/prefix.mjs, fit/zoom/split levers in lab/devices/round-page.js, window read-back), run.mjs records (Cpus_allowed_list, softirqs, relay ctxsw), mutants, gate.
Commands: cd delivery worktree of origin/claude/delivery; node lab/delivery/{predict,inputs,judge}.test.mjs
## Result
