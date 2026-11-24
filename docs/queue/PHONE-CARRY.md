state: done
started: 2026-11-24T10:27Z
heartbeat: 2026-11-24T10:31Z
by: r1GZWbx9
outputs: claude/reviews-2026-11-28 87e3867ba, b77ba07ba, 138b35022, a962ba03f (docs/decisions/phone-decode-route.md §8.1, header; docs/decisions/view-target.md header, §5.1, §6, §8; their index lines in docs/decisions/README.md; docs/lines/coordination.md); draft PR 405 ("do not merge"), no new PR
## Resume
Done. Next: PHONE-CARRY-REVIEW (a session that wrote none of this), findings in each page's §Review.
## Result
- Neither page carried a mark **provisional**: PHONE-READ, -FIX, -FIX-REVIEW, -CODE-CHECK, PHONE-READ-3D and its
  review were already in them (VIEW-PAGE, PHONE-ROUTE-PAGE, DECISION-PAGES-FIX); each re-read at its status file and
  claude/phone-run d0fca3589, and carried as it stands, dated.
- phone-decode-route §8.1: each open item's cell: 6, 9 and 7 → PHONE-ROUND-2's M5 and M17; 5, 8, 10 → §Middle-band
  phone (MIDDLE-PHONE-RUN, the owner's account); the exact frame's 216.5 ms against 80-130 predicted is asked by no
  cell of PHONE-ROUND-2-PREP's brief (named for that row).
- New, **theory from the code, not run**: the round's code (claude/unified since UNIFIED-SYNC-1124, PR 435) bounds the
  view to 15 frames on dbts_b1 and, with no cache, the fill to them (controller.js #fillSize); the round page's
  fillFailure (claude/phone-run lab/devices/round.mjs) fails a load with fewer than frameCount frames. So cells 2 and 3
  fail as written on claude/phone-run-2, and a passing fill is not the 11-22 one; unified has no lab setting for the
  bound's two sizes PHONE-ROUND-2-PREP asks. Its dry run decides it. view-target §6 says the same for cell 3's steps.
- view-target: PRs 434, 435 marked merged; §5.1's bound row cites IMPROVE-1 candidates.md §2 (the window cuts groups).
- Limits: nothing run but git reads and check_links (17 unresolved before and after); no phone; fixtures as the pages
  state (one phone, one home Wi-Fi, one evening; dbts_b1, dbts_a1's cut; no breast US clip on a phone).
- Owner decision: none new; for PHONE-ROUND-2-PREP, lift or size the bound for the round's fills (a lab setting).
