state: started
started: 2026-11-15T12:17Z
heartbeat: 2026-11-15T12:42Z
outputs: claude/report-arms e4767924, bf16e99e, d46f5497 (lab/report-arms/beacon/, arms/beacon.js, scripts/gate.sh), PR 395
## Resume
Done: the arm, floor, test (19/19 mutants), gate line, README section, line doc (claude/report-arms d46f5497); the
smoke (REPORT-BUILD-BEACON-smoke.jsonl: beacon x H,Y x D1-D5b,D7-D9, --wait 25; four page mutants on D3). Found:
run.mjs closes the browser right after each ending, so queued beacons die (a 2 s pause delivered them); reported, not
fixed (harness). Running: scripts/gate.sh --quick (wasm-pack installed, dockerd started, the vendors fetched, the two
pre-existing devices.md paths set aside locally). Next: smoke table into PR 395's body; state done.
## Result
