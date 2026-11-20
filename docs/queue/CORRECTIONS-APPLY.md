state: done
started: 2026-11-20T08:46Z
heartbeat: 2026-11-20T08:51Z
outputs: `claude/av1-corrections-apply` at `f91b59ea`, draft PR 416 into `claude/unified`

## Resume

Done. Next: UNIFIED-DOCS-REVIEW (needs UNIFIED-LINE-DOCS and this row), by a session that wrote neither.

## Result

* Docs only, nothing run; the gate not run. `scripts/check_links.py` 0 unresolved before and after; comment budget green.
* Every entry of `docs/av1/corrections.md` (§1–§12) applied in place in its file on `claude/unified`, each saying what it
  read; §6 (`payload-format.md`) was already applied 2026-11-14 and left as is. One commit per file.
* §1 quotes B0's re-read x\* (4.7584 at G 1, 4.6359 at G > 1, 4.8024 for 12-bit streams; measured on committed rows),
  not the audit's proposed 4.8 ± 0.15, since B's rule keeps both values.
* κ's two meanings named apart in `docs/glossary.md`: κ (error–noise, noise ratio) and κ_ℓ (band removed, groups).
* `corrections.md` now says every entry is applied; `docs/lines/codecs.md` (2) and §Open 10 updated.
* Fixtures as each passage names them: 19 DBT volumes of one EA1141 dataset, three timed; no breast ultrasound cine;
  4-core cloud hosts, no GPU, headless, software decode.
* Owner: five changed files are `lab/**/*.md`, so DOCS-SYNC will not merge this branch; PR 416 waits for your merge after
  UNIFIED-DOCS-REVIEW.
