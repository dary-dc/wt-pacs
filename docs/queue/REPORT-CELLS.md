state: started
started: 2026-11-19T12:47Z
heartbeat: 2026-11-19T12:52Z
outputs: claude/report-arms (PR 395)
## Resume
Done: `claude/report-arms` `115a3529`: D5's kill timed from the decoder's fault (fault.js stamps on channel
`faultbench`, page.js `rig.faultAt`/`sinceFault()`, run.mjs `killAfterFault`), tests first, 5/5 mutants.
Next: D5a smoke (one round, not counted): `cargo build --release -p series-server --features telemetry -p pack-series`,
`client/decode/wasm/build/build.sh`, then `node lab/report-arms/run.mjs --units "off,beacon:Y" --endings D5a --wait 5 --out /tmp/x.jsonl`.
Then cells L, C, Y, R, D6 (under --tun), Firefox, per report-plan.md §7.3; README's What is built table updated.
## Result
