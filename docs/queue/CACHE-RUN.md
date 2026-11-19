state: done
started: 2026-11-18T18:16Z
heartbeat: 2026-11-19T07:56Z
outputs: claude/cache-arms e988f9c6 (rows: chromium/ and firefox/ 23 counted cells each, mutants/, webkitgtk/probe.jsonl; counted.sh, mutants.sh, webkit-probe.mjs, results.py, <engine>/results.md); claude/cache-plan 3806262b (§8.8), 72033eb9 (§9 Results; docs/lines/client.md); no PR (branches have theirs)
## Resume
Resumed 2026-11-18T22:17Z by a new session (stalled since 20:32Z): R-busy S3 next, as below. Chromium-1243 here prints 153.0.8010.12 (matches §8.8). R-busy S3 whole 22:37Z (51 rows, d6ebc18d). R-idle x4 and O x2 whole by 23:35Z (b2d31da1). All Chromium counted cells whole 00:45Z (b8d5fe59). Now the Chromium mutants: `bash lab/cache-arms/rows/mutants.sh chromium`
(rows/chromium/mutants/, one round per arm, K two; reruns skip whole ones). Caught by 01:05Z in all four arms:
drop-writes on W and O (exact false), no-recheck on K (round 1 exact false, damage unreported). A second container
restart at ~01:00Z cut slot-held-L (kept .partial); rerun. All seven Chromium mutants caught in all four arms by
01:42Z (a63f23e9): slot-held delivered false; view-copy delay p99 bar 0/1; evict-newest sets false; tab-writes
readerWroteNothing false. Now Firefox 159: tarball from ftp.mozilla.org releases/159.0 (sha256 matches its SHA256SUMS),
unpacked at /home/user/ff-dl/firefox (redo after a restart); pilot: `FIREFOX_PATH=... xvfb-run -a bash
lab/cache-arms/rows/pilot.sh firefox` (resumable), Firefox pilot frozen 02:00Z (4895e2bf;
same picks as Chromium). Now counted.sh firefox under xvfb-run, cells in batches (scratch batchff.sh: L, W first).
Firefox whole by 04:15Z (bee177b9): L (all six), W (three), R-busy S2. Then R-busy S3, R-idle S2/S1/S3 whole by 05:17Z (f20e26b6). Then R-idle S1 4x, O x2, B whole by 06:40Z (afe320fb). Then E, K, Q, T, P by 06:59Z (5f5ea7ad): all 23 Firefox cells
whole. Firefox E and Q: the quota lever does not hold (Gecko fixedLimit), so not run (§8.6), named; K CACHESTORAGE 2 errored
rounds (null `written`); T CACHESTORAGE 4/4 rounds a navigation timeout; P OPFS arms SecurityError in the private window.
Firefox mutants 07:43Z (12d24ae1): caught but tab-writes on OPFS-SYNC and IDB (readerWroteNothing true), so
Firefox T is VOID for those two arms (§8.4); E's mutant not run (no lever). WebKitGTK 2.52.6 probe (webkit-probe.mjs,
rows/webkitgtk/probe.jsonl): cross-origin isolated, but no SharedArrayBuffer on the page or in a worker, and no OPFS
(getDirectory TypeError); IDB and caches present. The slot input needs SharedArrayBuffer: every WebKitGTK cell
"not run: SharedArrayBuffer". §Results written: cache-plan.md §9 (claude/cache-plan cc6adeb5, 72033eb9). Done; nothing owed by this row. (batchff2.sh,
which pushes this heartbeat after each cell), then mutants.sh firefox. Earlier: B's first try cut at 23:44Z by a container restart (kept .partial, counted in no bar); B, E, K, Q, T, P rerun in one job that starts no cell after 60 min
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
Measured (cache-plan.md §9): 4-vCPU container, Chromium 153 headless, Firefox 159 on Xvfb, synthetic frames, feeders not
decoders, warm page cache, O's F from M1; no phone, no Safari. All 23 counted cells whole on both engines.
* By §8.5 rule 3, **no arm passes on either engine**: L's PSS bar fails all four at 512² on both (slack ~64 MiB;
  Chromium IDB grows ~1.25 GiB at every size). OPFS-ASYNC is the only arm to pass L at S2 on Chromium.
* OPFS-SYNC and OPFS-ASYNC pass W, R-idle, R-busy and O on both; IDB and CACHESTORAGE fail R at S2/S3 and O on Firefox,
  and R-busy on Chromium.
* **Chromium T, OPFS-SYNC: tab 2 ended with 3 frames not exact over 4 rounds, its re-check reporting none** (rows
  T-2560-1x.jsonl, `second.verify`); not traced here.
* VOID: Chromium W at S1 (A/A 0.890); Firefox T for OPFS-SYNC and IDB (tab-writes mutant not caught). Saturated:
  Chromium S3 4× (none 6.5 %). Not run: Firefox E and Q (Gecko's quota lever does not hold); WebKitGTK 2.52.6 (no
  SharedArrayBuffer, no OPFS: webkit-probe.mjs).
* Firefox CACHESTORAGE errored in K (2/4, null `written`) and T (4/4, navigation timeout).
Owner, last: nothing to decide from this row; CACHE-VERDICT-REVIEW (the loser's question) is next, and the T
finding is the first thing it should read. The cache stays off.
