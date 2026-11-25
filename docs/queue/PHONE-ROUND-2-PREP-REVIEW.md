state: done
started: 2026-11-25T00:08Z
heartbeat: 2026-11-25T00:41Z
by: 6PvHHvpU
outputs: claude/phone-run-2 245fb9cc3 (round-2.md §Review), 5a4532dcf (docs/lines/devices.md); claude/work-ledger docs/queue/PHONE-ROUND-2-PREP-REVIEW/ (the variant's scripts, claim logs); PHONE-ROUND-2-PREP-FIX and -FIX-REVIEW appended to docs/queue-2026-11-24.md
## Resume
Done. PHONE-ROUND-2-PREP-FIX next, by another session; PHONE-ROUND-2 waits on its re-review.
## Result
* Re-run: round_headless.sh --round2 at 21c8102b0, every claim holds (12 loads, 6 min 14 s); unit tests pass.
* The round's code is unified's tip (unified unmoved since b059388b6; controller.js differs by PR 378's re-ask only).
* Each cell traced to its page (round-2.md §Review's table); the asks not carried are §5's, plus the exact frame's 216.5 ms (n1).
* Variant (cell M at budgets 6 and 12 of 20 frames): each load fills exactly its window, worker and page (measured).
* B1: cell M at w (15 frames, G = 8) runs the window PR 446 found defective in the product; the plan does not name it.
* m1: the memory record's window is the URL's: mutant M4 (viewer.js drops the page view's budget) passes every unit test
  and the round's claims; only the variant's count catches it (page 12:20, 6:20). m2: length ~1 h 21 min. n1 above.
* Mutants M1-M3 (sameRenderer relaunch, cell 3 budget, cell M steps) each fail a test.
* Fixtures and limits: synthetic 10-bit pair 64x48, 20 frames; one 4-core cloud container, headless Chromium, no GPU,
  fake adb, no phone, no radio; the window on dbts_b1-q8-g8 not exercised (theory); the gate not re-run (the prep's cited).
* Owner decision: none.
