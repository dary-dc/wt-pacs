state: done
started: 2026-11-11 16:27 UTC (claimed 3 min before the not-before)
heartbeat: 2026-11-11 16:32 UTC
outputs: claude/proposals 8527047e (389da442 P1-P5 verdicts in place; 8ccee99c §Red team; 8527047e B0), docs only; PR #358 (OPT-THEORY's draft into main) carries them; no new PR
## Resume
Done for every proposal standing at MEASURE-1 4ab3ee0d / audit-measure 33cb6b3d. Owed when MEASURE-1 says done: attack
its audit rows B, A, C (claude/audit-measure, docs/av1/audit-protocols.md §Measured) and add them under §Red team on
claude/proposals. check_links.py 0 unresolved; no gate (docs only); nothing measured.
## Result
* Verdicts in claude/proposals:docs/lines/proposals.md, under each P and in §Red team (one table, 17 rows).
* Nothing is "adopt" for FIX-2: P1 and P2 met their rules, but the owner's 13:30 decisions keep both off the demo and each owes a cell.
* P1 corrected: dbts_a1's 1 %  0.29x is 0.37-0.55x against P4's identical default arm (5 runs too few); all gain is the
  1 % iid cell; a jump during the fill under BBR's 85-260 ms queue untimed.
* P2 corrected: arms at equal Q, not equal quality (coding error per arm owed); exactness dropped from its rule; dbts_c1 at G 8, demo's is G 16.
* P3 open: the lab arm used cancel() (generation bump), not end_stream alone; the phone row's 15 s dwells sit on the browser's 15 s ping.
* P4, P5 withdrawn by their rules (verdicts stand); P5 gives an A/A floor of +1 to +30 ms on first picture.
* P6 rule corrected: its 10 ms / 1.02x bars are under that floor, a neutral change would be rejected.
* I1 cost corrected: hash ~4 % of a measured decode (P2's rows), not 1-2 %. I1/I2 are P2's missing cells.
* §Optimize corrected in place: a1/c1 sizes and loopback fills were swapped.
* Simplify: S4 done by FIX-1/DEMO-UX (green now claims an unrun check); S5 evidence stale (demo-check.mjs:159); S1 ~110 lines; S2 met for correctness.
* Fixtures: none run; MEASURE-1's rows: dbts_a1/b1/c1 of one dataset, userspace relay, 4-core host, no GPU, headless Chromium.
* Owner: S6 (WS/race bundles out of the image) is the only small removal candidate; whether the green label ships before I1.
