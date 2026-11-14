state: done
started: 2026-11-14T21:14Z
heartbeat: 2026-11-14T21:28Z
outputs: claude/depth8 at c79d0b07, draft PR 389 into claude/docs-client
## Resume
Done. Commits on claude/depth8: the lab arithmetic (lab/av1/depth8/theory.py, predictions.json), docs/av1/depth-cut-8.md,
pointers in payload-format.md §Depth cut, glossary, docs/lines/codecs.md §Open 7. Next: DEPTH8-MEASURE (another
session) runs §7 of docs/av1/depth-cut-8.md.
## Result
* Theory only; nothing coded or timed. Fixtures: 19 DBT volumes (12 at 12 bits, 7 at 10), the quality study's rows;
  libaom 3.15.1; one σ estimator; no US cine, ABUS, TRUS or MR; no reader, hardware decoder or browser run.
* The cut alone adds rounding RMS 4.61 (D 12) / 1.12 (D 10) source units: 0.31–0.44 / 0.20–0.33 of σ_min, under the
  noise on every volume.
* Coded, the highest Q with e_N ≤ σ: 8-bit Q 2–5…5–8 (12-bit), 4–10…7–13 (10-bit), against today's 7–9 and 9–14;
  bytes 0.82–1.09× (removal model) to 1.37–2.44× (independent model) of today's view. The k = 2 top-10 cells fit
  both models within 0.02; k = 4 separates them (protocol P2).
* Sourced: only desktop Chromium's 8-bit 4:2:0 grey (NV12) is a checked browser hardware path; Android none; Firefox
  WebCodecs exact on 4:2:0 grey (software); Safari WebCodecs only behind an off-by-default preference.
* Gate: comment budget, links, personal paths, lab absence green; full gate not run (no product code touched).
* Owner: whether an 8-bit view is acceptable; it reopens the 2026-11-10 decisions (D ≤ 10 own depth; no 8-bit preview).
