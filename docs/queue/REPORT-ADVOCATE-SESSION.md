state: done
started: 2026-11-14T23:17Z
heartbeat: 2026-11-14T23:23Z
outputs: claude/report-plan 8e1e0f0b, f97642b9 (docs/client/evidence/report-plan.md §3.3; docs/lines/client.md); REPORT-OPTIONS' PR
## Resume
Done: §3.3 amended in place by SESSION's advocate; line doc updated. Nothing next for this row.
## Result
Sources read at pinned revisions (WebTransport 5287ff36f135, WT-over-HTTP/3 draft-17, HTML 0793d3d8544e, Chromium
319b309ea895, Gecko c72617c01649, WebKit 6e6e3c0776f0, BCD 69fcf3608174), quoted in §3.3. Theory and source reading
only; nothing built or run; docs only, so no gate run.
* Design: the downloader worker owns the session and spawns the decoders, so the safety report goes decoder -> parent
  -> stream with no page hop; a bidi stream per record, the server's one-byte ack after its append (the spec: write's
  promise "does NOT necessarily mean that the chunk is acked"); records held until acked and resent on the next
  session; the load report at once, deltas batched per second; timings run: at once, hybrid, at hidden.
* Disadvantages left: nothing outlives the document (WT-H3 §6 resets every stream; Chromium Dispose, Gecko
  ActorDestroy, WebKit bfcache suspend all terminate); worker cleanup undefined in the spec; two hops at hide; a load
  whose session never opens reports nothing; link and report fail together; no sendOrder on Chromium; a wire change
  and a receiver in the frame server; WT stream limits not traced.
* Shared-part proposals for all: a sink contract of "one record in, one ack after append" with HTTP and stream
  bindings; the server as a third receiver row; one field-list file for JS and Rust; a delivery row for a failed dial.
