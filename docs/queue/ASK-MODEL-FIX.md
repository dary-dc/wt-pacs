state: done
started: 2026-11-22T19:47Z
heartbeat: 2026-11-22T19:58Z
outputs: `claude/ask-model` `74fbaa2a1` (commits `39543254c`, `9b5039487`, `74fbaa2a1`: `docs/client/evidence/ask-model.md`, `docs/client/design.md` §Open, `docs/lines/client.md`); PR 430 body §ASK-MODEL-FIX; `docs/queue/ASK-MODEL-FIX/legs.py` and `legs-output.txt` on `claude/work-ledger`
## Resume
Done. Nothing to continue. Next: ASK-MODEL-FIX-REVIEW (a session that wrote none of ASK-MODEL, its review or this
fix), findings in PR 430's body §Re-review; ASK-PAGE waits on it. No row appended; nothing scheduled.
## Result
Theory fix; nothing of the product built or run. Fixtures: none (§2's parameters, W = 15, v = 25 a second; derived).
* The review's toy rerun: output reproduced exactly; checked and extended by `legs.py` (the turn seen only by the
  input, a dwell at each turn, a closed form), not replaced.
* B2: the behind split struck. Under no skip and rho < 1 every hold has ~W - 1 frames behind at a turn; the hold only
  sets when the pipeline may fetch past them: leg with no wait (W - 1 - rho k0)/(1 - rho). Simulated wait a leg, rho
  0.216, legs 40: behind first 3.40 s, three quarters 3.40, centred 3.77, struck split 4.14; a 3 s dwell before
  each turn: behind first always 5.85, centred 4.55. The hold now: behind first while moving, centred while
  dwelling (as built); no estimate in the rule. §1, §4, §5, §7 P1-P2, §8, §9, design.md pointer changed in place.
* B1: P1 on legs of 20 and 40; legs of 12 a control (P1c). m1-m6 fixed (S6 abstract sha 8f699f74; S2 BIR line
  6947; S3 dynamic, tail restored; rho table derived on theory, 0.83; exact gate h >= n - rho(n - 1); S4 observers).
* check_links 0 unresolved; comment budget ok; the gate not run (docs only).
Owner: nothing new; the asking page carries §9 after the re-review.
