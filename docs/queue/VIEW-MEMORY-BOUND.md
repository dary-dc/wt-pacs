state: started
started: 2026-11-23T03:47Z
heartbeat: 2026-11-23T03:49Z
outputs: claude/view-memory-bound 4cc8df2b3 (client/view/controller.js default budget, its test; docs)
## Resume
Pushed 4cc8df2b3 on claude/view-memory-bound: Controller's default budget = framesWithin(256 MiB, meta); test
"the memory window defaults to 256 MiB of the series' frames", mutants M1-M4 killed; docs (what-a-view-asks-for.md,
design.md/html, lines/client.md). Next: client/decode/wasm/build/build.sh, ingest/tools.sh, scripts/gate.sh; then the
draft PR into claude/unified via mcp__github__create_pull_request; then done.
## Result
