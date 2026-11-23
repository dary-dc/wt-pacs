state: done (two blockers open; amendment 17 rows SYNC-RECONCILE-REVIEW-FIX and -FIX-REVIEW appended)
started: 2026-11-23T09:48Z
heartbeat: 2026-11-23T09:53Z
outputs: PR 417 body §SYNC-RECONCILE-REVIEW; `claude/sync-reconcile` 63f7b05b9 (`docs/lines/metadata.md`); `docs/queue/SYNC-RECONCILE-REVIEW/` (recompute.py, output.txt) here
## Resume
Done. Next: SYNC-RECONCILE-REVIEW-FIX (a session that wrote neither PR 417 nor this review), then its re-review.
## Result
* Holding: #223's rule quoted verbatim (2c1f31f9f l. 848-851); §6.1's six cells recomputed exactly; round trips
  cancel within §3's estimates (1.96 vs 1.96, 3.00 vs 2.99); rsync(1) (now 3.5.2) and token.c master lines present;
  (a) matches pcs-pacs-options.md §1.
* B1: P4's condition misstated wherever carried: 0.6x fails at M-R2's top raw 420 KB (5.49 s > 5 s on ADSL 0.5);
  the deciding bound is the compressed listing <= 34 KB (ct) / <= 221 KB (2 000), and zstd on the metadata call
  (zlib per file: P4 - P3 0.92-1.72 s on satellite 2 Mbit/s for ct). *derived*
* B2: §6's ranking line "1. P3 · 2. P4" left uncorrected in place.
* m1 (M-R3 not answered by source, §7/§9 contradict §6.1), m2 (rsync(1) quote does not support (b)'s rot claim),
  m3 (P3's item list understated); n1-n3.
* Docs only: links 0 unresolved, budget ok, gate not run; merges clean into claude/unified.
* Fixtures: none run; arithmetic on #234's estimates and #223's bytes (five parser series, a synthetic 2 000).
* Owner: none now; PR 417 does not merge until the re-review finds no blocker open.
