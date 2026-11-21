state: done
started: 2026-11-21T12:46Z
heartbeat: 2026-11-21T12:48Z
outputs: claude/engines e83b3457 (docs/decode/engines.md, docs/lines/client.md); PR 410 body §ENGINE-REVIEW-FIX
## Resume
Done. Nothing left for this row. Next: ENGINE-REVIEW-FIX-REVIEW (a session that wrote none of PR 410).
## Result
B1: engines.md rows 1, 6, 7, 11, 12 and the "So" corrected in place, each dated 2026-11-21 with its old text quoted:
Firefox dispatch 764/781 (160.0.1, twice), 763/781 (159.0.1); Chromium draft-02 by default 153-160, -07 behind a
flag only; Firefox reports measured at D1; Chromium getStats absent 153/158/159, present 160.0.8173.0; Firefox row 1
carries the G = 8 WebCodecs failure, a precondition on any 4:2:0 form. Numbers checked against engines-smoke/ rows.
m1-m4: sources re-fetched at the matrix's pins and quoted verbatim (BCD getStats note, stale; 160.0.8173.0 named
pre-release; WebKit WebTransport runtime-gated on 26, unconditional from 27, E6/E7 extended; createWritable's two
settings, E13 extended). Docs only: check_links 0 unresolved, comment budget ok; gate not run.
Fixtures: ENGINE-SMOKE's (one 4-vCPU container, no GPU, dbts_a1 only, one round, no Safari, no phone); nothing re-run.
Owner: nothing asked; ENGINES-PAGE waits on the re-review.
