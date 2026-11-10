state: done
started: 2026-11-10 10:31
heartbeat: 2026-11-10 11:34
outputs: claude/core-next 3ddc0aed, draft PR #351 into claude/core
## Resume
Done. claude/core-next: gate.yml commit 09936066, 18 --no-ff merges (23bdcd59 … 9c286a31), README §Demo 257a73e5,
line files a82d12f7, glossary + rename 9e0901be, deploy fix 3ddc0aed. The merge record is PR #351's body.
## Result
Order: plan.md's (demo branches first, then #289, #299, #302, av1-unified-mainbase, main), not coordination Open 2's.
Nothing skipped; nothing still moving. Conflicts: depth-cut vs ingest-fixes (3 files), README (phone vs demo),
#289 (4), #299 (2), #302 (1), mainbase (6; the av1* files resolved once, superseding #303), main (README).
Glossary: one row each for optimal quality, exact series, depth cut, pairing; lossy series renamed in 13 files.
Gate: full GATE OK on 9e0901be (773 s) and on the demo prefix 257a73e5 (526 s); skips: lavapipe, Firefox, nginx.
CI on 3ddc0aed: gate and deploy green. deploy was red before 3ddc0aed: paint/settle.js missing from the web image
(from #289), reproduced and fixed.
Found, not fixed: view/clock.js also missing from the web image (pre-existing, ?view=worker only).
Owner decisions: merge words on #351 merge by merge; O4 (stop after merge 13 for the demo alone);
keep or drop the 40 lab/av1/decode paths mainbase brings (recommended: drop, links to branch@commit);
close #289, #299, #302, #303 as carried; the clock.js web file.
