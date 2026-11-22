state: done
started: 
heartbeat: 2026-11-22T21:10Z
outputs: claude/phone-run 093bd105 (docs/phone-rows/next-round-results.md, B1, B2, m1-m5, nits, §Fix), e6fff19b (docs/lines/devices.md); claude/mobile-decode 78f0a307 (docs/decode/mobile/other-codecs.md B1, hw-inverted.md m1; PR 397)
## Resume
Done. Next: PHONE-READ-FIX-REVIEW (by a session that wrote none of the read, the review or this fix), findings in next-round-results.md §Re-review.
## Result
Docs only; nothing measured; gate not run; check_links 0 unresolved on claude/phone-run, the same 9 as before on claude/mobile-decode.
Every finding re-derived from raw/2026-11-22/ (618dd9cd) and raw/2026-11-22-cell3/ (85326fd3) before its correction:
* B1: M4 now reads the codecs.xml sections listing c2.qti.av1.decoder (lines 1325, 1838): HEVC 8192 x 8192, VP9
  4096 x 4096, dbts_b1 fits (declared); the active file marked inferred; the next round records file paths. Same in
  other-codecs.md.
* B2: C2's gap 1.20-1.65 s (dbts_b1), 0.36-0.59 s (dbts_a1) stated; both readings: summed no difference (6 of 15,
  median 1.031), end to end C2 slower (14 of 15 above 1, median 1.236, p ~ 0.001); the held verdict for the summed one only.
* m1-m5 and nits as the review states, with one correction to m1: the default copyTo gives 20 905-49 002, so the
  read's 19-49 k was the range over both paths; both now stated. m2 also: "none exact" held for RGBA16F only.
Fixtures: one phone, one home Wi-Fi, one evening, dbts_b1 and dbts_a1's cut (one dataset), software decode in cells 1-2.
