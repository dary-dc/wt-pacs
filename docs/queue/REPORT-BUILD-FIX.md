state: done
started: 2026-11-16T06:17Z
heartbeat: 2026-11-16T06:44Z
outputs: claude/report-arms 4ca48c26, 8f61d5a6, 261f004b, 7f56bc62, dce4764d, 133dc2bb (PR 395); smoke docs/queue/REPORT-BUILD-FIX-smoke.jsonl
## Resume
Done. Brief and Amendments unchanged since start (amendment 21).
## Result
Closed B1–B5 of docs/reviews/report-arms.md §Verdict on claude/report-arms (4ca48c26..133dc2bb), each with a test that
failed before its fix, mutated: B1 the wait before the browser's close; B2 binaries from CARGO_TARGET_DIR, a server
without telemetry refused (checked live too); B3 --units arm:timing over --rounds in Williams order, round and predecessor
per row, balanced() per cell, off' distinct; B4 Receiver::file (the byte only for a written line) tested outside run(),
WTPACS_SESSION_REPORT_MUTANT=ack-before-write; B5 the receiver crate in the image, deploy/workspace_test.sh in the gate.
Mutants: run.mjs 8/8, session_report.rs 7/7, workspace_test 1/1. Minors 2, 7 (part), 9, 14 (part) fixed; the rest listed in §Fixes.
Smoke (BEACON-H x D1–D5b, D7–D9, one load each, --wait 30): fill record in D1, D2, D3, D4, D7, D9 (D1/D2 lost before).
Fixtures: one 4-vCPU cloud host, no GPU, headless Chromium 153 only, grey-16 x32 not dbts_c1, loopback, no --tun, no docker.
Gate --quick OK 446 s (devices.md :57/:60 set aside locally); check_lab_absent.sh OK; skips named in §Fixes.
PR 395's body not edited (its findings live in the review file's §Fixes). Next: REPORT-BUILD-FIX-REVIEW.
