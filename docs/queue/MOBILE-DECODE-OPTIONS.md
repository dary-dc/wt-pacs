state: done
started: 2026-11-15 13:45 UTC
heartbeat: 2026-11-15 13:58 UTC
outputs: claude/mobile-decode e1cbe8fe (docs/decode/mobile/new-options.md, docs/lines/client.md), draft PR 397 into claude/docs-client; rows b97b4bff in docs/queue-client-2026-11-14.md; claude/phone-protocol 7b50805e (asks M1-M3)

## Resume

Nothing left. Not done by this row: no subscription to PR 397's activity (the row schedules nothing); the full gate
(docs only; `check_links.py` 0 unresolved, `check_personal_paths.sh` clean).

## Result

* Amendment 20's scope (options not on the brief's list). Theory and sources; nothing run on a device, GPU or coder.
* Premises: "no route returns a hardware frame's samples" held as read; "so it cannot be checked" did not hold; "the
  decode is the phone's bound" held narrowly (FILL-SPLIT); "the phone's hardware decoder takes these frames" is
  unchecked: `dbts_b1` and `dbts_c1` need AV1 level 5.0, Android's CDD asks level 4.1 at most.
* MOBILE-OPT-HW-INVERTED: a hardware 8-bit frame of grey with constant chroma is a function of luma alone; where
  one-to-one (derived from H.273: studio swing on 16...235, 220 levels, 7.78 bits) the page inverts it and hashes
  against the ingest digest, which proves the inversion per frame. Not tied to AV1. More than 8 bits by a second
  picture: theory only, no row.
* MOBILE-OPT-HTJ2K-LOSSY: a DICOM syntax, no depth cut, one decoder; bytes against AV1 unmeasured.
* MOBILE-OPT-CONTENT-CROP: two cropped fixtures hold 0.25 and 0.38 of their matrix; multiplies with every option.
* Six more named without a row, each with its reason (new-options section 6.1). Phone asks M1-M3 appended.
* Fixtures behind cited results: three timed DBT volumes of one dataset (19 for bytes), no ultrasound cine, 4-core
  hosts without a GPU, one phone, one home link; the HTJ2K throughput quoted is a desktop's.
* Leaning (labelled): the crop first; then lossy HTJ2K or the inverted hardware frame, by M1-M3 and the byte cells.
* Owner: whether a 220-level checked hardware view is acceptable; whether the second picture may be opened (it
  touches "the residual dropped" and "the split discarded"); whether a cropped view needs a word on screen.
