state: done (two blockers open; amendment 17 rows DELIVERY-BUILD-FIX and -FIX-REVIEW appended)
started: 2026-11-21T08:46Z
heartbeat: 2026-11-21T08:54Z
outputs: claude/delivery ffbdccf3 (docs/reviews/delivery.md; docs/lines/client.md), PR 406; docs/queue-2026-11-14.md §Rows and §Briefs (the two FIX rows; DELIVERY-RUN now needs the re-review)
## Resume
Done. Next: DELIVERY-BUILD-FIX (not before 11-21 12:00, latest 11-22 20:00), by a session that wrote none of the
protocol, the build or this review; then DELIVERY-BUILD-FIX-REVIEW; DELIVERY-RUN waits on it.
## Result
Reviewed claude/delivery 32364cae against delivery-comparison.md §1–§10 (scope: the build's commits and 7ab1ea70).
Holds: the arms as §1 (A/A′ same parameters, the arm label only), every clock ending where §5 says, the model as §4.1,
the forms as §3, K1 and K3 on the same bytes; absence check green; four unit suites pass; 24 of 32 mutants killed.
B1: LTE's 30 s blackout timer starts with the load, so 14 of 15 smoke loads had no blackout inside any clock; rows do
not record blackouts; K3's runner (9fad9d9b) has the same timer.
B2: under 8 counted rounds a cell prints "MISSES in", the words of a measured miss; the smoke's guard voided 8/15 CLEAN
and 5/15 PUB loads, so the decode side would read missed on every CLEAN and PUB cell.
Minors m1–m7: C1 presses 1.1–2.8 s after its fill, not 1 s; decoder read-back only ">2" and view fill only; C1's ask →
last byte not recorded; no tool writes --pilot-medians; the A/A input cannot yield worse/better; §3's constants and two
model choices unpinned by tests (the 8 surviving mutants).
Not run: the driver, K2, K3, §10's driver mutants (need the coded series and full Chromium); the gate (docs only);
check_links 0 unresolved.
Fixtures: the 75 smoke rows (one uncounted round a cell; dbts_a1/b1/c1 Q 8 G 8 and HTJ2K; one 4-core container,
full headless Chromium 153, software decode, TUN relay <= 90 Mbit, no radio); nothing measured here.
Owner: none new; the guard's VOID share (B2) is the build's open question, now with its consequence named.
