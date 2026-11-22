state: started
started: 2026-11-22T10:47Z
heartbeat: 2026-11-22T10:52Z
outputs: `claude/names-unified` at 02ddeb32 (four commits, pushed; no PR yet)
## Resume
Gate running (started 11:2xZ, log scratchpad gate.log; rerun the commands if lost). Pushed on `claude/names-unified`: 27d864df exactSource -> exactClient; db199169 lab's requestExactFrame/info.path
(r3_arm.test failed on the base, passes); ac3abac8 mark and status line *no digest*; 02ddeb32 rules-for-showing-lossy-
pictures *lossy stream*. Next: the gate (`client/decode/wasm/build/build.sh; ingest/tools.sh; scripts/gate.sh`, log in
the scratchpad), mutants on the rename sites, then the draft PR into claude/unified and the line doc.
Open finding for the PR body: `claude/htj2k-a1`'s stage3/page.js calls `requestExactFrame` on a consumer.js that has only
`requestFrame`, yet its rows show arm D's Lossless asks answered (a1-run-2, arm D, 57 asks, losslessExact true).
## Result
