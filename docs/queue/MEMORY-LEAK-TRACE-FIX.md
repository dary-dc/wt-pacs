state: done
started: 2026-11-23T03:27Z
heartbeat: 2026-11-23T03:40Z
outputs: claude/memory-on-navigation c81a114a1, 23baf1f28, 62bfaea0d (docs/client/evidence/navigation-memory.md §1, §1.1, §2.1; lab/viewer/navigation-memory.mjs; lab/viewer/rows/navigation-memory-g8.jsonl; docs/lines/client.md); PR 434 body §MEMORY-LEAK-TRACE-FIX
## Resume
Done: B1 and m1-m8, pushed; PR 434 body updated. Next: MEMORY-LEAK-TRACE-FIX-REVIEW (another session).
## Result
* B1 fixed: the phone's rows (renderer :85, loads 23-28) are evidence §1.1; the cause is named for the cloud page view only; "flat" is cloud-only everywhere.
* Cloud arm (measured, dbts_b1-q8-g8 + dbts_b1, headless Chromium 153, 4-core/15 GiB, software decode, loopback; 2 rounds ABCD DCBA, blocks of 6 loads): the phone's order page,page,worker,worker,page,page steps +846, +845, +7, -43 MiB (round 2 +776, +845, -65, +3); worker only flat 1544-1682; cache off past 5.6 GiB; forced collection 1525-1651.
* So the phone's +1452 and +1528 after loads 27 and 28 are not the cloud's cause; open: the URL's view not proof of what ran (PHONE-READ-CODE-CHECK), hardware decode, RSS+swap vs PSS.
* Correction to the review: the cause predicts one series at load 26 (its own live worker frames), about 0 at 27-28.
* m1: V8 backing-store.h quoted at Chromium 153.0.8010.12's v8_revision 0b60d2b0 L200-208 and main 4f01bdeb; Chrome 157 (phone) derived. m2-m7 corrected in place; m3 runs repeated and kept; m8 stays removed.
* Fixtures: one DBT volume, no US, no phone, no GPU. Gate not run (lab and docs only); check_links and the comment budget pass.
* Owner decision: none.
