state: done
started: 2026-11-25T07:27Z
heartbeat: 2026-11-25T07:40Z
by: n8fUGgJW
outputs: claude/reviews-2026-11-28 96600fb17 (D), 9f6f3b54f (C), 2f551644c (B), 86230b0ea (A), 9d6cf4879 (index, line doc)
## Resume
Done. Next: PAGES-PASS-REVIEW (not before 11-25 14:00), by a session that wrote none of it.
## Result
* 21 pages in place (docs only; nothing run, the gate not run; check_links 17 unresolved before and after, same paths).
* (2) Each §4 has "Each limitation, and what found it" (11–28 items; visually-lossless the fullest). About a dozen
  items say what found them is not recorded (named on each page).
* (3) Each §4 says where the link, not the decode, binds (transport-stack per profile); housekeeping pages say none.
* (1) ingest-optimal-quality §4: I2-RUN whole runs +52.4/+60.5/+47.8 % fail 10 % and 25 %; at 50 % round 2 and dbts_a1,
  dbts_c1 pass; 75 % passes every whole run, but dbts_b1 round 1 (+86 %, derived) exceeds it. Recorded against options
  leaning on a check (§2 item 8).
* (4) r-m1 (repository: usb_cine, usb_cine_rgb pinned, lossy-sourced), r-n1 (pacs-sync #223 quoted), r-n2 (VL rows
  file named), nits (cache P3, transport-stack WT-TS misses and ~63 Mbit/s derived, exact-frame-layout §7, ingest's G
  correction, view-target blocks, repository GB, final-state n1–n3); m13: six pages' §1–§3 detail to appendices,
  verbatim (final-state's §1–§3 still 68 lines, its §2 alone ~40).
* Fixtures and limits: as the pages state (19 DBT volumes, 3 timed; usb_cine/_rgb lossy-sourced; 4-core cloud hosts,
  software WebCodecs; one phone, one link, one evening).
* No recommendation changed. Out of scope, found: docs/reviews/dataset-hub.md §2 has the same 27-fetch GiB error.
* For the owner: engines items 2–4 would change once ENGINE-CELLS is verdicted (G = 8 failure traced to
  av1-payload.js layouts(); `ring` not qualifying on Firefox 160.0.1); named in engines §6, unchanged.
