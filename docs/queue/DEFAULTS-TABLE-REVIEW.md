state: started
started: 2026-11-24T20:27Z
heartbeat: 2026-11-24T20:30Z
by: 55NQ2BNp
outputs: findings in PR 444's body (claude/defaults-table)
## Resume
Done: every quote in docs/defaults.md (claude/defaults-table 11817b00e) grep-found on the tip but one (askDepth's, a
link stripped); server, deploy, ingest and receiver file:line rows read; quinn-proto 0.11.18's defaults read from
its crate (idle 30 s, initial RTT 333 ms, cubic initial window 12 000). Findings so far: the receiver's fsync rows
(ingest/receiver/src/disk.rs, package.rs:453 fsync every staged file) vs the table's "fsync none"; compose TLS_PORT/
TLS_DIR line order. Next: client rows (viewer.js, downloader.js, controller.js, decode, paint), then the findings
into PR 444's body §DEFAULTS-TABLE-REVIEW (mcp__github__update_pull_request), then done.
## Result
