state: started
started: 2026-11-21T11:17Z
heartbeat: 2026-11-21T11:54Z
outputs: claude/lab-levers-one-field 010eb2c94, fc5618d81 (no PR yet)
## Resume
Done: 010eb2c94 (one always-compiled lab: LabLevers) failed the gate: server/scripts/check_telemetry_absent.sh found --send-window-follows-cwnd in the default binary. fc5618d81 replaces it: Sessions built with every lever off, LabLevers::onto (feature-only) sets the five lever values; one cfg line instead of five pairs. Tests green default 153+7+1, lab-levers 160+7+1, telemetry 156+7+1; both absence checks OK; mutants M1-M4, M6 killed, M5 (advise_tile_names) survives as on the base; default build: identical served bytes (native-fill, us_cine_smoke and queue_large, interleaved twice), banner and --help identical, binary same size (6 035 808 B), bytes differ.
Next: full gate running (PYTHON=.venv/bin/python scripts/gate.sh, log /tmp only); then draft PR into claude/unified (body in the session scratchpad); docs/lines/coordination.md §Open 8 one line.
## Result
