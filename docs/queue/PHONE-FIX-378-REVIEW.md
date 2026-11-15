state: done
started: 2026-11-15T15:17Z
heartbeat: 2026-11-15T15:33Z
outputs: PR 378 body, section "Review of amendment 22 (PHONE-FIX-378-REVIEW, 2026-11-15)", on d9ed9815; nothing pushed to claude/lossless-under-loss (the push to another row's branch was refused by this session's permissions)
## Resume
Done. Not pushed to claude/lossless-under-loss: the same section in docs/reviews/lossless-under-loss.md and one line in docs/lines/optimal-quality.md Open 16 ("reviewed 2026-11-15, no blocker; owed: one re-ask enough? an ask whose own dial fails, lost?"). A later firing with that branch's push, or the owner, adds them from the PR body.
## Result
* No blocker. The tests fail on e9a221e5's code: consumer 1, downloader 3, and the controller's does not end (the old loop reads a number as unbounded). All pass at d9ed9815 (controller 42/42).
* This review's own mutants: 11 of 12 killed. The survivor is equivalent: resume()'s `wanted` loop marks fill frames lost, and nothing reads that flag (downloader.js:452).
* No other path re-asks a refused or failed-check exact ask. The decoder's second decode, again() after a decoder crash and the cache read-back were there before this PR.
* scripts/check_lab_absent.sh OK. scripts/gate.sh --quick --no-browser OK in 282 s. Skipped: the browser steps (demo-check.mjs not re-run; the author's run is on 3d9d3cf1, docs-only commits since), numpy/pydicom, the ingest build, lavapipe, Xvfb, Firefox, nginx.
* Minor, theory: `closed` is read when the rejection is handled, so a refusal followed at once by the session closing gets one extra ask.
* Fixtures: unit tests with stand-in sessions and workers on one 4-core cloud host without a GPU. No browser, no link, and the blackout rig was not re-run.
* Owner decision: whether an ask whose own dial fails (downloader.js:696; `l` pressed after the session died) counts as lost and is asked again once. Today it fails at once, which is load 6's label. Also, as PHONE-FIX-378 asks, whether one re-ask is enough.
