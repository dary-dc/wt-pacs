state: done
started: 2026-11-23T08:27Z
heartbeat: 2026-11-23T08:32Z
outputs: claude/reviews-2026-11-28 c8ff9a96c (docs/decisions/view-target.md; docs/decisions/README.md index line; docs/lines/client.md)
## Resume
Done. Nothing run. Claimed at 08:27, about four minutes inside the 20-minute settle of PHONE-READ-3D-REVIEW's push
(08:11); that row was done and its inputs did not move after.
## Result
* Page written from pushed results only: claude/phone-run d0fca3589 §Cell 3 and §Cell 3 review (no blocker), the cloud
  evidence (view-worker-start.md, view-worker-under-a-busy-page.md), MEMORY-LEAK-TRACE §Result, simplify-fable.md P5/P6.
  Not provisional: every row of the question is done; the 52 ms guard stays an assumption and the verdict does not turn on it.
* Deciding measurement: busy cine on the phone, worker 0 drops against the page's median 7 of 100, 24 of 24 pairs;
  every other measure no difference shown; first picture +8.6 [-4.2, +27.1] ms with the worker WITHOUT the start's fix
  (the plan's URLs carry no lab setting, derived).
* Fixtures and limits: one phone, one home 5 GHz Wi-Fi, one evening, dbts_b1-q8-g8 only, a synthetic busy page, a fresh
  Chrome per load (m1, m3); cloud: 4-core hosts, headless Chromium 153 and Firefox 155, no breast ultrasound; Safari never run.
* check_links: 17 unresolved, all pre-existing (none in the page); comment budget passes; docs only, gate not run.
* Owner decisions (view-target.md §2): (1) view worker the default, page view a lab arm: yes; (2) P6, the start's fix
  the one order, four settings removed: yes; (3) P5, the page view removed: no for now, after PHONE-ROUND-2's cell 3 under
  one condition, the Safari probe and the phone's memory after worker loads; (4) PHONE-ROUND-2 cell 3 under one
  condition with the fix and a first-picture field: yes; (5) the open table blocks nothing: yes.
