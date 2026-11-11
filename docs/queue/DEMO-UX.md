state: done
started: 2026-11-11T14:41Z
heartbeat: 2026-11-11T15:46Z
outputs: claude/demo-ux 14605f41, draft PR #365 into claude/demo-fixes-1
## Resume
Done. Nothing to resume.
## Result
DEMO-UX done: claude/demo-ux at 14605f41, draft PR #365 into claude/demo-fixes-1.
Merged --no-ff: #360, #362 (demo-check.mjs conflict: kept #362's paint check and FIX-1's view check), #359 (with
PHONE-AMEND) and #356.
1 label in colour: Optimal quality green, ✓ Lossless blue, failed red, words beside the colour (screen.js labelOf).
2 tap on the label or status line unfolds the whole status line, wrapped; desktop unchanged (Pixel 7 check).
3 stored form off the show list (STORED_FORM=1 keeps it); dav1d checked via the lab's refuseWebCodecs on 10-bit series.
4 SLICE-TOUCH's slice slider (viewer/slider.js), both views; demo-check makes the far jump with it.
5 client/README.md's "exact" sentence corrected in place.
Each change has a failing test first; every mutant was killed, unit and Chromium.
README loop, 18 series + 2 --refuse-webcodecs runs, x {page, worker}: 40 of 40 passed. Headless Chromium on one
4-core cloud host, no GPU, no phone; three DBT volumes of one dataset.
Gate OK (skipped: lavapipe, Firefox and the cross-codec arm, nginx).
Note: two commits briefly carried a decoder rebuild's in-flight files; 8e572058 restores them (no force-push).
Owner: the slider and the tap are untried on a phone; the phone run decides whether every slice is reachable.
