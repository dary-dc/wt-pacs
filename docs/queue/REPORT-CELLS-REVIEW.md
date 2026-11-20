state: done
started: 2026-11-20T13:47Z
heartbeat: 2026-11-20T13:54Z
outputs: `claude/report-arms` `9ba00851` (`docs/reviews/report-arms.md` §Cells review), `fb3f15e5` (`docs/lines/client.md`); PR 395; REPORT-CELLS-FIX and -FIX-REVIEW appended to `docs/queue-2026-11-14.md` §Rows
## Resume
Done. Next: REPORT-CELLS-FIX (a session that built none of the cells and wrote none of this review), then REPORT-CELLS-FIX-REVIEW; REPORT-RUN-2 now waits on the re-review.
## Result
* Reviewed `115a3529`..`56d27bb7` against `report-plan.md` §7.2–§7.4: the five new tests are green and fail with their change reverted; 14 mutants of this review's, 4 survivors (1 minor, 2 equivalent, 1 void).
* B1: cell R's one-address generator meets NGINX's 10 r/s per-address limit. REPORT-CELLS' smoke (measured): 160 of 200 load reports refused (429) at 100/s, and 1 960 of 2 000 at 1 000/s; RECEIVER wrote all of them. `lines` counts the refused lines as written. Fix: source addresses in 127/8, which work on this host (measured), or NGINX's load row reported as limited.
* B2: L's floor posts the arm's safety bytes to `/report/load`. RECEIVER then drops the safety fields as outside its list (`counters.outside` rises) and skips the safety `sync_data`, measured at 0.16 ms p50 here, about a tenth of the L p50s.
* Minors m1–m7: an untested earliest-copy rule; D5's `atKill` read one evaluate before the kill; the fault stamped at the decode's return; refaults rewriting the L rows' fill record; mixed clocks with 1 ms resolution (measured −1.1 to +0.1 ms in Chromium 153), so rule 2's 10 % lead on L is not decidable below about 10 ms; Y measures the kept, re-serialized record; Firefox inside `--tun` neither smoked nor named.
* Fixtures: a 4-vCPU cloud container without a GPU; headless Chromium 153 for one clock probe; nginx, Firefox and `--tun` read from REPORT-CELLS' smoke, not rerun; the grey-16 frame ×32, not `dbts_c1`. The gate was not run (a docs-only change); comment budget ok; `check_links.py` on the two files.
* Owner: nothing.
