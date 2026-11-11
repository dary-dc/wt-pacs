state: started
started: 2026-11-11 02:03 UTC
heartbeat: 2026-11-11 02:21 UTC
outputs: claude/demo-e2e-2-fixes 268545f2 (from claude/demo-fixes-0 36d286cd)
## Resume
Done: fresh clone /home/user/fresh (not persisted) of claude/demo-fixes-0 36d286cd; README §Demo Once block ran as
written (meson from pip, preinstalled Playwright 1.63 via NODE_PATH=/opt/node-tools/node_modules); demo-series.sh
658 s, bytes as recorded. Pushed docs/reviews/demo-e2e-2.md (268545f2). Running: the "Before the demo" loop over
20 series (/home/user/loop.sh). Next: mutate demo-check.mjs (cert renewal first: a cert ending within a day, renewal
removed vs kept), then the drafted Lossless-with-exact-paint check (static finding F1) with a mutant that writes
Lossless before the exact paint; draft PR into claude/demo-fixes-0. On resume in a new container: re-clone, re-run
the Once block, then continue from the review doc.
## Result
