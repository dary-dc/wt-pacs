state: done
started: 2026-11-14T22:18Z
heartbeat: 2026-11-14T22:50Z
outputs: claude/transport-design 96a829c8 (from origin/claude/docs-client 67a49208); draft PR #391 into claude/docs-client
## Resume
Done. docs/transport/design.md written and pushed; docs/lines/codecs.md points to it; PR #391 open as a draft.
## Result
docs/transport/design.md, structured as CLAUDE.md §Docs asks: one diagram (downloader worker, carriers, one endpoint routing
h3 and wt-pacs/1, planner, link), 8 rules, 11 Decided rows (controller, initial window, opening ask, shared stream,
fill and ask, windows, early SETTINGS, GSO 24, one endpoint, raw QUIC, WebSocket off), each with date, whose call and evidence.
Open has 11 items. Added: HTJ2K alone over WebTransport against HTTP/2 fetch, WebSocket and HTTP/3 fetch on the link
profiles, with its theory (delivery-prior-art §8, transport-conclusions §5) and what decides it.
Host networking is listed Open, not Decided: the only source is a theory-only proposal (claude/hostnet-theory, 2026-11-12).
Evidence files were not moved; off-branch evidence is cited as branch:path. Docs only: check_links and
check_personal_paths pass; gate.sh not run (no code touched).
Owner: host networking stays undecided until a check from a client off the host; the 32-packet window remains your call.
