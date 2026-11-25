state: started
started: 2026-11-25T00:07Z
heartbeat: 2026-11-25T00:21Z
by: 6PvHHvpU
outputs: claude/phone-run-2 (docs/phone-rows/round-2.md §Review)
## Resume
Read: round-2.md, the harness diff 9180c0542..21c8102b0 (lab/devices, the ?budget seam). Worktree of origin/claude/phone-run-2.
Now: builds (dockerd; pip meson; ingest/tools.sh; client/decode/wasm/build/build.sh; client/transport/{wasm,ts}/build.sh),
then `lab/devices/round_headless.sh --round2` and a scratch variant with ?budget under the series (the window
exercised); check c914c7a76's resolution against unified; trace each cell to its page on claude/reviews-2026-11-28.
Findings go to round-2.md §Review on claude/phone-run-2.
So far (not yet pushed to the branch): unit tests pass (round 8/8, round_test OK, levers ok); my mutant M4 (viewer.js page
view drops `budget`) survives every unit test (the memory record's `window` is computed from the URL); cell M at w = 15
on dbts_b1-q8-g8 (G = 8) runs the window PR 446 found defective in the product, which round-2.md does not name.
round_headless.sh --round2 re-run 00:15-00:21: every claim holds (12 loads). Running review_window.sh --window.
Built: ingest/tools.sh, series-server, pack-series (wasm-pack absent: WASM transport client not built). Scratch, untracked:
lab/devices/review_window.sh --window (cell M at budgets 6 and 12 of 20 frames).
## Result
