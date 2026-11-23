state: started
started: 2026-11-23T04:27Z
heartbeat: 2026-11-23T04:32Z
outputs: claude/stale-code 2def63b3e (no PR yet)
## Resume
Done: 2def63b3e on claude/stale-code: dev-server.py and deploy/nginx/wt-pacs.conf.template send Cache-Control: no-cache
on every response (modules and WASM had none: heuristic freshness); dev-server.test.py's test fails without it.
Reproduced in headless Chromium with a scratch probe (old module run after the file changed; fixed after).
Next: build the clients (client/decode/wasm/build/build.sh, ingest/tools.sh per README's cloud lines), then
deploy/check_equivalence.sh --local (nginx-light installed by apt) and scripts/gate.sh; write
docs/client/evidence/stale-client-code.md (sources: RFC 9111 4.2.2, 5.2.2.4; Chromium http_response_headers.cc at
1e61e2cd62); deploy/README.md line 190; the line doc; the draft PR into claude/unified.
## Result
