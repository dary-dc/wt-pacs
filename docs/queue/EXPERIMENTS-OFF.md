state: started
started: 2026-11-11 15:38 UTC
heartbeat: 2026-11-11 16:05 UTC
outputs: claude/demo-clean (from the demo tip claude/demo-fixes-1 daee0d1d); no PR
## Resume
Inventory read (main...daee0d1d: 313 files, +32 002). claude/demo-clean pushed at daee0d1d, nothing removed yet.
Findings so far: lab/target-review, lab/recv-loop, lab/opfs-arms, lab/native-fill(+lab/scripts/native_cache_cells.sh)
have no product or gate reference; lab/av1/decode's 38 files are byte-identical on claude/av1-unified-mainbase
(8 links in docs/decode/README.md to pin); lab/paint-read has one gate line (112); lab/frame-clock is imported by
lab/viewer/levers.js (not removable alone); lab/opfs-cache is imported by client/paint/settle-check.mjs (gate 138).
client/native: product of the native line (docs/lines/native.md), not on the demo path.
Next: docs/reviews/experiments-off.md, then one removal commit per item, then scripts/gate.sh.
Continue: git fetch; git checkout claude/demo-clean; git log origin/claude/demo-fixes-1..; read the doc's table.
## Result
(pending)
