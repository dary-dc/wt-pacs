state: done
started: 2026-11-22T22:07Z
heartbeat: 2026-11-22T22:10Z
outputs: claude/report-plan 948e79b47 (docs/client/evidence/report-plan.md §Verdict review 2), f5e249584 (docs/lines/client.md); docs/queue/REPORT-VERDICT-2/ (recompute.py, c_pairs.py, output.txt) on claude/work-ledger; no PR (docs only, the plan has none)
## Resume
Done. Next: REPORTS-PAGE (needs this row: done).
## Result
Read only; docs only: check_links 5 unresolved, all pre-existing (none added); the gate not run. Every Results 2 number
recomputed from claude/report-arms 4ef4e12a rows/r2-*.jsonl: all agree. Fixtures: Chromium 153 headless only, one 4-vCPU
container, the grey-16 frame x32 (not dbts_c1), a forced mismatch, loopback or a userspace relay, nginx 1.31.8, 1.7 KB R bodies; no phone.
* As written (§7.5): no carrier passes. C's per-round fill bar (0.98-1.02 in >= 15/18) fails every arm, and off' against
  off too (3/18; off's fill varies 7.3 % round to round): the bar is narrower than the host. Rule 5: each arm's gap over
  its floor is under 1 ms (a tie at the clock's resolution); SESSION also fails D8.
* Rule 3: a tie, not decided: the page handed the safety report on before all 162 D5a kills; the race opens only on a
  busy page for page-thread carriers (Lbusy, VOID, read as measured).
* Receivers: NGINX (1.31-1.45 % of a core at 100/s); RECEIVER behind nginx misses the 5 % bar (5.28-6.33 %).
* Read without C (not the verdict): Y over H by 40 points (90/90 against 54/90); BEACON-Y against KEEPALIVE-Y not
  separated: Lbusy (VOID) favours KEEPALIVE-Y 20-fold, C (derived sign test) BEACON-Y by ~9 ms a fill.
* Owed, no product change: C and Lbusy rerun with bars fixed before their rows, D5a on a busy page, R at real body sizes, Firefox's driver.
* Owner (REPORTS-PAGE): NGINX or RECEIVER's validation at ~4x the cost; name a carrier now on the reading, or after the reruns.
