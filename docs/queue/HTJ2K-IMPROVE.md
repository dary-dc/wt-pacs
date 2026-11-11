state: done
started: 2026-11-11 17:51 UTC
heartbeat: 2026-11-11 18:40 UTC
outputs: `claude/htj2k-tiles` 121c56c0, b64d923e (draft PR #324 into main, already open; the commits land in it)
## Resume
Done. 121c56c0: `docs/htj2k-tiles.md` §Improve (I1–I6, predictions J1–J11, the consolidated protocol R0–R7);
b64d923e: `docs/lines/codecs.md` Open 3. Nothing left; HTJ2K-MEASURE runs §Improve's protocol.
## Result
* What does not move: an exact picture at the viewport's level costs its level's bytes, so S still costs 1.2–10× D's
  to the first picture and the scroll (the break-even counts stand).
* I1: RPCL with `-tileparts R -tlm_marker true` (+112–132 B a frame) puts each level's offset in the main header and
  meets DICOM's RPCL syntax; `dbts_b1` needs six decompositions for its 64-sample base (OpenJPH 0.31.0 source, PS3.5).
* I2: Layout 1's three strips on the client's three decoders: a Lossless decode ×0.39–0.45 at 4× (TILEMEASURE), and over a
  link only the last strip's decode follows the last byte: D+T3 ×0.79–0.95 of D's Lossless at 4× (*derived*).
* I3: Layout 1's bands asked by index in runs; band 0 never painted on a phone (no preview). I4: the cache keeps coded
  bands and level pictures, so nothing is fetched twice; the coarse levels are decoded twice at a Lossless ask
  (OpenJPH cannot resume), a decoder patch not proposed. I5: 64×64 blocks kept; precincts in strips a reading only.
* Protocol for HTJ2K-MEASURE: arms D, D′, D+T3, D+L★, S★ (and W, S in decode); links r5000, r20000, lte-good,
  wifi-home, r20000 at 1 % loss; 1× and 4×; rule R0–R7 stated first; 5 shards ≤ 4.5 h.
* Fixtures: three timed DBT volumes of one dataset (EA1141); no breast US cine; 4-core host without GPU; no phone;
  nothing run. Checks: check_links 0 unresolved; gate not run (docs only).
* Owner: whether an exact level picture may be shown before the frame (D+L★), and Layout 1 for DBT if R3 holds.
