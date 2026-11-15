state: done
started: 2026-11-15T08:17Z
heartbeat: 2026-11-15T08:44Z
outputs: claude/cache-arms b8da9dc6, 248ba66f, 75472e8d, 929bebc4, 04cd9854 (lab/cache-arms/arms/idb.js, arms/idb.test.mjs; store-worker.js floor medians; README §IDB as built; scripts/gate.sh; docs/lines/client.md), draft PR 394 (its CACHE-BUILD-IDB section)
## Resume
Done. Nothing owed by this row; CACHE-BUILD-REVIEW judges it with the other builds. Firefox smoke not run (running
the downloaded Firefox was refused in this session); a later firing may add it without changing the arm.
## Result
IDB as §7.3 has it: a Blob a frame under [series, i], one relaxed transaction with commit(), one in flight; the slot
let go once the Blob holds its copy; estimate() at the open of a new series; eviction one transaction.
- Forced by the seam: a refused frame keeps its value for the store's retry (its slot already let go). Harness: the
  floor reports every series an arm times (IDB adds writeBufferMs, §8.2).
- Tests: arms/idb.test.mjs on an in-memory IndexedDB, 31 code mutants killed; one redundant guard removed.
- Smoke (not results), Chromium 153: every row check passed in L S1-S3, W, R-idle, R-busy, B, O, E, K (2 rounds), Q,
  T, P. R-idle p50 50 / 53 ms at S2 / S3.
- For CACHE-RUN: L's PSS growth at S2 1 601 MiB with Blobs, 553 with value=buffer (none 263): over L's memory bar,
  cause not traced. estimate() blind to the override on Chromium, so E's evictions came mid-fill, not at open.
- Backend: LevelDB plus a .blob directory in Chromium 153's profile; recorded by listing Default/IndexedDB/.
- gate.sh --quick passes with the two pre-existing link paths set aside locally; check_lab_absent.sh passes.
- Claimed at 08:17, about 3 minutes inside the 20-minute quiet window after OPFS-ASYNC's last push (its own files).
Fixtures: 4-vCPU cloud host, no GPU, synthetic 16-bit S1-S3, feeders not decoders, warm page cache, one round a cell;
no Firefox, no WebKitGTK, no phone.
