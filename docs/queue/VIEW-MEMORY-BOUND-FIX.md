state: done
started: 2026-11-23T05:28Z
heartbeat: 2026-11-23T05:53Z
outputs: claude/view-memory-bound dd3197034, 670b7613a, c15b0d482; PR 435 body §VIEW-MEMORY-BOUND-FIX
## Resume
Done. Next: VIEW-MEMORY-BOUND-FIX-REVIEW by a session that wrote none of PR 435 (findings in its body §Re-review).
## Result
* B1: with no cache, the want and the page view's fill stop at the memory window (wantFrom's w = the store's budget):
  exactly the frames farthest-first eviction keeps, nearest first (ahead first under waitAhead); with a cache, the whole series.
  Worker view, 10 frames, budget 4, five steps: wants 0,1,2,3 then 4,5,6,7, each kept on arrival (was 30 frames re-asked).
* m1 colour test (640x480x3: 291 at 8 and 16 bits); m2 design.md/html corrected (the sentence, not the code, was wrong);
  m3 W_min not built, why said; m4 the PR body's claims corrected in place.
* The gate caught metadata without width/height giving a NaN window (one frame filled); now unbounded, tested.
* Mutants: 7 killed; viewer.js's fill back to the whole series survives (no unit test reaches the page's connect).
* Gate OK at c15b0d482 (620 s); skipped: native painter/window, cross-codec arm and Firefox, web host (no nginx).
* Fixtures: unit tests on synthetic frames, the gate's 3-frame grey series in headless Chromium; no series over its
  window run in a browser or device; dbts_b1's 35-of-50 saving derived.
