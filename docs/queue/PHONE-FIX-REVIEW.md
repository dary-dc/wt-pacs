state: started
started: 2026-11-12T14:43Z
heartbeat: 2026-11-12T14:55Z
outputs: claude/phone-fix-review (findings), comments in PR 376/377/378 bodies under "Review"
## Resume
PR 378 (ffc407de) checked: reverting client/view/controller.js to claude/demo-fixes-2 fails 2 of its 4 new tests (39/41;
the other 2 are guards); mutants killed: no leave check, no retry, no wait. Finding: every rejection is re-asked,
not only transport losses (a decoder's refusal shows "asking" ~21 s before "failed"). Next: PR 376 (a66e9890) and
PR 377 (5137f449) the same way, worktrees /tmp/wl/{hpd,bcn}; then the gate on each branch; findings into
docs/reviews/phone-fix-review.md on claude/phone-fix-review and each PR body under "Review".
## Result
