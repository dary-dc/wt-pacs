state: done
started: 2026-11-14T23:18Z
heartbeat: 2026-11-14T23:23Z
outputs: claude/report-plan efa7d09f (docs/client/evidence/report-plan.md §3.5 RECEIVER; docs/lines/client.md), PR #388
## Resume
Done. Amendments, disadvantages and shared-part proposals pushed in one commit; nothing pending.
## Result
* RECEIVER is its own Rust process from crates already in Cargo.lock (tokio, httparse, serde_json), in the server's
  image, behind the viewer's nginx (same origin, CSP unchanged); not the OpenTelemetry Collector (webhook receiver
  beta and unstructured, file exporter alpha and buffered, no field check), which stays a forward target.
* nginx buffers and caps the body; NGINX's log line, conditioned on a non-2xx status, keeps records while RECEIVER
  is down (unvalidated: stated).
* One report-fields.json; a field outside it dropped before the write with a warning; strings capped; UID-shaped runs
  in errors[].message scrubbed (PS3.5 §9.1). 204 after the write; sync_data for safety reports only.
* Join with the server's link record and dedup by reportId moved to read time, proposed for NGINX alike; files by UTC
  day; a daily byte cap on load reports, never on safety reports.
* Ten disadvantages left listed (a process to run, a second hop, the scrub a heuristic, the fallback unvalidated, ...).
* Docs only; no gate run (no code touched). Nothing measured; marks (S)/(R)/(I) as the plan's.
* Owner: whether the unvalidated fallback log is acceptable, and the daily cap's size.
