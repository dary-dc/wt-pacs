state: started
started: 2026-11-11 01:35
heartbeat: 2026-11-11 02:50
outputs: claude/av1-corrections 0bb65c3f
## Resume
Done: step 1 pushed (2e4efdfc: docs/av1/corrections.md, docs/lines/codecs.md in place). Step 2 pushed (0bb65c3f: docs/av1/audit-protocols.md, codecs Open 00, av1 README). Next: gate (--quick --no-browser, docs only), draft PR into main, result.
Branch claude/av1-corrections from origin/main 017a3ca6 (local only so far). Plan:
1. docs/av1/corrections.md: per study branch (the table in claude/docs-lines-3:docs/lines/codecs.md §AV1 harvest (2)),
   the line as it stands quoted and the corrected text to put in its place (disk-access §11 model); main's own
   docs/lines/codecs.md corrected in place (0.07–0.22, 1.05–2.04, "G saves almost nothing", σ estimator).
2. docs/av1/audit-protocols.md: three pre-registered protocols, theory only: (A) quality F4 noise kept, σ_out ÷ σ;
   (B) quality F1 one bar at the estimator's resolution, integer-Q arms G 1 / G 16 (F2+F3 already pre-registered in
   claude/av1-groups-settings:docs/av1/groups.md §Settings amendment, S2 owed: point, not duplicate);
   (C) decode audit's three in one interleaved block (cores-capped 4x, back() off the clock, product HTJ2K unit).
3. docs/lines/codecs.md Open line; draft PR into main.
## Result
