state: done
started: 2026-11-23T10:17Z
heartbeat: 2026-11-23T10:19Z
outputs: claude/sync-reconcile 9f9634c66 (PR 417); docs/queue/SYNC-RECONCILE-REVIEW-FIX/ (bounds.py, output.txt) here
## Resume
Done. Next: SYNC-RECONCILE-REVIEW-FIX-REVIEW (a session that wrote none of PR 417, its review or this fix).
## Result
* B1: P4's condition restated in §0, the §6 pair table, §6.1, §8.1 and `docs/lines/metadata.md` (§State, §Open 2):
  P4 only if the metadata call uses zstd (`--zc=zstd`) and rsync's file list compresses to <= 34 KB (ct) and
  <= 221 KB (2 000 instances) on rural ADSL at 0.5 Mbit/s; per-file zlib gives P4 - P3 0.92-1.72 s (sat 2 Mbit/s)
  and 1.84-3.44 s (sat 1 Mbit/s) for ct, so P3 there. *derived*, recomputed independently (bounds.py, output.txt:
  every number matches the review's).
* B2: §6's ranking line corrected in place: 1. P4 · 2. P3 · 3. P1 · 4. P2 under §6.1's two conditions.
* m1: §6.1's M-R3 sentence, §7's M-R3 row and §9's "Not read" corrected in place. m2: the rot-at-rest claim labelled
  inference, the rsync(1) quote kept for what it shows. m3: the groups-only item list noted beside §6.1's table.
* Nits n1-n3 not in this row's brief; left for the re-review to judge.
* Docs only: check_links 0 unresolved, comment budget ok; the gate not run.
* Fixtures: none run; arithmetic on #234's estimates and #223's bytes (five parser series, a synthetic 2 000).
* Owner: none now; PR 417 merges only after its re-review finds no blocker open.
