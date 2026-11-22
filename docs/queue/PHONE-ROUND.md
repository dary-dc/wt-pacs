State: started
started: 2026-11-22T17:34Z
heartbeat: 2026-11-22T19:42Z
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
* Round confound (found mid-round, loads 22-29): the memory a load starts with depends on the same-origin loads
  before it. One renderer (SandboxedProcessService0:85) lived through loads 22-28, all on port 8765; RSS+VmSwap
  after each: 1.0, 1.7, 3.4, 4.6, 6.1, 7.6 GB, phone swap 9.2 of 12 GB; loads 28 (A, 4.6 s) and 29 (B, 2.0 s)
  VOID. At load 29 (8767) a new renderer (1.2 GB) and the old one freed (swap 1.9 GB). Evidence: target/round/
  resources.jsonl (per load: each Chrome process's name, RSS, VmSwap), round.py's OUT/adb/NNN-*-PID.stat (the PIDs).
  Cause not checked (the back/forward cache keeping the previous viewer document is a hypothesis).
* Ports to arms (target/round/plan.json): 8765 the dbts_b1 view (cell 1 view-1..4; cell 2 A, C1, C2 on b1;
  all 48 cell 3 loads); 8766 the dbts_a1 view (cell 2 A, C1, C2 on a1); 8767 b1's exact series (cell 1
  htj2k-1..4, cell 2 B on b1); 8768 a1's exact (cell 2 B on a1). B never shares an origin with A, C1, C2, so it
  biases arms, not only positions: B starts in a fresh renderer, A/C1/C2 inherit earlier same-origin loads. Cell 3
  runs 48 loads back to back on 8765 with no reset. PHONE-READ: split VOIDs and timings by the count of preceding
  same-origin loads in the same renderer.
