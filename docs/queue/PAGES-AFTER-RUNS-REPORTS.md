state: done
started: 2026-11-26T19:46Z
heartbeat: 2026-11-26T19:49Z
by: Cy2h4uoF
outputs: claude/reviews-2026-11-28 076b7c36c (docs/decisions/reports.md, README index line, docs/lines/coordination.md; PR 405, "do not merge")
## Resume
Done. Claimed at 19:46, 17 minutes after PAGE-RUNS-VERDICT-FIX-REVIEW's last push (step 4 asks 20); nothing moved
on claude/page-runs or claude/reviews-2026-11-28 in between. check_links.py: 17 unresolved, as before (0 new); gate
not run (docs).
## Result
reports.md read against page-runs.md §2 Results (as PAGE-RUNS-VERDICT-FIX corrects them, claude/page-runs 5fc1c372d)
and §Verdict review row 2; every change dated 2026-11-26, the old lines kept:
- §2: both reruns VOID by their A/A ((b) off 6, off' 8 of 18; (a) off' 1.053), so §6's rule names BEACON-Y, provisional.
- Item 3 now asks: rerun D5a busy alone, 18 rounds, with a race A/A written before its rows (yes, recommended);
  C not rerun (not measurable at this size on this host). Item 2 (Y) stays yes, provisional; item 4 gains SESSION's
  2-3 busy-page losses.
- New §2 "Read against the reruns": the race read beside (BEACON-* 9/18, KEEPALIVE-* 18/18), Lbusy counted (51 vs
  2.7-2.8 ms), C read beside (KEEPALIVE-Y° +3.9 ms, p 0.09), Firefox D1 and idle D5a counted, L VOID, D6 unrun.
- The page's own reading (labelled): §6's rule names no carrier if only (b) holds, so a rerun showing the race hands
  the carrier to the owner as measured.
- §4: five new limitations, each with what found it; Lbusy, D5a, Firefox entries corrected.
Fixtures and limits: the grey-16 frame x32 (not a demo volume), the fault bench's forced mismatch; one 4-core cloud
  container, no GPU; headless Chromium 158.0.8127.36, Firefox 160.0.1; loopback; no phone, no ultrasound.
Owner (for BRIEF-WEEKEND): D5a busy's rerun with a race A/A, yes or no (recommended yes); without it BEACON-Y stands.
