state: done
started: 2026-11-25T13:08Z
heartbeat: 2026-11-25T13:12Z
by: 3kXPEmwq
outputs: `claude/work-ledger` `docs/queue/IMPROVE-1/candidates.md` §Review (dac9d7333); IMPROVE-1-FIX, IMPROVE-1-FIX-REVIEW appended to `docs/queue-2026-11-24.md` (3e62cca56); `docs/lines/coordination.md`; no PR
## Resume
Done. Nothing to continue. Reproduce: `node docs/queue/IMPROVE-1/window-model.mjs <b059388b6 checkout>/client`;
`git show 618dd9cd:docs/phone-rows/raw/2026-11-22/round/beacon.jsonl > b.jsonl; python3 -I docs/queue/IMPROVE-1/rows.py b.jsonl`.
Next: IMPROVE-1-FIX (not before 11-25 14:00), then IMPROVE-1-FIX-REVIEW.
## Result
* Reproduced: window-model.mjs's table and rows.py's per-decoder, first-decode and fill lines exactly; every code quote at
  b059388b6; the arithmetic of §2-§4 (W 15, the step's 0.5-0.8 s, the shares, candidate 2's 1.6-1.9 s, candidate 5's dbts_b1 times).
* B1 (blocker): candidate 1's size is the model's (398 frames, 185 MB, "÷ 8"); the product measured 268/280 on the stand-in
  wire and 104-113 frames (49.4 MB) a tip pass in the browser, ÷ 1.3 to ÷ 3.3 after the build; the backward wait and
  260 MiB (not 273) missing from its cost. Rank and defect hold. IMPROVE-1-FIX corrects in place.
* m1: candidate 2's "at most 3.3 of 8" is a partial sum (a lower bound); its formula predicts -39 to -46 % at the measured
  share 0.39-0.46, the fill fell -10 to -19 %. m2: three decoders' plateau is the group count and a per-frame rise both.
  m3: candidate 5's dbts_a1 crossings are 13-24 and 44-90 Mbit/s, on a 0.247 the phone missed (0.33). m4, two nits.
* No queued row's premise refuted; no build stops.
* Fixtures and limits: the 2026-11-22 round (one premium phone, one home Wi-Fi link, one evening, dbts_b1, dbts_a1's cut,
  Q 8 G 8, software decode) and the measuring rows' cloud rows (4-core host, no GPU, headless Chromium, software
  WebCodecs, userspace relay); no ultrasound; nothing re-measured here.
* No owner decision.
