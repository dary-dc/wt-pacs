state: done
started: 2026-11-18T16:16Z
heartbeat: 2026-11-18T16:44Z
outputs: claude/phone-round c7677027, 4a360628, 3cd7ac89, 95f7d370, ba0a9619; PR 400 body §Levers fix
## Resume
Done. Nothing left; PHONE-LEVERS-FIX-REVIEW is next (a session that wrote none of the levers, their review or this fix).
## Result
* Blocker 1 (tests only, c7677027): the exact metadata with frame 3's digest changed, served as an HTJ2K series and as
  a view's exact series; a bench load and a C2 load each fail by name (`frame 3 decoded not exact`,
  `exactFill: frame 3 decoded false, not exact`). Both hold at 5d6a2f9b's code: it was right, only untested.
* Blocker 2 (test c7677027, fix 4a360628): bench frames carry `start`, the record `t0`; claims ms = end − start,
  no overlap per decoder, spanMs = last end − t0. Before the fix both codecs' claims FAIL; after, every claim holds.
* The review's four surviving mutants run through round_headless.sh: all killed, each by its intended claim.
* Minors: 3 (levers.test.mjs pins head.js's list; mutant killed), 7 (roundOrder's C1 presses Lossless, test first)
  fixed; 4, 5, 6, 8 left, listed in PR 400.
* round_headless.sh 18 loads every claim holds; check_lab_absent, comment budget green; gate.sh --quick OK 583 s,
  skips named in PR 400 §Levers fix. client/decode/wasm/build/build.sh failed (Docker Hub 429); tracked built/ used.
* Fixtures: one 4-core cloud host, headless Chromium, software WebCodecs, loopback, synthetic 64 x 48 20-frame pair,
  fake adb; no phone, no DBT volume.
