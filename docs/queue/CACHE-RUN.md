state: started
started: 2026-11-18T18:16Z
heartbeat: 2026-11-18T23:59Z
outputs: claude/cache-arms 5b86cbb9 (per-arm picks), 1390db63 (pilot-chromium.json frozen), rows lab/cache-arms/rows/chromium/ (18 whole cells by 2026-11-18T23:35Z: R-busy S3 d6ebc18d; R-idle x4, O x2 to b2d31da1); claude/cache-plan 3806262b (§8.8 amendment)
## Resume
Resumed 2026-11-18T22:17Z by a new session (stalled since 20:32Z): R-busy S3 next, as below. Chromium-1243 here prints 153.0.8010.12 (matches §8.8). R-busy S3 whole 22:37Z (51 rows, d6ebc18d). R-idle x4 and O x2 whole by 23:35Z (b2d31da1). B's first try cut at 23:44Z by a container restart (kept .partial, counted in no bar); B, E, K, Q, T, P rerun in one job that starts no cell after 60 min
(scratch batch.sh: counted.sh per cell, commit and push after each). Cells may also be run one a job:
`bash lab/cache-arms/rows/counted.sh chromium <cell-name>` (its substring), so the 2 h limit never cuts a cell mid-way.
Host: Chromium 153.0.8010.12 (Playwright's), 4 vCPU, 16 GiB. Six cache-arms tests pass.
Done: 5b86cbb9 per-arm picks (test first, 2 mutants killed); §8.8 amendment (cache-plan 3806262b); Chromium pilot
frozen 1390db63 (OPFS-SYNC whole frame; OPFS-ASYNC group=8MiB&inflight=3&read=sync; IDB default; CACHESTORAGE
inflight=3, buffered; a driver bug found and its step rerun before freezing, f67b4c40). Counted Chromium cells whole,
pushed: L S2 1x (12 rounds), L S1 1x, L S3 1x, L S1 4x, L none S2 4x and S3 4x, W S1/S2/S3, R-busy S2.
Cut: R-busy S3 at 26 rows (20:32, the container's 2 h background limit; this session's job had the longest
timeout, so not restarted here); kept as rows/chromium/R-busy-3328-1x.partial-2032Z.jsonl, counted in no bar.
To resume (fresh container): worktree of claude/cache-arms; `cd <it> && bash lab/cache-arms/rows/counted.sh chromium`
(it skips whole cells, starts at R-busy S3; Chromium as Playwright bundles it, check it prints 153.0.8010.12 in the
settings line or amend §8.8 first). Push rows by hand every 15 min (git add lab/cache-arms/rows; commit;
pull --rebase --autostash; push). Each run of counted.sh < 2 h; rerun it until it does nothing.
Then: the mutants (§8.4, one round per arm: --mutant drop-writes on W and O, no-recheck K (2 rounds), slot-held L,
view-copy L S2, evict-newest E, tab-writes T), Firefox 159 (pilot.sh firefox, counted.sh firefox; FIREFOX_PATH, Xvfb),
the WebKitGTK probe; then §Results in cache-plan.md (claude/cache-plan), each cell against §8.3's prediction.
Early readings (not the verdict): L S2 passes only OPFS-ASYNC; OPFS-SYNC and IDB fail on PSS alone (median growth 123
and 1 248 MiB vs none 25); L S1 4x: no arm passes (PSS; IDB also delivered rate); none S2 4x misses 1.3 % (not
saturated, unlike the last round), S3 4x 6.5 % (saturated: claims nothing); W S2 all pass (OPFS-SYNC ~2 400 MB/s, A/A
within 6 %); R-busy S2: OPFS-SYNC 10/10, OPFS-ASYNC 9/10, IDB 7/10, CACHESTORAGE 0/10 rounds within the bar.
## Result
