state: done
started: 2026-11-19T11:16Z
heartbeat: 2026-11-19T11:39Z
outputs: claude/study-db-schema (ba79335aa), draft PR 407 into claude/unified
## Resume
Done. 8c2e57f73 failing test; the fix; docs corrected in place; gate OK at 05947ce62. Next row: STUDY-DB-TEST-REVIEW (not before 11-20 12:00), by a session that wrote none of this.
## Result
* COMPLEXITY-AUDIT item 1 fixed on claude/study-db-schema, draft PR 407 into claude/unified.
* Failing test first: pacs-receiver tests::receive::a_stored_study_passes_the_verify_tool (pacs-verify over a stored study failed every level: "Invalid column type Text at index: 2, name: xxh3").
* One schema in common/study-db: the receiver's table definitions (series column, audit table) and hash form (xxh3 TEXT, 16 lowercase hex); the receiver and pacs-verify both on it.
* Mutants killed: unpadded hex, INTEGER column, put dropping the series, verifier skipping its compare, receiver writing an integer hash.
* Docs corrected in place: tools/pacs-verify/README.md, docs/ingest/pacs-receive-design.md D1, docs/lines/metadata.md.
* Gate OK (701 s, 4-core cloud host); skipped: native painter/window (no lavapipe, Xvfb), viewer cross-codec arm and Firefox, nginx web-host check.
* Fixtures: the receiver's synthetic test packages only.
* Owner decision: the hash column's type, TEXT (built) or INTEGER (in PR 407's body); merging PR 407 is the yes to TEXT.
