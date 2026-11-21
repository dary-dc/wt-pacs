state: started
started: 2026-11-21T11:17Z
heartbeat: 2026-11-21T11:32Z
outputs: claude/lab-levers-one-field 010eb2c94 (no PR yet)
## Resume
Done: 010eb2c94 (the change); series-server tests green default (153+7+1) and lab-levers (160+7+1); mutants M1-M4, M6 killed, M5 (advise_tile_names through Sessions) survives, no test before either; default build serves identical bytes to 4a2b4277f's (native-fill over us_cine_smoke and queue_large, every frame checked, twice each, interleaved), --help identical, binary +1504 B.
Next: scripts/gate.sh running (PYTHON=.venv/bin/python scripts/gate.sh; prerequisites built, the WASM matching its manifest); then draft PR into claude/unified (body drafted); docs/lines/coordination.md §Open 8 one line.
## Result
