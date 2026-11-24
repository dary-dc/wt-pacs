state: started
started: 2026-11-24T19:27Z
heartbeat: 2026-11-24T19:40Z
by: Zz3Kihvk
outputs: claude/engines 7048b6534 (trace), cc2b4c22d (3a rows); claude/page-runs e59c6e9d1 (page-runs.md §3 Results, 3a)
## Resume
Done: 3a whole. Six counted runs complete (claude/engines cc2b4c22d, docs/decode/engine-cells/3a/), result in
page-runs.md §3 Results (claude/page-runs e59c6e9d1): the failure is the client's layout choice (av1-payload.js
layouts() for a unit without a sequence header), not the engine.
Now: 3b. Rig = claude/frame-memory-m5-run@1a90eb992 worktree with `git checkout origin/claude/core-m5b -- lab/opfs-cache`;
client/decode/wasm/built copied from claude/engines (sha256sum -c ../build/manifest.sha256 OK); cargo build --release
-p pack-series -p series-server; bash ingest/tools.sh; .venv; client/transport/ts/build.sh. Then under Xvfb:
`NODE_PATH=$(npm root -g) PYTHON=.venv/bin/python FIREFOX_PATH=/tmp/claude-0/ff/160.0.1/firefox/firefox DISPLAY=:99 node lab/opfs-cache/run.mjs --cell m5 --rounds 12 --engine firefox --out <claude/engines>/docs/decode/engine-cells/3b/m5-ff160-amended.jsonl`
(12 rounds per §3b's text; the command block's `--rounds 7` is stale, §Review m4). Resume a cut run with --first-round N.
## Result
