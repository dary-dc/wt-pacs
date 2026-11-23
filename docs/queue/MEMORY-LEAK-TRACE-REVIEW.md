state: done (one blocker open; amendment 17 rows MEMORY-LEAK-TRACE-FIX and -FIX-REVIEW appended)
started:2026-11-23T02:47Z
heartbeat: 2026-11-23T02:51Z
outputs: findings in PR 434's body §MEMORY-LEAK-TRACE-REVIEW (reviewed at a462542a8); line doc note 5ced2b4b2 on claude/memory-on-navigation
## Resume
Done: PR 434 read at a462542a8; minimal rig re-run; V8 source fetched at a pinned revision; phone raw rows read; review in PR body; fix rows appended.
Next: none (MEMORY-LEAK-TRACE-FIX takes B1, m1-m8).
## Result
* Reproduced (cloud 4-core/15 GiB, headless Chromium): minimal rig sab main 862->4115 MiB over 5 loads, ab main 865/867/1680/870/1682, sab worker flat; matches the rows within 3 MiB. Full rig not re-run (fixture not rebuilt).
* Source: V8 backing-store.h at 4f01bdeb (main), PerIsolateAccountingLength "if (has_flag(kIsShared)) return 0;" (Chromium 153's V8 branch not checked).
* B1: on the phone (PHONE-ROUND resources.jsonl, renderer :85) the loads after worker-view loads 26 and 27 grew +1240 and +1452 MiB, as much as after page-view loads; the cloud cause explains the cloud page view, not all of the phone's growth. What ran on those loads is not checked (beacon's view is the URL's; PHONE-READ-CODE-CHECK open).
* m1-m8: V8 source unquoted; "collected within a load" overstated; bfcache-off and GC runs without rows; pagehide claim derived; fixture g16 vs phone's g8; growth starts at load 24, not 22; arms in blocks; PR body's Generated-by line (removed).
* Fixtures: dbts_b1 (one DBT volume) only; no US; one phone; cloud has no GPU. Gate not run (lab and docs only); comment budget and links pass.
* Owner decision: none.
