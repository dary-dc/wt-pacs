state: done
started: 2026-11-15 13:57 UTC
heartbeat: 2026-11-15 14:09 UTC
outputs: claude/mobile-decode `df1e4c12` (`docs/decode/mobile/av1-hardware-unchecked.md`), `f833e2ea` (`docs/lines/client.md`); PR 397 (draft, the branch's, existing)

## Resume

Done. Nothing left; MOBILE-DECODE-COMPARE reads the file's §8 and carries §9's asks.

## Result

* The owner's question: zoom, pan, rotate, flip, invert and window/level all work on the hardware path; window/level is
  a 256-entry table over 8-bit input (§3).
* 8 bits on screen: 4.01 source units a step (10-bit series), 16.05 (12-bit); 2.0–7.4 display levels a step at the
  header windows, against 0.5–1.85 today. 6 grey levels at a 100-unit window on a 12-bit volume (D).
* The rounding comes after the decode, so at today's Q the picture on screen is at e/σ 1.02–1.09, above the bar (D).
* It needs full range: at studio range a 10-bit series clips below 64 and above 940. 
  overrides the stream (S); whether Android's conversion obeys it is a device fact.
* Pixel values are intervals (±2 / ±8 source units); ROI SD is inflated; geometry is unchanged.
* Android's image reader holds 1–5 images (S, Chromium 157): copy each frame to  and close it;  is
  406 MiB as R8. The client cache gets no checked samples: (a) an 8-bit cache or (b) re-decoding.
* Whether the S23 has the decoder is unsettled. 2560 × 3328 needs level 5.0 and is taller than 2160; no vendor page
  names 4:0:0, Main 10 or a maximum size.
* Owed: five phone asks, one cloud cell (e_N of today's view rounded to 8 bits), §9. Docs only; gate not run (no code).
* Owner: whether an unchecked 8-bit moving picture is ever acceptable (amendment 1; the 2026-11-10 "no 8-bit
  preview"), and the cache's option (a) or (b) if it is.
