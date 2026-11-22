state: done
started: 2026-11-22T15:39Z
heartbeat: 2026-11-22T15:43Z
outputs: `claude/reviews-2026-11-28` `9406e30d` (`docs/decisions/final-state.md`; the index line of `docs/decisions/README.md`; `docs/lines/coordination.md`); draft PR 405 ("do not merge: decision pages"), no new PR
## Resume
Done. Nothing to continue. Sources fetched 2026-11-22 and quoted in the page's §8 (16, each with URL, section and
revision); the branch read at `4a2b4277`, not run. Docs only: `scripts/check_links.py` 4 unresolved before and
after (none in this page), comment budget ok, the gate not run. Next: FINAL-STATE-REVIEW (findings in the page's
§Review), then UNIFIED-PAGE. No row appended; nothing scheduled.
## Result
Sources and reasoning; nothing built, run or timed. Fixtures: none used (the program's are named in the page's §4 as
what "bench" stands for). Not read: ISO 9000, ISO 16290, ISO/IEC/IEEE 24765, IEC 62304 (sold); the eCFR API (406; the
2025-04-01 annual edition quoted instead).
* Premise questioned: "production ready" and "demo ready" are steps on one ladder, and so are alpha, beta, preview,
  release candidate and a TRL number. The state has three independent axes (scope, evidence, use), so any ladder
  word overclaims the third or undersells the first two (theory).
* Sixteen terms judged by five tests from the owner's words (five generated here). Recommended: **bench-verified**, always with its scope, and one line beside it: "Not run in production and not
  validated in a clinic; not a medical device." "Verified" against "validated" is the quality vocabulary's own split
  (FDA, General Principles of Software Validation §3.1.2); "bench" names the fixtures' limit.
* The definition: seven conditions, each with its check on the branch, and seven things named as outside it.
* Read on `claude/unified`, for UNIFIED-PAGE: the tracked ultrasound fixture is placeholders, so "complete for
  ultrasound stacks" is not yet shown; no table of defaults found. "Research use only" not recommended (an IVD label).
Owner, last: yes or no to *bench-verified* with the page's §5 (a yes: one glossary line, the README status line,
`coordination.md` §Goal's "deployment-ready" replaced); if "verified" is refused for DICOM's Verification Service
Class or a later regulatory path, *bench-measured* with §5 unchanged; the status line's second sentence either way.
