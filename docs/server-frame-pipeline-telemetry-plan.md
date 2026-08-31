# Plan: server Tap schema vs client frame-pipeline contract

**Status: deferred.** Attachment seam is done
([`adr-server-frame-sink.md`](adr-server-frame-sink.md)). Unifying the **report
schema** (`server_work_us` / `server_serve_us` ↔ client stages) is a separate
product decision and is **not** approved.

Until then: lab harvests keep independent `telemetry-server.json` and
`telemetry-client.json`. No join file. Do not implement schema migration from
archived drafts on this branch’s history.
