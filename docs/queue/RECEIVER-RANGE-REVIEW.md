state: started
started: 2026-11-22T13:46Z
heartbeat: 2026-11-22T13:52Z
outputs: findings in PR 422's body (claude/receiver-range at c37b5353d)
## Resume
Done (local, nothing pushed to claude/receiver-range): 51/51 pass at c37b5353d; mutants M1-M5 of the README each killed
(M1, M2 survive with signed.rs removed, as claimed); own mutants R1 (range from the addition only) killed, R2 (merge drops
metadata `signed`) survives, equivalent for the client (av1-frame.js types from each header's flags). Header layout
matches ingest.py payload(). Next: comment budget, check_links, scripts/gate.sh --quick on review-422 (= c37b5353d),
then (after client/transport/wasm/build.sh, client/decode/wasm/build/build.sh, ingest/tools.sh; README §Prerequisites) findings into PR 422's body §RECEIVER-RANGE-REVIEW (mcp__github__update_pull_request), then done.
## Result
