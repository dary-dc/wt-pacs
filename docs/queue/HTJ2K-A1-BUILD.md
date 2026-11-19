state: done
started: 2026-11-19T10:47Z
heartbeat: 2026-11-19T11:43Z
outputs: `claude/htj2k-a1` at `608ca152`, draft PR 408 into `claude/unified`
## Resume
Done. Next: HTJ2K-A1-BUILD-REVIEW (a session that wrote none of this): revert `cf975330`'s page hunk and see the
`whole-neighbour` row's check fail, and confirm that only `lab/htj2k-tiles/improve/` and `docs/lines/codecs.md` changed.
Smoke tree recipe: this file's history and HTJ2K-MEASURE's Resume; the D series from 157b7109's `demo-series.sh` at
Q 8 G 16; build the levels binding inside `wt-pacs-decoder-build` (no git there: give it the patch).
## Result
* D+T1 built in `lab/htj2k-tiles/improve/stage3/` (`page.js`, `run.mjs` `--arms D+T1`): the exact series' whole
  codestream as one `decode: false` entry, decoded on lab worker 0, hashed after the clock. Default arms unchanged.
* Mutant `whole-neighbour` caught (exact 0/1), row in `rows/stage3-mutants.jsonl`.
* Smoke, not counted (`rows/a1-build-smoke.jsonl`, 16 visits: `r5000` and `r20000`, 1× and 4×, four sets): 15 exact;
  1 refused by OPFS storage quota after the clock (`dbts_b1` `r5000` 4×, the fact §Verdict records); 6 VOID by the
  relay's p99 rule. The run should stop dockerd first.
* Fixtures and limits: three EA1141 DBT volumes; D series sha256 equal to `rows/stage3-d-series.json`; 4-core cloud host
  with no GPU, headless Chromium, software WebCodecs, a 4× cgroup cap (*assumption*), a userspace relay.
* Gate: full `scripts/gate.sh` green on the second run. The first run failed at `client/contract/run_browser.sh` with
  "1 workers outlived their closed clients" (WORKER-FLAKE's flake), and that step passed on rerun. The decoder base
  image came from `mirror.gcr.io` at the pinned digest (Docker Hub 429); outputs match `manifest.sha256`.
* `docs/lines/codecs.md` Open 7 updated on the branch. No owner decision.
