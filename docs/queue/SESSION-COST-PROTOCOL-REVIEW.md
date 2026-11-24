state: done
started: 2026-11-24T13:27Z
heartbeat: 2026-11-24T13:35Z
by: q7oxKe5p
outputs: findings in PR 441's body §SESSION-COST-PROTOCOL-REVIEW; claude/work-ledger docs/queue/SESSION-COST-PROTOCOL-REVIEW/ (harness, counts)
## Resume
2026-11-24T13:35Z: done. Next: SESSION-COST-PROTOCOL-FIX (appended), then -FIX-REVIEW; SESSION-COST-RUN waits on the re-review.
## Result
Four blockers, six minors, one nit (PR 441's body). Recomputed and holding: §1's step counts, every §4 cell from §3,
the CPU a MB from the 2026-11-23 rows, W, the H2/WT-TS ratio, every PS3.18 quote verbatim.
* B1: model.py's eviction breaks ties opposite to store.js; the trace through the product's Controller and downloader
  (b059388b6, stand-in transport) asks dbts_b1 A 796 / 370.54 MB (764), dbts_c1 A 177 (198), dbts_c1 B 84 (99).
* B2: on PR 446 (WINDOW-WHOLE-GROUPS) dbts_b1 A asks 130 frames, 60.61 MB: A, not FIT, cheapest; pre-register both.
* B3: FIT's W unstated; at level-1 pictures W ~63 and FIT dbts_b1 ~33.8 MB, not 81.82.
* B4: §5 omits PS3.18's rendered frames with viewport (§10.4.1.1.3, §8.3.5.1.3), a screen-sized reference.
* m1 per-arm CPU ranges; m2 no per-session intercept (idle 0.05 ms/s); m3 sessions not <= 60 s on CR; m4 server
  lifetime; m5 three-arm order; m6 ask counts for A+C1 and FIT.
Fixtures and limits: frames counted with 1x1 stand-in frames and an instant transport, no browser, link or time; three
timed DBT volumes of one dataset; usb_cine not traced (lossy-sourced, a function check).
No owner decision.
