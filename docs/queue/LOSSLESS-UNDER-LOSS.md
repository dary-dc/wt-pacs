state: started
started: 2026-11-12T09:11Z
heartbeat: 2026-11-12T09:15Z
outputs: claude/lossless-under-loss (not yet pushed)
## Resume
Branch claude/lossless-under-loss from claude/demo-fixes-2 (18d2d1ff), worktree ../wt-luloss. Read so far: PHONE-RUN.md,
claude/phone-rows raw/ (load 6 = beacon-wifi-8766 load abab2022, step 5; servers srv-4443/4444 logs: both sessions
"timed out" at 21:14:41, the exact one sent=10; counters.log: the fill's bytes all left by 21:14:12).
Theory so far: from ~21:14:11 no packet from the phone reached either server for 30 s; the ask (press ~21:14:26) never
arrived; no re-dial reached 4444 until the 22:20 rerun. Client paths: controller.showExact -> consumer ask ->
downloader ask -> FrameTimeoutError (15 s quiet) or closed -> resume() 5 dials -> fail "could not be re-dialled" ->
label "Lossless check failed". The exact downloader is not watched while idle (watch() returns, nothing owed).
Next: write docs/reviews/lossless-under-loss.md (theory), push; reproduction via lab/scripts/link_impair.py (blackout
after the fill, --loss 7), labelled simulated; then a failing controller test + fix (auto re-ask on a rejected exact
ask while the reader stays, bounded), mutate, gate, draft PR into claude/demo-fixes-2.
## Result
