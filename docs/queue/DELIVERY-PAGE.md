state: done
started: 2026-11-23T07:07Z
heartbeat: 2026-11-23T07:11Z
outputs: claude/reviews-2026-11-28 3819c3a2 (docs/decisions/delivery-per-link.md; docs/decisions/README.md index line; docs/lines/client.md); no PR (the pages' draft PR)
## Resume
Done. Next on this question: DECISION-PAGES-REVIEW (every -PAGE row).
## Result
From claude/delivery b8cd8c71 (DELIVERY-RUN, DELIVERY-VERDICT-REVIEW, no blocker), link-profiles.md, the route page.
Recommended: A + C1 (the view, the exact frame on request) on every link profile and device class; B not a default
for now (B fills first above G* 77-170 / 117-375 / 320-466 Mbit/s on dbts_b1 for entry/middle/premium, derived and
extrapolated past 90 Mbit/s; the route page's switch test first); C2 no (its exact series ends no sooner than B's, at
1.07-1.22x B's bytes); the next run records C1's ask -> last byte, registers a lossy-link model, moves the relay off
the decoding cores (pinned already, 52 VOIDs) and interleaves DELIVERY-FIT-ARM.
Measured on this host: B / A 1.65-3.85 on clean forms (host decode), 2.5-18.4 on CR/LTE/LOSS; C1 186-456 ms at short
round trips (model missed, +43..117 ms), 6.2-7.1 s at 800 ms (held). Lossy links carry no model.
Fixtures: dbts_a1/b1/c1 at Q 8 G 8, one 4-core container, software decode, Chromium 153, TUN relay <= 90 Mbit, no radio,
no US; the phone's cell 2 pending PHONE-READ-CODE-CHECK. Not provisional. Gate not run (docs only); check_links: the
page 0 unresolved (14 elsewhere, pre-existing); comment budget n/a (no code).
Owner: four yes/no in the page's §2 (1 yes, 2 no for now, 3 no, 4 yes).
