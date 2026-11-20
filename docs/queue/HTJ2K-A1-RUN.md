state: done
started: 2026-11-20T08:00Z
heartbeat: 2026-11-20T10:49Z
outputs: `claude/htj2k-a1` at `34131271` (`rows/a1-run-1.jsonl`, `rows/a1-run-2.jsonl`, `stage3/a1.py`, `docs/htj2k-tiles.md` §A1, measured, `docs/lines/codecs.md` Open 7); PR 408 body §HTJ2K-A1-RUN
## Resume
Done. Next: HTJ2K-A1-REVIEW (not before 11-21 08:00), by a session that wrote none of this run: every ratio recomputed
from the two rows files (`python3 lab/htj2k-tiles/improve/stage3/a1.py rows/a1-run-*.jsonl`), the rule applied as written.
## Result
* A1 run as pre-registered, readings of the registration pushed before any row: arms D, D′, D+T1, D+T3; `r5000`,
  `r20000`; 1×, 4×; `dbts_a1/b1/c1` phone; 6 rounds; 288 visits, 234 kept (53 VOID by the relay rule, 2 quota fails).
* R0 holds: every Lossless picture exact. `r20000` is decode-bound on this host on every volume; `r5000` link-bound.
* Deciding cell `dbts_b1` `r5000` 4× (measured): strips D+T3 ÷ D+T1 ×0.943 (s 0.014, n 4), outside the prediction
  ×0.96–0.99, inside the bound ×0.963: Layout 1 stays proposed for D+T3. D+T1 ÷ D ×0.979: no product-path overhead
  finding. D+T3 ÷ D ×0.923, as stage 3. Most of the gain is the strips', about a quarter the lab page's path.
* A first start (3 visits, not kept) lacked the lab level binding; built in the decoder image, sha256 as pinned.
* Gate `--quick` green on the tip (678 s); skipped: decoders' rebuild and absence checks (--quick), native painter
  and window, the viewer's cross-codec arm and Firefox, the web host's check. Comment budget and links OK.
* Fixtures and limits: three EA1141 DBT volumes, one dataset; the deciding reading is one cell of one volume;
  `dbts_c1` sideways not run; 4-core host, no GPU, headless Chromium 157 (stage 3: 153), software WebCodecs, a
  userspace relay, a 4× cgroup cap for a phone (*assumption*); nothing claimed for a phone.
* No owner decision.
