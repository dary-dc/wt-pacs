state: started
started: 2026-11-18T18:16Z
heartbeat: 2026-11-18T19:47Z
outputs: claude/cache-arms 5b86cbb9 (per-arm picks), 1390db63 (pilot-chromium.json frozen), rows under lab/cache-arms/rows/chromium/; claude/cache-plan 3806262b (§8.8 amendment)
## Resume
Host: Chromium 153.0.8010.12 (Playwright's), 4 vCPU, 16 GiB. Worktrees /home/user/arms (claude/cache-arms), /home/user/plan
(claude/cache-plan), /home/user/ledger. Six cache-arms tests pass.
Done: 5b86cbb9 per-arm picks (test first, 2 mutants killed); §8.8 amendment (cache-plan 3806262b); Chromium pilot
(rows/chromium/pilot/, picks.jsonl): OPFS-SYNC whole frame; OPFS-ASYNC group=8MiB&inflight=3&read=sync; IDB none
(Gecko only); CACHESTORAGE inflight=3, buffered. A driver bug (the body step reused the inflight step's rows) was found
and the step rerun before freezing (f67b4c40, picks.jsonl's "void" line); frozen 1390db63.
Running since 2026-11-18T18:32Z: `bash lab/cache-arms/rows/counted.sh chromium` (cells in §8.6's order; a cell's rows go to
rows/chromium/<cell>.running, moved to .jsonl when whole; a .running found at start is kept as .partial, no bar).
A background job stops at 2 h: rerun the same command; it skips whole cells. Push rows by hand
(git add lab/cache-arms/rows; commit; pull --rebase; push).
Next after Chromium's cells: the mutants (§8.4, one round each per arm: drop-writes W/O, no-recheck K, slot-held L,
view-copy L S2, evict-newest E, tab-writes T: `--mutant NAME --rounds 1`), then Firefox 159 (pilot.sh firefox, then
counted.sh firefox; FIREFOX_PATH, Xvfb), then the WebKitGTK probe; §Results in cache-plan.md.
## Result
