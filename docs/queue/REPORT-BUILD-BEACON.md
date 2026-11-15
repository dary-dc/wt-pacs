state: done
started: 2026-11-15T12:17Z
heartbeat: 2026-11-15T12:52Z
outputs: claude/report-arms e4767924, bf16e99e, d46f5497 (lab/report-arms/beacon/, arms/beacon.js, scripts/gate.sh), PR 395
## Resume
Done. Nothing owed by this row. The close-at-once defect in run.mjs is the harness's (REPORT-BUILD-REVIEW's to judge).
## Result
Built BEACON (report-plan.md §3.1 as advocated) behind the seam: lab/report-arms/beacon/, arms/beacon.js; H and Y.
- Each record is one sendBeacon in the call. A refused whole record is sent once more without frames (truncated, same
  reportId). A refused safety report is kept whole and first: resent at 1 s, at hide/pagehide, before any load record.
- floor.js: the arm's own bytes under a fresh load id and reportId of equal length (cells L, C not built to run it).
- Departure: one beacon per failure, not per task; the sink's one-record contract (§7.1) refuses a batch.
- beacon.test.mjs written first, seen failing; 19/19 mutants killed; added to scripts/gate.sh.
- Smoke H,Y x D1-D5b,D7-D9 (REPORT-BUILD-BEACON-smoke.jsonl, PR 395 body): safety report in all 18 rows; Y's fill
  record in all but D8; four page mutants each caught once.
- Found: run.mjs:91 closes the browser at once after each ending and destroys queued beacons (H: no record in D1, D2;
  a local 2 s pause delivered both). This biases D1, D2, D7, D8 against BEACON and KEEPALIVE. Fix before REPORT-RUN.
- Gate --quick passed on d46f5497 (two pre-existing devices.md paths set aside locally); check_lab_absent passed.
Fixtures: 4-vCPU cloud host, no GPU; headless Chromium 153 only; grey-16 x32, not dbts_c1; loopback, no relay.
Owner: whether the harness's close-at-once is fixed by a harness row or by REPORT-BUILD-REVIEW's blockers.
