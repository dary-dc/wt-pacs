state: done
started: 2026-11-18T11:16Z
heartbeat: 2026-11-18T11:34Z
outputs: claude/transport-arms 799f603b (docs/reviews/transport-arms.md §Re-review), 55bf31e0 (docs/lines/codecs.md §Open 7); PR 403
## Resume
Done. Next row: TRANSPORT-RUN (its needs are met: no blocker open). Setup as TRANSPORT-BUILD-FIX's Resume.
## Result
TRANSPORT-BUILD-FIX-REVIEW done: no blocker open; each fix reverted (or made a no-op) fails its check, restored passes.
* B1: --mutate no-opening -> STOP "frame 0 asked after the dial", exit 3; unmutated every ask before the dial.
* B2, B3: judge.test.mjs fails on the pre-fix judge (fa002825:run.mjs, 7 checks) and on each one-line revert.
* B4: --mutate default-congestion -> STOP "the server's TCP ran bbr, not cubic"; the Rust test fails with
  set_congestion a no-op (bbr != reno); unmutated, cubic read on every WS and H2-fill visit.
* B5: stacks.md §5.7 (claude/transport-design 0464fc8c), dated, before any counted row.
* Nothing else changed past the blockers and minors 1, 3, 5. Gate green to the decoders' rebuild (no Docker, skipped);
  both telemetry absence checks, check_lab_absent.sh and the comment budget green by hand.
* Not blocking: the `aa` exemption of the opening rule is untested (its mutant survives); the ss parse assumes the
  controller leads its line (fails safe).
Fixtures: synthetic 12-frame HTJ2K series, Chromium 157 headless, one 4-core container (bbr default), TUN relay; one FF
round per run, nothing measured.
Owner decisions: none.
