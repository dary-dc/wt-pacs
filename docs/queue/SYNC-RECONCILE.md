state: done
started: 
heartbeat: 2026-11-20T10:20Z
outputs: claude/sync-reconcile cafa8ecac, draft PR 417 into claude/unified
## Resume
Done. Nothing owed by this row. PACS-PAGE reads PR 417.
## Result
Both conflicts of docs/lines/metadata.md §Open 2 reconciled in place (docs/ingest/rsync-updates.md §6.1; dated corrections
in §0, §6, §8; the line doc's State now and Open 2).
P3 vs E: #234's own §0 says bytes and round trips do not rank the patterns, yet ranked P3 over P4 on them. #223's
pre-registered rule applied to #234's estimates (derived): E on satellite (0.3/1.8 s at 2 Mbit/s, 0.6/3.6 s at 1 Mbit/s);
rural ADSL 1.2/7.2 s (P3) with rsync's listing raw, 0.9/4.9 s (E) at M-R2's predicted -z <= 0.6x. P4 (E) provisional on M-R2.
M-R3's premise answered by source (rsync-delivery.md §2.10: zstd keeps context, zlib resets; use --zc=zstd).
Hash bridge: (a) in every pattern; #234's (b) was cost only and misses rot at rest (rsync-delivery.md §1).
Fixtures: estimates from #234/#223 (#154's five series, a synthetic 2 000); nothing timed. check_links and comment budget
green; gate not run (docs only).
Owner: the second-writer fork (A+F or E+F) stays yours; M-R2 is the measurement that would flip E to P3 on rural ADSL.
