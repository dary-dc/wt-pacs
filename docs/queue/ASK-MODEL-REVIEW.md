state: done
started: 2026-11-22T19:08Z
heartbeat: 2026-11-22T19:13Z
outputs: findings in PR 430's body §ASK-MODEL-REVIEW (`claude/ask-model` at `2fdac0e8c`, unchanged); the toy `docs/queue/ASK-MODEL-REVIEW/sawtooth.py` and its output on `claude/work-ledger`; ASK-MODEL-FIX and ASK-MODEL-FIX-REVIEW appended to `docs/queue-2026-11-14.md` §Rows, ASK-PAGE now needs the re-review
## Resume
Done. The line doc on `claude/ask-model` was not updated: the push to that branch was refused in this session (a
permission check), so ASK-MODEL-FIX's brief carries the line. Next: ASK-MODEL-FIX.
## Result
Theory review; nothing of the product run. Fixtures: none (the toy uses §2's parameters: W = 15, v = 25 frames a second,
rho 0.216 and 0.8, no RTT, a lead of 0; derived, not measured).
* Sources: S1 and S7 sha match, quotes verbatim; S4, S5 sha match (efetch XML); S3 quotes verbatim, page dynamic;
  S6 abstract only (efetch db=pmc): "vigorous drilling", no "3.8 slices" or "sawtooth". S2 is Basic Image Review.
* Arithmetic recomputed: §3.3, §5's formulas and rho table, §6's k*, P1/P1b numbers all as written.
* B1: P1's legs of 12 fit W = 15, so every evict-past-budget arm (the store as built) holds the leg and waits 0.
* B2: under no skip the reader is held at mu, nothing builds up ahead, and the rule's delta/rho hold blocks the fetch
  §5 assumes; the toy orders the arms the other way (legs 20, rho 0.216: all ahead 0.50 s, 3/4 0.50, centred 0.87,
  the rule 1.24). The claim is unshown; the toy does not prove the opposite.
* m1–m6: S6's reliance, S2's profile, S3's revision, rho's label, the cine gate's exact bound, S4's observers.
Owner: nothing yet; the fix loop runs first (two rounds, then blocked).
