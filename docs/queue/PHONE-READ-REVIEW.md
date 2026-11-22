state: done
started: 2026-11-22T20:46Z
heartbeat: 2026-11-22T20:54Z
outputs: claude/phone-run af461ecb (docs/phone-rows/next-round-results.md §Review), 8fe185c7 (docs/lines/devices.md); PHONE-READ-FIX and -FIX-REVIEW appended to docs/queue-client-2026-11-14.md
## Resume
Done. Next: PHONE-READ-FIX (by its brief in docs/queue-client-2026-11-14.md); MOBILE-DECODE-REJUDGE now waits on PHONE-READ-FIX-REVIEW.
## Result
Docs only; nothing measured; gate not run. Every number recomputed from raw/2026-11-22/ (618dd9cd) and
raw/2026-11-22-cell3/ (85326fd3): cells 1, 2 and 4 match except as below.
Two blockers (amendment 17's loop started):
* B1: M4's HEVC/VP9 limits (4096 x 2176, "dbts_b1 exceeds") come from a codecs.xml section listing no AV1; the
  live list names c2.qti.av1.decoder, and the sections listing it declare HEVC 8192 x 8192, VP9 4096 x 4096:
  dbts_b1 fits (declared). Also in other-codecs.md on claude/mobile-decode (PR 397).
* B2: C2's exact series was asked 0.36-1.65 s after the view's fill; the read's sum leaves the gap out; end to end
  C2 / (A + B) is above 1 in 14 of 15, median 1.24 (C2 slower by the rule). Both readings are owed.
Minor: off-by-one counts 19.5-45.7 k (not 19-49 k); RGBA32F gave 255 values where RGBA16F gave 1024; the CPU bound
depends on the wall time (2.73 or 3.32 of 8); four DEVICE-THEORY lines unnamed; the 12-of-15 threshold post hoc.
Unchanged: B faster than A 15 of 15, cell 1's 18.9 ms, cell 3 not decided.
Fixtures: one phone, one home Wi-Fi, one evening, dbts_b1 and dbts_a1's cut, software decode in cells 1-2.
