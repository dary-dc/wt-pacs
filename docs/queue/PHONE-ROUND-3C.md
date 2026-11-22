State: done
started: 
heartbeat: 2026-11-22T20:27Z
outputs: claude/phone-run 85326fd3 (docs/phone-rows/raw/2026-11-22-cell3/, 33 files through raw_rows.py)
## Resume
Done: stopped at the smoke. Cell 3 waits for BEACON-LOSS; nothing else is owed by this row.
## Result
* Smoke failed at its first load (plan step 0 = round load 92, page view): in a fresh Chrome (force-stop, then am
  start on /next, no Start press) the fill record, 2 labels and the wakeLock record arrived; the end batch did not
  (no verdict, frameChange, cine, busy, exactFrame). So the loss is not memory or a long-lived renderer: it is the
  beacon. The gated relaunch skipped, as designed ("no verdict within 8 s"). Stopped during step 1 with Ctrl-C.
* Why the dry run's cell 3 got through: its plan ran cell 3 at --quick's steps 3, cineS 2 (target/dry/plan.json loads
  20-23); the round runs the defaults, 20 steps, cine 10 s. The dry run's end batch (load 21) was ~24 KB: labels 57
  records 15.2 KB, cine 2 records 4.5 KB (20-21 draws each), busy 1.5 KB, lossless 1.0 KB, frameChange 0.8 KB (6
  steps). Scaled to 40 steps and 10 s of cine, it is ~45 KB if labels do not grow and ~110 KB if they grow with
  the frames shown. Chrome refuses a sendBeacon over its keepalive quota (64 KiB in flight, from memory, not
  sourced), and beacon.js:6 ignores the false return. Hypothesis, not checked on the phone; BEACON-LOSS's first check.
* Before (20:24Z): thermal 0 (no cool-down wait needed), skin 37.1 C, battery 89 %, MemAvailable 2.9 GB; Facebook,
  Instagram, WhatsApp force-stopped again, and YouTube, found running. After-reads in cell3/.
* Deviations: worktree detached at 3dbe295a3 for the run, back on claude/phone-run after. The first open did not
  connect: I had removed the adb reverses when the main round ended. They were restored, Chrome opened again on
  /next (same tab, via application_id), and load 0 opened at 20:26Z.
