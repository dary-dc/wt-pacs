state: started
started: 2026-11-11 03:21
heartbeat: 2026-11-11 03:22
outputs: claude/demo-fixes-1 579206f0 (from claude/demo-fixes-0 36d286cd)
## Resume
Done: 579206f0 merges (--no-ff) demo-view-worker, demo-tests-mobile, demo-redteam, demo-review-blind into
claude/demo-fixes-1 (conflicts in demo-check.mjs and docs/lines/optimal-quality.md kept both sides).
Next, one fix per commit, test first: redteam 2-5 (client/viewer/pair-source.test.mjs, client/view/depth-cut.test.mjs),
redteam 1 (owner call: answer with evidence), blind C1-C3 (viewer.js; need a node seam or demo-check), C5
(lab/av1/tools/ingest_coded.py choices), S1 (av1.js docstring). Then add the two test files to scripts/gate.sh, gate,
draft PR into claude/core mapping finding -> commit.
Continue: git fetch origin; git checkout -B claude/demo-fixes-1 origin/claude/demo-fixes-1
## Result
