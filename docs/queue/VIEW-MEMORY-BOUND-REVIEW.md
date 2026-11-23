state: done
started: 2026-11-23T05:07Z
heartbeat: 2026-11-23T05:10Z
outputs: PR 435 body §VIEW-MEMORY-BOUND-REVIEW (reviewed at claude/view-memory-bound 3fa0a8c86); VIEW-MEMORY-BOUND-FIX and -FIX-REVIEW appended to docs/queue-2026-11-14.md
## Resume
Done. Next: VIEW-MEMORY-BOUND-FIX (a session that wrote neither PR 435 nor this review), by its brief in amendment 28.
## Result
No code changed; the gate was not rerun (the build's was green). client/view tests all pass; comment budget ok; check_links 0.
The default reverted fails the new test; the four claimed mutants killed; colour and no-channels mutants survive.
One blocker (amendment 17's loop started):
* B1: only "store budget = W" of the doc's rule is built; the want stays the whole series. Measured (unit probe,
  worker view, 10 frames, budget 4, no cache): every step re-asked the 6 frames outside the window, 30 fetched over
  five steps, each evicted on arrival. Page view: the fill fetches and decodes n, keeps W. Derived for dbts_b1 (50, W 15):
  35 frames decoded for nothing, and re-fetched after each step in the worker view. "Only memory changes" does not hold.
Minor: m1 no colour case (US in scope); m2 design.md's "only once written" untrue with the bound on; m3 W_min not
built, unsaid; m4 the re-ask covered for the page view only.
Fixtures: unit tests and a probe on synthetic frames; nothing in a browser or on a device; dbts_b1's waste derived.
