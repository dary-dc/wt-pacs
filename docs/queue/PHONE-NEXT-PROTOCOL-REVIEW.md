state: done
started: 2026-11-15T00:18Z
heartbeat: 2026-11-15T00:40Z
outputs: claude/phone-protocol 3448459a (docs/phone-rows/next-round.md §Review; docs/lines/optimal-quality.md §Open), on its open draft PR 359
## Resume
Done. The author's fixes (findings 1, 3-9 and the rule half of 2) follow on claude/phone-protocol by a later firing of
this queue's worker, as PHONE-NEXT-PROTOCOL's brief allows; no row for them exists in the table yet.
## Result
Review of next-round.md (read only; nothing run). Holds: arms are design.md's; every cell predicts before data; the
view comparison's minimum (16 pairs, ~37 min of loads) fits cell 3's 60 min budget; all quotes of the Screen Wake Lock
WD, WebTransport CR, Long Tasks draft and proc_pid_stat(5) re-fetched and verbatim; sign-test thresholds recomputed.
Findings (author): 1 blocker, the wake lock is released at each load's navigation (spec §11.2; runner uses
location.assign), fix proposed: Settings.Global STAY_ON_WHILE_PLUGGED_IN set by adb; 2 cell 3 predicts the first
picture page-faster, which its own guard turns into a worker loss; 3 cell 2 has no margin and a post-hoc pooling rule;
4 cell 1 relies on cell 4 which runs last; 5 cell 2's predictions conditional; 6 the busy lever must run in the
viewer document; 7 P1's credential-encrypted storage now sourced (Android Direct Boot page); 8 logcat naming and adb
/proc reads still unsourced; 9 time sums to ~2 h 20 min, Williams rows unbalanced. No gate: docs only.
Fixtures: the protocol's own (one phone, one home AP, two DBT volumes of one dataset); this review ran nothing.
Owner: the first-picture bound in cell 3's guard; PRs 376/378 in the run commit.
