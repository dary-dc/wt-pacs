state: done
started: 2026-11-26T18:18Z
heartbeat: 2026-11-26T18:26Z
by: UECSGNPd
outputs: claude/reviews-2026-11-28 af382df6d, cb328c103, 31908ee45, 715c9a0a2, 509831114, 467abe631 (PR 405, "do not merge"); the reports page split off as PAGES-AFTER-RUNS-REPORTS in docs/queue-2026-11-24.md
## Resume
Done. Five pages read against the verdicts and corrected in place, dated "2026-11-26, PAGES-AFTER-RUNS"; README's
five index lines, docs/lines/coordination.md, README §Pass re-review's r-m1 (transport-stack), r-n1 (pacs-sync), r-n2
(pcs-note). `reports` waits on PAGE-RUNS-VERDICT-FIX-REVIEW (its fix not before 19:00), so it is a row of its own,
PAGES-AFTER-RUNS-REPORTS (appended; BRIEF-WEEKEND needs it), rather than a stalled row every worker would re-take.
Claimed at 18:18, 17 minutes after PAGE-RUNS-VERDICT's last push, not the procedure's 20; that review freed the five
pages ("may go from this review now"). check_links.py: 17 unresolved, as before; comment budget ok; gate not run (docs).
## Result
Read against DELIVERY-VERDICT-2 (+ re-review), SESSION-COST's verdict re-review 2 and PAGE-RUNS-VERDICT §1, §3–§5:
- delivery-per-link: recommendation stands; a view is needed on every lossy and long-RTT profile and below G*, not above
  it, nor where frames exceed the viewport (FIT first on dbts_b1); "no view needed" not found; C1's excess after the last
  byte; the curve holds LTE's wire, no LTE fill carries; lowest session cost A (a1, c1), FIT (b1), B dearest.
- transport-stack: item 2 done; item 1 kept, both of §1's rules stated; #39 now yes (a build row); #96 held; CR not the cap.
- engines: G = 8 failure is the client's layouts(); item 2 replaced by that fix; items 3, 4 done; ring misses the fill bar
  on Firefox 160.0.1 (x1.241), memory held; contradiction 6 closed.
- asking: P1 holds (behind first 0.4-1.2 s a leg under centred); P1b cannot decide; controls refute the model's mechanism.
- cache: Chromium only, provisional (CACHE-DESIGN-1124 never ran, Firefox unrun); the cache stays off.
Fixtures and limits: as each run's (three DBT volumes of one dataset, synthetic sets for engines and cache, one 4-core
cloud container, headless Chromium 158 / Firefox 159.0.1-160.0.1, a userspace relay, no radio, no ultrasound measured).
For BRIEF-WEEKEND's table: #39's build row (yes, recommended); behind first's build row (yes, provisional); choice 2 of
frame-memory-ownership.md for Firefox (the owner's lever 2); a FIT default where frames exceed the viewport is named,
not asked.
