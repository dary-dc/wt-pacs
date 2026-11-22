State: started
started: 2026-11-22T17:34Z
heartbeat: 2026-11-22T19:32Z
outputs: (none yet; raw rows go to claude/phone-run:docs/phone-rows/raw/2026-11-22/)
## Resume
FULL round by SATURDAY.md, worktree wt-pacs-phone-962 on claude/phone-run 3dbe295a3, RUN_CODE a8927df1 (no pull
until the raw rows are committed). Steps 0-1 done (before reads in target/round-*-before.txt, target/probe-shell/).
Step 2 done: 24 of 28 ok, 4 VOID (timer stalls on painting loads; memory pressure, apps not closed). Now: adb dropped 18:28Z (MTP only), reconnecting; then apps force-stopped, sampler checked, step 3. Node runs in the container with wt-pacs-data mounted too (demo-series
is a symlink there).
## Result
(the round's pending; what the dry run found)
* Dry run (target/dry, 28 loads, apps not closed): 28 verdicts, 24 ok, 4 VOID "the runner's timers stopped"
  (load 12 cell 2 A 6.9 s, 13 B 2.8 s, 15 C1 2.0 s, 23 cell 3 page 2.3 s). Every stall on a painting load; the
  bench loads (cell 1) all at the 250 ms tick.
* Memory, read from round.py's per-load /proc/<pid>/stat (majflt summed over Chrome's processes) and logcat:
  bench loads 1-2.6 k major faults, 0 lmkd kills; load 11 279 k (23 kills, no stall); load 12 403 k, 356 k of them
  in the page's renderer (32 kills, the 6.9 s stall); load 23 127 k (23 kills). Loads 16-19, after the kills:
  3-9 k, stalls under 0.7 s. Not a perfect fit (load 11: faults, no stall; load 15: VOID at 22 k).
* Cause on our side: at the run commit FrameStore's budget is Infinity (client/view/store.js:30, no caller passes
  one) and the OPFS cache is off, so the view holds every decoded frame: dbts_b1 2560x3328, 50 frames, ~17 MB a
  frame at 2 bytes, ~850 MB, against ~2.7 GB MemAvailable on the phone (7 GB) with Facebook, Instagram, WhatsApp
  resident. The bound is the coordinator's to queue (frame-memory-ownership.md's 256 MiB window); nothing changes
  tonight.
* Corrections to SATURDAY.md section 2's expectations, for PHONE-READ: logcat DOES carry codec component names
  (c2.qti.av1.decoder among them; the c2.qti.hevc.decoder traffic is System UI's, pid 4524, not ours), and the
  per-load /proc/<pid>/stat files are NOT empty (420 files): cell 1's route and CPU per process are readable.
* The full round runs clean (Facebook, Instagram, WhatsApp force-stopped, the owner's choice), with
  target/resources.sh: one adb snapshot per gap between loads (meminfo, PSI, vmstat swap/fault counters, thermal,
  each Chrome process's RSS/VmSwap, top 8 by RSS), nothing during a load, into target/round/resources.jsonl.
