state: done
started: 2026-11-14T23:10Z
heartbeat: 2026-11-14T23:16Z
outputs: claude/phone-protocol b48b6619, 6ed6429e (docs/phone-rows/next-round.md; docs/lines/optimal-quality.md), on its open draft PR 359; claude/phone-rows 1354e67f (amendment 11); work-ledger d735c727 (PHONE-AMEND-3 superseded)
## Resume
Done. For PHONE-NEXT-PROTOCOL-REVIEW: read claude/phone-protocol:docs/phone-rows/next-round.md, write its Review section.
## Result
Protocol pre-registered (theory; nothing run). Fixtures: one phone, one home AP, one laptop, one evening,
dbts_b1-q8-g8 and dbts_a1-q8-g8-cut with their exact series; software decode unless logcat shows otherwise.
Cells: (1) decode per frame, HTJ2K and the view, 1-4 decoders, in memory, drift check; (2) arms A, B, C1, C2 on Wi-Fi,
8 Williams rounds x 2 series; (3) page vs worker, cubic-restart only, frame-change / exact-frame / cine latency idle and
with 100 ms long tasks every 250 ms, ABBA, 24 pairs planned against a minimum of 16 (sign test p < 0.05, median <= 0.95);
(4) the hw probe, exploratory, logcat in place of media-internals; (5) cache P2 then P1 if built.
One press (amendment 5): runner drives, laptop script switches servers, Wake Lock re-acquired and recorded, stopping rule
by loads' own time, no ran load excluded. Amendment 6's theory table; 12's names proposed; 7/11 six-octet of record.
Run commit must carry PRs 376/378 or their failure modes are named (VOID hidden / failed lost ask); neither is in
unified-client e5b20cba today. ~2 h 10 min. Sources: Screen Wake Lock WD 2026-11-11, WebTransport CR 2026-07-30,
Long Tasks 2026-10-20, proc_pid_stat(5) 6.19, quoted. Not sourced, flagged for the review: logcat naming the codec
component; Android CE storage locking Chrome's data until first unlock. No gate run: docs only.
Amendment 11: phone-blind-read.md §3 and its line doc corrected on claude/phone-rows; claude/docs-client's
docs/client/evidence/view-target.md still says "which reading stands is the owner's" (the docs queue's file; DOCS-FIX's).
Owner: P1's second sitting after a reboot, or new-process P1 without cold claimed; merging 376/378 into the run commit;
the measure names (glossary).
