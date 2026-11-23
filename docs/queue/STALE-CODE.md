state: started
started: 2026-11-23T04:27Z
heartbeat: 2026-11-23T04:36Z
outputs: claude/stale-code 83d5428ad (no PR yet)
## Resume
Done on claude/stale-code: 2def63b3e (no-cache everywhere) was replaced by 6187ca4cf after a measurement showed it
doubles a cold open's preloaded-worker requests (2 -> 4) and makes a warm open ask for every module (0 -> 4):
dev-server.py --revalidate (opt-in, for the device round), its test (fails without the change), nginx unchanged.
83d5428ad: docs/client/evidence/stale-client-code.md (sources, the two measured tables, the owner's options),
deploy/README.md, docs/lines/client.md. Probes in the session scratch only (not committed).
Next: the gate (running: client/transport/wasm/build.sh then scripts/gate.sh, log in the session scratch); then the
draft PR into claude/unified via mcp__github__create_pull_request; then state done.
## Result
