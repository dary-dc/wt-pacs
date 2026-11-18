state: done
started: 2026-11-18T19:16Z
heartbeat: 2026-11-18T19:19Z
outputs: claude/report-plan e193769c (report-plan.md §Verdict review), 62c89dda (design.md §Open, lines/client.md); its existing PR
## Resume
Done 2026-11-18T19:19Z. Nothing owed by this row.
## Result
Every count of §Results recomputed from claude/report-arms 110695ca rows: all 81 unit × ending cells agree, balanced, no error, CPU ≤ 19 %.
Rule §7.5 on Chromium, cell D only (provisional: L, C, Y, R unbuilt; D6 not run):
* Pass: BEACON-H/Y, KEEPALIVE-H/Y. Fail: SESSION-1/Y (D8 safety 0/18), SESSION-H (D8 safety; D1, D7 load).
* Rank: the Y arms 72/72 fill records over D3–D5b against the H arms' 36/72; BEACON-Y vs KEEPALIVE-Y not decided.
* Rule 3 (safety carrier) not decided: run.mjs times D5's kill from the page's send (rig.safety), not the mismatch,
  so D5a's 18/18 never tested the race. Receivers not decided (cell R unbuilt).
* Loser's question: floors unmeasured; SESSION's D8 loss is the design's (an HTTP fallback would make it another arm).
* §5: at once delivered 972/972 for HTTP carriers; at once vs at the end not compared; the server's reaction unmeasured.
Fixtures and limits: Chromium 153 headless, loopback no relay, the rig's grey-16 32-frame series, one 4-vCPU container.
Owner decisions: telemetry stays off; whether to build D5 retimed + L, C, Y (and R, D6, Firefox, WebKitGTK) next.
