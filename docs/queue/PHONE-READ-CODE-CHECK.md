state: done
started: 2026-11-23T07:27Z
heartbeat: 2026-11-23T07:34Z
outputs: claude/phone-run 2b242245 (docs/phone-rows/next-round-results.md §Which code each load ran, and its Fixtures line; docs/lines/devices.md)
## Resume
Done. Nothing owed by this row. A review by another session is owed (none is queued in §Rows; VIEW-PAGE and PHONE-ROUTE-PAGE read the section).
## Result
* Every load of PHONE-ROUND (2026-11-22) carries fields only post-11-11 code writes: 101 loads of the round (steps 0-96, the rest plan's 140-143) and 3C's 2, read from raw/2026-11-22/round/ at 618dd9cd and raw/2026-11-22-cell3/ at 85326fd3, against the 11-11 run commit 962226e8 (measured).
* Markers, each per load id, 103 of 103 where they apply: decoders and cores on every record (def86ef44); each frame's route, which the 11-11 code calls path (a5c086a4e: decoder.js, htj2k.js, av1.js, controller.js's about()); bench frames' start (4a3606285); a lossless record on all 16 C1 loads (95f7d3709).
* So beacon.js, round-page.js, bench.js and round.mjs ran exactly as at 3dbe295a3, and the decode modules and controller.js at a5c086a4e or later. No load is set apart, and no result is corrected.
* Not established: 18 of the page's 29 changed or new modules leave no field in the rows (viewer.js, the transport and paint modules, view.js and view-worker.js; the list is in the section). HTML and JSON are revalidated (dev-server.py sends no-cache); JavaScript is not.
* The check was mutated with four row mutants (route renamed path, decoders removed, start removed, C1's lossless dropped), and each one fails it.
* Limits: one phone, one evening. A marker shows code at or after its commit, not that every module ran that code. Docs only: check_links.py and the comment budget pass, and the gate was not run.
