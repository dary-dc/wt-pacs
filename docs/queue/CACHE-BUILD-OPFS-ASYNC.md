state: done
started: 2026-11-15T07:16Z
heartbeat: 2026-11-15T07:59Z
outputs: claude/cache-arms e1b8cefb, 1ab1ddac, 856dadc8, a781f7ee (lab/cache-arms/arms/opfs-async.js, arms/opfs-async.test.mjs; README §OPFS-ASYNC as built; scripts/gate.sh; docs/lines/client.md), draft PR 394 (its CACHE-BUILD-OPFS-ASYNC section)
## Resume
Done. Nothing owed by this row; CACHE-BUILD-REVIEW judges it with the other builds. Firefox smoke not run (its launch
was refused in this session); a later firing may add it without changing the arm.
## Result
OPFS-ASYNC as §7.2 has it: a file per group of G frames by createWritable, committed at close; each frame copied out of
its slot, the slot let go once copied; writes in flight ≤ the pilot's k; reads by getFile() or a sync handle.
- Forced by the sequential store worker (README): write returns once issued; a copy is kept until its group commits
  (reads of an open group served from it); a row's "written" is "handed to the arm" (K at S3 has G = 1).
- Changed from the design: only a new series is probed; the probe at every open refused Q's reopen under the ballast.
- Tests: arms/opfs-async.test.mjs, 24 code mutants killed; one redundant guard removed.
- Smoke (not results), Chromium 153: every cell's checks pass but L S1 at G = 1 (100.5 MB/s; with group=8MiB and
  inflight=3, 125.0), as §8.3 predicted marginal; R-busy S3 miss p50 248 ms by getFile().
- gate.sh --quick passes with the two pre-existing link paths set aside locally; check_lab_absent.sh passes.
Fixtures: 4-vCPU cloud host, no GPU, synthetic 16-bit S1-S3, feeders not decoders, warm page cache, one round a cell;
no Firefox, no WebKitGTK, no phone.
