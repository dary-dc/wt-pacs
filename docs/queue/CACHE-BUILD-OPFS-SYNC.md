state: done
started: 2026-11-15T06:16Z
heartbeat: 2026-11-15T06:49Z
outputs: claude/cache-arms 83190ac6, a9006373 (lab/cache-arms/arms/opfs-sync.js, arms/opfs-sync.test.mjs; serveReads and pilot through the seam; scripts/gate.sh; docs/lines/client.md), draft PR 394 (its CACHE-BUILD-OPFS-SYNC section)
## Resume
Done. Nothing owed by this row; CACHE-BUILD-REVIEW judges it with the other three builds.
## Result
OPFS-SYNC as §7.1 has it: one packed file and one sync handle a series, truncate at open, written from the slot in
pieces (pilot `piece`, default whole frame) with waiting reads let in between, record after the last piece; Gecko's
refusal name passed up as QuotaExceededError; a reading tab by getFile(), no handle.
- Seam changes, opt-in, for all arms alike: `serveReads` in the write's context; `--pilot` reaching the arm's factory.
- Tests: arms/opfs-sync.test.mjs, 21 code mutants killed, one equivalent named; store.test.mjs +1, mutated.
- Smoke (not results): Chromium 153 every cell one round, all checks pass but Q S2 (truncate ≈813 MiB refused under the
  877 MiB override, as the harness foresaw: CACHE-RUN's amendment); Firefox 159 L, R-busy, T at S2 and K at S1 pass.
- gate.sh --quick passes with the link check set aside (two pre-existing paths, docs/lines/devices.md 57, 60).
Fixtures: 4-vCPU cloud host, no GPU, synthetic 16-bit S1-S3, feeders not decoders, warm page cache, one round a cell.
