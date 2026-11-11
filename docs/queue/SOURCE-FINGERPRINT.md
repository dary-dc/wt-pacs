state: started
started: 2026-11-11T14:42Z
heartbeat: 2026-11-11T14:55Z
outputs: claude/source-fingerprint (from claude/demo-fixes-1 daee0d1d)
## Resume
Design (not yet pushed): `sourceFingerprint` = XXH3-64 hex over the concatenated hex per-frame XXH3-64 digests of the
source samples in the HTJ2K exact series' layout (`frame_digest(s.frame(i), s.stored > 8)`); for an HTJ2K exact series
that is its own `digests.frames`, so no second pass; an optimal-quality or AV1 series hashes the samples once.
Writers: ingest/coded-frames/ingest.py (`metadata()`, from_dicom), lab/av1/tools/ingest_coded.py (demo series),
ingest/from-parser/src/main.rs (same.py compares bundles byte for byte). checkPair (client/viewer/pair.js) compares it;
framesSha256 stays the set's download pin, no longer copied into a series.
Next: venv (.venv, ingest/requirements.txt), ingest/tools.sh in background; failing tests first (pair.test.mjs,
pair-source.test.mjs, lossy_test.py, same_test.py/from_dicom); then docs (glossary, payload-format, client/README,
docs/lines/optimal-quality.md); gate; draft PR into claude/demo-fixes-1.
Commands: cd wt-pacs; git checkout claude/source-fingerprint (or -B from origin/claude/demo-fixes-1).
## Result
(pending)
