state: started
started: 2026-11-11 16:28 UTC
heartbeat: 2026-11-11 16:50 UTC
outputs: `claude/htj2k-tiles` (docs; draft PR #324 already open)
## Resume
Checked (no commits yet): DICOM PS3.5 §10.18.1, §8.4.1, A.11 quotes verbatim (fetched); OpenJPH 0.31.0 quotes verbatim
(raw.githubusercontent.com); ℓ_fit table, bytes table, decode figures recomputed from
`claude/htj2k-progressive:lab/htj2k-progressive/rows/stage3-volumes.md` and `stage1-levels.md`. Found: c1 break-even 62/49
→ 63/50 (and "more than" → "at least"); c1 decode 94–103 → 93–103 ms; "1.55–1.81" is audit-decode F2's derived figure,
not lines/codecs.md; S at ℓ≥1 decodes a frame twice on Lossless; missed P-TILE/Layout 1 (T3 measured, on 3 workers),
PCS input (`mf.mxf`, profile unknown; ours is `ingest/coded-frames/ingest.py:23`, no TLM), `-tileparts R` + TLM.
Next: corrections in place in `docs/htj2k-tiles.md` §Screen on `claude/htj2k-tiles` (worktree ../htj2k), then
`docs/lines/codecs.md`, push, finish.
## Result
