state: done
started: 2026-11-15T14:16Z
heartbeat: 2026-11-15T14:49Z
outputs: claude/lossless-under-loss (PR 378, draft): e9a221e5 failing tests, 0d0f971c fix, the lab arm, docs/reviews/lossless-under-loss.md §Amendment 22, 3000ed23 line doc, d9ed9815 checks; PR body section "Re-scoped by amendment 22"
## Resume
Done. Next row: PHONE-FIX-378-REVIEW, by a session that wrote none of 378 or this fix.
## Result
* Amendment 22's scope: only a lost ask (transport deadline passed, session closed, resume spent) is asked again, once, 1 s later, while the reader stays; a refusal and a failed check never.
* The downloader marks the loss (`lost`), the consumer names it `AskLostError`, the controller re-asks only that. PR 378's 1-4-16 schedule replaced.
* Tests failing first (downloader, consumer, controller), 11 of 11 mutants killed; the lab rig's off arm needs no product lever; lab/lossless-under-loss/ stays in lab/, absence check green.
* scripts/gate.sh (full) OK in 664 s at 3d9d3cf1 (skips by name: numpy/pydicom, lavapipe, Xvfb/xdotool, Firefox, GL display, nginx); demo-check.mjs on dbts_b1-q8-g8 passed in both views (one series of one DBT volume, headless Chromium, software WebCodecs, a 4-core cloud host without a GPU).
* Theory, not re-run: the rig's 45 s blackout now ends on *Lossless check failed* at ~34 s, as with no re-ask.
* Owner decision: whether one re-ask is enough (an outage longer than the resume's budget still needs the reader's l).
