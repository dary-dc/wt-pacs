state: done
started: 2026-11-14T23:17Z
heartbeat: 2026-11-14T23:24Z
outputs: claude/report-plan ac3a8227, ac4b7630 (docs/client/evidence/report-plan.md §3.5 NGINX, docs/lines/client.md), PR #388
## Resume
Done. §3.5's NGINX design amended in place on claude/report-plan; nothing else owed by this row.
## Result
Docs and theory, plus one local check on nginx 1.24.0 (Ubuntu's package, loopback, curl; not the image's 1.29).
Sources: nginx.org docs (6 Nov 2026, sha256 pinned in §3.5), nginx source release-1.29.8 and release-1.31.8,
docker-nginx d99174e2cecf, pkg-oss 743c6b8d8e16.
Found: the plan's log line spliced the body into escape=json and wrote invalid JSON (checked); now the body is a JSON
string beside $content_length, so a body nginx spilled to a temp file shows as n>0, r="" (checked).
Amended: client_body_early_read (nginx >= 1.31.5) reads the body with return 204 and no hop; on 1.29 the hop with
proxy_pass_request_body off (the proxy reads the body regardless, source); body 16 KiB in one buffer; a file per kind
(/report/load, /report/safety), unbuffered, a day per file; POST only; limit_req on load reports only; JSON only.
Left: unvalidated and unauthenticated; the 204 precedes the line (ngx_http_free_request logs after); the error log
names the client; no raise; the reader parses twice; 16 KiB cap.
Shared, reconciled with RECEIVER's advocate: kind in the path; the delivery cell counts sink records, never 204s.
Owner: whether the web image moves to nginx 1.31 mainline (early read) or keeps 1.29 and the hop.
