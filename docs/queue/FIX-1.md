state: started
started: 2026-11-11 03:21
heartbeat: 2026-11-11 03:26
outputs: claude/demo-fixes-1 fdbf8f89 (from claude/demo-fixes-0 36d286cd)
## Resume
Done (claude/demo-fixes-1): 579206f0 merges demo-view-worker, demo-tests-mobile, demo-redteam, demo-review-blind;
c6d13a48 red team 3 (controller refuses a cut frame not at 10 bits); then red team 5 (dot ids), 4 (16-hex digest per
frame), 2 (photometric/rescale/perFrame compared), 1 (framesSha256 required on both; evidence: fetch_data.py:164
writes it, ingest_coded.py copies set metadata into both) — the last at fdbf8f89. pair-source and depth-cut tests pass.
Next: blind C5 (ingest_coded.py --codec choices, a check in ingest/coded-frames/lossy_test.py), C1-C3 in viewer.js
(mark under a label, lossless failure cleared from the status line, overlay without the lossy series' Q/G on a
lossless frame; checks via demo-check.mjs or a node seam), S1 av1.js docstring; add pair-source.test.mjs and
depth-cut.test.mjs to scripts/gate.sh; docs/lines/optimal-quality.md line; gate (setup README §Prerequisites +
ingest/tools.sh building in background); draft PR into claude/core.
Continue: git fetch origin; git checkout -B claude/demo-fixes-1 origin/claude/demo-fixes-1
## Result
