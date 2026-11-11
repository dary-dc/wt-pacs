state: done
started: 2026-11-11 01:40
heartbeat: 2026-11-11 01:43
outputs: claude/demo-understand cf4404f4 (docs/reviews/understand/names.md), 7ea2232d (docs/lines/optimal-quality.md Open 12); no PR (findings only)
## Resume
Done. Read from the demo tip claude/demo-fixes-0 618e13c8; nothing renamed.
## Result
* Eight findings, ranked by what they save a presenter, each with its rename and every place it touches.
* 1: `requestExactFrame` is every ask, optimal-quality frames included (controller.js:158) — rename to
  `requestFrame`, 133 occurrences in 48 files (product 6 files, contract, tests, 20 lab files, 9 docs).
* 2: the mark says *unchecked* on every optimal-quality frame and the status line counts exact/not exact/unchecked,
  though such a series has no digests; client/README.md:97–98 says a lossy frame's `exact` means it matched the
  encoder's reconstruction — wrong, to be corrected in place.
* 3: `showLossy`/`View.lossy`/intent `lossy` (R1) → `showOptimal`/`optimal`, 11 places; metadata key `lossy` stays.
* 4: *view* is page|worker and also "the AV1 view" (glossary's own optimal quality row, README §Demo).
* 5: the decode route is `path`, `route` and the status line's `decoders:` → *route*, one glossary row.
* 6: *Lossless* (screen) vs exact (code): a glossary row for the quality label; `exactSource` vs `client`.
* 7: `depthCut`/`cut` is the shift D − 10, not the form → `cutShift`.
* 8: no glossary row for downloader, consumer, route, quality label, mark, overlay, status line, on demand; refusal in three senses.
* Fixtures: none; a reading of the code at 618e13c8.
* Owner decision: which renames, and when; suggested order docs first (2, 8) before 11-13, code after, 1 last.
