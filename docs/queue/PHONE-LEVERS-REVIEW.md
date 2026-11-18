state: done (two blockers open; amendment 17 rows PHONE-LEVERS-FIX and -FIX-REVIEW appended)
started: 2026-11-18T14:16Z
heartbeat: 2026-11-18T14:53Z
outputs: claude/phone-round 42d2a8f4, 934fd6d8 (docs/reviews/phone-round.md §Levers), e348024a (docs/lines/client.md); ledger 5f1fff7f (rows appended); PR 400 body unchanged (the review file holds the findings, as Re-review 2)
## Resume
Done. Nothing left for this row; PHONE-LEVERS-FIX is next (a session that wrote neither the levers nor this review).
## Result
Checked def86ef4, 3d6385fd, 5d6a2f9b. As committed: the three unit tests, round_headless.sh (every claim holds),
check_lab_absent.sh, the comment budget, gate.sh --quick (GATE OK 545 s; skips named in §Levers) all green.
Lever off: only head.js's list of lab names changes in the product; with no lab parameter the page's path is the
same. C2 checks every exact frame (its digest mutant killed); the bench uses the product's decoder.js, the viewer's
decoder configuration and whole groups, timed by the decoder's own stamps.
Own mutants 8: 4 killed, 1 killed only by the known 0 ms cell-3 flake, 3 survive.
Blockers: (1) a frame not exact fails neither the bench nor a C2 load under any test (both consequence mutants
survive); (2) the bench's per-frame time and span are pinned only by > 0 (the hand-over and first-decodeStart
mutants survive). Minors: ?decoders alone untested at the gate; the view's 7 groups of 8 bound cell 1's view sweep
(50/26/18/16 frame-times at 1-4 decoders, derived); HTJ2K's time carries its XXH3 check, the view's none; a throw in
the bench's handlers waits for fillS; C1's press not in roundOrder (PHONE-RUN-OWNER must carry it); the 0 ms flake.
Fixtures: one 4-core cloud host, headless Chromium, software WebCodecs, loopback, the synthetic 64 x 48 20-frame
pair, fake adb; no phone, no DBT volume. Not this row's: docs/queue/BRIEF-WED.md is the 11-10 queue's (11-12), so
this file's BRIEF-WED (claude/reviews-2026-11-18, due 11-18 10:00) reads done by name and has never run.
