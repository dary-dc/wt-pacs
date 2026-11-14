state: done
started: 2026-11-14T21:16Z
heartbeat: 2026-11-14T21:22Z
outputs: claude/report-plan 60669a53 (docs/client/evidence/report-plan.md §3.2; docs/lines/client.md); REPORT-OPTIONS' PR
## Resume
Done: §3.2 amended in place by KEEPALIVE's advocate, one commit. Nothing next for this row.
## Result
Sources read at pinned revisions (Fetch 478609e29799, HTML 0793d3d8544e, Chromium 319b309ea895, Gecko c72617c01649,
WebKit 6e6e3c0776f0), quoted in §3.2. Theory and source reading only; nothing built or run.
* Chromium: "KeepAlive is not yet supported in web workers"; only the page's keepalive goes to the browser-held
  KeepAliveURLLoaderService (on by default). Gecko: page and worker keepalive go to the parent and survive the worker's
  end (refutes, at today's Gecko, the RUM SDK's Firefox claim; the kill cell still decides). WebKit: not traced.
* Design: safety report from the decoder worker at once, and from the page at each hide until its 204 arrives;
  reportId dedups; one retry on error. Load report from the page only, BEACON's hybrid/seq/pagehide adopted alike.
* Per-sender keepalive budget (Fetch's fetch group; Gecko per request in workers, 256/origin, 2048 total).
* Disadvantages left: Chromium worker send dies with the worker; hide send on the page thread; duplicates; Firefox <133.
* Shared-part proposals for all carriers: report constants in the workers' init message; reportId in the field list;
  a 204 only after the record is written (NGINX answers before logging, I); worker report time counted in the page cell.
