state: done
started: 2026-11-17T13:24Z
heartbeat: 2026-11-17T13:40Z
outputs: PR 397 body §Re-review: AV1-HW-CHIPS-FIX-REVIEW; claude/mobile-decode 748e31f1 (docs/lines/client.md)
## Resume
Done. Nothing owed by this row; amendment 17's loop for av1-chips.md ends (no blocker open).
## Result
Re-review of a6c81939..b81d6302 (av1-chips.md, docs/lines/client.md). Verdict: both blockers closed, none open.
* Blocker 1: table re-counted, 11 at 4.x and 8 at 5.x; every count corrected in place with a note; no stale count in docs/.
* Blocker 2: Android 16 CDD re-fetched ("Last updated: December 2, 2025"); [5.1/H-1-22] quoted exactly, under class V
  (§2.2.7.1); only dbt12_ea1141 and dbt10_ea1141 fit 1080 x 1920, so "17 of 19 exceed" holds.
* Minors 3-6 present as claimed; nothing else changed.
Minor, not blockers: AV1-HW-CHIPS.md's Result on this ledger still says 10/9 (outside the fix brief); one new clause in §1
wants a (D); three over-wide lines.
Checks: check_links 9 unresolved (same 9), check_personal_paths clean; gate not run (no code).
Fixtures and limits: a documents re-review of the 19 DBT volumes' sizes (EA1141); nothing run, no device; one source
re-fetched (CDD), S6 and S8 not re-fetched.
