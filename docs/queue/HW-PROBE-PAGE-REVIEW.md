state: done
started: 2026-11-15T01:16Z
heartbeat: 2026-11-15T01:22Z
outputs: claude/hw-probe af4b6aeb (docs/lines/client.md; no code changed); draft PR #393 into claude/docs-client, opened here from HW-PROBE-PAGE-pr-body.md; findings in its body §Review
## Resume
Done. Nothing left for a cloud worker.
## Result
PR #393 opened (draft, into claude/docs-client). Reviewed at 0d330405; base pass rerun here, headless Chrome for
Testing 153.0.8010.12, SwiftShader, software only, no device: all base claims PASS, same 27 cell lines.
Holds: every outcome recorded; one press (?run=D0); check_lab_absent.sh OK; comment budget OK.
Expected planes right: two mutants of this review (a luma digest in hw-units.json; neutral chroma +1), both killed.
Finding (measured, cause not traced): every RGB copyTo and WebGL2 read fits studio-range expansion even where the
frame says fullRange: true (8 bits: every statistic matches; 10 bits within rounding), so the probe's RGB and paint
"exact" counts measure range, not precision, and ingest.py's "full range gives R = G = B" premise fails in this
Chromium. The 8-bit cap (256 of 1024 levels) stands.
Gaps: no claim judges chroma or no-preference; hardwareDecode() unsettled in caps.js loses the D0 row on a throw.
Suggested fixes left to phone-tests (their tooling). Untested: any phone, hardware decoder, Chromium 141, Firefox,
WebKit, a GPU adapter.
