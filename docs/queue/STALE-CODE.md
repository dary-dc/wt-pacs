state: done
started: 2026-11-23T04:27Z
heartbeat: 2026-11-23T04:49Z
outputs: claude/stale-code 83d5428ad (6187ca4cf, 2def63b3e); PR 437 (draft into claude/unified)
## Resume
Done. Next: STALE-CODE-REVIEW (a session that wrote none of it), findings in PR 437's body.
## Result
Yes: a browser can run older client code than either server serves. Modules, workers and WASM carry no
Cache-Control, so they get heuristic freshness, a tenth of their age (RFC 9111 4.2.2; Chromium at 1e61e2cd62). In the
web image that is a tenth of the build's age after a deploy (derived). Measured in headless Chromium on scratch pages
(4-core cloud host, Playwright 1.63, not the viewer): a page opened again ran the old module (today) and the new one
(--revalidate). no-cache on everything raised a preloaded worker's requests from 2 to 4 cold and from 0 to 4 warm,
which undoes page-open's cut 3 (theory: about a round trip per link; not measured on the viewer).
Built: dev-server.py --revalidate (opt-in, for the device round), test mutated (2 mutants killed, one by the
CLI probe). nginx unchanged. Gate OK (685 s), skips named in PR 437.
Harness part (a): the flag is here; passing it in round.py and recording the code each load ran are
DEVICEKIT-TOOLS's (claude/phone-run).
Owner: the product's modules either no-cache (one line, costs round trips every open) or under a build key (structural,
free when warm), or neither: docs/client/evidence/stale-client-code.md.
