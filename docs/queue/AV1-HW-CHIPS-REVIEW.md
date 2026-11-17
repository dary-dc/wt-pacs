state: done (two blockers open; amendment 17 rows AV1-HW-CHIPS-FIX and -FIX-REVIEW appended)
started: 2026-11-17T11:20Z
heartbeat: 2026-11-17T11:55Z
outputs: PR 397 body §Review: AV1-HW-CHIPS-REVIEW; claude/mobile-decode a6c81939 (docs/lines/client.md)
## Resume
Done. Nothing owed by this row; AV1-HW-CHIPS-FIX is next (a session that wrote neither the file nor this review).
## Result
Review of docs/decode/mobile/av1-chips.md (6e72321d): all 10 sources fetched at their pins; every quote exact.
Blockers: (1) the count is 11 volumes at level 4.x and 8 at 5.x, not 10 and 9 (§3's own table; §1, §5, §4.3,
the status Result and the line doc carry the wrong one); (2) the Android 16 CDD [5.1/H-1-22] asks portrait decode of
class-V phones, AV1 at 1080p; the file says the CDD does not ask it. Conclusion holds by size, not by orientation.
Minors: the level Chromium compares is the WebCodecs codec string's; the CDD page hash is not a stable pin; Android's
level map bounds height at 6144 not 3456; FIXTURES' width x height order assumed.
Arithmetic (samples, blocks, strips, rates) re-derived on all 19 rows: matches.
Fixtures and limits: sizes of the 19 DBT volumes (EA1141) only; nothing run; no device; Chrome 157 tag not read.
