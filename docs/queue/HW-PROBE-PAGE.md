state: started
started: 2026-11-14T21:15Z
heartbeat: 2026-11-14T22:30Z
outputs: claude/hw-probe (from origin/claude/docs-client); PR to be opened by HW-PROBE-PAGE-REVIEW from docs/queue/HW-PROBE-PAGE-pr-body.md
## Resume
Built by the local session phone-tests in lab/devices/ (amendment 15): make_hw_units.py (units, run in the local rust
image with ingest's build), hw-units.json, hwdecode.js (D0's matrix, called from caps.js), hwdecode-worker.js (each
cell in a worker the page ends when a call blocks it), hwdecode_test.mjs (headless Chromium through collector.py,
mutants plane, expected, codec, unit, paint). Found headless: Chromium 141's copyTo({format: "I420P10"}) of a 10-bit
software frame blocks the calling thread, so the cell runs in a worker. Next: headless test green with every mutant,
README section, push, PR body file, then the phone run.
## Result
