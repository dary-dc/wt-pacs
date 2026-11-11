state: done
started: 2026-11-11 16:28 UTC
heartbeat: 2026-11-11 17:05 UTC
outputs: `claude/htj2k-tiles` 474b5e2c, 9b24f26a (draft PR #324 into main, already open; the commits land in it)
## Resume
Done. 474b5e2c: corrections in place in `docs/htj2k-tiles.md` §Screen resolution; 9b24f26a: its §Review and
`docs/lines/codecs.md`. Nothing left.
## Result
* Sources: DICOM PS3.5 §10.18.1, §8.4.1, A.11 and OpenJPH 0.31.0 quotes verbatim (fetched); T.800/T.814 not re-read.
* Arithmetic: ℓ_fit table, series MB, level-1 share, bytes table, fit-arm times hold. Corrected in place: `dbts_c1`
  break-even 62/49 → 63/50 slices (and "more than" → "at least"); `dbts_c1` decode 94–103 → 93–103 ms; WebCodecs'
  1.55–1.81 HTJ2K frames is audit-decode F2's derived figure, not lines/codecs.md (4×: 0.81–0.97, thread-skewed);
  under S at level ≥ 1 a Lossless ask decodes the frame again whole (fit arm: 74–81 + 273–296 ms at 4×).
* Fairness: same lossless end state priced; content not equal (S's scroll on a1/c1 is 12-bit exact, D's a depth-cut
  lossy view), which favours D's bytes; phone sizes assumed, a 1440-wide phone takes b1 to level 0.
* Missed: TILEMEASURE's three strips (×0.39–0.45 at 4×) shorten the Lossless decode in both approaches (b1 ~105–130 ms,
  derived); `-tileparts R` + `-tlm_marker` give level offsets from the main header (not tried, for HTJ2K-IMPROVE);
  the PCS delivers `mf.mxf`, and the RPCL profile S relies on is ours, not known to be the PCS's.
* Standing: S pays only if a reader asks Lossless on most slices; nothing found moves that.
* Fixtures: three timed DBT volumes of one dataset (EA1141); no breast US cine; 4-core host without GPU; no phone; nothing run.
* Owner: ask the PCS team for its HTJ2K profile (progression order, decompositions, TLM).
