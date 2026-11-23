state: done
started: 2026-11-23T09:30Z
heartbeat: 2026-11-23T09:40Z
outputs: claude/reviews-2026-11-28 dc09c6a5c..35d310e56 (docs/decisions/*.md, README.md §Fix and index, docs/lines/coordination.md); no PR (the branch's own)
## Resume
Done. Next: DECISION-PAGES-FIX-REVIEW, by a session that wrote none of the pages, the review or this fix; it reads
docs/decisions/README.md §Fix for each finding's commit. SYNC-RECONCILE-REVIEW (PR 417) still owed for B2.
## Result
* B1: frame-integrity.md and phone-decode-route.md read again under the owner's 2026-11-23 ~02:00 word. Items 1, 3, 5 and 6 of
  frame-integrity changed: state 1 describes the view; PR 368's digest covers software-decoded view frames only; "no view
  check" is named as option (d). Items 2, 4, 7 and 8 kept. Route items 6 and 9 kept as "no" with changed reasons: the 8-bit
  forms are moot, and the hardware view's 4:2:0 form waits for M5. Policy 4.8 added. Each page's §7 names amendment 1's reopen
  for the view.
* B2: pacs-sync.md item 3 says yes to PR 417 only after SYNC-RECONCILE-REVIEW finds no blocker.
* B3: final-state.md §5 says the status line leaves condition 2 unmet, and names usb_cine (lossy-sourced, so its numbers
  are provisional). unified-to-main.md says the same. "No US fixture" became "no US clip run" in five pages.
* m1-m12 fixed in place; m1 and m2 were re-counted from the rows and output.txt. m13 and the nits are not fixed, as the review said.
* Not checked: m6's quote of #223's source was not re-fetched. m8's 811 s and 477 s are not tied to a PR in their source.
* Docs only: nothing run, and the gate was not run. check_links shows 17 unresolved before and after, none on a changed line.
  The comment budget is ok.
* Fixtures: none touched. Every number came from the pushed rows and pages named in §Fix.
