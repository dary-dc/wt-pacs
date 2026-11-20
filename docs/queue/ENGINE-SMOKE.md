state: started
started: 2026-11-20T14:18Z
heartbeat: 2026-11-20T14:29Z
outputs: claude/engines (rows; docs/decode/engines.md §Measured)
## Resume
Pushed on claude/engines (0cb6f00b8): docs/decode/engines-smoke/ raw logs. Firefox 160.0.1 and 159.0.1 from
archive.mozilla.org (SHA256SUMS checked) in /home/user/ff. Built: wasm decoders (manifest match), ingest/tools.sh,
transport wasm (wasm-pack 0.15.0), client/transport/ts/build.sh. So far: dispatch rig Chromium 789/789; Firefox 160
764/781 twice, 159 763/781: the WebCodecs/G = 8 group clauses fail (a miss against cell 2's "dispatch 3/3").
Running: demo subset (dbts_a1 exact, -q8-g16-cut, -q8-g1-cut) into demo-series/ by
scratchpad demo-subset.sh (scripts/demo-series.sh's ingest() for one set). Next: cell 1 demo-check.mjs page/worker,
--refuse-webcodecs; cell 2 check.mjs --engine firefox under xvfb-run; cells 3-7; engines.md §Measured.
## Result
