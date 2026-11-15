state: done
started: 2026-11-15 17:21 UTC
heartbeat: 2026-11-15 18:06 UTC
outputs: claude/phone-round f4ad195cb (from claude/hw-probe af4b6aeb), draft PR 400 into claude/hw-probe

## Resume

Done. Commits 27336c4b..f4ad195cb on claude/phone-round; README lab/devices/README.md §The round. Brief and Amendments
unchanged since start (amendment 21).

## Result
The one-press round: round.py (laptop: plan behind GET /next, run-commit check before load 1, one adb server,
stay-on 7 set and restored, adb reads between loads only, servers per block, reboot after a marked block) and the
viewer's ?round= hook (wake lock recorded, timer gap > 2 s = VOID: stopped, a failed load recorded and the next taken,
cell 3's steps / cine / exact frames idle and busy on the viewer's thread); roundOrder() gives next-round.md's order.
Tested headless (Chromium, real viewer and servers, synthetic 64×48 20-frame pair, nine loads, fake adb, no phone):
every claim holds; each claim's mutant fails it (22 mutants named in PR 400). Headless refuses the wake lock: recorded.
Gate --quick OK (skips named in the PR); check_lab_absent green.
Found and fixed: a killed round.py left its servers holding their ports (SIGTERM handler, test first).
Not built (PHONE-LEVERS or a product seam): cell 1's bench, C2, decoder count, getStats(), the configure's
hardwareAcceleration, the page-read commit, cell 5's arms, report endings. lab/phone/'s runner and beacon superseded.
RUNNER-AUTO-REVIEW is due (a session that wrote none of this).
