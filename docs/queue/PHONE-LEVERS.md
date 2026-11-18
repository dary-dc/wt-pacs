state: done
started: 2026-11-18T00:17Z
heartbeat: 2026-11-18T00:56Z
outputs: claude/phone-round def86ef4, 3d6385fd, 5d6a2f9b (PR 400 §Levers)
## Resume
Done. Nothing left; PHONE-LEVERS-REVIEW is next (a session that wrote none of it).
## Result
* Three lab levers through the viewer's lab gate (lab/devices/bench.js, round-page.js, levers.js; head.js names them):
  `?decoders=N` (the fill's count, recorded with cores); `?exactFill=1` (arm C2: the whole exact series after the
  view's fill, every frame XXH3-checked, its span); `?bench=<frames>&decoders=N` (cell 1: coded bytes held, then N
  product decoder workers, decodeEnd − decodeStart per frame, effective = span ÷ frames; the viewer never dials).
* roundOrder: cell 1 ×3 Williams rows of 8 arms first, C2 with exactFill, the 1- and 3-decoder drift arms last (144 loads).
* One product seam: head.js's lab-parameter list. The view on this branch has no reconstruction digests, so its
  frames are `unchecked` in the bench as in the product; a mismatch fails the load.
* Tests: levers.test.mjs, round.test.mjs, beacon.test.mjs, round_headless.sh 16 loads, every claim holds.
  Mutants 11, all killed; untested: the bench's mismatch path.
* gate.sh --quick OK 480 s (skips named in PR 400 §Levers); check_lab_absent and comment budget green;
  demo-check.mjs not run (needs the DBT datasets; product change is a name list).
* Fixtures: 4-core cloud host, headless Chromium, software WebCodecs, loopback, synthetic 64 × 48 20-frame pair,
  fake adb; no phone. Amendment 24, named in this run's prompt, is not in the queue file on origin.
