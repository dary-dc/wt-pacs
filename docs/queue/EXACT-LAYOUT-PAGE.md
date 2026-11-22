state: done
started: 2026-11-22T16:17Z
heartbeat: 2026-11-22T16:21Z
outputs: claude/reviews-2026-11-28 67e5e5671 (docs/decisions/exact-frame-layout.md; README.md index line; docs/lines/codecs.md §Open 7); draft PR 405 ("do not merge: decision pages"), no new PR
## Resume
Done. Read only, from pushed results: claude/htj2k-a1 4189ef47 (docs/htj2k-tiles.md §Verdict, §A1, §A1 review), claude/mobile-decode
6ae00ae9 (htj2k-preview.md), unified docs/disk-layout/target.md §Layout 1, exact-frame-by-htj2k-layout.md. DICOM PS3.5 2026e §10.18.1
re-fetched; the quote matches. Docs only: check_links (4 unresolved, all pre-existing in lab-list.md and transport-stack.md), comment
budget ok; gate not run.
## Result
Fixtures: three EA1141 DBT volumes; the deciding reading one cell (dbts_b1 r5000 4x) of one volume, 4-5 paired rounds; 4-core cloud
host, no GPU, headless Chromium 157/153, software WebCodecs, userspace relay, 4x cgroup cap (assumption); no phone, no ultrasound.
* A1's rule kept Layout 1 for D+T3: the strips' effect x0.943 <= x0.963 (measured, recomputed by the review); D+T3 / D x0.923.
* D+L*'s level picture x0.264 of D's wait, but 46.9 dB from the resampled original, failed the VL proxy; reaches 1 of 19 DBT upright.
* On a phone nothing is measured; a decode-bound phone should gain more (theory: strips decode in x0.43-0.48).
Owner, last (exact-frame-layout.md §2): Layout 1 carried by D+T3 only, yes; build it now, no; P1 and P2 in the next phone round,
yes (R3 decides the build); P3 no until the cache is on; a level picture before the original, no for now (reopens "no
low-resolution preview"); send the drafted PCS note (§9), yes.
