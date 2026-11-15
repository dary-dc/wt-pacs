state: done
started: 2026-11-15 13:45 UTC
heartbeat: 2026-11-15 13:58 UTC
outputs: claude/mobile-decode e1cbe8fe (docs/decode/mobile/new-options.md, docs/lines/client.md), draft PR 397 into claude/docs-client; rows b97b4bff in docs/queue-client-2026-11-14.md; claude/phone-protocol 7b50805e (asks M1-M3)

## Resume

Nothing left. Not done by this row: no subscription to PR 397's activity (the row schedules nothing); the full gate
(docs only; `check_links.py` 0 unresolved, `check_personal_paths.sh` clean).

## Result

* Scope: amendment 20 (options not on the brief's list). Theory and sources; nothing run on a device, GPU or coder.
* Premises: "no route returns a hardware frame's samples" and "it arrives as an 8-bit RGB picture" held as read,
  not re-verified; "so it cannot be checked" did not hold; "the decode is the phone's bound" held narrowly
  (FILL-SPLIT); "the phone's hardware decoder takes these frames" is unchecked: `dbts_b1` (8 519 680 samples) and
  `dbts_c1` (2 452 688) exceed AV1 level 4.x's 2 359 296 and need 5.0; Android's CDD asks level 4.1 at most.
* New option 1, MOBILE-OPT-HW-INVERTED: a hardware 8-bit frame of grey with constant chroma is a function of luma
  alone; where one-to-one (derived from H.273: the studio-swing conversion on 16...235, 220 levels, 7.78 bits) the
  page inverts it and hashes against the ingest digest, which itself proves the inversion per frame. Not tied to AV1.
* Its extension to more than 8 bits (a second picture carrying the first's error): theory only, no row.
* New option 2, MOBILE-OPT-HTJ2K-LOSSY: a DICOM syntax (.4.203), no depth cut, one decoder; bytes unmeasured.
* New option 3, MOBILE-OPT-CONTENT-CROP: two cropped fixtures hold 0.25 and 0.38 of their matrix; every per-sample
  cost scales; multiplies with every option.
* Named without a row, with reasons (new-options section 6.1): screen-sized decode, hardware first then software,
  a web shell with a native decoder, server rendering, AV1 reconstruction in WebGPU, an attested decoder.
* Fixtures behind every cited result: three timed DBT volumes of one dataset (19 for bytes), no ultrasound cine,
  4-core hosts without a GPU, one phone, one home link. The HTJ2K throughput quoted is a desktop's (white paper).
* Leaning (labelled): the crop first; then lossy HTJ2K or the inverted hardware frame by the phone's cells M1-M3.
* Owner: whether a 220-level (7.78-bit) checked hardware view is acceptable beside DEPTH8's question; whether the
  second picture may be opened (it touches "the residual dropped" and "the split discarded", 2026-11-09); whether a
  cropped view needs a word on screen.
