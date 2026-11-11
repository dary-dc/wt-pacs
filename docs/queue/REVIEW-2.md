state: started
started: 2026-11-11T16:25Z
heartbeat: 2026-11-11T16:29Z
outputs: claude/demo-review-2 (from the demo tip claude/demo-fixes-1 daee0d1d); findings in docs/reviews/review-2.md
## Resume
Done on claude/demo-review-2 (docs/reviews/review-2.md): §1 FIX-1 reverted fix by fix, all load-bearing (e084d574);
§2 docs claims vs rows, one minor docs finding D1 (3f0e2266). #364: checkPair fix 8e7027a5 reverted fails both pair
tests; mutants M1-M3 of its rule killed (not yet written up). In progress: ingest/tools.sh building (BUILD=ingest/.build
in a worktree of origin/claude/source-fingerprint) to revert 64a42e19 against lossy_test.py / end_to_end_test.py.
Next: §3 #364, §4 #365 (DEMO-UX, five commits; node tests then Chromium), §5 claude/demo-clean's removals
(trees byte-identical to the named line-branch commits; gate claim), then result, PR? none (findings only, no base named).
## Result
