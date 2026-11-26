state: done
started: 2026-11-24T19:35Z
heartbeat: 2026-11-25T18:14Z
by: xigw9LEm
outputs: claude/report-arms (lab builds 958644318, 60578e891, f23fb35e6, 0092cf5e6, e9b0e0a9b, 712a3fc67; rows lab/report-arms/rows/r3-*.jsonl to a3b58b612); claude/page-runs docs/reviews/page-runs.md §2 Amendment and §2 Results, docs/lines/client.md (513fc7ca5); no PR (none asked)

## Resume

Done; nothing to continue. Next: PAGE-RUNS-VERDICT, by a session that ran none of this. The scripts, how
the run went and every restart are in docs/queue/REPORT-RERUNS/ and page-runs.md §2.

## Result

* Done 2026-11-25 18:20Z. Chromium 158 (4-core cloud host, no GPU, loopback, RECEIVER behind nginx 1.31.8, the grey-16
  frame x32, the fault bench's forced mismatch; CPU <= 63 % throughout), Firefox 160.0.1; page-runs.md §2 Results.
* (b) D5a busy: VOID by its A/A (off 6 vs off' 8; the letter stands, PAGE-RUNS-VERDICT B1). Read beside, not
  adopted: BEACON-* 9/18 safety each (band 10-17: miss, below), KEEPALIVE-* 18/18 (hit), SESSION-* 15-16/18 (miss).
  Corrected 2026-11-26, page-runs.md §Verdict review: this read "the race exists" and "VOID by the letter, Fisher p 0.73". Built: the kill timed from the
  decoder worker's own report (as written, every driver call waited for the long task: §2 Amendment).
* Lbusy: A/A 1.040 pass (µs clock); every band hit per load (page carriers ~51 ms p99, worker carriers <= 3 ms).
* (a) C: VOID by its A/A (off' 1.053, p 0.013); read beside, KEEPALIVE-Y +7.3 ms over KEEPALIVE-Y° (p 0.09).
* Firefox: driver step 0 built (three fixes, mutants killed) and two follow-up defects fixed; D5a, D1 as predicted;
  L VOID by its A/A (2.25); D6 unrun (WebTransport under --tun timed out); D2 D9 D4 D5b D8 D3 D7 Lbusy C not run.
* Two container restarts and three driver crashes resumed at round boundaries (run.mjs --from-round); no partial round counted.
* Gate not run (lab and docs rows); the report-arms tests and comment budget pass; check_links 0 new.
* Owner: nothing asked here. (a) and (b) both VOID, so reports.md §6's rule gives BEACON-Y, provisional; a rerun of
  D5a busy with a race A/A written first is the owner's yes or no (page-runs.md §Verdict review, table row 2).
  Corrected 2026-11-26, page-runs.md §Verdict review (B1): this read "(b) shown, (a) not shown (VOID), so reports.md's
  KEEPALIVE-Y condition is half met".
