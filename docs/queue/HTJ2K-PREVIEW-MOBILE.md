state: done
started: 2026-11-17T14:22Z
heartbeat: 2026-11-17T15:05Z
outputs: `claude/mobile-decode` `a37b42a5` (`docs/decode/mobile/htj2k-preview.md`), `b9b9fc5c` (`docs/lines/client.md`); PR 397 (no new PR)
## Resume
Done. Next row: HTJ2K-PREVIEW-MOBILE-REVIEW, by a session that wrote none of it.
## Result
* The path: every frame the exact HTJ2K codestream; the prefix to the level covering the screen's device pixels
  first, decoded, checked, painted; the rest and the whole exact frame after. Theory, sources, existing rows; nothing run.
* The record: the 2026-10-10, 11-06 and 11-10 lines say "never"/"not considered now"/"no low-resolution preview" with
  no reason recorded (a documentation finding); the one reason on record is 2026-10-11's, an upscaled picture.
* What differs: the phone's AV1 is software and decode-bound (133–135 ms), no phone is promised hardware AV1 at
  `dbts_b1`'s size; the old verdicts compared a superseded AV1 preview (11-02) or ran on x86 (11-12, S★); at device
  pixels nothing is upscaled, though the screen shows the 5/3 low band, not the viewer's resample.
* Reach (D): upright one view, 1 of 19 DBT volumes on a 1080-wide phone, 0 on 1440-wide; 12 sideways, 8 in two views;
  FFDM and synthesized 2D reach level 1 on a 1080-wide phone.
* `dbts_b1` level 1: 21–39 ms decode predicted (T), 1.21–1.32× the view's bytes (D on R); fill ×0.18–0.29 at ≥ 600
  Mbit/s, a tie at 103, ×1.21–1.32 at 18 (D on T). Asks P1–P4 for the phone round (its §8).
* Not built: level decode binding, clamp, SIZ reset, digest per level, level offsets in the store, render path.
* Sources fetched: DICOM PS3.5 2026d §10.18.1; OpenJPH 0.31.0 `c68064d0` `ojph_codestream.h`. Docs only; gate not run.
* Owner: whether an exact level picture first, where it covers the screen, counts as the decided-against
  "reduced-resolution preview".
