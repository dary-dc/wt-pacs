state: done
started: 2026-11-12T09:11Z
heartbeat: 2026-11-12T09:54Z
outputs: claude/lossless-under-loss ffc407de, draft PR 378 into claude/demo-fixes-2
## Resume
Done. Nothing to resume; PHONE-FIX-REVIEW reviews PR 378.
## Result
* Theory (docs/reviews/lossless-under-loss.md): after load 6's fill no packet from the phone reached either server
  for 30 s (both sessions timed out together, the exact one at sent=10): the ask never arrived, no re-dial arrived;
  the downloader failed the ask after its resume's 5 dials, and the label called it "Lossless check failed" with
  nothing asking again. Why the phone's UDP went silent is not shown.
* Fix (client/view/controller.js): a lost exact ask (rejected, no frame) is asked again after 1, 4, 16 s while the
  reader stays; a failed check is not. Failing tests first (1a84e38e); 6 mutants killed.
* Reproduced, simulated (lab/lossless-under-loss/, link_impair.py 7 % loss + 45 s blackout, headless Chromium 153,
  4-core cloud host): re-asks off 3/3 failed at 28.2 s; on 3/3 Lossless at 58.1-58.7 s. One rig, 3 rounds per arm.
* Gate full OK (585 s), skips named in the PR (Python venv, lavapipe, Xvfb, GL, Firefox, nginx).
* Owner decisions: the schedule; a separate label for a failed fetch; server keep-alive below 15 s; the beacon
  carrying the failure's reason.
