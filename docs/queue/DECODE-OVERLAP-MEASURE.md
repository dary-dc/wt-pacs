state: started
started: 2026-11-25T06:17Z
heartbeat: 2026-11-25T06:35Z
by: 8rHJATFk
outputs: none yet
## Resume
Standing review done (findings.md to follow): PR 447's three new tests each fail with their file reverted to the tip;
cccac3363 is caught by the dispatch rig (788/789), cfb7c6a04 by client/decode/depth-cut.browser.mjs (2 failed).
Rig and predictions pushed: docs/queue/DECODE-OVERLAP-MEASURE/ (README.md, bench.js, run.mjs, rounds.sh).
Running: rounds 0-5 (one Williams period of the three arms), rows.jsonl pushed after each round.
Resume a cut run: worktrees /home/user/tip (origin/claude/unified b059388b6), /home/user/branch
(origin/claude/decode-overlap 59605e6e0), series in /home/user/series by /home/user/series/make.sh (README.md); then
docs/queue/DECODE-OVERLAP-MEASURE/rounds.sh <next round> 6. Then: summary.mjs (medians per cell and arm, A/A first),
findings.md, PR 447's body, the line doc.
## Result
